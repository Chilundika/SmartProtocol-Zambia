import { Address } from "@stellar/stellar-sdk";
import type { PostgrestError } from "@supabase/supabase-js";

import {
  getSupabaseClient,
  isUniqueConstraintError,
} from "@/src/lib/supabase";
import { WalletAuthError } from "@/src/lib/walletAuth";

export { WalletAuthError };

const ACTIVE_FUNDER_SESSION_KEY = "smartprotocol_active_funder_email_v1";
const ACTIVE_FUNDER_SNAPSHOT_KEY = "smartprotocol_active_funder_snapshot_v1";
const PIN_PATTERN = /^\d{4}$/;
const PBKDF2_ITERATIONS = 100_000;
const PIN_VERIFIER_PREFIX = "smartprotocol-funder:";

export interface FunderAccount {
  email: string;
  organizationName: string;
  publicKey: string;
  encryptedVerifier: string;
  createdAt: string;
}

export interface FunderRegistrationInput {
  organizationName: string;
  email: string;
  pin: string;
  publicKey: string;
}

export interface FunderSession {
  email: string;
  organizationName: string;
  publicKey: string;
}

interface EncryptedKeyPayload {
  salt: string;
  iv: string;
  ciphertext: string;
}

interface FunderRow {
  email: string;
  organization_name: string;
  public_key: string;
  encrypted_verifier: string;
  created_at: string;
}

function assertBrowser(): void {
  if (typeof window === "undefined") {
    throw new WalletAuthError(
      "NOT_IN_BROWSER",
      "Funder registry is only available in the browser.",
    );
  }
}

function throwQueryError(error: PostgrestError | null, fallback: string): void {
  if (error) {
    throw new WalletAuthError("SUPABASE_ERROR", error.message || fallback);
  }
}

export function normalizeFunderEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(email: string): string {
  const normalized = normalizeFunderEmail(email);

  if (normalized.length < 4) {
    throw new WalletAuthError(
      "INVALID_EMAIL",
      "Enter a valid organization email or ID.",
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length < 6) {
    throw new WalletAuthError(
      "INVALID_EMAIL",
      "Enter a valid organization email or ID.",
    );
  }

  return normalized;
}

function validateOrganizationName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    throw new WalletAuthError(
      "INVALID_ORG_NAME",
      "Enter the organization name.",
    );
  }
  return trimmed;
}

function validatePin(pin: string): void {
  if (!PIN_PATTERN.test(pin)) {
    throw new WalletAuthError("INVALID_PIN", "PIN must be exactly 4 digits.");
  }
}

function validatePublicKey(publicKey: string): string {
  const trimmed = publicKey.trim();
  try {
    new Address(trimmed);
  } catch {
    throw new WalletAuthError(
      "INVALID_ADDRESS",
      "Enter a valid Stellar public key (starts with G), or capture it from Freighter.",
    );
  }
  if (!trimmed.startsWith("G")) {
    throw new WalletAuthError(
      "INVALID_ADDRESS",
      "Official funder wallet must be a Stellar public key starting with G.",
    );
  }
  return trimmed;
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

async function deriveAesKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
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

async function encryptVerifier(
  email: string,
  pin: string,
): Promise<EncryptedKeyPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey(pin, salt);
  const encoder = new TextEncoder();
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    aesKey,
    encoder.encode(`${PIN_VERIFIER_PREFIX}${email}`),
  );

  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
  };
}

async function decryptVerifier(encryptedVerifier: string, pin: string): Promise<string> {
  let payload: EncryptedKeyPayload;
  try {
    payload = JSON.parse(encryptedVerifier) as EncryptedKeyPayload;
  } catch {
    throw new WalletAuthError("CORRUPT_ACCOUNT", "Stored funder account is corrupted.");
  }

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
    throw new WalletAuthError("INVALID_PIN", "Invalid PIN. Please try again.");
  }
}

