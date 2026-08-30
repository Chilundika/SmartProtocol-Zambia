// SmartProtocol Zambia — beneficiary auth Edge Function
//
// The only path to `beneficiaries.encrypted_key`. Runs with the service role
// key, which bypasses RLS, so it can read the secret columns that migration
// 0001 revoked from anon.
//
// This function does NOT unwrap keys. Client-side PBKDF2 + AES-GCM is
// unchanged: on a successful PIN check the ciphertext is handed back and the
// browser derives the AES key and decrypts locally. The function only owns
// PIN verification bookkeeping (attempt counting and lockout).
//
// Accounts that predate migration 0001 have no pin_hash and are migrated by
// trust-on-first-use, which accepts one arbitrary PIN. That path is bounded on
// both ends: eligible rows must have created_at before the migration deploy
// timestamp, and the path shuts off entirely at the cutoff. See the backfill
// window section below. Afterwards those rows need an assisted reset.
//
// The backfill is two-phase. verify-pin stages the candidate hash and returns a
// single-use token; confirm-backfill promotes it only after the client proves it
// could decrypt the ciphertext with that PIN. A typo therefore commits nothing
// and the user simply retries. Note that this prevents accidental self-lockout,
// not a deliberate one: an attacker who knows a legacy NRC can still stage and
// confirm a PIN of their choosing. That exposure is inherent to trust-on-first-
// use and is what the cutoff window exists to bound.
//
// Response convention: every outcome the client is expected to render returns
// HTTP 200 with a discriminated union body, so the caller reads one shape via
// supabase.functions.invoke() instead of unwrapping FunctionsHttpError. Only
// genuinely exceptional conditions use non-2xx (400 malformed, 405 method,
// 500 unexpected).
//
// Never logs `pin`, `encryptedKey`, or any decrypted material. NRCs are
// national ID numbers, so logs carry a short stable hash rather than the
// value itself; the real NRC is written only to the service-role-only audit
// table.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

// --- Configuration ---------------------------------------------------------

const MAX_ATTEMPTS = 5;
const LOCKOUT_STEPS_MINUTES = [1, 5, 15, 60, 240];
const BCRYPT_COST = 10;

const PIN_PATTERN = /^\d{4}$/;
const NRC_PATTERN = /^\d{6}\/\d{2}\/\d{1}$/;
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;

// Coarse per-IP ceiling across all actions. Per-NRC lockout alone does not
// stop one attempt sprayed across many NRCs.
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT_MAX_TRACKED_IPS = 10_000;

// Trust-on-first-use is bounded on both axes: only rows that predate the
// migration are eligible, and the whole path shuts off after the cutoff.
const BACKFILL_WINDOW_DAYS = 14;

// Staged backfills are confirmed within a single page load — one decrypt and one
// round trip — so this only needs to cover a slow device on a bad connection.
const BACKFILL_TOKEN_TTL_MS = 3 * 60_000;
const BACKFILL_TOKEN_BYTES = 32;

