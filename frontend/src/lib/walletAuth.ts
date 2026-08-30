import { Keypair } from "@stellar/stellar-sdk";
import type { PostgrestError } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/src/lib/supabase";

const ACTIVE_SESSION_KEY = "smartprotocol_active_nrc_v2";
const ACTIVE_PUBLIC_KEY = "smartprotocol_active_beneficiary_pk_v2";
const PIN_PATTERN = /^\d{4}$/;
const PBKDF2_ITERATIONS = 100_000;
const FRIENDBOT_TESTNET_URL = "https://friendbot.stellar.org";

/**
 * Registration-time NRC shape. Kept in step with the same check in the
 * beneficiary-auth Edge Function so a badly formatted NRC is rejected before we
 * generate and fund a testnet account. Deliberately NOT applied to login: rows
 * created before this check existed have looser NRCs and must stay reachable.
 */
const NRC_REGISTRATION_PATTERN = /^\d{6}\/\d{2}\/\d{1}$/;

/** All beneficiary reads/writes touching encrypted_key go through this. */
const BENEFICIARY_AUTH_FUNCTION = "beneficiary-auth";

export interface WalletAuthErrorDetails {
  /** Wrong-PIN attempts left before the account locks, when the server said. */
  attemptsRemaining?: number;
  /** ISO timestamp the lockout expires, present on ACCOUNT_LOCKED. */
  retryAt?: string;
}

export class WalletAuthError extends Error {
  readonly code: string;
  readonly attemptsRemaining?: number;
  readonly retryAt?: string;

  constructor(code: string, message: string, details?: WalletAuthErrorDetails) {
    super(message);
    this.name = "WalletAuthError";
    this.code = code;
    this.attemptsRemaining = details?.attemptsRemaining;
    this.retryAt = details?.retryAt;
  }
}

interface EncryptedKeyPayload {
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface StoredAccount {
  publicKey: string;
  encryptedKey: string;
}

export interface ActiveSession {
  nrc: string;
  publicKey: string;
  keypair: Keypair;
}

/**
 * The only beneficiary columns the anon key can still read after migration
 * 0001. encrypted_key is not in this list and cannot be selected directly.
 */
interface BeneficiaryPublicRow {
  nrc: string;
  public_key: string;
  created_at: string;
}

/** Union of every beneficiary-auth response, flattened. */
interface BeneficiaryAuthResponse {
  ok: boolean;
  error?: string;
  publicKey?: string;
  encryptedKey?: string;
  nrc?: string;
  attemptsRemaining?: number;
  retryAt?: string;
  /**
   * Present only when this login is the first since the server-side PIN check
   * was introduced. The PIN is staged, not stored: it is only committed once we
   * confirm the returned ciphertext actually decrypts with it.
   */
  backfillToken?: string;
}

function assertBrowser(): void {
  if (typeof window === "undefined") {
    throw new WalletAuthError(
      "NOT_IN_BROWSER",
      "Embedded wallet is only available in the browser.",
    );
  }
}

function throwQueryError(error: PostgrestError | null, fallback: string): void {
  if (error) {
    throw new WalletAuthError("SUPABASE_ERROR", error.message || fallback);
  }
}

/** Normalizes NRC input for use as a storage key. */
export function normalizeNrc(nrc: string): string {
  return nrc.trim().replace(/\s+/g, "");
}

function validateNrc(nrc: string): string {
  const normalized = normalizeNrc(nrc);

  if (!normalized) {
    throw new WalletAuthError("INVALID_NRC", "NRC number is required.");
  }

  if (normalized.length < 6) {
    throw new WalletAuthError("INVALID_NRC", "Enter a valid NRC number.");
  }

  return normalized;
}

/**
 * Stricter than validateNrc, for new accounts only. Runs before Friendbot so a
 * malformed NRC does not cost a funded account that register() will reject.
 */
function validateNrcForRegistration(nrc: string): string {
  const normalized = validateNrc(nrc).toUpperCase();

  if (!NRC_REGISTRATION_PATTERN.test(normalized)) {
    throw new WalletAuthError(
      "INVALID_NRC",
      "Enter your NRC in the format 123456/11/1.",
    );
  }

  return normalized;
}

function validatePin(pin: string): void {
  if (!PIN_PATTERN.test(pin)) {
    throw new WalletAuthError(
      "INVALID_PIN",
      "PIN must be exactly 4 digits.",
    );
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function deriveAesKey(
  pin: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptSecretKey(
  secretKey: string,
  pin: string,
): Promise<EncryptedKeyPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey(pin, salt);
  const encoder = new TextEncoder();
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    aesKey,
    encoder.encode(secretKey),
  );

  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
  };
}

function parseEncryptedKey(encryptedKey: string): EncryptedKeyPayload {
  try {
    const parsed = JSON.parse(encryptedKey) as EncryptedKeyPayload;
    if (
      typeof parsed.salt !== "string" ||
      typeof parsed.iv !== "string" ||
      typeof parsed.ciphertext !== "string"
    ) {
      throw new Error("Invalid encrypted key payload.");
    }
    return parsed;
  } catch {
    throw new WalletAuthError(
      "CORRUPT_WALLET",
      "Stored wallet data is corrupted.",
    );
  }
}

async function decryptSecretKey(
  encryptedKey: string,
  pin: string,
): Promise<string> {
  const payload = parseEncryptedKey(encryptedKey);
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const aesKey = await deriveAesKey(pin, salt);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      aesKey,
      toArrayBuffer(ciphertext),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new WalletAuthError(
      "INVALID_PIN",
      "Invalid PIN. Please try again.",
    );
  }
}

