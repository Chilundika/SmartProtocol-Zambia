# SmartProtocol Zambia — Security & Data Integrity Fixes
*Spec for implementation in Cursor (Claude Opus 5 agent)*

This document addresses three gaps identified in the current build:
1. Weak PIN auth with no rate limiting
2. No server-side NRC uniqueness enforcement
3. Vendor ID collision risk

Each section has: the problem, the schema change, and the implementation logic. Hand each section to the coding agent as a discrete task — they don't depend on each other.

---

## 1. PIN Security & Rate Limiting

### Problem
4-digit PINs = 10,000 combinations. Without lockout, a script (or someone with physical access to a shared device) can brute-force a beneficiary's session in seconds. This gates fund release, so it needs real protection — but the fix has to stay usable for farmers on basic phones with no email/SMS OTP infrastructure assumed.

### Schema changes (Supabase / Postgres)

```sql
alter table beneficiaries
  add column pin_hash text not null default '', -- bcrypt hash, replaces plaintext pin
  add column failed_pin_attempts int not null default 0,
  add column locked_until timestamptz null,
  add column last_attempt_at timestamptz null;

-- index for fast lockout checks
create index idx_beneficiaries_nrc on beneficiaries (nrc);
```

**Critical: stop storing PINs in plaintext.** Hash with bcrypt (or argon2) server-side before insert. Never compare PINs client-side or return `pin` in any API response.

### Lockout logic (server-side only — Supabase Edge Function or RPC, never client)

```typescript
// pseudocode for the login/PIN-verify edge function
const MAX_ATTEMPTS = 5;
const LOCKOUT_STEPS_MINUTES = [1, 5, 15, 60, 240]; // escalating lockout

async function verifyPin(nrc: string, pin: string) {
  const beneficiary = await getBeneficiaryByNrc(nrc);
  if (!beneficiary) return { error: "not_found" };

  if (beneficiary.locked_until && new Date() < beneficiary.locked_until) {
    return { error: "locked", retryAt: beneficiary.locked_until };
  }

  const valid = await bcrypt.compare(pin, beneficiary.pin_hash);

  if (!valid) {
    const attempts = beneficiary.failed_pin_attempts + 1;
    const stepIndex = Math.min(attempts - MAX_ATTEMPTS, LOCKOUT_STEPS_MINUTES.length - 1);
    const lockUntil = attempts >= MAX_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_STEPS_MINUTES[Math.max(stepIndex, 0)] * 60_000)
      : null;

    await updateBeneficiary(beneficiary.id, {
      failed_pin_attempts: attempts,
      locked_until: lockUntil,
      last_attempt_at: new Date(),
    });

    return { error: "invalid_pin", attemptsRemaining: Math.max(0, MAX_ATTEMPTS - attempts) };
  }

  // success — reset counters
  await updateBeneficiary(beneficiary.id, { failed_pin_attempts: 0, locked_until: null });
  return { success: true, sessionToken: issueSession(beneficiary.id) };
}
```

### Recovery flow
Since farmers likely can't self-serve a password reset (no reliable email/SMS), route lockout recovery through an **assisted reset**:
- A vendor or field agent with elevated role can trigger a reset after re-verifying the farmer's NRC + a secondary check (e.g. physical ID inspection, matches existing pilot patterns for KYC-lite programs).
- Log every assisted reset (`reset_by`, `reset_at`, `reason`) to a `beneficiary_pin_resets` audit table — this closes a fraud vector where an agent resets PINs to redirect payouts.

```sql
create table beneficiary_pin_resets (
  id uuid primary key default gen_random_uuid(),
  beneficiary_id uuid references beneficiaries(id),
  reset_by uuid references vendors(id), -- or an agents table if you have one
  reason text,
  created_at timestamptz default now()
);
```

---

## 2. NRC Uniqueness & Validation

### Problem
No server-side uniqueness check means duplicate/ghost beneficiary records can slip in via typos or intentional re-registration — the exact fraud vector this protocol exists to remove.

### Schema changes

```sql
-- normalize NRC format before this constraint goes on: strip spaces, enforce case
alter table beneficiaries
  add constraint uq_beneficiaries_nrc unique (nrc);

-- Zambian NRC format: 6 digits / 2 digits / 1 digit, e.g. 123456/78/1
alter table beneficiaries
  add constraint chk_nrc_format check (nrc ~ '^\d{6}/\d{2}/\d{1}$');
```

