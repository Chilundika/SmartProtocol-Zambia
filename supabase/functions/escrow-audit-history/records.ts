// Read-side rules for escrow audit history.
//
// The browser never queries stellar_transaction_audit. This module turns one
// stored row plus a fresh Testnet getTransaction result into a public record,
// or rejects it. Rejection drops the row; the envelope XDR is never returned.

import {
  ESCROW_OPERATIONS,
  isCanonicalU64,
  verifyConfirmedEnvelope,
  type EscrowOperation,
} from "../transaction-audit/envelope.ts";

export const STELLAR_EXPERT_TESTNET_TX =
  "https://stellar.expert/explorer/testnet/tx";

export const OPERATION_LABELS: Record<EscrowOperation, string> = {
  init_escrow: "Escrow initialized",
  fund_escrow: "Escrow funded",
  submit_proof: "Beneficiary proof submitted",
  release_funds: "Vendor payout released",
};

export const TIMESTAMP_LABELS = {
  ledger_close: "On-chain ledger close time",
  audit_recorded: "Audit-recorded time",
} as const;

export type TimestampSource = keyof typeof TIMESTAMP_LABELS;

const LIFECYCLE_RANK: Record<EscrowOperation, number> = {
  init_escrow: 0,
  fund_escrow: 1,
  submit_proof: 2,
  release_funds: 3,
};

const HASH_PATTERN = /^[0-9a-fA-F]{64}$/;
const PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;
const LEDGER_CLOSE_MIN_SECONDS = 946684800;
const LEDGER_CLOSE_MAX_SECONDS = 4102444800;

const OPERATION_SET = new Set<string>(ESCROW_OPERATIONS);

export const PRE_AUDIT_EMPTY_MESSAGE =
  "No verified audit records exist for this escrow yet. Init, funding, proof, and payout appear here after a confirmed transaction is recorded and re-checked on Stellar Testnet.";

export const UNVERIFIED_HISTORY_MESSAGE =
  "Stored audit records for this escrow could not be re-verified on Stellar Testnet, so they are not shown.";

export interface StoredAuditRow {
  tx_hash: unknown;
  operation: unknown;
  escrow_id: unknown;
  signer_address: unknown;
  ledger: unknown;
  ledger_status: unknown;
  recorded_at: unknown;
}

export interface RpcTransactionView {
  status?: unknown;
  ledger?: unknown;
  envelopeXdr?: unknown;
  createdAt?: unknown;
}

export interface VerifiedAuditRecord {
  operation: EscrowOperation;
  operationLabel: string;
  txHash: string;
  explorerUrl: string;
  ledger: number;
  timestamp: string;
  timestampSource: TimestampSource;
  timestampLabel: string;
  signerAddress: string;
  verificationStatus: "verified";
}

export function operationLabel(operation: EscrowOperation): string {
  return OPERATION_LABELS[operation];
}

function isEscrowOperation(value: string): value is EscrowOperation {
  return OPERATION_SET.has(value);
}

function readPositiveLedger(value: unknown): number | null {
  const ledger = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(ledger) || ledger <= 0) {
    return null;
  }
  return ledger;
}

function readLedgerCloseIso(createdAt: unknown): string | null {
  if (typeof createdAt !== "number" && typeof createdAt !== "string") {
    return null;
  }
  if (typeof createdAt === "string" && !/^[0-9]+$/.test(createdAt)) {
    return null;
  }
  const seconds = Number(createdAt);
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < LEDGER_CLOSE_MIN_SECONDS ||
    seconds > LEDGER_CLOSE_MAX_SECONDS
  ) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

function readAuditRecordedIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

/**
 * Re-checks one stored row against the transaction Stellar Testnet returned.
 * A mismatch, a failed status, or a missing envelope produces no public record.
 */
