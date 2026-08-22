import { Keypair } from "@stellar/stellar-sdk";

const ACCOUNTS_STORAGE_KEY = "smartprotocol_accounts_v2";
const ACTIVE_SESSION_KEY = "smartprotocol_active_nrc_v2";
const LEGACY_STORAGE_KEY = "smartprotocol_embedded_wallet_v1";
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

export type AccountsDictionary = Record<string, StoredAccount>;

export interface ActiveSession {
  nrc: string;
  publicKey: string;
  keypair: Keypair;
}

function assertBrowser(): void {
  if (typeof window === "undefined") {
    throw new WalletAuthError(
      "NOT_IN_BROWSER",
      "Embedded wallet is only available in the browser.",
    );
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

function readAccounts(): AccountsDictionary {
  assertBrowser();

  const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as AccountsDictionary;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeAccounts(accounts: AccountsDictionary): void {
  assertBrowser();
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
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

/** Returns true when at least one NRC account exists on this device. */
export function hasAnyAccount(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return Object.keys(readAccounts()).length > 0;
}

/** Returns true when the given NRC already has a stored account. */
export function accountExists(nrc: string): boolean {
  const normalized = normalizeNrc(nrc);
  if (!normalized) {
    return false;
  }
  return readAccounts()[normalized] !== undefined;
}

/** Returns the stored public key for an NRC without requiring the PIN. */
export function getAccountPublicKey(nrc: string): string | null {
  const normalized = normalizeNrc(nrc);
  return readAccounts()[normalized]?.publicKey ?? null;
}

/** Returns all registered NRC numbers on this device. */
export function listAccountNrcs(): string[] {
  return Object.keys(readAccounts());
}

/** Returns the active session NRC from sessionStorage, if any. */
export function getActiveSessionNrc(): string | null {
  assertBrowser();
  const nrc = sessionStorage.getItem(ACTIVE_SESSION_KEY);
  return nrc ? normalizeNrc(nrc) : null;
}

function setActiveSessionNrc(nrc: string): void {
  assertBrowser();
  sessionStorage.setItem(ACTIVE_SESSION_KEY, normalizeNrc(nrc));
}

/** Clears the in-memory/browser-tab active session without deleting stored accounts. */
export function signOutSession(): void {
  assertBrowser();
  sessionStorage.removeItem(ACTIVE_SESSION_KEY);
}

/**
 * Creates a new account for the given NRC: generates a keypair, funds it
 * on testnet, encrypts the secret with the PIN, and saves to localStorage.
 */
export async function createAccount(
  nrc: string,
  pin: string,
): Promise<{ nrc: string; publicKey: string }> {
  validatePin(pin);
  const normalizedNrc = validateNrc(nrc);

  if (accountExists(normalizedNrc)) {
    throw new WalletAuthError(
      "NRC_EXISTS",
      "An account with this NRC already exists on this device. Log in instead.",
    );
  }

  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();

  await fundTestnetAccount(publicKey);

  const encrypted = await encryptSecretKey(keypair.secret(), pin);
  const accounts = readAccounts();

  accounts[normalizedNrc] = {
    publicKey,
    encryptedKey: JSON.stringify(encrypted),
  };

  writeAccounts(accounts);

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

  const account = readAccounts()[normalizedNrc];
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

  setActiveSessionNrc(normalizedNrc);

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

/** Deletes a specific NRC account from localStorage. */
export function deleteAccount(nrc: string): void {
  const normalizedNrc = validateNrc(nrc);
  const accounts = readAccounts();

  if (!accounts[normalizedNrc]) {
    throw new WalletAuthError(
      "NRC_NOT_FOUND",
      "No account found for this NRC.",
    );
  }

  delete accounts[normalizedNrc];
  writeAccounts(accounts);

  if (getActiveSessionNrc() === normalizedNrc) {
    signOutSession();
  }
}

/** Removes all locally stored accounts (testing / reset helper). */
export function clearAllAccounts(): void {
  assertBrowser();
  localStorage.removeItem(ACCOUNTS_STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  signOutSession();
}
