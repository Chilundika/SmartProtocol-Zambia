import { getSupabaseClient, isSupabaseConfigured } from "@/src/lib/supabase";
import {
  EscrowAuditHistoryError,
  parseEscrowAuditHistory,
  type EscrowAuditHistory,
} from "@/src/lib/escrowAuditHistory";

const ESCROW_AUDIT_HISTORY_FUNCTION = "escrow-audit-history";

export async function fetchEscrowAuditHistory(
  escrowId: string,
): Promise<EscrowAuditHistory> {
  if (!isSupabaseConfigured()) {
    throw new EscrowAuditHistoryError();
  }

  const invoked = await getSupabaseClient().functions.invoke(
    ESCROW_AUDIT_HISTORY_FUNCTION,
    { body: { escrowId } },
  );
  if (invoked.error || !invoked.data) {
    throw new EscrowAuditHistoryError();
  }
  return parseEscrowAuditHistory(invoked.data);
}
