// SmartProtocol Zambia — read-only escrow audit history.
//
// The browser sends one canonical escrow id. This function reads only that
// escrow's rows with the service role, re-checks each hash with Stellar
// Testnet getTransaction, and returns the rows whose envelopes still match
// the stored signer, operation, contract, and escrow id.
//
// stellar_transaction_audit stays service-role-only. This function does not
// add a browser policy, grant, or direct table query for anon/authenticated.
//
// Required server-only Edge Function secret (same value as transaction-audit,
// never NEXT_PUBLIC, and never imported from frontend config):
//   ESCROW_CONTRACT_ID

import { createClient } from "npm:@supabase/supabase-js@2";
import { StrKey } from "npm:@stellar/stellar-sdk@17.0.1";
import { isCanonicalU64 } from "../transaction-audit/envelope.ts";
import {
  PRE_AUDIT_EMPTY_MESSAGE,
  UNVERIFIED_HISTORY_MESSAGE,
  orderVerifiedAuditRecords,
  verifyStoredAuditRow,
  type RpcTransactionView,
  type StoredAuditRow,
  type VerifiedAuditRecord,
} from "./records.ts";

const STELLAR_TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const CONTRACT_ID_PATTERN = /^C[A-Z2-7]{55}$/;
const HISTORY_ROW_LIMIT = 50;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface HistoryRequest {
  escrowId?: unknown;
}

interface RpcResponse {
  result?: RpcTransactionView;
  error?: {
    message?: unknown;
  };
}

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function readEscrowContractId(): string {
  const contractId = Deno.env.get("ESCROW_CONTRACT_ID")?.trim() ?? "";
  if (
    !CONTRACT_ID_PATTERN.test(contractId) ||
    !StrKey.isValidContract(contractId)
  ) {
    throw new Error("ESCROW_CONTRACT_ID is not configured.");
  }
  return contractId;
}

async function readConfirmedTransaction(
  txHash: string,
): Promise<RpcTransactionView | null> {
  try {
    const rpcResponse = await fetch(STELLAR_TESTNET_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "smartprotocol-escrow-audit-history",
        method: "getTransaction",
        params: { hash: txHash },
      }),
    });
    if (!rpcResponse.ok) {
      return null;
    }
    const payload = (await rpcResponse.json()) as RpcResponse;
    if (payload.error || !payload.result) {
      return null;
    }
    return {
      status: payload.result.status,
      ledger: payload.result.ledger,
      envelopeXdr: payload.result.envelopeXdr,
      createdAt: payload.result.createdAt,
    };
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return response({ ok: false, code: "method_not_allowed" }, 405);
  }

  let contractId: string;
  try {
    contractId = readEscrowContractId();
  } catch {
    console.error("[escrow-audit-history] missing or invalid ESCROW_CONTRACT_ID");
    return response({ ok: false, code: "server_misconfigured" }, 500);
  }

  let escrowId: string;
  try {
    const body = (await request.json()) as HistoryRequest;
    if (typeof body.escrowId !== "string" || !isCanonicalU64(body.escrowId)) {
      return response({ ok: false, code: "invalid_escrow_id" }, 400);
    }
    escrowId = body.escrowId;
  } catch {
    return response({ ok: false, code: "invalid_escrow_id" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[escrow-audit-history] missing Supabase service configuration");
    return response({ ok: false, code: "server_misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const selected = await supabase
    .from("stellar_transaction_audit")
    .select(
      "tx_hash, operation, escrow_id, signer_address, ledger, ledger_status, recorded_at",
    )
    .eq("escrow_id", escrowId)
    .order("recorded_at", { ascending: true })
    .limit(HISTORY_ROW_LIMIT);

  if (selected.error || !selected.data) {
    console.error("[escrow-audit-history] read failed", {
      code: selected.error?.code,
    });
    return response({ ok: false, code: "history_read_failed" }, 500);
  }

  const verified: VerifiedAuditRecord[] = [];
  let unverifiedCount = 0;
  for (const row of selected.data as StoredAuditRow[]) {
    const txHash = typeof row.tx_hash === "string" ? row.tx_hash : "";
    const rpc = txHash ? await readConfirmedTransaction(txHash) : null;
    const record = verifyStoredAuditRow(row, rpc, contractId, escrowId);
    if (record) {
      verified.push(record);
    } else {
      unverifiedCount += 1;
    }
  }

  const records = orderVerifiedAuditRecords(verified);
  return response({
    ok: true,
    escrowId,
    records,
    unverifiedCount,
    emptyMessage: records.length > 0
      ? null
      : unverifiedCount > 0
        ? UNVERIFIED_HISTORY_MESSAGE
        : PRE_AUDIT_EMPTY_MESSAGE,
  });
});
