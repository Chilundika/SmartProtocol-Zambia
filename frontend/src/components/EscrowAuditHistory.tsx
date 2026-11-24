"use client";

import { useEffect, useState } from "react";

import {
  AUDIT_HISTORY_ERROR_MESSAGE,
  auditHistoryView,
  type EscrowAuditRecord,
} from "@/src/lib/escrowAuditHistory";
import { fetchEscrowAuditHistory } from "@/src/lib/fetchEscrowAuditHistory";
import type { EscrowStatusOnChain } from "@/src/blockchain/stellarClient";

function formatLocalTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function EscrowAuditHistory({
  escrowId,
  refreshKey,
  status,
  balanceXlm,
}: {
  escrowId: string;
  refreshKey: number;
  status: EscrowStatusOnChain;
  balanceXlm: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<EscrowAuditRecord[]>([]);
  const [unverifiedCount, setUnverifiedCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setRecords([]);
    setUnverifiedCount(0);

    void fetchEscrowAuditHistory(escrowId)
      .then((history) => {
        if (!active) {
          return;
        }
        setRecords(history.records);
        setUnverifiedCount(history.unverifiedCount);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setError(AUDIT_HISTORY_ERROR_MESSAGE);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [escrowId, refreshKey]);

  const view = auditHistoryView({
    loading,
    error,
    records,
    unverifiedCount,
  });

  return (
    <section
      className="mt-6 border-t border-zinc-800 pt-5"
      aria-labelledby={`audit-history-${escrowId}`}
    >
      <h3 id={`audit-history-${escrowId}`} className="text-sm font-semibold text-white">
        Audit history
      </h3>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">
            Current on-chain status
          </dt>
          <dd className="mt-1 text-sm font-semibold text-white">{status}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">
            Escrow balance
          </dt>
          <dd className="mt-1 text-sm font-semibold text-white">{balanceXlm} XLM</dd>
        </div>
      </dl>

      {view.kind === "loading" ? (
        <p className="mt-4 text-sm text-zinc-400" role="status">
          Loading audit history…
        </p>
      ) : null}

      {view.kind === "error" ? (
        <p className="mt-4 text-sm text-zinc-300" role="status">
          {view.message}
        </p>
      ) : null}

      {view.kind === "empty" ? (
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">{view.message}</p>
      ) : null}

      {view.kind === "records" ? (
        <div className="mt-4 space-y-3">
          {view.omittedMessage ? (
            <p className="text-sm text-zinc-400">{view.omittedMessage}</p>
          ) : null}
          <ol className="space-y-3">
            {view.records.map((record) => (
              <li
                key={record.txHash}
                className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3"
              >
                <p className="text-sm font-semibold text-white">{record.operationLabel}</p>
                <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">
                  Transaction
                </p>
                <a
                  href={record.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block break-all font-mono text-xs text-emerald-300 underline-offset-2 hover:underline"
                >
                  {record.txHash}
                </a>
                <p className="mt-2 text-xs text-zinc-400">Ledger {record.ledger}</p>
                <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">
                  {record.timestampLabel}
                </p>
                <time className="mt-1 block text-sm text-zinc-200" dateTime={record.timestamp}>
                  {formatLocalTime(record.timestamp)}
                </time>
                <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">Signer</p>
                <p className="mt-1 break-all font-mono text-xs text-zinc-300">
                  {record.signerAddress}
                </p>
                <p className="mt-2 text-xs text-emerald-200">
                  Verification status: Verified
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