/**
 * Reads only the columns anon still holds a grant on. Safe for existence and
 * public-key lookups; it cannot return encrypted_key, so anything needing the
 * ciphertext must call verify-pin instead.
 */
async function fetchBeneficiaryPublic(
  nrc: string,
): Promise<BeneficiaryPublicRow | null> {
  assertBrowser();
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("beneficiaries")
    .select("nrc, public_key, created_at")
    .eq("nrc", nrc)
    .maybeSingle();

  throwQueryError(error, "Unable to look up this NRC account.");
  return (data as BeneficiaryPublicRow | null) ?? null;
}

/** Renders a lockout expiry as something a user can act on. */
export function describeLockout(retryAt?: string | null): string {
  if (!retryAt) {
    return "Please try again later.";
  }

  const remainingMs = new Date(retryAt).getTime() - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "You can try again now.";
  }

  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) {
    return `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }

  const hours = Math.ceil(minutes / 60);
  return `Try again in ${hours} hour${hours === 1 ? "" : "s"}.`;
}

function mapFunctionError(response: BeneficiaryAuthResponse): WalletAuthError {
  const details: WalletAuthErrorDetails = {
    attemptsRemaining: response.attemptsRemaining,
    retryAt: response.retryAt,
  };

  // A wrong PIN carrying a retryAt is the attempt that tripped the lock, so
  // report it as locked rather than "0 attempts remaining".
  if (response.error === "invalid_pin" && response.retryAt) {
    return new WalletAuthError(
      "ACCOUNT_LOCKED",
      `Too many incorrect PIN attempts. ${describeLockout(response.retryAt)}`,
      details,
    );
  }

  switch (response.error) {
    case "invalid_pin": {
      const remaining = response.attemptsRemaining;
      const suffix =
        typeof remaining === "number" && remaining > 0
          ? ` ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before this account is locked.`
          : "";
      return new WalletAuthError(
        "INVALID_PIN",
        `Invalid PIN.${suffix}`,
        details,
      );
    }

    case "locked":
      return new WalletAuthError(
        "ACCOUNT_LOCKED",
        `This account is temporarily locked. ${describeLockout(response.retryAt)}`,
        details,
      );

    case "not_found":
      return new WalletAuthError(
        "NRC_NOT_FOUND",
        "No account found for this NRC. Create an account first.",
      );

    case "nrc_already_registered":
      return new WalletAuthError(
        "NRC_EXISTS",
        "An account with this NRC already exists. Log in instead.",
      );

    case "invalid_nrc_format":
      return new WalletAuthError(
        "INVALID_NRC",
        "Enter your NRC in the format 123456/11/1.",
      );

    case "rate_limited":
      return new WalletAuthError(
        "RATE_LIMITED",
        `Too many attempts from this connection. ${describeLockout(response.retryAt)}`,
        details,
      );

    // All three mean the same thing to the user: this account predates the
    // current login system and cannot be migrated automatically any more.
    case "account_migration_expired":
    case "account_not_eligible_for_migration":
    case "account_requires_assisted_setup":
      return new WalletAuthError(
        "ACCOUNT_MIGRATION_REQUIRED",
        "This account was created before the current login system and needs to be reset by an administrator before you can sign in.",
      );

    default:
      return new WalletAuthError(
        "AUTH_SERVICE_ERROR",
        "The beneficiary login service rejected this request. Please try again.",
      );
  }
}

/**
 * Invokes beneficiary-auth and normalizes the result. Domain failures come back
 * as HTTP 200 with ok:false, so anything in `error` is a transport problem.
 */
async function callBeneficiaryAuth(
  body: Record<string, unknown>,
): Promise<BeneficiaryAuthResponse> {
  assertBrowser();
  const client = getSupabaseClient();

  let data: BeneficiaryAuthResponse | null = null;

  try {
    const invoked =
      await client.functions.invoke<BeneficiaryAuthResponse>(
        BENEFICIARY_AUTH_FUNCTION,
        { body },
      );

    if (invoked.error) {
      throw new WalletAuthError(
        "AUTH_SERVICE_UNREACHABLE",
        "Could not reach the beneficiary login service. Check your connection and try again.",
      );
    }

    data = invoked.data ?? null;
  } catch (invokeError) {
    if (invokeError instanceof WalletAuthError) {
      throw invokeError;
    }
    throw new WalletAuthError(
      "AUTH_SERVICE_UNREACHABLE",
      "Could not reach the beneficiary login service. Check your connection and try again.",
    );
  }

  if (!data) {
    throw new WalletAuthError(
      "AUTH_SERVICE_ERROR",
      "The beneficiary login service returned an empty response.",
    );
  }

  if (!data.ok) {
    throw mapFunctionError(data);
  }

  return data;
}

function keypairFromSecret(secretKey: string): Keypair {
  try {
    return Keypair.fromSecret(secretKey);
  } catch {
    throw new WalletAuthError(
      "CORRUPT_WALLET",
      "Stored wallet data is corrupted.",
    );
  }
}

/**
 * Creates and funds a new Stellar testnet account via Friendbot so the
 * session wallet can submit Soroban transactions.
 */
export async function fundTestnetAccount(publicKey: string): Promise<void> {
  assertBrowser();

  const url = `${FRIENDBOT_TESTNET_URL}/?addr=${encodeURIComponent(publicKey)}`;

  let response: Response;

  try {
    response = await fetch(url, { method: "GET" });
  } catch {
    throw new WalletAuthError(
      "FRIENDBOT_OFFLINE",
      "Could not reach Friendbot to activate your session wallet on testnet. Check your internet connection and try again.",
    );
  }

  if (response.ok) {
    return;
  }

  let detail = `Friendbot returned status ${response.status}.`;

  try {
    const body = (await response.json()) as { detail?: string; title?: string };
    if (body.detail) {
      detail = body.detail;
    } else if (body.title) {
      detail = body.title;
    }
  } catch {
    // Response body was not JSON — keep default detail message.
  }

  throw new WalletAuthError(
    "FRIENDBOT_FAILED",
    `Unable to fund testnet account: ${detail}`,
  );
}

/**
 * Returns true when the given NRC already has a stored account. Public-columns
 * read only — never calls verify-pin, so it cannot consume a lockout attempt.
 */
export async function accountExists(nrc: string): Promise<boolean> {
  const normalized = normalizeNrc(nrc);
  if (!normalized) {
    return false;
  }
  return (await fetchBeneficiaryPublic(normalized)) !== null;
}

/** Returns the stored public key for an NRC without requiring the PIN. */
export async function getAccountPublicKey(nrc: string): Promise<string | null> {
  const normalized = normalizeNrc(nrc);
  if (!normalized) {
    return null;
  }
  return (await fetchBeneficiaryPublic(normalized))?.public_key ?? null;
}

/** Returns the active session NRC from sessionStorage, if any. */
export function getActiveSessionNrc(): string | null {
  assertBrowser();
  const nrc = sessionStorage.getItem(ACTIVE_SESSION_KEY);
  return nrc ? normalizeNrc(nrc) : null;
}

/** Returns the cached public key for the active tab session, if any. */
export function getActiveSessionPublicKey(): string | null {
  assertBrowser();
  return sessionStorage.getItem(ACTIVE_PUBLIC_KEY);
}

function setActiveSession(nrc: string, publicKey: string): void {
  assertBrowser();
  sessionStorage.setItem(ACTIVE_SESSION_KEY, normalizeNrc(nrc));
  sessionStorage.setItem(ACTIVE_PUBLIC_KEY, publicKey);
}

/** Clears the in-memory/browser-tab active session without deleting stored accounts. */
export function signOutSession(): void {
  assertBrowser();
  sessionStorage.removeItem(ACTIVE_SESSION_KEY);
  sessionStorage.removeItem(ACTIVE_PUBLIC_KEY);
}

/**
 * Creates a new account for the given NRC: generates a keypair, funds it on
 * testnet, encrypts the secret with the PIN, and registers it through the Edge
 * Function, which hashes the PIN server-side.
 */
export async function createAccount(
  nrc: string,
  pin: string,
): Promise<{ nrc: string; publicKey: string }> {
  validatePin(pin);
  const normalizedNrc = validateNrcForRegistration(nrc);

  if (await accountExists(normalizedNrc)) {
    throw new WalletAuthError(
      "NRC_EXISTS",
      "An account with this NRC already exists. Log in instead.",
    );
  }

  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();

  await fundTestnetAccount(publicKey);

  const encrypted = await encryptSecretKey(keypair.secret(), pin);

  await callBeneficiaryAuth({
    action: "register",
    nrc: normalizedNrc,
    pin,
    publicKey,
    encryptedKey: JSON.stringify(encrypted),
  });

  return { nrc: normalizedNrc, publicKey };
}

/**
 * Second half of the legacy-account migration. Only ever called after a local
 * decrypt has already proved the PIN is right.
 *
 * Never throws: the user is logged in and holding a working keypair by this
 * point, so a failure here must not turn a successful login into an error. The
 * account simply stays unmigrated and the next login stages it again.
 */
async function confirmBackfill(nrc: string, token: string): Promise<void> {
  try {
    await callBeneficiaryAuth({ action: "confirm-backfill", nrc, token });
  } catch {
    // Intentionally swallowed. See above.
  }
}

/**
 * Logs in with NRC + PIN and marks the NRC as the active session for this tab.
 *
 * The Edge Function verifies the PIN and returns the ciphertext; decryption
 * still happens here, in the browser, exactly as before. The secret key never
 * leaves this device.
 *
 * Costs one lockout attempt on failure, so call it once per user action.
 */
export async function loginAccount(
  nrc: string,
  pin: string,
): Promise<ActiveSession> {
  validatePin(pin);
  const normalizedNrc = validateNrc(nrc);

  const response = await callBeneficiaryAuth({
    action: "verify-pin",
    nrc: normalizedNrc,
    pin,
  });

  if (!response.publicKey || !response.encryptedKey) {
    throw new WalletAuthError(
      "AUTH_SERVICE_ERROR",
      "The beneficiary login service returned an incomplete session.",
    );
  }

  let secretKey: string;

  try {
    secretKey = await decryptSecretKey(response.encryptedKey, pin);
  } catch (decryptError) {
    if (
      decryptError instanceof WalletAuthError &&
      decryptError.code === "CORRUPT_WALLET"
    ) {
      throw decryptError;
    }

    // A staged backfill means the server had no hash to check this PIN against,
    // so a decryption failure here is simply the wrong PIN. Nothing was
    // committed — no confirm-backfill call, no attempt counted — so retrying
    // with the correct PIN works.
    if (response.backfillToken) {
      throw new WalletAuthError(
        "INVALID_PIN",
        "Invalid PIN. Enter the PIN you originally registered with and try again.",
      );
    }

    // No staged backfill, so the server verified this PIN against a stored hash
    // and it was right. The ciphertext therefore does not match the hash, which
    // a user cannot fix.
    throw new WalletAuthError(
      "WALLET_UNLOCK_FAILED",
      "Your PIN was accepted but this wallet could not be unlocked. The account needs to be reset by an administrator.",
    );
  }

  const keypair = keypairFromSecret(secretKey);

  if (keypair.publicKey() !== response.publicKey) {
    throw new WalletAuthError(
      "CORRUPT_WALLET",
      "Stored wallet data is corrupted.",
    );
  }

  // Decryption succeeded and the keypair matches, which is the proof the server
  // was waiting for before committing this PIN as the account PIN.
  if (response.backfillToken) {
    await confirmBackfill(normalizedNrc, response.backfillToken);
  }

  setActiveSession(normalizedNrc, response.publicKey);

  return {
    nrc: normalizedNrc,
    publicKey: response.publicKey,
    keypair,
  };
}

/**
 * Unlocks the currently active session NRC using the PIN (e.g. after page refresh).
 */
export async function unlockActiveAccount(pin: string): Promise<Keypair> {
  validatePin(pin);

  const normalizedNrc = getActiveSessionNrc();
  if (!normalizedNrc) {
    throw new WalletAuthError(
      "NO_ACTIVE_SESSION",
      "No active session. Please log in again.",
    );
  }

  const session = await loginAccount(normalizedNrc, pin);
  return session.keypair;
}

/**
 * Deletes a specific NRC account. Requires the PIN: anon can no longer delete
 * rows directly, and the Edge Function verifies before hard-deleting so that
 * knowing an NRC is not enough to destroy someone's account.
 *
 * Costs one lockout attempt on a wrong PIN, same as login.
 */
export async function deleteAccount(nrc: string, pin: string): Promise<void> {
  validatePin(pin);
  const normalizedNrc = validateNrc(nrc);

  await callBeneficiaryAuth({
    action: "delete",
    nrc: normalizedNrc,
    pin,
  });

  if (getActiveSessionNrc() === normalizedNrc) {
    signOutSession();
  }
}
