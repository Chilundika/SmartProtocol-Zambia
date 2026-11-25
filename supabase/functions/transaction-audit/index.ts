// SmartProtocol Zambia — verified Soroban transaction audit writer.
//
// The browser sends metadata only after its transaction service observed a
// successful ledger result. This function independently calls getTransaction
// against Stellar Testnet, then parses that response's envelopeXdr. Browser
// metadata is stored only when the source account, the single escrow-contract
// invocation, the function name, and the escrow id all match the envelope.
// Client credentials never receive table access.
//
// Required server-only Edge Function secret (set before deployment, never
// NEXT_PUBLIC, and never imported from frontend config):
//   ESCROW_CONTRACT_ID
// Canonical StrKey (C...) of the SmartProtocol escrow contract. The function
// rejects every audit request if this value is missing or not a contract id,
// and rejects any confirmed transaction that invokes a different contract.

import { createClient } from "npm:@supabase/supabase-js@2";
import { StrKey } from "npm:@stellar/stellar-sdk@17.0.1";
import {
  ESCROW_OPERATIONS,
  isCanonicalU64,
  verifyConfirmedEnvelope,
  type EscrowOperation,
} from "./envelope.ts";

const STELLAR_TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const HASH_PATTERN = /^[0-9a-fA-F]{64}$/;
const PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;
const CONTRACT_ID_PATTERN = /^C[A-Z2-7]{55}$/;
const OPERATION_SET = new Set<string>(ESCROW_OPERATIONS);

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AuditRequest {
  txHash?: unknown;
  operation?: unknown;
  escrowId?: unknown;
  signerAddress?: unknown;
}

interface ConfirmedTransaction {
  ledger: number;
  envelopeXdr: string;
}

interface RpcResponse {
  result?: {
    status?: unknown;
    ledger?: unknown;
    envelopeXdr?: unknown;
  };
  error?: {
    message?: unknown;
  };
}

interface StoredAuditRow {
  operation: string;
  escrow_id: string;
  signer_address: string;
  ledger: number | string;
  ledger_status: string;
}

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
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

function validateRequest(body: AuditRequest): {
  txHash: string;
  operation: EscrowOperation;
  escrowId: string;
  signerAddress: string;
} {
  const txHash = readRequiredString(body.txHash, "txHash");
  const operation = readRequiredString(body.operation, "operation");
  const escrowId = readRequiredString(body.escrowId, "escrowId");
  const signerAddress = readRequiredString(body.signerAddress, "signerAddress");

  if (!HASH_PATTERN.test(txHash)) {
    throw new Error("txHash must be a 64-character hexadecimal hash.");
  }
  if (!OPERATION_SET.has(operation)) {
    throw new Error("operation is not a supported escrow write.");
  }
  if (!isCanonicalU64(escrowId)) {
    throw new Error("escrowId must be a canonical u64 decimal string.");
  }
  if (
    !PUBLIC_KEY_PATTERN.test(signerAddress) ||
    !StrKey.isValidEd25519PublicKey(signerAddress)
  ) {
    throw new Error("signerAddress must be a Stellar public key.");
  }

  return {
    txHash: txHash.toLowerCase(),
    operation: operation as EscrowOperation,
    escrowId,
    signerAddress,
  };
}

async function getConfirmedTransaction(
  txHash: string,
): Promise<ConfirmedTransaction> {
  const rpcResponse = await fetch(STELLAR_TESTNET_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "smartprotocol-transaction-audit",
      method: "getTransaction",
      params: { hash: txHash },
    }),
  });

  if (!rpcResponse.ok) {
    throw new Error("Stellar Testnet RPC could not verify this transaction.");
  }

  const payload = (await rpcResponse.json()) as RpcResponse;
  if (payload.error) {
    throw new Error("Stellar Testnet RPC rejected the verification request.");
  }
  if (payload.result?.status !== "SUCCESS") {
    throw new Error("Transaction is not confirmed as SUCCESS on Stellar Testnet.");
  }

  const ledger = Number(payload.result.ledger);
  if (!Number.isSafeInteger(ledger) || ledger <= 0) {
    throw new Error("Stellar Testnet RPC returned an invalid ledger number.");
  }
  if (typeof payload.result.envelopeXdr !== "string" || !payload.result.envelopeXdr) {
    throw new Error("Confirmed transaction envelope is missing.");
  }

  return { ledger, envelopeXdr: payload.result.envelopeXdr };
}

function sameStoredAudit(
  row: StoredAuditRow,
  audit: {
    operation: string;
    escrowId: string;
    signerAddress: string;
  },
  ledger: number,
): boolean {
  return (
    row.operation === audit.operation &&
    row.escrow_id === audit.escrowId &&
    row.signer_address === audit.signerAddress &&
    String(row.ledger) === String(ledger) &&
    row.ledger_status === "SUCCESS"
  );
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
    console.error("[transaction-audit] missing or invalid ESCROW_CONTRACT_ID");
    return response({ ok: false, code: "server_misconfigured" }, 500);
  }

  try {
    const audit = validateRequest((await request.json()) as AuditRequest);
    const confirmed = await getConfirmedTransaction(audit.txHash);
    verifyConfirmedEnvelope(confirmed.envelopeXdr, audit, contractId);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[transaction-audit] missing Supabase service configuration");
      return response({ ok: false, code: "server_misconfigured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.from("stellar_transaction_audit").insert({
      tx_hash: audit.txHash,
      operation: audit.operation,
      escrow_id: audit.escrowId,
      signer_address: audit.signerAddress,
      ledger: confirmed.ledger,
      ledger_status: "SUCCESS",
    });

    if (error?.code === "23505") {
      const existing = await supabase
        .from("stellar_transaction_audit")
        .select("operation, escrow_id, signer_address, ledger, ledger_status")
        .eq("tx_hash", audit.txHash)
        .maybeSingle();

      if (existing.error || !existing.data) {
        console.error("[transaction-audit] duplicate lookup failed");
        return response({ ok: false, code: "audit_write_failed" }, 500);
      }
      if (!sameStoredAudit(existing.data as StoredAuditRow, audit, confirmed.ledger)) {
        throw new Error(
          "This transaction hash is already recorded with different metadata.",
        );
      }
      return response({
        ok: true,
        txHash: audit.txHash,
        ledger: confirmed.ledger,
      });
    }

    if (error) {
      console.error("[transaction-audit] insert failed", { code: error.code });
      return response({ ok: false, code: "audit_write_failed" }, 500);
    }

    return response({
      ok: true,
      txHash: audit.txHash,
      ledger: confirmed.ledger,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request.";
    return response({ ok: false, code: "verification_failed", message }, 400);
  }
});
