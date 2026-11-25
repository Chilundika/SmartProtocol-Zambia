import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUDIT_HISTORY_ERROR_MESSAGE,
  AUDIT_OPERATION_LABELS,
  AUDIT_TIMESTAMP_LABELS,
  HISTORY_REFRESH_FAILED_NOTE,
  PRE_AUDIT_EMPTY_MESSAGE,
  UNVERIFIED_HISTORY_MESSAGE,
  auditHistoryView,
  compactHistorySummary,
  historyEscrowId,
  historyRefreshNote,
  parseEscrowAuditHistory,
  type EscrowAuditRecord,
} from "./escrowAuditHistory.ts";

const HASH = "ab".repeat(32);

function record(overrides: Partial<EscrowAuditRecord> = {}): EscrowAuditRecord {
  const txHash = overrides.txHash ?? HASH;
  return {
    operation: "fund_escrow",
    operationLabel: AUDIT_OPERATION_LABELS.fund_escrow,
    txHash,
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txHash}`,
    ledger: 20,
    timestamp: "2026-04-02T08:30:00.000Z",
    timestampSource: "ledger_close",
    timestampLabel: AUDIT_TIMESTAMP_LABELS.ledger_close,
    signerAddress: "G".padEnd(56, "A"),
    verificationStatus: "verified",
    ...overrides,
  };
}

describe("escrow audit history display", () => {
  it("maps each operation and timestamp source to a fixed label", () => {
    assert.equal(AUDIT_OPERATION_LABELS.init_escrow, "Escrow initialized");
    assert.equal(AUDIT_OPERATION_LABELS.fund_escrow, "Escrow funded");
    assert.equal(AUDIT_OPERATION_LABELS.submit_proof, "Beneficiary proof submitted");
    assert.equal(AUDIT_OPERATION_LABELS.release_funds, "Vendor payout released");
    assert.equal(AUDIT_TIMESTAMP_LABELS.ledger_close, "On-chain ledger close time");
    assert.equal(AUDIT_TIMESTAMP_LABELS.audit_recorded, "Audit-recorded time");
  });

  it("uses the pre-audit explanation when history is empty", () => {
    const view = auditHistoryView({
      loading: false,
      error: null,
      records: [],
      unverifiedCount: 0,
    });

    assert.equal(view.kind, "empty");
    if (view.kind === "empty") {
      assert.equal(view.message, PRE_AUDIT_EMPTY_MESSAGE);
    }
  });

  it("keeps a load failure separate from the pre-audit empty state", () => {
    const view = auditHistoryView({
      loading: false,
      error: AUDIT_HISTORY_ERROR_MESSAGE,
      records: [],
      unverifiedCount: 0,
    });

    assert.deepEqual(view, { kind: "error", message: AUDIT_HISTORY_ERROR_MESSAGE });
    assert.notEqual(AUDIT_HISTORY_ERROR_MESSAGE, PRE_AUDIT_EMPTY_MESSAGE);
  });

  it("preserves lifecycle order and labels a ledger-close record from its source", () => {
    const init = record({
      operation: "init_escrow",
      txHash: "11".repeat(32),
      ledger: 4,
      timestampSource: "audit_recorded",
    });
    const payout = record({
      operation: "release_funds",
      txHash: "22".repeat(32),
      ledger: 9,
      timestampSource: "ledger_close",
    });
    const parsed = parseEscrowAuditHistory({
      ok: true,
      escrowId: "42",
      unverifiedCount: 1,
      emptyMessage: null,
      records: [init, payout],
    });
    const view = auditHistoryView({
      loading: false,
      error: null,
      records: parsed.records,
      unverifiedCount: parsed.unverifiedCount,
    });

    assert.equal(view.kind, "records");
    if (view.kind !== "records") {
      return;
    }
    assert.deepEqual(
      view.records.map((item) => item.operation),
      ["init_escrow", "release_funds"],
    );
    assert.equal(view.records[0].operationLabel, "Escrow initialized");
    assert.equal(view.records[0].timestampLabel, "Audit-recorded time");
    assert.equal(view.records[1].timestampLabel, "On-chain ledger close time");
    assert.equal(
      view.omittedMessage,
      "Some stored audit records could not be re-verified and were omitted.",
    );
  });

  it("keeps a collapsed summary free of invented events", () => {
    assert.equal(
      compactHistorySummary({ loaded: false, loading: false, error: null, recordCount: 0 }),
      "Verified history is collapsed",
    );
    assert.equal(
      compactHistorySummary({ loaded: true, loading: false, error: null, recordCount: 0 }),
      "No verified events yet",
    );
    assert.equal(
      compactHistorySummary({ loaded: true, loading: false, error: null, recordCount: 2 }),
      "2 verified events",
    );
    assert.equal(
      compactHistorySummary({
        loaded: false,
        loading: false,
        error: AUDIT_HISTORY_ERROR_MESSAGE,
        recordCount: 0,
      }),
      "History could not be loaded",
    );
    assert.equal(
      compactHistorySummary({
        loaded: true,
        loading: false,
        error: AUDIT_HISTORY_ERROR_MESSAGE,
        recordCount: 2,
      }),
      "2 verified events",
    );
    assert.equal(
      historyRefreshNote({ loaded: true, error: AUDIT_HISTORY_ERROR_MESSAGE }),
      HISTORY_REFRESH_FAILED_NOTE,
    );
    assert.equal(historyRefreshNote({ loaded: false, error: AUDIT_HISTORY_ERROR_MESSAGE }), null);
    assert.equal(historyRefreshNote({ loaded: true, error: null }), null);
  });

  it("scopes a history request to one canonical escrow id", () => {
    assert.equal(historyEscrowId("01"), "1");
    assert.equal(historyEscrowId("42"), "42");
    assert.equal(historyEscrowId(""), null);
    assert.equal(historyEscrowId("1.5"), null);
    assert.equal(historyEscrowId("999999999999999999999"), null);
  });

  it("rejects a payload that leaks an envelope or misstates verification", () => {
    const base = {
      ok: true,
      escrowId: "42",
      unverifiedCount: 0,
      records: [{ ...record(), envelopeXdr: "AAAA" }],
    };

    assert.throws(() => parseEscrowAuditHistory(base), /unchanged/);
    assert.throws(
      () => parseEscrowAuditHistory({
        ...base,
        records: [{ ...record(), verificationStatus: "unverified" }],
      }),
      /unchanged/,
    );
    assert.equal(UNVERIFIED_HISTORY_MESSAGE.includes("not shown"), true);
  });
});
