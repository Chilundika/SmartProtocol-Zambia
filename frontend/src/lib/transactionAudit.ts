import { getSupabaseClient } from "@/src/lib/supabase";
import type { TransactionSubmitResult } from "@/src/blockchain/transactionService";

const TRANSACTION_AUDIT_FUNCTION = "transaction-audit";

export type EscrowTransactionOperation =
  | "init_escrow"
  | "fund_escrow"
  | "submit_proof"
  | "release_funds";

interface TransactionAuditResponse {
  ok: boolean;
  code?: string;
  message?: string;
}

export class TransactionAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionAuditError";
  }
}

/**
 * Records a confirmed escrow write through the server-side verifier. A failed
 * audit write never reverses an already-settled Stellar transaction.
 */
export async function recordConfirmedEscrowTransaction(input: {
  operation: EscrowTransactionOperation;
  escrowId: string;
  result: TransactionSubmitResult;
}): Promise<void> {
  const { operation, escrowId, result } = input;
  const invoked = await getSupabaseClient().functions.invoke<TransactionAuditResponse>(
    TRANSACTION_AUDIT_FUNCTION,
    {
      body: {
        txHash: result.txHash,
        operation,
        escrowId,
        signerAddress: result.signerAddress,
      },
    },
  );

  if (invoked.error || !invoked.data?.ok) {
    throw new TransactionAuditError(
      invoked.data?.message ??
        "The transaction succeeded, but its audit record could not be saved.",
    );
  }
}
