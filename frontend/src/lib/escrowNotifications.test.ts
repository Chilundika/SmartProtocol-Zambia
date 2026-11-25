import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyEscrowObservation,
  detectEscrowLifecycleChange,
  type EscrowObservation,
} from "./escrowNotifications.ts";

function observed(
  status: EscrowObservation["status"],
  amount: bigint | null,
  escrowId = "42",
): EscrowObservation {
  return {
    escrowId,
    exists: status !== null,
    status,
    amount,
  };
}

describe("escrow lifecycle notifications", () => {
  it("does not notify on the first baseline read", () => {
    const first = applyEscrowObservation(null, observed("Locked", 1000n));

    assert.equal(first.event, null);
    assert.equal(first.baseline.status, "Locked");
  });

  it("does not notify again when the escrow state is unchanged", () => {
    const baseline = applyEscrowObservation(null, observed("Pending", 1000n));
    const repeat = applyEscrowObservation(baseline.baseline, observed("Pending", 1000n));

    assert.equal(baseline.event, null);
    assert.equal(repeat.event, null);
    assert.equal(detectEscrowLifecycleChange(observed("Released", 0n), observed("Released", 0n)), null);
  });

  it("labels Locked to Pending as escrow funded", () => {
    const event = detectEscrowLifecycleChange(
      observed("Locked", 1000n),
      observed("Pending", 1000n),
    );

    assert.equal(event?.type, "escrow_funded");
    assert.equal(event?.escrowId, "42");
    assert.match(event?.message ?? "", /Locked to Pending/);
  });

  it("labels Pending to Released as beneficiary sign-off", () => {
    const event = detectEscrowLifecycleChange(
      observed("Pending", 1000n),
      observed("Released", 1000n),
    );

    assert.equal(event?.type, "proof_received");
    assert.match(event?.label ?? "", /sign-off/i);
  });

  it("labels Released with a balance to Released with zero as vendor payout", () => {
    const event = detectEscrowLifecycleChange(
      observed("Released", 1000n),
      observed("Released", 0n),
    );

    assert.equal(event?.type, "payout_released");
    assert.match(event?.message ?? "", /zero/);
  });

  it("does not notify for transitions outside the three lifecycle events", () => {
    assert.equal(
      detectEscrowLifecycleChange(observed("Locked", 1000n), observed("Released", 1000n)),
      null,
    );
    assert.equal(
      detectEscrowLifecycleChange(observed("Released", 1000n), observed("Released", 500n)),
      null,
    );
    assert.equal(
      detectEscrowLifecycleChange(observed("Released", 0n), observed("Released", 0n)),
      null,
    );
  });

  it("does not treat a new escrow id as a change from the previous escrow", () => {
    const event = detectEscrowLifecycleChange(
      observed("Locked", 1000n, "7"),
      observed("Pending", 1000n, "8"),
    );

    assert.equal(event, null);
  });

  it("keeps the last known escrow when a later read says it is missing", () => {
    const known = observed("Pending", 1000n);
    const applied = applyEscrowObservation(known, {
      escrowId: "42",
      exists: false,
      status: null,
      amount: null,
    });

    assert.equal(applied.event, null);
    assert.equal(applied.baseline.status, "Pending");
  });
});
