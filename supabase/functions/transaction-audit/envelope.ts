// Parses a confirmed Soroban envelope with the SDK installed for this
// function: @stellar/stellar-sdk@17.0.1 (TransactionBuilder.fromXdr,
// Networks.TESTNET, Keypair.verify, Address.fromScAddress).
//
// The escrow id is argument 0 on every write. That matches the current
// contract signatures, where escrow_id: u64 is the first parameter after Env:
// init_escrow, fund_escrow, submit_proof, release_funds.

import {
  Address,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from "npm:@stellar/stellar-sdk@17.0.1";

const U64_MAX = 18446744073709551615n;

export const ESCROW_OPERATIONS = [
  "init_escrow",
  "fund_escrow",
  "submit_proof",
  "release_funds",
] as const;

export type EscrowOperation = (typeof ESCROW_OPERATIONS)[number];

const ESCROW_ID_ARGUMENT_INDEX: Record<EscrowOperation, number> = {
  init_escrow: 0,
  fund_escrow: 0,
  submit_proof: 0,
  release_funds: 0,
};

export interface EnvelopeAudit {
  operation: EscrowOperation;
  escrowId: string;
  signerAddress: string;
}

export function isCanonicalU64(value: string): boolean {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    return false;
  }
  const parsed = BigInt(value);
  return parsed <= U64_MAX && parsed.toString() === value;
}

export function verifyConfirmedEnvelope(
  envelopeXdr: string,
  audit: EnvelopeAudit,
  contractId: string,
): void {
  if (!envelopeXdr) {
    throw new Error("Confirmed transaction envelope is missing.");
  }

  let parsed: FeeBumpTransaction | Transaction;
  try {
    parsed = TransactionBuilder.fromXdr(envelopeXdr, Networks.TESTNET);
  } catch {
    throw new Error("Confirmed transaction envelope is malformed.");
  }

  if (parsed instanceof FeeBumpTransaction) {
    throw new Error("Fee-bump transactions are not accepted.");
  }
  if (!(parsed instanceof Transaction)) {
    throw new Error("Confirmed transaction envelope is malformed.");
  }
  if (parsed.networkPassphrase !== Networks.TESTNET) {
    throw new Error("Transaction is not bound to Stellar Testnet.");
  }
  if (parsed.source !== audit.signerAddress) {
    throw new Error("Transaction source does not match signerAddress.");
  }

  let sourceKey: Keypair;
  try {
    sourceKey = Keypair.fromPublicKey(parsed.source);
  } catch {
    throw new Error("Transaction source is not a Stellar account.");
  }

  const networkHash = parsed.hash();
  const signedForTestnet = parsed.signatures.some((decorated) => {
    try {
      return sourceKey.verify(networkHash, decorated.signature);
    } catch {
      return false;
    }
  });
  if (!signedForTestnet) {
    throw new Error(
      "Transaction signature does not match the Stellar Testnet network.",
    );
  }

  if (parsed.operations.length !== 1) {
    throw new Error("Transaction must contain exactly one operation.");
  }

  const operation = parsed.operations[0];
  if (operation.source && operation.source !== audit.signerAddress) {
    throw new Error("Operation source does not match signerAddress.");
  }
  if (operation.type !== "invokeHostFunction") {
    throw new Error("Transaction does not invoke a contract.");
  }
  if (operation.func.type !== "hostFunctionTypeInvokeContract") {
    throw new Error("Transaction does not invoke a contract function.");
  }

  const invocation = operation.func.invokeContract;
  let invokedContract: string;
  try {
    invokedContract = Address.fromScAddress(invocation.contractAddress).toString();
  } catch {
    throw new Error("Transaction contract address is malformed.");
  }
  if (invokedContract !== contractId) {
    throw new Error("Transaction invokes a different contract.");
  }

  let functionName: string;
  try {
    functionName = invocation.functionName.toStringStrict();
  } catch {
    throw new Error("Transaction function name is malformed.");
  }
  if (functionName !== audit.operation) {
    throw new Error("Transaction function does not match the submitted operation.");
  }

  const escrowArg = invocation.args[ESCROW_ID_ARGUMENT_INDEX[audit.operation]];
  if (!escrowArg || escrowArg.type !== "scvU64") {
    throw new Error("Transaction escrow id argument is missing or not a u64.");
  }
  if (escrowArg.u64.toString() !== audit.escrowId) {
    throw new Error("Transaction escrow id does not match the submitted escrowId.");
  }
}