const CORS_HEADERS: Record<string, string> = {
  // Tighten to the deployed origin before production.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- Types -----------------------------------------------------------------

interface BeneficiaryRow {
  nrc: string;
  public_key: string;
  encrypted_key: string;
  created_at: string;
  pin_hash: string | null;
  failed_pin_attempts: number;
  locked_until: string | null;
}

/** Staged-but-unconfirmed backfill state, read only by confirm-backfill. */
interface PendingBackfillRow {
  nrc: string;
  created_at: string;
  pin_hash: string | null;
  pending_pin_hash: string | null;
  pending_token_hash: string | null;
  pending_token_expires_at: string | null;
}

/**
 * Reasons a null-pin_hash row cannot be migrated automatically. All three mean
 * the same thing operationally — the account needs an assisted reset — but they
 * are kept distinct so the audit table shows why.
 */
type BackfillDenial =
  // Past the cutoff. The window for self-service migration has closed.
  | "account_migration_expired"
  // Row was created after server-side auth went live, so register() should have
  // written a hash. Points at a direct table write or a rollback/roll-forward.
  | "account_not_eligible_for_migration"
  // Window env vars missing or nonsensical. Fails closed rather than leaving
  // trust-on-first-use open indefinitely by accident.
  | "account_requires_assisted_setup";

type BackfillOutcome = "backfilled" | BackfillDenial;

type RequestBody =
  | { action: "verify-pin"; nrc?: unknown; pin?: unknown }
  | { action: "register"; nrc?: unknown; pin?: unknown; publicKey?: unknown; encryptedKey?: unknown }
  | { action: "delete"; nrc?: unknown; pin?: unknown }
  | { action: "confirm-backfill"; nrc?: unknown; token?: unknown };

type VerifyOutcome =
  // backfillToken is set only when this was a legacy row and the caller must
  // confirm a successful decrypt before the staged hash is committed.
  | { kind: "ok"; row: BeneficiaryRow; backfillToken: string | null }
  | { kind: "not_found" }
  | { kind: "locked"; retryAt: string }
  | { kind: "invalid_pin"; attemptsRemaining: number; retryAt: string | null }
  | { kind: "backfill_denied"; error: BackfillDenial };

interface RequestContext {
  ip: string;
  userAgent: string;
}

// --- Small helpers ---------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Short stable digest so logs can correlate attempts without recording PII. */
async function nrcTag(nrc: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(nrc),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 4)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createBackfillToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(BACKFILL_TOKEN_BYTES)));
}

/**
 * Only the digest is stored, so a database leak cannot be replayed into a
 * confirm-backfill call. SHA-256 is sufficient here: the input is 256 bits of
 * CSPRNG output, not a guessable secret, so there is nothing to slow down.
 */
async function hashBackfillToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toHex(new Uint8Array(digest));
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function readContext(request: Request): RequestContext {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip =
    forwarded.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    "unknown";

  return { ip, userAgent: request.headers.get("user-agent") ?? "" };
}

/**
 * Matches the browser's historical normalizeNrc() exactly: trim and strip
 * whitespace, no case change. Used for lookups so rows written before the
 * strict format check stay reachable.
 */
