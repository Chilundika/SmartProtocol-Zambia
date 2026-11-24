import {
  Account,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  type xdr,
} from "npm:@stellar/stellar-sdk@17.0.1";
import { isCanonicalU64 } from "../transaction-audit/envelope.ts";
import {
  OPERATION_LABELS,
  PRE_AUDIT_EMPTY_MESSAGE,
  TIMESTAMP_LABELS,
  UNVERIFIED_HISTORY_MESSAGE,
  assembleAuditHistory,
  orderVerifiedAuditRecords,
  verifyStoredAuditRow,
  type StoredAuditRow,
  type VerifiedAuditRecord,
} from "./records.ts";

const source = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(1));
const escrowContract = StrKey.encodeContract(new Uint8Array(32).fill(3));
const otherContract = StrKey.encodeContract(new Uint8Array(32).fill(4));
const LEDGER_CLOSE_SECONDS = 1712345678;

function u64(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

function signedEnvelope(functionName: string, escrowId: bigint, contract = escrowContract): string {
  const account = new Account(source.publicKey(), "1");
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeContractFunction({
      contract,
      function: functionName,
      args: [u64(escrowId)],
    }))
    .setTimeout(30)
    .build();
  transaction.sign(source);
  return transaction.toXdr();
}

function storedRow(
  operation: StoredAuditRow["operation"],
  txHash: string,
  overrides: Partial<StoredAuditRow> = {},
): StoredAuditRow {
  return {
    tx_hash: txHash,
    operation,
    escrow_id: "42",
    signer_address: source.publicKey(),
    ledger: 500,
    ledger_status: "SUCCESS",
    recorded_at: "2026-03-01T12:00:00.000Z",
    ...overrides,
  };
}

function verifiedRecord(
  operation: VerifiedAuditRecord["operation"],
  ledger: number,
  txHash: string,
): VerifiedAuditRecord {
  return {
    operation,
    operationLabel: OPERATION_LABELS[operation],
    txHash,
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txHash}`,
    ledger,
    timestamp: "2026-03-01T12:00:00.000Z",
    timestampSource: "audit_recorded",
    timestampLabel: TIMESTAMP_LABELS.audit_recorded,
    signerAddress: source.publicKey(),
    verificationStatus: "verified",
  };
}

Deno.test("labels each lifecycle operation for display", () => {
  if (OPERATION_LABELS.init_escrow !== "Escrow initialized") {
    throw new Error("init label");
  }
  if (OPERATION_LABELS.fund_escrow !== "Escrow funded") {
    throw new Error("fund label");
  }
  if (OPERATION_LABELS.submit_proof !== "Beneficiary proof submitted") {
    throw new Error("proof label");
  }
  if (OPERATION_LABELS.release_funds !== "Vendor payout released") {
    throw new Error("payout label");
  }
});

Deno.test("accepts a re-checked envelope and labels ledger close time", () => {
  const envelope = signedEnvelope("fund_escrow", 42n);
  const hash = "ab".repeat(32);
  const record = verifyStoredAuditRow(
    storedRow("fund_escrow", hash),
    {
      status: "SUCCESS",
      ledger: 500,
      envelopeXdr: envelope,
      createdAt: String(LEDGER_CLOSE_SECONDS),
    },
    escrowContract,
    "42",
  );

  if (!record) {
    throw new Error("expected a verified record");
  }
  if (record.timestampSource !== "ledger_close") {
    throw new Error(`timestamp source ${record.timestampSource}`);
  }
  if (record.timestampLabel !== "On-chain ledger close time") {
    throw new Error(record.timestampLabel);
  }
  if (record.timestamp !== new Date(LEDGER_CLOSE_SECONDS * 1000).toISOString()) {
    throw new Error(record.timestamp);
  }
  if (record.verificationStatus !== "verified") {
    throw new Error(record.verificationStatus);
  }
  if (record.explorerUrl !== `https://stellar.expert/explorer/testnet/tx/${hash}`) {
    throw new Error(record.explorerUrl);
  }
  if ("envelopeXdr" in record) {
    throw new Error("public record included the envelope");
  }
});

Deno.test("labels audit-recorded time when the ledger close time is absent", () => {
  const record = verifyStoredAuditRow(
    storedRow("init_escrow", "cd".repeat(32), {
      recorded_at: "2026-04-02T08:30:00.000Z",
    }),
    {
      status: "SUCCESS",
      ledger: "500",
      envelopeXdr: signedEnvelope("init_escrow", 42n),
    },
    escrowContract,
    "42",
  );

  if (!record || record.timestampSource !== "audit_recorded") {
    throw new Error("expected the audit-recorded timestamp");
  }
  if (record.timestampLabel !== "Audit-recorded time") {
    throw new Error(record.timestampLabel);
  }
  if (record.timestamp !== "2026-04-02T08:30:00.000Z") {
    throw new Error(record.timestamp);
  }
});

Deno.test("rejects a stored row whose envelope does not match the audit fields", () => {
  const hash = "ef".repeat(32);
  const cases: Array<{ row: StoredAuditRow; contractId?: string; name: string }> = [
    {
      name: "signer",
      row: storedRow("fund_escrow", hash, {
        signer_address: Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(2)).publicKey(),
      }),
    },
    {
      name: "operation",
      row: storedRow("release_funds", hash),
    },
    {
      name: "contract",
      row: storedRow("fund_escrow", hash),
      contractId: otherContract,
    },
    {
      name: "escrow id",
      row: storedRow("fund_escrow", hash, { escrow_id: "43" }),
    },
  ];

  for (const testCase of cases) {
    const record = verifyStoredAuditRow(
      testCase.row,
      {
        status: "SUCCESS",
        ledger: 500,
        envelopeXdr: signedEnvelope("fund_escrow", 42n),
        createdAt: LEDGER_CLOSE_SECONDS,
      },
      testCase.contractId ?? escrowContract,
      "42",
    );
    if (record) {
      throw new Error(`${testCase.name} was accepted`);
    }
  }
});

