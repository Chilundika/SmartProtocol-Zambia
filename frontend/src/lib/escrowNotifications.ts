import type { EscrowStateResult, EscrowStatusOnChain } from "@/src/blockchain/stellarClient";

/**
 * Difference between two Testnet escrow reads. The first read is only a
 * baseline. A notification is produced only when a later read matches one of
 * the three lifecycle changes.
 */

export type EscrowLifecycleEventType =
  | "escrow_funded"
  | "proof_received"
  | "payout_released";

export interface EscrowObservation {
  escrowId: string;
  exists: boolean;
  status: EscrowStatusOnChain | null;
  amount: bigint | null;
}

export interface EscrowLifecycleChange {
  escrowId: string;
  type: EscrowLifecycleEventType;
  label: string;
  message: string;
}

export function observationFromEscrowRead(
  escrowId: string,
  result: EscrowStateResult,
): EscrowObservation {
  if (!result.exists || !result.escrow) {
    return { escrowId, exists: false, status: null, amount: null };
  }
  return {
    escrowId,
    exists: true,
    status: result.escrow.status,
    amount: result.escrow.amount,
  };
}

export function detectEscrowLifecycleChange(
  previous: EscrowObservation | null,
  next: EscrowObservation,
): EscrowLifecycleChange | null {
  if (!previous || previous.escrowId !== next.escrowId) {
    return null;
  }
  if (!previous.exists || !next.exists || !previous.status || !next.status) {
    return null;
  }
  if (previous.amount === null || next.amount === null) {
    return null;
  }

  if (previous.status === "Locked" && next.status === "Pending") {
    return {
      escrowId: next.escrowId,
      type: "escrow_funded",
      label: "Escrow funded",
      message: "The escrow moved from Locked to Pending. Funds have been deposited.",
    };
  }

  if (previous.status === "Pending" && next.status === "Released") {
    return {
      escrowId: next.escrowId,
      type: "proof_received",
      label: "Beneficiary sign-off received",
      message: "The escrow moved from Pending to Released. Milestone proof was submitted.",
    };
  }

  if (
    previous.status === "Released" &&
    next.status === "Released" &&
    previous.amount > BigInt(0) &&
    next.amount === BigInt(0)
  ) {
    return {
      escrowId: next.escrowId,
      type: "payout_released",
      label: "Vendor payout released",
      message: "The escrow remains Released and its balance is now zero. The vendor payout was released.",
    };
  }

  return null;
}

/**
 * Keeps the last known escrow when a later successful read says it is missing,
 * so a transient empty result does not erase the baseline. A failed RPC call
 * never reaches this function.
 */
export function applyEscrowObservation(
  previous: EscrowObservation | null,
  next: EscrowObservation,
): { baseline: EscrowObservation; event: EscrowLifecycleChange | null } {
  if (previous?.exists && !next.exists) {
    return { baseline: previous, event: null };
  }
  return {
    baseline: next,
    event: detectEscrowLifecycleChange(previous, next),
  };
}