function normalizeNrcForLookup(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

/**
 * Registration-time normalization. Uppercasing is a no-op for values that
 * pass NRC_PATTERN (digits and slashes only) and guards against stray letters.
 */
function normalizeNrcForRegister(raw: string): string {
  return normalizeNrcForLookup(raw).toUpperCase();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Confirms the payload looks like our AES-GCM envelope without decrypting. */
function isEncryptedEnvelope(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return (
      typeof parsed.salt === "string" &&
      typeof parsed.iv === "string" &&
      typeof parsed.ciphertext === "string"
    );
  } catch {
    return false;
  }
}

// --- Rate limiting ---------------------------------------------------------
//
// In-memory and therefore best-effort: each Edge Function instance keeps its
// own counters and they reset on cold start, so a distributed attacker gets
// more headroom than the constants suggest. This is defence-in-depth behind
// the per-NRC lockout, not the primary control. Move to a Postgres table or
// Upstash if you need a hard guarantee.

const requestLog = new Map<string, number[]>();

function pruneRequestLog(cutoff: number): void {
  for (const [ip, hits] of requestLog) {
    const fresh = hits.filter((at) => at > cutoff);
    if (fresh.length === 0) {
      requestLog.delete(ip);
    } else {
      requestLog.set(ip, fresh);
    }
  }
}

function checkRateLimit(ip: string): { allowed: boolean; retryAt?: string } {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const hits = (requestLog.get(ip) ?? []).filter((at) => at > cutoff);

  if (hits.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLog.set(ip, hits);
    return {
      allowed: false,
      retryAt: new Date(hits[0] + RATE_LIMIT_WINDOW_MS).toISOString(),
    };
  }

  hits.push(now);
  requestLog.set(ip, hits);

  if (requestLog.size > RATE_LIMIT_MAX_TRACKED_IPS) {
    pruneRequestLog(cutoff);
  }

  return { allowed: true };
}

// --- Backfill window -------------------------------------------------------
//
// BENEFICIARY_BACKFILL_DEPLOYED_AT is required and must be an ISO 8601 instant
// set to the moment migration 0001 was applied in this environment:
//
//   supabase secrets set BENEFICIARY_BACKFILL_DEPLOYED_AT=2026-08-30T09:00:00Z
//
// BENEFICIARY_BACKFILL_CUTOFF_AT is optional and defaults to deploy +14 days.
// Set it explicitly to extend or shorten the window.
//
// If either value is missing or unparseable the window resolves to null and
// every legacy login is refused with account_requires_assisted_setup. That is
// deliberate: forgetting the secret should be loud, not silently permissive.

interface BackfillWindow {
  deployedAt: Date;
  cutoffAt: Date;
}

function readBackfillWindow(): BackfillWindow | null {
  const deployedRaw = Deno.env.get("BENEFICIARY_BACKFILL_DEPLOYED_AT");
  if (!deployedRaw) {
    return null;
  }

  const deployedAt = new Date(deployedRaw);
  if (Number.isNaN(deployedAt.getTime())) {
    return null;
  }

  const cutoffRaw = Deno.env.get("BENEFICIARY_BACKFILL_CUTOFF_AT");
  const cutoffAt = cutoffRaw
    ? new Date(cutoffRaw)
    : new Date(deployedAt.getTime() + BACKFILL_WINDOW_DAYS * 86_400_000);

  if (Number.isNaN(cutoffAt.getTime()) || cutoffAt <= deployedAt) {
    return null;
  }

  return { deployedAt, cutoffAt };
}

const BACKFILL_WINDOW = readBackfillWindow();

// Logged on every cold start so the active window is recoverable from logs
// alone when someone is triaging a migration complaint months from now.
if (BACKFILL_WINDOW) {
  console.log(
    `[BACKFILL_WINDOW] eligible_created_before=${BACKFILL_WINDOW.deployedAt.toISOString()} cutoff=${BACKFILL_WINDOW.cutoffAt.toISOString()}`,
  );
} else {
  console.error(
    "[BACKFILL_WINDOW] unconfigured or invalid — trust-on-first-use is disabled and legacy logins will be refused",
  );
}

/** Returns null when the row may be backfilled, or the reason it may not. */
function backfillDenial(row: BeneficiaryRow): BackfillDenial | null {
  if (!BACKFILL_WINDOW) {
    return "account_requires_assisted_setup";
  }

  if (Date.now() >= BACKFILL_WINDOW.cutoffAt.getTime()) {
    return "account_migration_expired";
  }

  const createdAt = new Date(row.created_at).getTime();
  if (
    Number.isNaN(createdAt) ||
    createdAt >= BACKFILL_WINDOW.deployedAt.getTime()
  ) {
    return "account_not_eligible_for_migration";
  }

  return null;
}

// --- Lockout bookkeeping ---------------------------------------------------

function lockedUntilDate(row: BeneficiaryRow): Date | null {
  if (!row.locked_until) {
    return null;
  }
  const until = new Date(row.locked_until);
  return until.getTime() > Date.now() ? until : null;
}

async function recordFailedAttempt(
  admin: SupabaseClient,
  row: BeneficiaryRow,
): Promise<{ attemptsRemaining: number; retryAt: string | null }> {
  const attempts = row.failed_pin_attempts + 1;
  const stepIndex = Math.min(
    attempts - MAX_ATTEMPTS,
    LOCKOUT_STEPS_MINUTES.length - 1,
  );
  const retryAt =
    attempts >= MAX_ATTEMPTS
      ? new Date(
          Date.now() +
            LOCKOUT_STEPS_MINUTES[Math.max(stepIndex, 0)] * 60_000,
        ).toISOString()
      : null;

  const { error } = await admin
    .from("beneficiaries")
    .update({
      failed_pin_attempts: attempts,
      locked_until: retryAt,
      last_attempt_at: new Date().toISOString(),
    })
    .eq("nrc", row.nrc);

  if (error) {
    // Surface loudly: a silent failure here means attempts are not counted.
    console.error("failed to persist attempt counter", error.message);
  }

  return {
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - attempts),
    retryAt,
  };
}

