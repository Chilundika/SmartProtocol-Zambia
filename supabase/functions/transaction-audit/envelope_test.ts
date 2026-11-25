// Regression tests for the confirmed-envelope verifier.
// Run: deno test supabase/functions/transaction-audit
// Uses only npm:@stellar/stellar-sdk@17.0.1, the same pin as envelope.ts.

import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  type xdr,
} from "npm:@stellar/stellar-sdk@17.0.1";
import {
  isCanonicalU64,
  verifyConfirmedEnvelope,
  type EscrowOperation,
} from "./envelope.ts";

const source = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(1));
const other = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(2));
const feePayer = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(9));
const escrowContract = StrKey.encodeContract(new Uint8Array(32).fill(3));
const otherContract = StrKey.encodeContract(new Uint8Array(32).fill(4));

function u64(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

function invoke(
  contract: string,
  functionName: string,
  args: xdr.ScVal[],
  operationSource?: string,
): xdr.Operation {
  return Operation.invokeContractFunction({
    contract,
    function: functionName,
    args,
    source: operationSource,
  });
}

function signedEnvelope(
  operations: xdr.Operation[],
  passphrase: string,
  signer: Keypair = source,
): string {
  const account = new Account(signer.publicKey(), "1");
  let builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  });
  for (const operation of operations) {
    builder = builder.addOperation(operation);
  }
  const transaction = builder.setTimeout(30).build();
  transaction.sign(signer);
  return transaction.toXdr();
}

function auditFor(
  operation: EscrowOperation,
  escrowId: string,
  signerAddress: string = source.publicKey(),
) {
  return { operation, escrowId, signerAddress };
}

function expectAccepted(
  envelopeXdr: string,
  operation: EscrowOperation,
  escrowId: string,
  contractId: string = escrowContract,
): void {
  verifyConfirmedEnvelope(
    envelopeXdr,
    auditFor(operation, escrowId),
    contractId,
  );
}

