import { Keypair } from "@stellar/stellar-sdk";
import type { PostgrestError } from "@supabase/supabase-js";

import {
  getSupabaseClient,
  isUniqueConstraintError,
} from "@/src/lib/supabase";

const ACTIVE_SESSION_KEY = "smartprotocol_active_nrc_v2";
const ACTIVE_PUBLIC_KEY = "smartprotocol_active_beneficiary_pk_v2";
const PIN_PATTERN = /^\d{4}$/;
const PBKDF2_ITERATIONS = 100_000;
const FRIENDBOT_TESTNET_URL = "https://friendbot.stellar.org";

export class WalletAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WalletAuthError";
    this.code = code;
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

interface BeneficiaryRow {
  nrc: string;
  public_key: string;
  encrypted_key: string;
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

function mapBeneficiary(row: BeneficiaryRow): StoredAccount {
  return {
    publicKey: row.public_key,
    encryptedKey: row.encrypted_key,
  };
}

async function fetchBeneficiary(nrc: string): Promise<StoredAccount | null> {
  assertBrowser();
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("beneficiaries")
    .select("nrc, public_key, encrypted_key")
    .eq("nrc", nrc)
    .maybeSingle();

  throwQueryError(error, "Unable to look up this NRC account.");
  return data ? mapBeneficiary(data as BeneficiaryRow) : null;
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

/** Returns true when the given NRC already has a stored account. */
export async function accountExists(nrc: string): Promise<boolean> {
  const normalized = normalizeNrc(nrc);
  if (!normalized) {
    return false;
  }
  return (await fetchBeneficiary(normalized)) !== null;
}

/** Returns the stored public key for an NRC without requiring the PIN. */
export async function getAccountPublicKey(nrc: string): Promise<string | null> {
  const normalized = normalizeNrc(nrc);
  if (!normalized) {
    return null;
  }
  return (await fetchBeneficiary(normalized))?.publicKey ?? null;
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
 * Creates a new account for the given NRC: generates a keypair, funds it
 * on testnet, encrypts the secret with the PIN, and upserts to Supabase.
 */
export async function createAccount(
  nrc: string,
  pin: string,
): Promise<{ nrc: string; publicKey: string }> {
  validatePin(pin);
  const normalizedNrc = validateNrc(nrc);

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
  const client = getSupabaseClient();
  const { error } = await client.from("beneficiaries").insert({
    nrc: normalizedNrc,
    public_key: publicKey,
    encrypted_key: JSON.stringify(encrypted),
  });

  if (isUniqueConstraintError(error)) {
    throw new WalletAuthError(
      "NRC_EXISTS",
      "An account with this NRC already exists. Log in instead.",
    );
  }

  throwQueryError(error, "Unable to save this NRC account.");

  return { nrc: normalizedNrc, publicKey };
}

/**
 * Logs in with NRC + PIN, decrypts the keypair, and marks the NRC as the
 * active session for this browser tab.
 */
export async function loginAccount(
  nrc: string,
  pin: string,
): Promise<ActiveSession> {
  validatePin(pin);
  const normalizedNrc = validateNrc(nrc);

  const account = await fetchBeneficiary(normalizedNrc);
  if (!account) {
    throw new WalletAuthError(
      "NRC_NOT_FOUND",
      "No account found for this NRC. Create an account first.",
    );
  }

  const secretKey = await decryptSecretKey(account.encryptedKey, pin);
  const keypair = keypairFromSecret(secretKey);

  if (keypair.publicKey() !== account.publicKey) {
    throw new WalletAuthError(
      "CORRUPT_WALLET",
      "Stored wallet data is corrupted.",
    );
  }

  setActiveSession(normalizedNrc, account.publicKey);

  return {
    nrc: normalizedNrc,
    publicKey: account.publicKey,
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

/** Deletes a specific NRC account from the beneficiaries table. */
export async function deleteAccount(nrc: string): Promise<void> {
  const normalizedNrc = validateNrc(nrc);
  const existing = await fetchBeneficiary(normalizedNrc);

  if (!existing) {
    throw new WalletAuthError(
      "NRC_NOT_FOUND",
      "No account found for this NRC.",
    );
  }

  const client = getSupabaseClient();
  const { error } = await client
    .from("beneficiaries")
    .delete()
    .eq("nrc", normalizedNrc);

  throwQueryError(error, "Unable to delete this NRC account.");

  if (getActiveSessionNrc() === normalizedNrc) {
    signOutSession();
  }
}