async function clearAttempts(
  admin: SupabaseClient,
  nrc: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin
    .from("beneficiaries")
    .update({
      failed_pin_attempts: 0,
      locked_until: null,
      last_attempt_at: new Date().toISOString(),
      ...extra,
    })
    .eq("nrc", nrc);

  if (error) {
    throw new Error(`unable to reset attempt counters: ${error.message}`);
  }
}

// --- Core verification (shared by verify-pin and delete) -------------------

/**
 * allowBackfill gates the trust-on-first-use path. Login sets it; delete does
 * not, because a legacy row's PIN cannot actually be verified and a destructive
 * action must never run on an unverified PIN.
 */
async function verifyPin(
  admin: SupabaseClient,
  nrc: string,
  pin: string,
  context: RequestContext,
  options: { allowBackfill: boolean },
): Promise<VerifyOutcome> {
  const { data, error } = await admin
    .from("beneficiaries")
    .select(
      "nrc, public_key, encrypted_key, created_at, pin_hash, failed_pin_attempts, locked_until",
    )
    .eq("nrc", nrc)
    .maybeSingle();

  if (error) {
    throw new Error(`beneficiary lookup failed: ${error.message}`);
  }

  if (!data) {
    return { kind: "not_found" };
  }

  const row = data as BeneficiaryRow;

  // Lockout is checked before anything else, so a locked account cannot be
  // verified, backfilled, or deleted.
  const locked = lockedUntilDate(row);
  if (locked) {
    return { kind: "locked", retryAt: locked.toISOString() };
  }

  // Trust-on-first-use backfill for accounts created before migration 0001.
  // Staged, not committed: the submitted PIN only becomes the account PIN once
  // the client confirms it decrypted the ciphertext. Bounded by backfillDenial()
  // on both created_at and cutoff.
  if (row.pin_hash === null) {
    if (!options.allowBackfill) {
      // No audit row: nothing was attempted and no staging happened. The caller
      // needs an assisted reset before a destructive action is possible.
      console.warn(
        `[PIN_BACKFILL_NOT_ALLOWED] nrc_tag=${await nrcTag(row.nrc)} ip=${context.ip}`,
      );
      return {
        kind: "backfill_denied",
        error: "account_requires_assisted_setup",
      };
    }

    const denial = backfillDenial(row);

    if (denial) {
      // Not counted as a failed attempt. The PIN was never checked, so the
      // caller has not earned a lockout, and locking the row would only get in
      // the way of the assisted reset this outcome is asking for.
      const auditError = await recordBackfillEvent(admin, row, context, denial);
      if (auditError) {
        console.error(`[PIN_BACKFILL_DENIED] audit write failed: ${auditError}`);
      }

      console.warn(
        `[PIN_BACKFILL_DENIED] outcome=${denial} nrc_tag=${await nrcTag(row.nrc)} ip=${context.ip}`,
      );
      return { kind: "backfill_denied", error: denial };
    }

    const backfillToken = await stageBackfill(admin, row, pin);
    return { kind: "ok", row, backfillToken };
  }

  const valid = await bcrypt.compare(pin, row.pin_hash);

  if (!valid) {
    const { attemptsRemaining, retryAt } = await recordFailedAttempt(admin, row);
    return { kind: "invalid_pin", attemptsRemaining, retryAt };
  }

  await clearAttempts(admin, row.nrc);
  return { kind: "ok", row, backfillToken: null };
}

/** Returns an error message on failure rather than throwing, so each caller
 * can choose whether an unrecorded event is fatal. */
