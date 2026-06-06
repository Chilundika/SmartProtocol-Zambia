import {
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import {
  ESCROW_FACTORY_CONTRACT_ID,
  NATIVE_XLM_TOKEN_CONTRACT_ID,
  STELLAR_TESTNET_NETWORK_PASSPHRASE,
  STELLAR_TESTNET_RPC_URL,
} from "@/src/blockchain/stellarConfig";

/** Parsed on-chain escrow status (matches Soroban `EscrowStatus`). */
export type EscrowStatusOnChain = "Locked" | "Pending" | "Released";

/** Parsed escrow record from `get_escrow`. */
export interface EscrowState {
  funder: string;
  vendor: string;
  amount: bigint;
  status: EscrowStatusOnChain;
  recipient: string;
}

/** Result of a read-only `get_escrow` simulation. */
export interface EscrowStateResult {
  exists: boolean;
  escrow?: EscrowState;
}

/** Typed error for UI display and logging. */
export class StellarClientError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StellarClientError";
    this.code = code;
  }
}

const PLACEHOLDER_PREFIX = "REPLACE_WITH_";
const STROOPS_PER_XLM = BigInt(10_000_000);

/** Converts an XLM amount (bigint or number) to stroops for Soroban i128 args. */
function xlmToStroops(amount: bigint | number): bigint {
  if (typeof amount === "bigint") {
    if (amount <= BigInt(0)) {
      throw new StellarClientError(
        "INVALID_AMOUNT",
        "Amount must be greater than zero XLM.",
      );
    }
    return amount * STROOPS_PER_XLM;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new StellarClientError(
      "INVALID_AMOUNT",
      "Amount must be greater than zero XLM.",
    );
  }

  const stroops = BigInt(Math.floor(Number(amount) * 10_000_000));
  if (stroops <= BigInt(0)) {
    throw new StellarClientError(
      "INVALID_AMOUNT",
      "Amount must be greater than zero XLM.",
    );
  }

  return stroops;
}

let rpcServer: rpc.Server | null = null;

function getRpcServer(): rpc.Server {
  if (!rpcServer) {
    rpcServer = new rpc.Server(STELLAR_TESTNET_RPC_URL, {
      allowHttp: STELLAR_TESTNET_RPC_URL.startsWith("http://"),
    });
  }
  return rpcServer;
}

function getEscrowContract(): Contract {
  assertConfiguredContractId(
    ESCROW_FACTORY_CONTRACT_ID,
    "ESCROW_FACTORY_CONTRACT_ID",
  );
  return new Contract(ESCROW_FACTORY_CONTRACT_ID);
}

function assertConfiguredContractId(id: string, name: string): void {
  if (id.includes(PLACEHOLDER_PREFIX)) {
    throw new StellarClientError(
      "CONFIG_NOT_SET",
      `${name} is not configured. Deploy the contract and update stellarConfig.ts.`,
    );
  }
}

function assertValidAddress(label: string, address: string): void {
  try {
    new Address(address);
  } catch (cause) {
    throw new StellarClientError(
      "INVALID_ADDRESS",
      `${label} is not a valid Stellar address.`,
      cause,
    );
  }
}

function addressToScVal(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

function i128ToScVal(value: bigint): xdr.ScVal {
  if (value <= BigInt(0)) {
    throw new StellarClientError(
      "INVALID_AMOUNT",
      "Amount must be a positive integer (stroops).",
    );
  }
  return nativeToScVal(value, { type: "i128" });
}

function proofHashToScVal(proofHash: string): xdr.ScVal {
  const normalized = proofHash.startsWith("0x")
    ? proofHash.slice(2)
    : proofHash;

  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new StellarClientError(
      "INVALID_PROOF_HASH",
      "proofHash must be 32 bytes encoded as 64 hexadecimal characters.",
    );
  }

  return nativeToScVal(Buffer.from(normalized, "hex"), { type: "bytes" });
}

function parseEscrowStatus(value: unknown): EscrowStatusOnChain {
  // Rust enums often serialize to single-element arrays in JS (e.g., ["Locked"])
  const normalizedStatus = Array.isArray(value) ? value[0] : value;

  if (typeof normalizedStatus === "string") {
    if (
      normalizedStatus === "Locked" ||
      normalizedStatus === "Pending" ||
      normalizedStatus === "Released"
    ) {
      return normalizedStatus;
    }
  }

  if (
    normalizedStatus &&
    typeof normalizedStatus === "object" &&
    "tag" in normalizedStatus
  ) {
    const tag = (normalizedStatus as { tag: string }).tag;
    if (tag === "Locked" || tag === "Pending" || tag === "Released") {
      return tag;
    }
  }

  throw new StellarClientError(
    "PARSE_ERROR",
    `Unexpected escrow status value: ${JSON.stringify(value)}`,
  );
}