function mapFunderRow(row: FunderRow): FunderAccount {
  return {
    email: row.email,
    organizationName: row.organization_name,
    publicKey: row.public_key,
    encryptedVerifier: row.encrypted_verifier,
    createdAt: row.created_at,
  };
}

export async function getFunderAccount(email: string): Promise<FunderAccount | null> {
  const normalized = normalizeFunderEmail(email);
  if (!normalized) {
    return null;
  }

  assertBrowser();
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("funders")
    .select("email, organization_name, public_key, encrypted_verifier, created_at")
    .eq("email", normalized)
    .maybeSingle();

  throwQueryError(error, "Unable to look up this funder organization.");
  return data ? mapFunderRow(data as FunderRow) : null;
}

export function getActiveFunderEmail(): string | null {
  assertBrowser();
  const email = sessionStorage.getItem(ACTIVE_FUNDER_SESSION_KEY);
  return email ? normalizeFunderEmail(email) : null;
}

export function getActiveFunderSessionSnapshot(): FunderSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = sessionStorage.getItem(ACTIVE_FUNDER_SNAPSHOT_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as FunderSession;
    if (!parsed.email || !parsed.organizationName || !parsed.publicKey) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistFunderSession(session: FunderSession): void {
  assertBrowser();
  sessionStorage.setItem(ACTIVE_FUNDER_SESSION_KEY, normalizeFunderEmail(session.email));
  sessionStorage.setItem(ACTIVE_FUNDER_SNAPSHOT_KEY, JSON.stringify(session));
}

export function signOutFunderSession(): void {
  assertBrowser();
  sessionStorage.removeItem(ACTIVE_FUNDER_SESSION_KEY);
  sessionStorage.removeItem(ACTIVE_FUNDER_SNAPSHOT_KEY);
}

export async function funderExists(email: string): Promise<boolean> {
  return (await getFunderAccount(email)) !== null;
}

export async function createFunderAccount(
  input: FunderRegistrationInput,
): Promise<FunderAccount> {
  validatePin(input.pin);
  const email = validateEmail(input.email);
  const organizationName = validateOrganizationName(input.organizationName);
  const publicKey = validatePublicKey(input.publicKey);

  if (await funderExists(email)) {
    throw new WalletAuthError(
      "EMAIL_EXISTS",
      "An organization with this email or ID already exists. Log in instead.",
    );
  }

  const encrypted = await encryptVerifier(email, input.pin);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("funders")
    .insert({
      email,
      organization_name: organizationName,
      public_key: publicKey,
      encrypted_verifier: JSON.stringify(encrypted),
    })
    .select("email, organization_name, public_key, encrypted_verifier, created_at")
    .single();

  if (isUniqueConstraintError(error)) {
    throw new WalletAuthError(
      "EMAIL_EXISTS",
      "An organization with this email or ID already exists. Log in instead.",
    );
  }

  throwQueryError(error, "Unable to save this funder organization.");
  return mapFunderRow(data as FunderRow);
}

export async function loginFunderAccount(
  email: string,
  pin: string,
): Promise<FunderSession> {
  validatePin(pin);
  const normalized = validateEmail(email);
  const account = await getFunderAccount(normalized);

  if (!account) {
    throw new WalletAuthError(
      "EMAIL_NOT_FOUND",
      "No funder organization found for this email or ID. Register first.",
    );
  }

  const verifier = await decryptVerifier(account.encryptedVerifier, pin);
  if (verifier !== `${PIN_VERIFIER_PREFIX}${account.email}`) {
    throw new WalletAuthError("INVALID_PIN", "Invalid PIN. Please try again.");
  }

  const session: FunderSession = {
    email: account.email,
    organizationName: account.organizationName,
    publicKey: account.publicKey,
  };
  persistFunderSession(session);
  return session;
}

export async function getActiveFunderAccount(): Promise<FunderAccount | null> {
  const email = getActiveFunderEmail();
  if (!email) {
    return null;
  }
  return getFunderAccount(email);
}