async function recordBackfillEvent(
  admin: SupabaseClient,
  row: BeneficiaryRow,
  context: RequestContext,
  outcome: BackfillOutcome,
): Promise<string | null> {
  const { error } = await admin.from("beneficiary_pin_backfills").insert({
    nrc: row.nrc,
    outcome,
    beneficiary_created_at: row.created_at,
    client_ip: context.ip,
    user_agent: context.userAgent,
  });

  return error ? error.message : null;
}

/**
 * Phase one. Hashes the candidate PIN into pending_pin_hash and returns a
 * single-use token. Writes nothing to pin_hash and no audit row, so a caller
 * that never confirms leaves the account exactly as it was.
 *
 * Staging again for the same account overwrites any previous pending token, so
 * only the most recent attempt is ever confirmable.
 */
async function stageBackfill(
  admin: SupabaseClient,
  row: BeneficiaryRow,
  pin: string,
): Promise<string> {
  const token = createBackfillToken();
  const pendingPinHash = await bcrypt.hash(pin, BCRYPT_COST);

  const { error } = await admin
    .from("beneficiaries")
    .update({
      pending_pin_hash: pendingPinHash,
      pending_token_hash: await hashBackfillToken(token),
      pending_token_expires_at: new Date(
        Date.now() + BACKFILL_TOKEN_TTL_MS,
      ).toISOString(),
    })
    .eq("nrc", row.nrc);

  if (error) {
    throw new Error(`unable to stage backfill: ${error.message}`);
  }

  console.log(
    `[PIN_BACKFILL_STAGED] nrc_tag=${await nrcTag(row.nrc)} ttl_ms=${BACKFILL_TOKEN_TTL_MS}`,
  );

  return token;
}

async function clearPendingBackfill(
  admin: SupabaseClient,
  nrc: string,
): Promise<void> {
  await admin
    .from("beneficiaries")
    .update({
      pending_pin_hash: null,
      pending_token_hash: null,
      pending_token_expires_at: null,
    })
    .eq("nrc", nrc);
}

// --- Actions ---------------------------------------------------------------

async function handleVerifyPin(
  admin: SupabaseClient,
  body: Extract<RequestBody, { action: "verify-pin" }>,
  context: RequestContext,
): Promise<Response> {
  if (!isNonEmptyString(body.nrc) || !isNonEmptyString(body.pin)) {
    return json({ ok: false, error: "bad_request" });
  }
  if (!PIN_PATTERN.test(body.pin)) {
    return json({ ok: false, error: "invalid_pin", attemptsRemaining: MAX_ATTEMPTS });
  }

  // Deliberately no NRC_PATTERN check here: rows registered before the strict
  // format existed must remain reachable for login.
  const nrc = normalizeNrcForLookup(body.nrc);
  const outcome = await verifyPin(admin, nrc, body.pin, context, {
    allowBackfill: true,
  });

  switch (outcome.kind) {
    case "ok":
      return json({
        ok: true,
        publicKey: outcome.row.public_key,
        encryptedKey: outcome.row.encrypted_key,
        // Present only for legacy rows. The client must call confirm-backfill
        // with it after a successful local decrypt, or the account stays
        // unmigrated and this repeats on the next login.
        ...(outcome.backfillToken
          ? { backfillToken: outcome.backfillToken }
          : {}),
      });
    case "not_found":
      return json({ ok: false, error: "not_found" });
    case "locked":
      return json({ ok: false, error: "locked", retryAt: outcome.retryAt });
    case "invalid_pin":
      return json({
        ok: false,
        error: "invalid_pin",
        attemptsRemaining: outcome.attemptsRemaining,
        ...(outcome.retryAt ? { retryAt: outcome.retryAt } : {}),
      });
    case "backfill_denied":
      return json({ ok: false, error: outcome.error });
  }
}

