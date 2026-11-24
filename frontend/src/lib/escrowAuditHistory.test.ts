import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUDIT_HISTORY_ERROR_MESSAGE,
  AUDIT_OPERATION_LABELS,
  AUDIT_TIMESTAMP_LABELS,
  PRE_AUDIT_EMPTY_MESSAGE,
  UNVERIFIED_HISTORY_MESSAGE,
  auditHistoryView,
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
