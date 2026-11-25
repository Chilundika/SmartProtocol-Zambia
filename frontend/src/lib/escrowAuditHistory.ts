const TESTNET_TX_PREFIX = "https://stellar.expert/explorer/testnet/tx/";
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;

export const AUDIT_OPERATION_LABELS = {
  init_escrow: "Escrow initialized",
  fund_escrow: "Escrow funded",
  submit_proof: "Beneficiary proof submitted",
  release_funds: "Vendor payout released",
} as const;

export const AUDIT_TIMESTAMP_LABELS = {
  ledger_close: "On-chain ledger close time",
  audit_recorded: "Audit-recorded time",
} as const;

export const PRE_AUDIT_EMPTY_MESSAGE =
  "No verified audit records exist for this escrow yet. Init, funding, proof, and payout appear here after a confirmed transaction is recorded and re-checked on Stellar Testnet.";

export const UNVERIFIED_HISTORY_MESSAGE =
  "Stored audit records for this escrow could not be re-verified on Stellar Testnet, so they are not shown.";

export const AUDIT_HISTORY_ERROR_MESSAGE =
  "Audit history could not be loaded. The on-chain status and balance above are unchanged.";

export const HISTORY_REFRESH_FAILED_NOTE =
  "Refresh failed. Showing the last verified result.";

export type AuditOperation = keyof typeof AUDIT_OPERATION_LABELS;
export type AuditTimestampSource = keyof typeof AUDIT_TIMESTAMP_LABELS;

export interface EscrowAuditRecord {
  operation: AuditOperation;
  operationLabel: string;
  txHash: string;
  explorerUrl: string;
  ledger: number;
  timestamp: string;
  timestampSource: AuditTimestampSource;
  timestampLabel: string;
  signerAddress: string;
  verificationStatus: "verified";
}

export interface EscrowAuditHistory {
  escrowId: string;
  records: EscrowAuditRecord[];
  unverifiedCount: number;
}

export class EscrowAuditHistoryError extends Error {
  constructor() {
    super(AUDIT_HISTORY_ERROR_MESSAGE);
    this.name = "EscrowAuditHistoryError";
  }
}

function isAuditOperation(value: unknown): value is AuditOperation {
  return typeof value === "string" && value in AUDIT_OPERATION_LABELS;
}

function isTimestampSource(value: unknown): value is AuditTimestampSource {
  return value === "ledger_close" || value === "audit_recorded";
}

function readRecord(value: unknown): EscrowAuditRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EscrowAuditHistoryError();
  }
  const record = value as Record<string, unknown>;
  if ("envelopeXdr" in record || "recorded_at" in record) {
    throw new EscrowAuditHistoryError();
  }
  if (!isAuditOperation(record.operation) || !isTimestampSource(record.timestampSource)) {
    throw new EscrowAuditHistoryError();
  }
  if (typeof record.txHash !== "string" || !HASH_PATTERN.test(record.txHash)) {
    throw new EscrowAuditHistoryError();
  }
  if (record.explorerUrl !== `${TESTNET_TX_PREFIX}${record.txHash}`) {
    throw new EscrowAuditHistoryError();
  }
  if (typeof record.ledger !== "number" || !Number.isSafeInteger(record.ledger) || record.ledger <= 0) {
    throw new EscrowAuditHistoryError();
  }
  if (typeof record.timestamp !== "string" || Number.isNaN(new Date(record.timestamp).getTime())) {
    throw new EscrowAuditHistoryError();
  }
  if (typeof record.signerAddress !== "string" || !PUBLIC_KEY_PATTERN.test(record.signerAddress)) {
    throw new EscrowAuditHistoryError();
  }
  if (record.verificationStatus !== "verified") {
    throw new EscrowAuditHistoryError();
  }

  return {
    operation: record.operation,
    operationLabel: AUDIT_OPERATION_LABELS[record.operation],
    txHash: record.txHash,
    explorerUrl: record.explorerUrl,
    ledger: record.ledger,
    timestamp: record.timestamp,
    timestampSource: record.timestampSource,
    timestampLabel: AUDIT_TIMESTAMP_LABELS[record.timestampSource],
    signerAddress: record.signerAddress,
    verificationStatus: "verified",
  };
}

export function parseEscrowAuditHistory(payload: unknown): EscrowAuditHistory {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new EscrowAuditHistoryError();
  }
  const body = payload as Record<string, unknown>;
  if (body.ok !== true || typeof body.escrowId !== "string" || !/^(0|[1-9][0-9]*)$/.test(body.escrowId)) {
    throw new EscrowAuditHistoryError();
  }
  if (!Array.isArray(body.records)) {
    throw new EscrowAuditHistoryError();
  }
  if (
    typeof body.unverifiedCount !== "number" ||
    !Number.isSafeInteger(body.unverifiedCount) ||
    body.unverifiedCount < 0
  ) {
    throw new EscrowAuditHistoryError();
  }

  return {
    escrowId: body.escrowId,
    records: body.records.map((record) => readRecord(record)),
    unverifiedCount: body.unverifiedCount,
  };
}

export type AuditHistoryView =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty"; message: string }
  | { kind: "records"; records: EscrowAuditRecord[]; omittedMessage: string | null };

/**
 * Compact line shown while a history dropdown is collapsed. A count appears
 * only after a verified payload has loaded.
 */
export function compactHistorySummary(input: {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  recordCount: number;
}): string {
  if (input.error && !input.loaded) {
    return "History could not be loaded";
  }
  if (!input.loaded) {
    return input.loading ? "Loading verified history…" : "Verified history is collapsed";
  }
  if (input.recordCount <= 0) {
    return "No verified events yet";
  }
  return input.recordCount === 1
    ? "1 verified event"
    : `${input.recordCount} verified events`;
}

/** Short note when a later refresh fails and the last verified count stays. */
export function historyRefreshNote(input: {
  loaded: boolean;
  error: string | null;
}): string | null {
  if (!input.loaded || !input.error) {
    return null;
  }
  return HISTORY_REFRESH_FAILED_NOTE;
}

/** Canonical escrow id for a history request, or null when the id is not a safe integer. */
export function historyEscrowId(raw: string): string | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }
  return String(parsed);
}

/**
 * Chooses the history panel from a verified payload. An unfamiliar empty
 * message still uses the pre-audit explanation, and a ledger-close record
 * never receives the audit-recorded label.
 */
export function auditHistoryView(input: {
  loading: boolean;
  error: string | null;
  records: readonly EscrowAuditRecord[];
  unverifiedCount: number;
}): AuditHistoryView {
  if (input.loading) {
    return { kind: "loading" };
  }
  if (input.error) {
    return { kind: "error", message: input.error };
  }
  if (input.records.length === 0) {
    return {
      kind: "empty",
      message: input.unverifiedCount > 0
        ? UNVERIFIED_HISTORY_MESSAGE
        : PRE_AUDIT_EMPTY_MESSAGE,
    };
  }
  return {
    kind: "records",
    records: [...input.records],
    omittedMessage: input.unverifiedCount > 0
      ? "Some stored audit records could not be re-verified and were omitted."
      : null,
  };
}
