"use client";

import { useEffect, useRef, useState } from "react";

import { getEscrowState } from "@/src/blockchain/stellarClient";
import {
  applyEscrowObservation,
  observationFromEscrowRead,
  type EscrowLifecycleChange,
  type EscrowObservation,
} from "@/src/lib/escrowNotifications";

/** New dashboard poller. It does not replace the manual status refresh. */
const ESCROW_NOTIFICATION_POLL_MS = 6000;
const MAX_NOTIFICATIONS = 20;

export interface EscrowLifecycleNotification extends EscrowLifecycleChange {
  id: number;
  occurredAt: string;
}

function parsePollEscrowId(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

/**
 * Reads one escrow from Stellar Testnet while the dashboard is open.
 * The first successful read is silent. Later lifecycle changes are appended
 * to the notification list. A background failure keeps the previous baseline
 * and does not touch the page's escrow card or spinner.
 */
export function useEscrowLifecycleNotifications(input: {
  escrowId: string;
  sourceAddress: string | null;
}): EscrowLifecycleNotification[] {
  const { escrowId, sourceAddress } = input;
  const [notifications, setNotifications] = useState<EscrowLifecycleNotification[]>([]);
  const baselineRef = useRef<EscrowObservation | null>(null);
  const inFlightRef = useRef(false);
  const notificationIdRef = useRef(0);

  useEffect(() => {
    const parsedEscrowId = parsePollEscrowId(escrowId);
    const canonicalEscrowId = parsedEscrowId === null ? null : String(parsedEscrowId);
    baselineRef.current = null;

    if (!sourceAddress || canonicalEscrowId === null || parsedEscrowId === null) {
      return;
    }

    let active = true;

    const poll = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;
      try {
        const result = await getEscrowState(parsedEscrowId, sourceAddress);
        if (!active) {
          return;
        }
        const next = observationFromEscrowRead(canonicalEscrowId, result);
        const applied = applyEscrowObservation(baselineRef.current, next);
        baselineRef.current = applied.baseline;
        if (!applied.event) {
          return;
        }
        const event = applied.event;
        const notice: EscrowLifecycleNotification = {
          ...event,
          id: notificationIdRef.current + 1,
          occurredAt: new Date().toISOString(),
        };
        notificationIdRef.current = notice.id;
        setNotifications((current) => [...current, notice].slice(-MAX_NOTIFICATIONS));
      } catch (error) {
        console.error("[escrow-notifications] background read failed", error);
      } finally {
        inFlightRef.current = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, ESCROW_NOTIFICATION_POLL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [escrowId, sourceAddress]);

  return notifications;
}