/**
 * Phase two. Promotes a staged hash into pin_hash once the client has proved it
 * could decrypt with that PIN.
 *
 * Always answers ok:true. Every rejection path — unknown NRC, no staged
 * backfill, expired token, wrong token, already migrated — means the same thing
 * to the caller: nothing was committed. Distinguishing them in the response
 * would tell an attacker which NRCs exist and which have a backfill in flight,
 * and the client has no different action to take in any of those cases.
 * Single use is structural rather than a separate check: committing clears the
 * staging columns, so a replayed token finds nothing to promote.
 */
async function handleConfirmBackfill(
  admin: SupabaseClient,
  body: Extract<RequestBody, { action: "confirm-backfill" }>,
  context: RequestContext,
): Promise<Response> {
  if (!isNonEmptyString(body.nrc) || !isNonEmptyString(body.token)) {
    return json({ ok: true });
  }

  const nrc = normalizeNrcForLookup(body.nrc);

  const { data, error } = await admin
    .from("beneficiaries")
    .select(
      "nrc, created_at, pin_hash, pending_pin_hash, pending_token_hash, pending_token_expires_at",
    )
    .eq("nrc", nrc)
    .maybeSingle();

  if (error) {
    throw new Error(`backfill confirmation lookup failed: ${error.message}`);
  }

  const row = data as PendingBackfillRow | null;

  if (
    !row ||
    row.pin_hash !== null ||
    !row.pending_pin_hash ||
    !row.pending_token_hash ||
    !row.pending_token_expires_at
  ) {
    return json({ ok: true });
  }

  if (new Date(row.pending_token_expires_at).getTime() <= Date.now()) {
    await clearPendingBackfill(admin, nrc);
    console.warn(
      `[PIN_BACKFILL_EXPIRED] nrc_tag=${await nrcTag(nrc)} ip=${context.ip}`,
    );
    return json({ ok: true });
  }

  const submittedHash = await hashBackfillToken(body.token);
  if (!timingSafeEquals(submittedHash, row.pending_token_hash)) {
    console.warn(
      `[PIN_BACKFILL_BAD_TOKEN] nrc_tag=${await nrcTag(nrc)} ip=${context.ip}`,
    );
    return json({ ok: true });
  }

  // Audit first: over-counting a backfill that then fails to commit is
  // recoverable, an unaudited commit is not.
  const auditError = await recordBackfillEvent(
    admin,
    { nrc: row.nrc, created_at: row.created_at } as BeneficiaryRow,
    context,
    "backfilled",
  );

  if (auditError) {
    throw new Error(`backfill audit write failed: ${auditError}`);
  }

  const { error: commitError } = await admin
    .from("beneficiaries")
    .update({
      pin_hash: row.pending_pin_hash,
      pending_pin_hash: null,
      pending_token_hash: null,
      pending_token_expires_at: null,
      failed_pin_attempts: 0,
      locked_until: null,
      last_attempt_at: new Date().toISOString(),
    })
    .eq("nrc", nrc)
    // Guards against two confirmations racing: whichever update lands second
    // matches no rows and commits nothing.
    .is("pin_hash", null);

  if (commitError) {
    throw new Error(`unable to commit backfill: ${commitError.message}`);
  }

  console.log(
    `[PIN_BACKFILL] legacy account migrated nrc_tag=${await nrcTag(nrc)} ip=${context.ip} at=${new Date().toISOString()}`,
  );

  return json({ ok: true });
}