function parseEscrowStruct(raw: unknown): EscrowState {
  if (!raw || typeof raw !== "object") {
    throw new StellarClientError(
      "PARSE_ERROR",
      "Escrow payload was not a struct.",
    );
  }

  const record = raw as Record<string, unknown>;
  const rawStatus = record.status;
  const normalizedStatus = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;

  return {
    funder: String(record.funder),
    vendor: String(record.vendor),
    amount: BigInt(record.amount as string | number | bigint),
    status: parseEscrowStatus(normalizedStatus),
    recipient: String(record.recipient),
  };
}

function parseOptionEscrow(retval: xdr.ScVal | undefined): EscrowStateResult {
  if (!retval) {
    return { exists: false };
  }

  const native = scValToNative(retval);

  if (native === null || native === undefined) {
    return { exists: false };
  }

  if (Array.isArray(native) && native[0] === "void") {
    return { exists: false };
  }

  if (typeof native === "object" && native !== null) {
    if ("tag" in native) {
      const tagged = native as { tag: string; values?: unknown[] };
      if (tagged.tag === "None") {
        return { exists: false };
      }
      if (tagged.tag === "Some" && tagged.values?.[0]) {
        return {
          exists: true,
          escrow: parseEscrowStruct(tagged.values[0]),
        };
      }
    }
  }

  return {
    exists: true,
    escrow: parseEscrowStruct(native),
  };
}

async function loadSourceAccount(publicKey: string) {
  assertValidAddress("source account", publicKey);
  try {
    return await getRpcServer().getAccount(publicKey);
  } catch (cause) {
    throw new StellarClientError(
      "ACCOUNT_NOT_FOUND",
      `Account ${publicKey} was not found on testnet. Fund it via Friendbot before submitting transactions.`,
      cause,
    );
  }
}

async function simulateContractCall(
  sourcePublicKey: string,
  operation: xdr.Operation,
): Promise<rpc.Api.SimulateTransactionResponse> {
  const account = await loadSourceAccount(sourcePublicKey);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_TESTNET_NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(180)
    .build();

  let simulation: rpc.Api.SimulateTransactionResponse;

  try {
    simulation = await getRpcServer().simulateTransaction(tx);
  } catch (cause) {
    throw new StellarClientError(
      "RPC_ERROR",
      "Failed to reach the Soroban RPC endpoint.",
      cause,
    );
  }

  const parsed = rpc.Api.isSimulationRaw(simulation)
    ? rpc.parseRawSimulation(simulation)
    : simulation;

  if (rpc.Api.isSimulationError(parsed)) {
    throw new StellarClientError(
      "SIMULATION_FAILED",
      parsed.error ?? "Contract simulation failed.",
    );
  }

  return parsed;
}

async function buildContractTransactionXdr(
  sourcePublicKey: string,
  operation: xdr.Operation,
): Promise<string> {
  const account = await loadSourceAccount(sourcePublicKey);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_TESTNET_NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(180)
    .build();

  let simulation: rpc.Api.SimulateTransactionResponse;

  try {
    simulation = await getRpcServer().simulateTransaction(tx);
  } catch (cause) {
    console.error("RPC Simulation Failure:", cause);
    throw new StellarClientError(
      "RPC_ERROR",
      "Failed to reach the Soroban RPC endpoint.",
      cause,
    );
  }

  const parsed = rpc.Api.isSimulationRaw(simulation)
    ? rpc.parseRawSimulation(simulation)
    : simulation;

  if (rpc.Api.isSimulationError(parsed)) {
    const simulationError = new StellarClientError(
      "SIMULATION_FAILED",
      parsed.error ?? "Transaction simulation failed.",
    );
    console.error("RPC Simulation Failure:", simulationError);
    throw simulationError;
  }

  if (rpc.Api.isSimulationRestore(parsed)) {
    const restoreError = new StellarClientError(
      "RESTORE_REQUIRED",
      "Contract state must be restored before this transaction can be submitted.",
    );
    console.error("RPC Simulation Failure:", restoreError);
    throw restoreError;
  }

  try {
    // Re-hydrate to ensure instanceof checks pass the dual-package boundary
    const safeTx = new Transaction(tx.toXDR(), STELLAR_TESTNET_NETWORK_PASSPHRASE);
    const assembled = rpc.assembleTransaction(safeTx, parsed).build();
    return assembled.toXDR();
  } catch (cause) {
    console.error("RPC Simulation Failure:", cause);
    throw new StellarClientError(
      "TX_BUILD_FAILED",
      "Failed to assemble the transaction XDR.",
      cause,
    );
  }
}