export function verifyStoredAuditRow(
  row: StoredAuditRow,
  rpc: RpcTransactionView | null,
  contractId: string,
  expectedEscrowId: string,
): VerifiedAuditRecord | null {
  if (!isCanonicalU64(expectedEscrowId)) {
    return null;
  }
  if (typeof row.tx_hash !== "string" || !HASH_PATTERN.test(row.tx_hash)) {
    return null;
  }
  if (typeof row.operation !== "string" || !isEscrowOperation(row.operation)) {
    return null;
  }
  if (row.escrow_id !== expectedEscrowId) {
    return null;
  }
  if (
    typeof row.signer_address !== "string" ||
    !PUBLIC_KEY_PATTERN.test(row.signer_address)
  ) {
    return null;
  }
  if (row.ledger_status !== "SUCCESS") {
    return null;
  }

  const storedLedger = readPositiveLedger(row.ledger);
  if (storedLedger === null || !rpc || rpc.status !== "SUCCESS") {
    return null;
  }
  if (readPositiveLedger(rpc.ledger) !== storedLedger) {
    return null;
  }
  if (typeof rpc.envelopeXdr !== "string" || !rpc.envelopeXdr) {
    return null;
  }

  try {
    verifyConfirmedEnvelope(
      rpc.envelopeXdr,
      {
        operation: row.operation,
        escrowId: expectedEscrowId,
        signerAddress: row.signer_address,
      },
      contractId,
    );
  } catch {
    return null;
  }

  const ledgerClose = readLedgerCloseIso(rpc.createdAt);
  const auditRecorded = readAuditRecordedIso(row.recorded_at);
  const timestamp = ledgerClose ?? auditRecorded;
  if (!timestamp) {
    return null;
  }
  const timestampSource: TimestampSource = ledgerClose
    ? "ledger_close"
    : "audit_recorded";
  const txHash = row.tx_hash.toLowerCase();

  return {
    operation: row.operation,
    operationLabel: operationLabel(row.operation),
    txHash,
    explorerUrl: `${STELLAR_EXPERT_TESTNET_TX}/${txHash}`,
    ledger: storedLedger,
    timestamp,
    timestampSource,
    timestampLabel: TIMESTAMP_LABELS[timestampSource],
    signerAddress: row.signer_address,
    verificationStatus: "verified",
  };
}

export function orderVerifiedAuditRecords(
  records: readonly VerifiedAuditRecord[],
): VerifiedAuditRecord[] {
  return [...records].sort((left, right) => {
    const rank = LIFECYCLE_RANK[left.operation] - LIFECYCLE_RANK[right.operation];
    if (rank !== 0) {
      return rank;
    }
    if (left.ledger !== right.ledger) {
      return left.ledger - right.ledger;
    }
    return left.txHash.localeCompare(right.txHash);
  });
}

export function assembleAuditHistory(
  rows: readonly StoredAuditRow[],
  readRpc: (txHash: string) => RpcTransactionView | null,
  contractId: string,
  escrowId: string,
): {
  records: VerifiedAuditRecord[];
  unverifiedCount: number;
  emptyMessage: string | null;
} {
  if (!isCanonicalU64(escrowId)) {
    throw new Error("escrowId must be a canonical u64 decimal string.");
  }

  const verified: VerifiedAuditRecord[] = [];
  let unverifiedCount = 0;
  for (const row of rows) {
    const txHash = typeof row.tx_hash === "string" ? row.tx_hash : "";
    const record = verifyStoredAuditRow(
      row,
      txHash ? readRpc(txHash) : null,
      contractId,
      escrowId,
    );
    if (record) {
      verified.push(record);
    } else {
      unverifiedCount += 1;
    }
  }

  const records = orderVerifiedAuditRecords(verified);
  return {
    records,
    unverifiedCount,
    emptyMessage: records.length > 0
      ? null
      : unverifiedCount > 0
        ? UNVERIFIED_HISTORY_MESSAGE
        : PRE_AUDIT_EMPTY_MESSAGE,
  };
}