async function handleRegister(
  admin: SupabaseClient,
  body: Extract<RequestBody, { action: "register" }>,
): Promise<Response> {
  if (
    !isNonEmptyString(body.nrc) ||
    !isNonEmptyString(body.pin) ||
    !isNonEmptyString(body.publicKey) ||
    !isEncryptedEnvelope(body.encryptedKey)
  ) {
    return json({ ok: false, error: "bad_request" });
  }

  if (!PIN_PATTERN.test(body.pin)) {
    return json({ ok: false, error: "invalid_pin" });
  }

  if (!STELLAR_PUBLIC_KEY_PATTERN.test(body.publicKey)) {
    return json({ ok: false, error: "bad_request" });
  }

  const nrc = normalizeNrcForRegister(body.nrc);
  if (!NRC_PATTERN.test(nrc)) {
    return json({ ok: false, error: "invalid_nrc_format" });
  }

  const { data: existing, error: lookupError } = await admin
    .from("beneficiaries")
    .select("nrc")
    .eq("nrc", nrc)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`duplicate check failed: ${lookupError.message}`);
  }
  if (existing) {
    return json({ ok: false, error: "nrc_already_registered" });
  }

  const pinHash = await bcrypt.hash(body.pin, BCRYPT_COST);

  const { error: insertError } = await admin.from("beneficiaries").insert({
    nrc,
    public_key: body.publicKey,
    encrypted_key: body.encryptedKey,
    pin_hash: pinHash,
    failed_pin_attempts: 0,
  });

  // The unique index is the real backstop for the race the check above misses.
  if (insertError) {
    if (insertError.code === "23505") {
      return json({ ok: false, error: "nrc_already_registered" });
    }
    throw new Error(`insert failed: ${insertError.message}`);
  }

  console.log(`[REGISTER] nrc_tag=${await nrcTag(nrc)}`);
  return json({ ok: true, nrc });
}

async function handleDelete(
  admin: SupabaseClient,
  body: Extract<RequestBody, { action: "delete" }>,
  context: RequestContext,
): Promise<Response> {
  if (!isNonEmptyString(body.nrc) || !isNonEmptyString(body.pin)) {
    return json({ ok: false, error: "bad_request" });
  }
  if (!PIN_PATTERN.test(body.pin)) {
    return json({ ok: false, error: "invalid_pin", attemptsRemaining: MAX_ATTEMPTS });
  }

  const nrc = normalizeNrcForLookup(body.nrc);
  const outcome = await verifyPin(admin, nrc, body.pin, context, {
    allowBackfill: false,
  });

  if (outcome.kind === "not_found") {
    return json({ ok: false, error: "not_found" });
  }
  if (outcome.kind === "locked") {
    return json({ ok: false, error: "locked", retryAt: outcome.retryAt });
  }
  if (outcome.kind === "invalid_pin") {
    return json({
      ok: false,
      error: "invalid_pin",
      attemptsRemaining: outcome.attemptsRemaining,
      ...(outcome.retryAt ? { retryAt: outcome.retryAt } : {}),
    });
  }
  // An unmigrated legacy row cannot be deleted. Its PIN cannot be verified
  // against anything, and deleting on an unverified PIN would hand anyone who
  // knows an NRC a way to destroy the account.
  if (outcome.kind === "backfill_denied") {
    return json({ ok: false, error: outcome.error });
  }

  const { error } = await admin.from("beneficiaries").delete().eq("nrc", nrc);
  if (error) {
    throw new Error(`delete failed: ${error.message}`);
  }

  console.log(`[DELETE] nrc_tag=${await nrcTag(nrc)}`);
  return json({ ok: true });
}

// --- Entry point -----------------------------------------------------------

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const context = readContext(request);
  const limit = checkRateLimit(context.ip);
  if (!limit.allowed) {
    console.warn(`[RATE_LIMIT] ip=${context.ip}`);
    return json({ ok: false, error: "rate_limited", retryAt: limit.retryAt });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return json({ ok: false, error: "server_error" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    switch (body?.action) {
      case "verify-pin":
        return await handleVerifyPin(admin, body, context);
      case "register":
        return await handleRegister(admin, body);
      case "delete":
        return await handleDelete(admin, body, context);
      case "confirm-backfill":
        return await handleConfirmBackfill(admin, body, context);
      default:
        return json({ ok: false, error: "unknown_action" }, 400);
    }
  } catch (error) {
    // Message only — request payloads are never logged.
    console.error(
      "unhandled error",
      error instanceof Error ? error.message : "unknown",
    );
    return json({ ok: false, error: "server_error" }, 500);
  }
});