function expectRejected(
  envelopeXdr: string,
  operation: EscrowOperation,
  escrowId: string,
  messageIncludes: string,
  options?: { signerAddress?: string; contractId?: string },
): void {
  let thrown: unknown;
  try {
    verifyConfirmedEnvelope(
      envelopeXdr,
      auditFor(operation, escrowId, options?.signerAddress),
      options?.contractId ?? escrowContract,
    );
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof Error) || !thrown.message.includes(messageIncludes)) {
    const actual = thrown instanceof Error ? thrown.message : String(thrown);
    throw new Error(
      `expected rejection containing ${JSON.stringify(messageIncludes)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("accepts a signed Testnet init_escrow envelope", () => {
  const envelope = signedEnvelope(
    [invoke(escrowContract, "init_escrow", [u64(42n)])],
    Networks.TESTNET,
  );
  expectAccepted(envelope, "init_escrow", "42");
});

Deno.test("accepts a signed Testnet fund_escrow envelope", () => {
  const envelope = signedEnvelope(
    [invoke(escrowContract, "fund_escrow", [u64(42n)])],
    Networks.TESTNET,
  );
  expectAccepted(envelope, "fund_escrow", "42");
});

Deno.test("accepts a signed Testnet submit_proof envelope", () => {
  const envelope = signedEnvelope(
    [invoke(escrowContract, "submit_proof", [u64(42n)])],
    Networks.TESTNET,
  );
  expectAccepted(envelope, "submit_proof", "42");
});

Deno.test("accepts a signed Testnet release_funds envelope", () => {
  const envelope = signedEnvelope(
    [invoke(escrowContract, "release_funds", [u64(42n)])],
    Networks.TESTNET,
  );
  expectAccepted(envelope, "release_funds", "42");
});

Deno.test("rejects a signer that is not the transaction source", () => {
  const envelope = signedEnvelope(
    [invoke(escrowContract, "fund_escrow", [u64(7n)])],
    Networks.TESTNET,
  );
  expectRejected(envelope, "fund_escrow", "7", "source does not match", {
    signerAddress: other.publicKey(),
  });
});

Deno.test("rejects an operation source that differs from the signer", () => {
  const envelope = signedEnvelope(
    [invoke(escrowContract, "fund_escrow", [u64(7n)], other.publicKey())],
    Networks.TESTNET,
  );
  expectRejected(envelope, "fund_escrow", "7", "Operation source");
});

Deno.test("rejects a function that differs from the submitted operation", () => {
  const envelope = signedEnvelope(
    [invoke(escrowContract, "fund_escrow", [u64(7n)])],
    Networks.TESTNET,
  );
  expectRejected(
    envelope,
    "init_escrow",
    "7",
    "does not match the submitted operation",
  );
});

Deno.test("rejects an escrow id that differs from the u64 argument", () => {
  const envelope = signedEnvelope(
    [invoke(escrowContract, "fund_escrow", [u64(7n)])],
    Networks.TESTNET,
  );
  expectRejected(
    envelope,
    "fund_escrow",
    "8",
    "does not match the submitted escrowId",
  );
});

Deno.test("rejects an escrow id argument that is not a u64", () => {
  const envelope = signedEnvelope(
    [
      invoke(escrowContract, "fund_escrow", [
        nativeToScVal(7n, { type: "i64" }),
      ]),
    ],
    Networks.TESTNET,
  );
  expectRejected(envelope, "fund_escrow", "7", "not a u64");
});

Deno.test("rejects a contract invocation with no escrow id argument", () => {
  const envelope = signedEnvelope(
    [invoke(escrowContract, "fund_escrow", [])],
    Networks.TESTNET,
  );
  expectRejected(envelope, "fund_escrow", "7", "missing or not a u64");
});

Deno.test("rejects an invocation of a different contract", () => {
  const envelope = signedEnvelope(
    [invoke(otherContract, "fund_escrow", [u64(7n)])],
    Networks.TESTNET,
  );
  expectRejected(envelope, "fund_escrow", "7", "different contract");
});

Deno.test("rejects a transaction with more than one operation", () => {
  const envelope = signedEnvelope(
    [
      invoke(escrowContract, "fund_escrow", [u64(7n)]),
      Operation.bumpSequence({ bumpTo: "2" }),
    ],
    Networks.TESTNET,
  );
  expectRejected(envelope, "fund_escrow", "7", "exactly one operation");
});

Deno.test("rejects a payment that does not invoke a contract", () => {
  const envelope = signedEnvelope(
    [
      Operation.payment({
        destination: other.publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    ],
    Networks.TESTNET,
  );
  expectRejected(envelope, "fund_escrow", "7", "does not invoke a contract");
});

Deno.test("rejects a wasm upload host function", () => {
  const envelope = signedEnvelope(
    [Operation.uploadContractWasm({ wasm: new Uint8Array([1, 2, 3, 4]) })],
    Networks.TESTNET,
  );
  expectRejected(
    envelope,
    "fund_escrow",
    "7",
    "does not invoke a contract function",
  );
});

Deno.test("rejects an envelope signed for the public network", () => {
  const envelope = signedEnvelope(
    [invoke(escrowContract, "fund_escrow", [u64(7n)])],
    Networks.PUBLIC,
  );
  expectRejected(
    envelope,
    "fund_escrow",
    "7",
    "does not match the Stellar Testnet network",
  );
});

Deno.test("rejects a fee-bump transaction", () => {
  const inner = TransactionBuilder.fromXdr(
    signedEnvelope(
      [invoke(escrowContract, "fund_escrow", [u64(7n)])],
      Networks.TESTNET,
    ),
    Networks.TESTNET,
  );
  if (!(inner instanceof Transaction)) {
    throw new Error("inner envelope did not parse as a transaction");
  }
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    feePayer,
    "10000",
    inner,
    Networks.TESTNET,
  );
  feeBump.sign(feePayer);
  expectRejected(feeBump.toXdr(), "fund_escrow", "7", "Fee-bump");
});

Deno.test("rejects a malformed envelope", () => {
  expectRejected("AAAA", "fund_escrow", "7", "malformed");
});

Deno.test("rejects a missing envelope", () => {
  expectRejected("", "fund_escrow", "7", "missing");
});

Deno.test("accepts canonical escrow id 1, the normalized form of 01", () => {
  if (isCanonicalU64("01") || !isCanonicalU64("1")) {
    throw new Error("01 must normalize to canonical 1 before verification");
  }
  const envelope = signedEnvelope(
    [invoke(escrowContract, "fund_escrow", [u64(1n)])],
    Networks.TESTNET,
  );
  expectAccepted(envelope, "fund_escrow", "1");
});

Deno.test("rejects a non-canonical escrow id", () => {
  if (isCanonicalU64("01") || isCanonicalU64("00") || isCanonicalU64("-1")) {
    throw new Error("non-canonical u64 values were accepted");
  }
  const envelope = signedEnvelope(
    [invoke(escrowContract, "fund_escrow", [u64(1n)])],
    Networks.TESTNET,
  );
  expectRejected(
    envelope,
    "fund_escrow",
    "01",
    "does not match the submitted escrowId",
  );
});

Deno.test("rejects an escrow id outside the u64 range", () => {
  if (!isCanonicalU64("0") || !isCanonicalU64("18446744073709551615")) {
    throw new Error("canonical u64 boundaries were rejected");
  }
  if (isCanonicalU64("18446744073709551616")) {
    throw new Error("out-of-range u64 was accepted");
  }
});