### Normalization (apply before every insert/lookup)

```typescript
function normalizeNrc(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}
```

Run this in the registration handler *before* the uniqueness check hits the DB — otherwise `123456/78/1` and `123456 /78/1 ` register as "different" NRCs.

### Server-side registration flow

```typescript
async function registerBeneficiary(rawNrc: string, pin: string, ...rest) {
  const nrc = normalizeNrc(rawNrc);

  if (!/^\d{6}\/\d{2}\/\d{1}$/.test(nrc)) {
    return { error: "invalid_nrc_format" };
  }

  const existing = await getBeneficiaryByNrc(nrc);
  if (existing) {
    return { error: "nrc_already_registered" };
  }

  const pinHash = await bcrypt.hash(pin, 10);
  return await insertBeneficiary({ nrc, pin_hash: pinHash, ...rest });
}
```

The DB `unique` constraint is the real backstop (handles race conditions the app-level check can miss); the app-level check is just for a clean error message instead of a raw Postgres constraint violation.

### Near-duplicate detection (optional, funder-facing)
Typos won't always produce an exact-match collision (e.g. `123456/78/1` vs `123457/78/1`). Add a lightweight admin flag rather than blocking registration outright:

```sql
-- run periodically or on new registration, flag NRCs within edit-distance 1
-- of an existing NRC for funder review, don't auto-reject
```

Use `pg_trgm` + `similarity()` in Postgres, or compute Levenshtein distance in an Edge Function against recent registrations in the same district/vendor catchment, and surface flagged pairs in the Funder Verification Dashboard rather than silently blocking — a human should adjudicate genuine near-duplicates vs. legitimate similar NRCs.

---

## 3. Vendor ID Collision Risk

### Problem
`[initial][initial][5 digits]` = 100,000 combinations per initial pair. Fine at pilot scale, but common initial pairs (e.g. "CM", "JM") will exhaust faster, and there's currently no DB-level guarantee of uniqueness — just a generation-time assumption.

### Schema change

```sql
alter table vendors
  add constraint uq_vendors_vendor_id unique (vendor_id);
```

This alone turns silent collisions into a catchable error — pair it with a retry loop so it's invisible to the user.

### Generation logic with collision retry

```typescript
async function generateVendorId(firstName: string, lastName: string): Promise<string> {
  const prefix = (firstName[0] + lastName[0]).toLowerCase();
  const MAX_RETRIES = 10;

  for (let i = 0; i < MAX_RETRIES; i++) {
    const digits = String(Math.floor(10000 + Math.random() * 90000)); // 5 digits
    const candidate = prefix + digits;

    const { data: existing } = await supabase
      .from("vendors")
      .select("id")
      .eq("vendor_id", candidate)
      .maybeSingle();

    if (!existing) return candidate;
  }

  throw new Error("vendor_id_generation_exhausted"); // extremely unlikely, but fail loud
}
```

### Recommended upgrade: add a check digit
Vendor IDs get **read aloud and manually typed** by funders during escrow setup (per the workflow doc) — that's a keying-error risk, not just a collision risk. A check digit catches typos at entry time before an escrow gets misdirected to the wrong vendor.

```typescript
// simple mod-10 check digit appended to the candidate
function checkDigit(id: string): number {
  const codeSum = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return codeSum % 10;
}

// vendor ID becomes: cc33791-4  (8 chars + check digit)
// on funder entry, recompute the check digit and reject silently-wrong IDs
// before the escrow amount screen ever loads
```

This is a small change now vs. a costly one once vendor IDs are live in production escrows — worth doing at the same time as the uniqueness constraint rather than as a follow-up.

---

## Suggested implementation order
1. NRC uniqueness + normalization (smallest change, closes the most direct fraud gap)
2. Vendor ID unique constraint + retry loop (quick, low-risk)
3. PIN hashing + lockout (touches auth flow — test thoroughly on a staging Supabase instance before deploying, since it changes the login contract)

Check digit on vendor IDs can ride along with step 2 if there's time, or ship as a fast-follow.
