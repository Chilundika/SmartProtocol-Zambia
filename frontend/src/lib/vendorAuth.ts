import { Keypair } from "@stellar/stellar-sdk";
import type { PostgrestError, RealtimeChannel } from "@supabase/supabase-js";

import {
  getSupabaseClient,
  isUniqueConstraintError,
} from "@/src/lib/supabase";
import { fundTestnetAccount, WalletAuthError } from "@/src/lib/walletAuth";

export { WalletAuthError };

const ACTIVE_VENDOR_SESSION_KEY = "smartprotocol_active_vendor_tpin_v1";
const ACTIVE_VENDOR_SNAPSHOT_KEY = "smartprotocol_active_vendor_snapshot_v1";
const PIN_PATTERN = /^\d{4}$/;
const VENDOR_ID_PATTERN = /^[a-z]{2}\d{5}$/;
const PBKDF2_ITERATIONS = 100_000;
export const MAX_DOCUMENT_BYTES = 7 * 1024 * 1024;
const VENDORS_CHANGED_EVENT = "smartprotocol:vendors-changed";
const VENDOR_ID_NOT_APPROVED = "Vendor ID not found or not yet approved";

export type VendorVerificationStatus = "pending" | "verified" | "rejected";

export interface VendorDocument {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

export interface VendorProfile {
  vendorId: string;
  fullName: string;
  tpin: string;
  publicKey: string;
  stellarAddress: string;
  encryptedKey: string;
  businessName: string;
  pacraNumber: string;
  documentNotes: string;
  document: VendorDocument | null;
  status: VendorVerificationStatus;
  verifiedAt: string | null;
  createdAt: string;
  watchedEscrowIds: string[];
}

export type VendorSessionSnapshot = Omit<VendorProfile, "encryptedKey">;

export interface VendorRegistrationInput {
  tpin: string;
  pin: string;
  fullName: string;
  businessName: string;
  pacraNumber: string;
  documentNotes: string;
  document: VendorDocument | null;
}

export interface VendorSession {
  tpin: string;
  publicKey: string;
  keypair: Keypair;
  profile: VendorProfile;
}

interface EncryptedKeyPayload {
  salt: string;
  iv: string;
  ciphertext: string;
}

interface VendorRow {
  vendor_id: string;
  full_name: string;
  tpin: string;
  public_key: string;
  stellar_address: string;
  encrypted_key?: string | null;
  business_name: string;
  pacra_number: string;
  document_notes: string;
  document?: VendorDocument | null;
  status: string;
  verified_at: string | null;
  created_at: string;
  watched_escrow_ids: string[] | null;
}

const VENDOR_DIRECTORY_COLUMNS =
  "vendor_id, full_name, tpin, public_key, stellar_address, business_name, pacra_number, document_notes, status, verified_at, created_at, watched_escrow_ids";

const VENDOR_AUTH_COLUMNS = `${VENDOR_DIRECTORY_COLUMNS}, encrypted_key, document`;

function assertBrowser(): void {
  if (typeof window === "undefined") {
    throw new WalletAuthError(
      "NOT_IN_BROWSER",
      "Vendor registry is only available in the browser.",
    );
  }
}

function throwQueryError(error: PostgrestError | null, fallback: string): void {
  if (error) {
    throw new WalletAuthError("SUPABASE_ERROR", error.message || fallback);
  }
}

export function normalizeTpin(tpin: string): string {
  return tpin.trim().replace(/\s+/g, "").toUpperCase();
}

function validateTpin(tpin: string): string {
  const normalized = normalizeTpin(tpin);

  if (!normalized) {
    throw new WalletAuthError("INVALID_TPIN", "Business TPIN / ID is required.");
  }

  if (normalized.length < 6) {
    throw new WalletAuthError(
      "INVALID_TPIN",
      "Enter a valid Business TPIN or registration ID (at least 6 characters).",
    );
  }

  return normalized;
}

function validatePin(pin: string): void {
  if (!PIN_PATTERN.test(pin)) {
    throw new WalletAuthError("INVALID_PIN", "PIN must be exactly 4 digits.");
  }
}

function validateBusinessName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    throw new WalletAuthError(
      "INVALID_BUSINESS_NAME",
      "Enter the registered business name.",
    );
  }
  return trimmed;
}

export function normalizeVendorId(vendorId: string): string {
  return vendorId.trim().toLowerCase();
}

