import { signTransaction } from "@stellar/freighter-api";
import { rpc, Transaction } from "@stellar/stellar-sdk";

import {
  STELLAR_TESTNET_NETWORK_PASSPHRASE,
  STELLAR_TESTNET_RPC_URL,
} from "@/src/blockchain/stellarConfig";

/** Final on-ledger outcome after polling completes. */
export type TransactionLedgerStatus = "SUCCESS" | "FAILED";

/** Result returned to the UI after sign, submit, and ledger confirmation. */
export interface TransactionSubmitResult {
  txHash: string;
  status: TransactionLedgerStatus;
  signerAddress: string;
}

/** Typed error for transaction pipeline failures (sign → submit → poll). */
export class TransactionServiceError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
    readonly cause?: unknown,
    readonly txHash?: string,
  ) {
    super(message);
    this.name = "TransactionServiceError";
    this.code = code;
  }
}

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 30;

const { GetTransactionStatus } = rpc.Api;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createRpcServer(): rpc.Server {
  return new rpc.Server(STELLAR_TESTNET_RPC_URL, {
    allowHttp: STELLAR_TESTNET_RPC_URL.startsWith("http://"),
  });
}

function parseSignedTransaction(signedTxXdr: string): Transaction {
  try {
    return new Transaction(signedTxXdr, STELLAR_TESTNET_NETWORK_PASSPHRASE);
  } catch (cause) {
    throw new TransactionServiceError(
      "INVALID_SIGNED_XDR",
      "Freighter returned a signed transaction that could not be parsed.",
      cause,
    );
  }
}

async function pollUntilLedgerSettled(
  server: rpc.Server,
  txHash: string,
): Promise<TransactionLedgerStatus> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(POLL_INTERVAL_MS);
    }

    let txResponse: rpc.Api.GetTransactionResponse;

    try {
      txResponse = await server.getTransaction(txHash);
    } catch (cause) {
      console.error("[transactionService] getTransaction RPC call failed.", {
        txHash,
        attempt: attempt + 1,
        cause,
      });
      throw new TransactionServiceError(
        "RPC_ERROR",
        "Failed to poll transaction status from Soroban RPC.",
        cause,
        txHash,
      );
    }

    if (txResponse.status === GetTransactionStatus.NOT_FOUND) {
      console.info("[transactionService] Transaction not yet on ledger, retrying…", {
        txHash,
        attempt: attempt + 1,
      });
      continue;
    }

    if (txResponse.status === GetTransactionStatus.SUCCESS) {
      console.info("[transactionService] Transaction cleared on ledger.", {
        txHash,
        ledger: txResponse.ledger,
      });
      return "SUCCESS";
    }

    if (txResponse.status === GetTransactionStatus.FAILED) {
      console.error("[transactionService] Transaction reverted on ledger.", {
        txHash,
        ledger: txResponse.ledger,
      });
      throw new TransactionServiceError(
        "LEDGER_FAILED",
        "The transaction was included on the ledger but failed execution.",
        txResponse,
        txHash,
      );
    }
  }

  const timeoutSeconds = (MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1_000;

  console.error("[transactionService] Polling timed out.", { txHash, timeoutSeconds });

  throw new TransactionServiceError(
    "POLL_TIMEOUT",
    `Transaction was not confirmed within ${timeoutSeconds} seconds.`,
    undefined,
    txHash,
  );
}

/**
 * Signs an assembled transaction XDR with Freighter, submits it to Soroban RPC,
 * and polls until the transaction is SUCCESS or FAILED on the ledger.
 */
export async function signAndSubmitTransaction(
  xdr: string,
): Promise<TransactionSubmitResult> {
  const trimmedXdr = xdr.trim();

  if (!trimmedXdr) {
    throw new TransactionServiceError(
      "INVALID_XDR",
      "Cannot sign an empty transaction XDR.",
    );
  }

  console.info("[transactionService] Requesting Freighter signature…");

  const signResult = await signTransaction(trimmedXdr, {
    networkPassphrase: STELLAR_TESTNET_NETWORK_PASSPHRASE,
  });

  if (signResult.error) {
    console.error("[transactionService] Freighter signing failed.", {
      code: signResult.error.code,
      message: signResult.error.message,
    });
    throw new TransactionServiceError(
      "SIGNING_FAILED",
      signResult.error.message ??
        "Freighter rejected or failed to sign the transaction.",
      signResult.error,
    );
  }

  if (!signResult.signedTxXdr) {
    throw new TransactionServiceError(
      "SIGNING_FAILED",
      "Freighter did not return a signed transaction XDR.",
    );
  }

  const { signerAddress, signedTxXdr } = signResult;

  console.info("[transactionService] Transaction signed.", { signerAddress });

  const signedTransaction = parseSignedTransaction(signedTxXdr);
  const server = createRpcServer();

  let sendResponse: rpc.Api.SendTransactionResponse;

  try {
    sendResponse = await server.sendTransaction(signedTransaction);
  } catch (cause) {
    console.error("[transactionService] sendTransaction RPC call failed.", { cause });
    throw new TransactionServiceError(
      "SUBMIT_FAILED",
      "Failed to submit the signed transaction to Soroban RPC.",
      cause,
    );
  }

  const { hash: txHash, status: sendStatus } = sendResponse;

  if (sendStatus === "ERROR") {
    console.error("[transactionService] Network rejected submission.", {
      txHash,
      sendStatus,
      errorResult: sendResponse.errorResult,
    });
    throw new TransactionServiceError(
      "SUBMIT_REJECTED",
      "The network rejected the transaction before ledger inclusion.",
      sendResponse.errorResult,
      txHash,
    );
  }

  if (sendStatus === "TRY_AGAIN_LATER") {
    console.error("[transactionService] Network asked to retry later.", {
      txHash,
      sendStatus,
    });
    throw new TransactionServiceError(
      "SUBMIT_RETRY",
      "The network is temporarily busy. Please try again in a moment.",
      sendResponse,
      txHash,
    );
  }

  console.info("[transactionService] Transaction submitted to RPC.", {
    txHash,
    sendStatus,
  });

  const ledgerStatus = await pollUntilLedgerSettled(server, txHash);

  return {
    txHash,
    status: ledgerStatus,
    signerAddress,
  };
}
