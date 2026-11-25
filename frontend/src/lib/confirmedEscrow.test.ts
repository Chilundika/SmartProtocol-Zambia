import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalEscrowAuditId,
  confirmedTransactionFeedback,
} from "./confirmedEscrow.ts";

describe("canonical escrow audit id", () => {
  it("normalizes 01 to 1 for the signed id and the audit record", () => {
    const parsedEscrowId = Number("01");
    const auditEscrowId = canonicalEscrowAuditId(parsedEscrowId);

    assert.equal(parsedEscrowId, 1);
    assert.equal(auditEscrowId, "1");
    assert.equal(auditEscrowId, String(parsedEscrowId));
  });
});

describe("post-confirmation feedback", () => {
  it("keeps a confirmed transaction successful when status refresh fails", () => {
    const feedback = confirmedTransactionFeedback({
      refreshError: new Error("Soroban RPC unavailable"),
    });

    assert.equal(feedback.kind, "success");
    assert.equal(feedback.auditWarning, undefined);
    assert.match(feedback.refreshWarning ?? "", /Status refresh failed/);
    assert.match(feedback.refreshWarning ?? "", /remains confirmed/);
    assert.match(feedback.refreshWarning ?? "", /Soroban RPC unavailable/);
  });

  it("keeps success when the audit write and the status refresh both fail", () => {
    const feedback = confirmedTransactionFeedback({
      auditError: new Error("audit down"),
      refreshError: new Error("refresh down"),
    });

    assert.equal(feedback.kind, "success");
    assert.equal(feedback.auditWarning, "audit down");
    assert.match(feedback.refreshWarning ?? "", /refresh down/);
  });
});