export function validateVendorIdFormat(vendorId: string): string {
  const normalized = normalizeVendorId(vendorId);
  if (!VENDOR_ID_PATTERN.test(normalized)) {
    throw new WalletAuthError(
      "INVALID_VENDOR_ID",
      "Vendor ID must be 7 characters: two letters plus five digits (e.g. cc33791).",
    );
  }
  return normalized;
}

export function extractNameInitials(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter((part) => /[a-z]/i.test(part));

  if (parts.length < 2) {
    throw new WalletAuthError(
      "INVALID_FULL_NAME",
      "Enter your full name (first and last) so we can generate a Vendor ID.",
    );
  }

  const firstInitial = parts[0].match(/[a-z]/i)?.[0];
  const lastInitial = parts[parts.length - 1].match(/[a-z]/i)?.[0];

  if (!firstInitial || !lastInitial) {
    throw new WalletAuthError(
      "INVALID_FULL_NAME",
      "Enter your full name (first and last) so we can generate a Vendor ID.",
    );
  }

  return `${firstInitial}${lastInitial}`.toLowerCase();
}

export function validateFullName(fullName: string): string {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  extractNameInitials(trimmed);
  return trimmed;
}

function randomFiveDigits(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 100_000;
  return String(value).padStart(5, "0");
}

export async function allocateVendorId(fullName: string): Promise<string> {
  const prefix = extractNameInitials(fullName);
  const client = getSupabaseClient();

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = `${prefix}${randomFiveDigits()}`;
    const { data, error } = await client
      .from("vendors")
      .select("vendor_id")
      .eq("vendor_id", candidate)
      .maybeSingle();

    throwQueryError(error, "Unable to allocate a Vendor ID.");
    if (!data) {
      return candidate;
    }
  }

  throw new WalletAuthError(
    "VENDOR_ID_COLLISION",
    "Could not allocate a unique Vendor ID. Please try again.",
  );
}

export function getVendorPayoutAddress(vendor: VendorProfile): string {
  return vendor.stellarAddress || vendor.publicKey;
}

function validatePacraNumber(pacra: string): string {
  const normalized = pacra.trim().replace(/\s+/g, "");
  if (normalized.length < 5) {
    throw new WalletAuthError(
      "INVALID_PACRA",
      "Enter a valid PACRA registration number.",
    );
  }
  return normalized;
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
      "Stored vendor wallet data is corrupted.",
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
    throw new WalletAuthError("INVALID_PIN", "Invalid PIN. Please try again.");
  }
}

function notifyVendorsChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(VENDORS_CHANGED_EVENT));
}

function parseStatus(value: unknown): VendorVerificationStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "verified" || normalized === "approved") {
    return "verified";
  }
  if (normalized === "rejected") {
    return "rejected";
  }
  return "pending";
}

function parseDocument(value: unknown): VendorDocument | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const doc = value as Partial<VendorDocument>;
  if (typeof doc.fileName !== "string" || typeof doc.dataUrl !== "string") {
    return null;
  }
  return {
    fileName: doc.fileName,
    mimeType:
      typeof doc.mimeType === "string" ? doc.mimeType : "application/octet-stream",
    sizeBytes: typeof doc.sizeBytes === "number" ? doc.sizeBytes : 0,
    dataUrl: doc.dataUrl,
  };
}

function mapVendorRow(row: VendorRow): VendorProfile {
  return {
    vendorId: row.vendor_id,
    fullName: row.full_name,
    tpin: row.tpin,
    publicKey: row.public_key,
    stellarAddress: row.stellar_address || row.public_key,
    encryptedKey: row.encrypted_key ?? "",
    businessName: row.business_name,
    pacraNumber: row.pacra_number,
    documentNotes: row.document_notes ?? "",
    document: parseDocument(row.document),
    status: parseStatus(row.status),
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    watchedEscrowIds: Array.isArray(row.watched_escrow_ids)
      ? row.watched_escrow_ids.map(String)
      : [],
  };
}

function profileToInsert(profile: VendorProfile): Record<string, unknown> {
  return {
    vendor_id: profile.vendorId,
    full_name: profile.fullName,
    tpin: profile.tpin,
    public_key: profile.publicKey,
    stellar_address: profile.stellarAddress,
    encrypted_key: profile.encryptedKey,
    business_name: profile.businessName,
    pacra_number: profile.pacraNumber,
    document_notes: profile.documentNotes,
    document: profile.document,
    status: profile.status,
    verified_at: profile.verifiedAt,
    created_at: profile.createdAt,
    watched_escrow_ids: profile.watchedEscrowIds,
  };
}