/**
 * Read-only: calls `get_escrow(recipient)` on the escrow factory contract.
 *
 * @param recipientAddress - Map key / beneficiary address for the escrow
 * @param simulationSourceAddress - Funded testnet account used only to simulate (defaults to `recipientAddress`)
 */
export async function getEscrowState(
  recipientAddress: string,
  simulationSourceAddress?: string,
): Promise<EscrowStateResult> {
  assertValidAddress("recipientAddress", recipientAddress);

  const source =
    simulationSourceAddress ?? recipientAddress;
  assertValidAddress("simulationSourceAddress", source);

  const contract = getEscrowContract();
  const operation = contract.call(
    "get_escrow",
    addressToScVal(recipientAddress),
  );

  const simulation = await simulateContractCall(source, operation);

  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new StellarClientError(
      "SIMULATION_FAILED",
      "Unexpected simulation response for get_escrow.",
    );
  }

  return parseOptionEscrow(simulation.result?.retval);
}

/**
 * Builds XDR for `init_escrow` (funder must sign & submit).
 * @param amount - Escrow amount in XLM (converted to stroops before packing).
 */
export async function buildInitEscrowTx(
  funder: string,
  vendor: string,
  amount: bigint | number,
  recipient: string,
): Promise<string> {
  try {
    assertValidAddress("funder", funder);
    assertValidAddress("vendor", vendor);
    assertValidAddress("recipient", recipient);
    assertConfiguredContractId(
      NATIVE_XLM_TOKEN_CONTRACT_ID,
      "NATIVE_XLM_TOKEN_CONTRACT_ID",
    );

    const amountStroops = xlmToStroops(amount);
    const contract = getEscrowContract();
    const operation = contract.call(
      "init_escrow",
      addressToScVal(funder),
      addressToScVal(NATIVE_XLM_TOKEN_CONTRACT_ID),
      addressToScVal(vendor),
      addressToScVal(recipient),
      i128ToScVal(amountStroops),
    );

    return await buildContractTransactionXdr(funder, operation);
  } catch (error) {
    console.error("RPC Simulation Failure:", error);
    throw error;
  }
}

/**
 * Builds XDR for `fund_escrow` (funder deposits Native XLM).
 * @param amount - Deposit amount in XLM (converted to stroops before packing).
 */
export async function buildFundEscrowTx(
  funder: string,
  recipient: string,
  amount: bigint | number,
): Promise<string> {
  try {
    assertValidAddress("funder", funder);
    assertValidAddress("recipient", recipient);

    const amountStroops = xlmToStroops(amount);
    const contract = getEscrowContract();
    const operation = contract.call(
      "fund_escrow",
      addressToScVal(funder),
      addressToScVal(recipient),
      i128ToScVal(amountStroops),
    );

    return await buildContractTransactionXdr(funder, operation);
  } catch (error) {
    console.error("RPC Simulation Failure:", error);
    throw error;
  }
}

/**
 * Builds XDR for `submit_proof` (beneficiary sign-off).
 * `recipient` defaults to `beneficiary` (escrow map key).
 */
export async function buildSubmitProofTx(
  beneficiary: string,
  proofHash: string,
  recipient?: string,
): Promise<string> {
  try {
    assertValidAddress("beneficiary", beneficiary);
    const escrowRecipient = recipient ?? beneficiary;
    assertValidAddress("recipient", escrowRecipient);

    const contract = getEscrowContract();
    const operation = contract.call(
      "submit_proof",
      addressToScVal(beneficiary),
      addressToScVal(escrowRecipient),
      proofHashToScVal(proofHash),
    );

    return await buildContractTransactionXdr(beneficiary, operation);
  } catch (error) {
    console.error("RPC Simulation Failure:", error);
    throw error;
  }
}

/**
 * Builds XDR for `release_funds` (funder pays vendor after beneficiary proof).
 */
export async function buildReleaseFundsTx(
  funder: string,
  recipient: string,
): Promise<string> {
  try {
    assertValidAddress("funder", funder);
    assertValidAddress("recipient", recipient);

    const contract = getEscrowContract();
    const operation = contract.call(
      "release_funds",
      addressToScVal(funder),
      addressToScVal(recipient),
    );

    return await buildContractTransactionXdr(funder, operation);
  } catch (error) {
    console.error("RPC Simulation Failure:", error);
    throw error;
  }
}