Deno.test("rejects a transaction that is not SUCCESS or whose ledger changed", () => {
  const row = storedRow("submit_proof", "11".repeat(32));
  const envelope = signedEnvelope("submit_proof", 42n);
  const failed = verifyStoredAuditRow(
    row,
    { status: "FAILED", ledger: 500, envelopeXdr: envelope, createdAt: LEDGER_CLOSE_SECONDS },
    escrowContract,
    "42",
  );
  const moved = verifyStoredAuditRow(
    row,
    { status: "SUCCESS", ledger: 501, envelopeXdr: envelope, createdAt: LEDGER_CLOSE_SECONDS },
    escrowContract,
    "42",
  );
  if (failed || moved) {
    throw new Error("expected both rows to be unverified");
  }
});

Deno.test("explains empty history for an escrow with no audit rows", () => {
  const history = assembleAuditHistory([], () => null, escrowContract, "7");
  if (history.records.length !== 0 || history.unverifiedCount !== 0) {
    throw new Error("expected an empty verified history");
  }
  if (history.emptyMessage !== PRE_AUDIT_EMPTY_MESSAGE) {
    throw new Error(history.emptyMessage ?? "missing empty message");
  }
});

Deno.test("omits rows that fail re-verification and orders the verified lifecycle", () => {
  const initHash = "a1".repeat(32);
  const fundEarly = "b2".repeat(32);
  const fundLate = "c3".repeat(32);
  const proofHash = "d4".repeat(32);
  const payoutHash = "e5".repeat(32);
  const badHash = "f6".repeat(32);
  const envelopes: Record<string, string> = {
    [initHash]: signedEnvelope("init_escrow", 42n),
    [fundEarly]: signedEnvelope("fund_escrow", 42n),
    [fundLate]: signedEnvelope("fund_escrow", 42n),
    [proofHash]: signedEnvelope("submit_proof", 42n),
    [payoutHash]: signedEnvelope("release_funds", 42n),
    [badHash]: signedEnvelope("fund_escrow", 99n),
  };
  const ledgers: Record<string, number> = {
    [initHash]: 10,
    [fundEarly]: 12,
    [fundLate]: 40,
    [proofHash]: 15,
    [payoutHash]: 11,
    [badHash]: 13,
  };

  const history = assembleAuditHistory(
    [
      storedRow("release_funds", payoutHash, { ledger: ledgers[payoutHash] }),
      storedRow("fund_escrow", badHash, { ledger: ledgers[badHash], escrow_id: "99" }),
      storedRow("fund_escrow", fundLate, { ledger: ledgers[fundLate] }),
      storedRow("init_escrow", initHash, { ledger: ledgers[initHash] }),
      storedRow("submit_proof", proofHash, { ledger: ledgers[proofHash] }),
      storedRow("fund_escrow", fundEarly, { ledger: ledgers[fundEarly] }),
    ],
    (txHash) => ({
      status: "SUCCESS",
      ledger: ledgers[txHash],
      envelopeXdr: envelopes[txHash],
      createdAt: LEDGER_CLOSE_SECONDS,
    }),
    escrowContract,
    "42",
  );

  const order = history.records.map((record) => `${record.operation}:${record.ledger}`);
  if (order.join(",") !== "init_escrow:10,fund_escrow:12,fund_escrow:40,submit_proof:15,release_funds:11") {
    throw new Error(order.join(","));
  }
  if (history.unverifiedCount !== 1 || history.emptyMessage !== null) {
    throw new Error("expected one omitted row and no empty message");
  }
});

Deno.test("orders equal operations by ledger and then transaction hash", () => {
  const laterHash = "bb".repeat(32);
  const earlierHash = "aa".repeat(32);
  const ordered = orderVerifiedAuditRecords([
    verifiedRecord("fund_escrow", 20, laterHash),
    verifiedRecord("fund_escrow", 20, earlierHash),
    verifiedRecord("fund_escrow", 5, laterHash),
  ]);
  const keys = ordered.map((record) => `${record.ledger}:${record.txHash.slice(0, 2)}`);
  if (keys.join(",") !== "5:bb,20:aa,20:bb") {
    throw new Error(keys.join(","));
  }
});

Deno.test("rejects a non-canonical escrow id before reading rows", () => {
  if (isCanonicalU64("01")) {
    throw new Error("01 is not canonical");
  }
  let thrown: unknown;
  try {
    assembleAuditHistory([], () => null, escrowContract, "01");
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof Error) || !thrown.message.includes("canonical")) {
    throw new Error("expected a canonical escrow id rejection");
  }
  if (
    UNVERIFIED_HISTORY_MESSAGE.length === 0 ||
    PRE_AUDIT_EMPTY_MESSAGE.length === 0 ||
    UNVERIFIED_HISTORY_MESSAGE.includes("No verified audit records")
  ) {
    throw new Error("empty and unverified copy must stay distinct");
  }
});