function toSessionSnapshot(profile: VendorProfile): VendorSessionSnapshot {
  return {
    vendorId: profile.vendorId,
    fullName: profile.fullName,
    tpin: profile.tpin,
    publicKey: profile.publicKey,
    stellarAddress: profile.stellarAddress,
    businessName: profile.businessName,
    pacraNumber: profile.pacraNumber,
    documentNotes: profile.documentNotes,
    document: profile.document,
    status: profile.status,
    verifiedAt: profile.verifiedAt,
    createdAt: profile.createdAt,
    watchedEscrowIds: profile.watchedEscrowIds,
  };
}

function snapshotToProfile(snapshot: VendorSessionSnapshot): VendorProfile {
  return { ...snapshot, encryptedKey: "" };
}

function keypairFromSecret(secretKey: string): Keypair {
  try {
    return Keypair.fromSecret(secretKey);
  } catch {
    throw new WalletAuthError(
      "CORRUPT_WALLET",
      "Stored vendor wallet data is corrupted.",
    );
  }
}

export function subscribeVendorRegistry(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  let channel: RealtimeChannel | null = null;
  try {
    const client = getSupabaseClient();
    channel = client
      .channel(`vendors-registry-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vendors" },
        () => onChange(),
      )
      .subscribe();
  } catch {
    // Registry reads still work without Realtime; same-tab updates use the event below.
  }

  window.addEventListener(VENDORS_CHANGED_EVENT, onChange);

  return () => {
    window.removeEventListener(VENDORS_CHANGED_EVENT, onChange);
    if (channel) {
      void getSupabaseClient().removeChannel(channel);
    }
  };
}

export async function listVendorProfiles(): Promise<VendorProfile[]> {
  assertBrowser();
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("vendors")
    .select(VENDOR_DIRECTORY_COLUMNS)
    .order("created_at", { ascending: false });

  throwQueryError(error, "Unable to load vendor registrations.");
  return ((data ?? []) as VendorRow[]).map(mapVendorRow);
}

export async function listPendingVendors(): Promise<VendorProfile[]> {
  const vendors = await listVendorProfiles();
  return vendors.filter((vendor) => vendor.status === "pending");
}

export async function listVerifiedVendors(): Promise<VendorProfile[]> {
  const vendors = await listVendorProfiles();
  return vendors.filter((vendor) => vendor.status === "verified");
}

export async function getVendorProfile(tpin: string): Promise<VendorProfile | null> {
  const normalized = normalizeTpin(tpin);
  if (!normalized) {
    return null;
  }

  assertBrowser();
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("vendors")
    .select(VENDOR_AUTH_COLUMNS)
    .eq("tpin", normalized)
    .maybeSingle();

  throwQueryError(error, "Unable to look up this vendor account.");
  return data ? mapVendorRow(data as VendorRow) : null;
}

export async function getVendorById(vendorId: string): Promise<VendorProfile | null> {
  const normalized = normalizeVendorId(vendorId);
  if (!normalized) {
    return null;
  }

  assertBrowser();
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("vendors")
    .select(VENDOR_DIRECTORY_COLUMNS)
    .eq("vendor_id", normalized)
    .maybeSingle();

  throwQueryError(error, "Unable to look up this Vendor ID.");
  return data ? mapVendorRow(data as VendorRow) : null;
}

export async function findVendorByPublicKey(
  publicKey: string,
): Promise<VendorProfile | null> {
  const trimmed = publicKey.trim();
  if (!trimmed) {
    return null;
  }

  const byPayout = await listVendorByColumn("stellar_address", trimmed);
  if (byPayout) {
    return byPayout;
  }
  return listVendorByColumn("public_key", trimmed);
}

async function listVendorByColumn(
  column: "stellar_address" | "public_key",
  value: string,
): Promise<VendorProfile | null> {
  assertBrowser();
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("vendors")
    .select(VENDOR_DIRECTORY_COLUMNS)
    .eq(column, value)
    .maybeSingle();

  throwQueryError(error, "Unable to look up this vendor address.");
  return data ? mapVendorRow(data as VendorRow) : null;
}

/**
 * Resolves a human-readable Vendor ID to the mapped Stellar payout address.
 * Throws if the ID is missing or the vendor is not verified.
 */
export async function resolveVerifiedVendorPayoutAddress(
  vendorId: string,
): Promise<string> {
  const normalized = normalizeVendorId(vendorId);
  if (!VENDOR_ID_PATTERN.test(normalized)) {
    throw new WalletAuthError("VENDOR_ID_NOT_APPROVED", VENDOR_ID_NOT_APPROVED);
  }

  const vendor = await getVendorById(normalized);
  if (!vendor || vendor.status !== "verified") {
    throw new WalletAuthError("VENDOR_ID_NOT_APPROVED", VENDOR_ID_NOT_APPROVED);
  }

  return getVendorPayoutAddress(vendor);
}

export async function vendorExists(tpin: string): Promise<boolean> {
  return (await getVendorProfile(tpin)) !== null;
}

export function getActiveVendorTpin(): string | null {
  assertBrowser();
  const tpin = sessionStorage.getItem(ACTIVE_VENDOR_SESSION_KEY);
  return tpin ? normalizeTpin(tpin) : null;
}

export function getActiveVendorSnapshot(): VendorProfile | null {
  assertBrowser();
  const raw = sessionStorage.getItem(ACTIVE_VENDOR_SNAPSHOT_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as VendorSessionSnapshot;
    if (!parsed.tpin || !parsed.vendorId || !parsed.publicKey) {
      return null;
    }
    return snapshotToProfile(parsed);
  } catch {
    return null;
  }
}

function setActiveVendorSession(profile: VendorProfile): void {
  assertBrowser();
  sessionStorage.setItem(ACTIVE_VENDOR_SESSION_KEY, normalizeTpin(profile.tpin));
  sessionStorage.setItem(
    ACTIVE_VENDOR_SNAPSHOT_KEY,
    JSON.stringify(toSessionSnapshot(profile)),
  );
}

export function signOutVendorSession(): void {
  assertBrowser();
  sessionStorage.removeItem(ACTIVE_VENDOR_SESSION_KEY);
  sessionStorage.removeItem(ACTIVE_VENDOR_SNAPSHOT_KEY);
}

export async function readVendorDocumentFile(
  file: File,
): Promise<VendorDocument> {
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new WalletAuthError(
      "DOCUMENT_TOO_LARGE",
      "Document must be 7 MB or smaller.",
    );
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read the selected file."));
    };
    reader.onerror = () => {
      reject(new Error("Could not read the selected file."));
    };
    reader.readAsDataURL(file);
  });

  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    dataUrl,
  };
}

export async function createVendorAccount(
  input: VendorRegistrationInput,
): Promise<{ tpin: string; publicKey: string; vendorId: string }> {
  validatePin(input.pin);
  const tpin = validateTpin(input.tpin);
  const fullName = validateFullName(input.fullName);
  const businessName = validateBusinessName(input.businessName);
  const pacraNumber = validatePacraNumber(input.pacraNumber);
  const documentNotes = input.documentNotes.trim();

  if (!documentNotes && !input.document) {
    throw new WalletAuthError(
      "DOCUMENT_REQUIRED",
      "Add verification notes or upload a supporting document.",
    );
  }

  if (await vendorExists(tpin)) {
    throw new WalletAuthError(
      "TPIN_EXISTS",
      "A vendor with this TPIN already exists. Log in instead.",
    );
  }

  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();

  await fundTestnetAccount(publicKey);

  const encrypted = await encryptSecretKey(keypair.secret(), input.pin);
  const vendorId = await allocateVendorId(fullName);
  const profile: VendorProfile = {
    vendorId,
    fullName,
    tpin,
    publicKey,
    stellarAddress: publicKey,
    encryptedKey: JSON.stringify(encrypted),
    businessName,
    pacraNumber,
    documentNotes,
    document: input.document,
    status: "pending",
    verifiedAt: null,
    createdAt: new Date().toISOString(),
    watchedEscrowIds: [],
  };

  const client = getSupabaseClient();
  const { error } = await client.from("vendors").insert(profileToInsert(profile));

  if (isUniqueConstraintError(error)) {
    const message = error?.message ?? "";
    if (message.toLowerCase().includes("tpin")) {
      throw new WalletAuthError(
        "TPIN_EXISTS",
        "A vendor with this TPIN already exists. Log in instead.",
      );
    }
    throw new WalletAuthError(
      "VENDOR_ID_COLLISION",
      "Could not allocate a unique Vendor ID. Please try again.",
    );
  }

  throwQueryError(error, "Unable to save this vendor registration.");
  notifyVendorsChanged();

  return { tpin, publicKey, vendorId };
}

export async function loginVendorAccount(
  tpin: string,
  pin: string,
): Promise<VendorSession> {
  validatePin(pin);
  const normalized = validateTpin(tpin);

  const profile = await getVendorProfile(normalized);
  if (!profile) {
    throw new WalletAuthError(
      "TPIN_NOT_FOUND",
      "No vendor account found for this TPIN. Register first.",
    );
  }

  const secretKey = await decryptSecretKey(profile.encryptedKey, pin);
  const keypair = keypairFromSecret(secretKey);

  if (keypair.publicKey() !== profile.publicKey) {
    throw new WalletAuthError(
      "CORRUPT_WALLET",
      "Stored vendor wallet data is corrupted.",
    );
  }

  setActiveVendorSession(profile);

  return {
    tpin: normalized,
    publicKey: profile.publicKey,
    keypair,
    profile,
  };
}

export async function unlockActiveVendor(pin: string): Promise<Keypair> {
  const tpin = getActiveVendorTpin();
  if (!tpin) {
    throw new WalletAuthError(
      "NO_ACTIVE_SESSION",
      "No active vendor session. Please log in again.",
    );
  }

  const session = await loginVendorAccount(tpin, pin);
  return session.keypair;
}

export async function setVendorVerificationStatus(
  tpin: string,
  status: VendorVerificationStatus,
): Promise<VendorProfile> {
  const normalized = validateTpin(tpin);
  const existing = await getVendorProfile(normalized);

  if (!existing) {
    throw new WalletAuthError(
      "TPIN_NOT_FOUND",
      "No vendor registration found for this TPIN.",
    );
  }

  const verifiedAt = status === "verified" ? new Date().toISOString() : null;
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("vendors")
    .update({
      status,
      verified_at: verifiedAt,
    })
    .eq("tpin", normalized)
    .select(VENDOR_DIRECTORY_COLUMNS)
    .single();

  throwQueryError(error, "Unable to update vendor status.");
  notifyVendorsChanged();
  return mapVendorRow(data as VendorRow);
}

export async function addWatchedEscrowId(
  tpin: string,
  escrowId: string,
): Promise<VendorProfile> {
  const normalized = validateTpin(tpin);
  const existing = await getVendorProfile(normalized);

  if (!existing) {
    throw new WalletAuthError(
      "TPIN_NOT_FOUND",
      "No vendor account found for this TPIN.",
    );
  }

  const id = escrowId.trim();
  if (!/^\d+$/.test(id)) {
    throw new WalletAuthError(
      "INVALID_ESCROW_ID",
      "Escrow ID must be a positive whole number.",
    );
  }

  const watchedEscrowIds = existing.watchedEscrowIds.includes(id)
    ? existing.watchedEscrowIds
    : [...existing.watchedEscrowIds, id];

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("vendors")
    .update({ watched_escrow_ids: watchedEscrowIds })
    .eq("tpin", normalized)
    .select(VENDOR_DIRECTORY_COLUMNS)
    .single();

  throwQueryError(error, "Unable to save this escrow to the vendor watchlist.");
  notifyVendorsChanged();
  return mapVendorRow(data as VendorRow);
}

export async function updateVendorPayoutAddress(
  tpin: string,
  stellarAddress: string,
): Promise<VendorProfile> {
  const normalized = validateTpin(tpin);
  const trimmed = stellarAddress.trim();

  try {
    Keypair.fromPublicKey(trimmed);
  } catch {
    throw new WalletAuthError(
      "INVALID_ADDRESS",
      "Enter a valid Stellar public key (starts with G).",
    );
  }

  const existing = await getVendorProfile(normalized);

  if (!existing) {
    throw new WalletAuthError(
      "TPIN_NOT_FOUND",
      "No vendor account found for this TPIN.",
    );
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("vendors")
    .update({ stellar_address: trimmed })
    .eq("tpin", normalized)
    .select(VENDOR_DIRECTORY_COLUMNS)
    .single();

  throwQueryError(error, "Unable to update the mapped payout address.");
  notifyVendorsChanged();
  return mapVendorRow(data as VendorRow);
}

export async function assignEscrowToVendorAddress(
  vendorPublicKey: string,
  escrowId: string,
): Promise<void> {
  const vendor = await findVendorByPublicKey(vendorPublicKey);
  if (!vendor) {
    return;
  }
  await addWatchedEscrowId(vendor.tpin, escrowId);
}

export async function deleteVendorAccount(tpin: string): Promise<void> {
  const normalized = validateTpin(tpin);
  const existing = await getVendorProfile(normalized);

  if (!existing) {
    throw new WalletAuthError(
      "TPIN_NOT_FOUND",
      "No vendor account found for this TPIN.",
    );
  }

  const client = getSupabaseClient();
  const { error } = await client.from("vendors").delete().eq("tpin", normalized);

  throwQueryError(error, "Unable to delete this vendor account.");
  notifyVendorsChanged();

  if (getActiveVendorTpin() === normalized) {
    signOutVendorSession();
  }
}
