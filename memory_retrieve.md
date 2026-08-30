# SmartProtocol Zambia — Reference Memory Dump

> **Purpose:** This file is a consolidated reference for AI assistants and developers joining mid-project. It captures architecture, implementation decisions, file map, deployment state, and the chronological evolution of work completed through August 22, 2026.

---

## 1. Project Overview

**SmartProtocol Zambia** is a Next.js 15 decentralized application for **Verified Milestone Payouts (VMP)** on **Stellar/Soroban Testnet**. It implements an escrow smart contract where:

- A **Funder** locks XLM until milestones are verified.
- A **Beneficiary** (e.g. farmer) submits cryptographic proof of delivery.
- A **Vendor** receives payout after the funder releases funds.

**Monorepo root:** `SmartProtocolZm/`

| Area | Path | Stack |
|------|------|-------|
| Frontend | `frontend/` | Next.js 15 App Router, React, Tailwind CSS |
| Soroban contracts | `contracts/` | Rust, Soroban SDK v23 |
| Docs | `tutorial.md`, `QA_TEST.md`, this file | Markdown |

**Run locally:**
```bash
yarn install          # or npm install
npx yarn dev          # Windows: yarn may not be on PATH
# → http://localhost:3000
```

---

## 2. Actors & Wallet Architecture (Hybrid)

| Role | Route | Wallet | Signing method |
|------|-------|--------|----------------|
| **Funder** | `/funder` | [Freighter](https://www.freighter.app) browser extension | `signAndSubmitTransaction()` via `@stellar/freighter-api` |
| **Beneficiary** | `/beneficiary`, `/beneficiary/auth` | Embedded session wallet (NRC + 4-digit PIN) | `signAndSubmitWithKeypair()` — local SDK signing, no extension |
| **Vendor** | *(none)* | Any Stellar wallet (passive) | Receives XLM when funder calls `release_funds` |

This hybrid design targets funders on desktop (Freighter) and beneficiaries in the field on mobile browsers (PIN wallet, no extension install).

---

## 3. Escrow Lifecycle (On-Chain)

```
Locked  →  Pending  →  Released  →  (vendor paid, amount zeroed)
```

| Status | Meaning |
|--------|---------|
| **Locked** | Escrow record created via `init_escrow`; no XLM deposited yet |
| **Pending** | Funder called `fund_escrow`; XLM locked in contract |
| **Released** | Beneficiary called `submit_proof`; funder may release to vendor |

---

## 4. Smart Contract — Current Design

**File:** `contracts/contracts/escrow/src/lib.rs`

### Key design change (completed)

Escrows are keyed by **`escrow_id: u64`**, NOT beneficiary address. This allows **multiple escrows per beneficiary** on the same contract.

### Storage

```rust
enum DataKey {
    Escrow(u64),        // per-escrow record
    NativeXlmToken,     // locked on first init
}

struct EscrowData {
    funder: Address,
    vendor: Address,
    amount: i128,
    status: EscrowStatus,
    recipient: Address,  // beneficiary — authorized to submit_proof
}
```

### Contract functions (all take `escrow_id` first after `env`)

| Function | Signer | Purpose |
|----------|--------|---------|
| `init_escrow(escrow_id, funder, native_xlm_token, vendor, recipient, amount)` | Funder | Create escrow → **Locked** |
| `fund_escrow(escrow_id, funder, amount)` | Funder | Deposit XLM → **Pending** |
| `submit_proof(escrow_id, beneficiary, proof_hash)` | Beneficiary | Must match `recipient` → **Released** |
| `release_funds(escrow_id, funder)` | Funder | Pay vendor, zero amount |
| `get_escrow(escrow_id)` | *(read-only simulate)* | Returns `Option<EscrowData>` |

### Tests

**File:** `contracts/contracts/escrow/src/test.rs` — **16 tests passing**, including `same_beneficiary_can_have_multiple_escrows`.

### Build & deploy

```bash
cd contracts
stellar contract build
# WASM output: contracts/target/wasm32v1-none/release/escrow.wasm

stellar contract deploy \
  --wasm target/wasm32v1-none/release/escrow.wasm \
  --source-account deployer \
  --network testnet
```

**Important:** Deploy from `contracts/` directory, NOT project root or `contracts/contracts/`.

**Configured Stellar CLI identity on dev machine:** `deployer` (and others: `beneficiary-demo`, `beneficiary-fresh`, `beneficiary2-demo`).

---

## 5. Testnet Deployment State

**Current live contract** (deployed during this project session):

| Config key | Value |
|------------|-------|
| `ESCROW_FACTORY_CONTRACT_ID` | `CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ` |
| `NATIVE_XLM_TOKEN_CONTRACT_ID` | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| RPC | `https://soroban-testnet.stellar.org` |
| Passphrase | `Test SDF Network ; September 2015` |

**Config file:** `frontend/src/blockchain/stellarConfig.ts`

**Previous contract (deprecated):** `CABMN45ARQKZ6ISJUXHVDGB236U6IEIC2ZO2V24YZB6D7JQOUVL5VFCH` — used beneficiary address as map key; frontend no longer targets it.

**Stellar Lab link:** https://lab.stellar.org/r/testnet/contract/CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ

---

## 6. Frontend Architecture

### Routes

| Route | File | Purpose |
|-------|------|---------|
| `/` | `frontend/app/page.tsx` | Landing page |
| `/funder` | `frontend/app/funder/page.tsx` | Funder dashboard (Freighter) |
| `/beneficiary/auth` | `frontend/app/beneficiary/auth/page.tsx` | NRC login / registration |
| `/beneficiary` | `frontend/app/beneficiary/page.tsx` | Beneficiary dashboard (auth-gated) |

### Layout providers (`frontend/app/layout.tsx`)

```tsx
<WalletProvider>           {/* Freighter — funder */}
  <EmbeddedWalletProvider> {/* NRC session wallet — beneficiary */}
    {children}
  </EmbeddedWalletProvider>
</WalletProvider>
```

### Blockchain client layer

**`frontend/src/blockchain/stellarClient.ts`**

All builders take **`escrowId`** as first parameter:

```typescript
getEscrowState(escrowId, simulationSourceAddress)
buildInitEscrowTx(escrowId, funder, vendor, amount, recipient)
buildFundEscrowTx(escrowId, funder, amount)
buildSubmitProofTx(escrowId, beneficiary, proofHash)
buildReleaseFundsTx(escrowId, funder)
```

Pipeline: simulate via Soroban RPC → assemble XDR → return unsigned XDR string.

**`frontend/src/blockchain/transactionService.ts`**

| Function | Used by | Description |
|----------|---------|-------------|
| `signAndSubmitTransaction(xdr)` | Funder | Freighter sign → RPC submit → poll ledger |
| `signAndSubmitWithKeypair(xdr, keypair)` | Beneficiary | Local `transaction.sign(keypair)` → RPC submit → poll |

Shared helper: `submitSignedTransaction()` handles RPC send + polling.

### Funder wallet

**`frontend/src/context/WalletContext.tsx`** — Freighter connect/session via `@stellar/freighter-api`.

**`frontend/src/components/WalletConnectButton.tsx`** — "Connect Freighter" in navbar (non-beneficiary routes).

### Beneficiary wallet (NRC multi-account)

**`frontend/src/lib/walletAuth.ts`** — Local account manager.

**Storage model:**
```typescript
// localStorage: smartprotocol_accounts_v2
Record<NRC, { publicKey: string, encryptedKey: string }>
// encryptedKey = JSON.stringify({ salt, iv, ciphertext })
// Encryption: PBKDF2 (100k iter) + AES-GCM-256 with 4-digit PIN

// sessionStorage: smartprotocol_active_nrc_v2
// Active logged-in NRC for current browser tab
```

**API:**

| Function | Purpose |
|----------|---------|
| `createAccount(nrc, pin)` | Sign up — Friendbot fund → encrypt → save |
| `loginAccount(nrc, pin)` | Log in — decrypt → set active session → return Keypair |
| `unlockActiveAccount(pin)` | Re-unlock after page refresh |
| `deleteAccount(nrc)` | Remove NRC from localStorage |
| `signOutSession()` | Clear sessionStorage only |
| `fundTestnetAccount(publicKey)` | GET `https://friendbot.stellar.org/?addr=...` |
| `normalizeNrc(nrc)` | Trim whitespace for storage key |

**Error codes:** `INVALID_NRC`, `INVALID_PIN`, `NRC_EXISTS`, `NRC_NOT_FOUND`, `FRIENDBOT_OFFLINE`, `FRIENDBOT_FAILED`, `CORRUPT_WALLET`, etc.

**Legacy:** Old single-wallet key `smartprotocol_embedded_wallet_v1` is no longer written; not auto-migrated.

**`frontend/src/context/EmbeddedWalletContext.tsx`**

React context exposing: `isAuthenticated`, `activeNrc`, `publicKey`, `keypair`, `isUnlocked`, `signUp`, `login`, `signOut`, `deleteAccount`, `unlockWithPin`.

**`frontend/src/components/BeneficiaryWalletButton.tsx`**

Navbar control on beneficiary routes: Log In link / PIN unlock / Sign Out.

---

## 7. UI Flows (Current)

### Funder (`/funder`)

1. Connect Freighter (Testnet, funded).
2. **Initialize escrow** — enter vendor + beneficiary addresses + XLM amount.
   - App auto-generates **Escrow ID** via `Date.now()` on submit.
   - Displays **Active escrow ID** — share with beneficiary.
3. **Fund escrow** — same Escrow ID, amount must match init exactly.
4. **Escrow status reader** — query by Escrow ID.
5. Wait for beneficiary proof → status **Released**.
6. **Release to vendor** — same Escrow ID.

### Beneficiary auth (`/beneficiary/auth`)

- Toggle **Log In** / **Create Account**.
- Fields: NRC (e.g. `123456/11/1`), 4-digit PIN.
- Registration: Friendbot overlay — *"Initializing and activating session wallet on Testnet…"*
- On success → redirect to `/beneficiary`.

### Beneficiary dashboard (`/beneficiary`)

- Auth-gated: redirects to `/beneficiary/auth` if not logged in.
- **Your account** panel: NRC, public key, copy button.
- **Sign Out** — clears session, keeps localStorage data.
- **Delete Account** — removes NRC from device, returns to auth.
- Enter **Escrow ID** from funder → check delivery status.
- Submit proof hash → PIN modal if locked → local sign + submit.
- Navbar: Enter PIN to Unlock / Sign Out.

### Vendor (passive)

- Share `G…` public key with funder at init time.
- No app interaction required.
- Confirm payment via Freighter balance or funder status reader.

---

## 8. Complete End-to-End Timeline

| Step | Actor | Action | Expected status |
|------|-------|--------|-----------------|
| 1 | Vendor | Share public key with funder | — |
| 2 | Beneficiary | Register at `/beneficiary/auth` (NRC + PIN) | Testnet account funded |
| 3 | Beneficiary | Share public key with funder | — |
| 4 | Funder | Initialize escrow | **Locked** + Escrow ID generated |
| 5 | Funder | Share Escrow ID with beneficiary | — |
| 6 | Funder | Fund escrow (matching amount) | **Pending** |
| 7 | Beneficiary | Lookup by Escrow ID | **Pending** |
| 8 | Beneficiary | Submit proof (PIN) | **Released** |
| 9 | Funder | Release to vendor | Balance **0 XLM** |
| 10 | Vendor | Check Freighter balance | +XLM received |

---

## 9. Key Files Reference

```
SmartProtocolZm/
├── contracts/
│   ├── contracts/escrow/src/lib.rs      # Escrow factory (escrow_id keyed)
│   ├── contracts/escrow/src/test.rs     # 16 unit tests
│   └── target/wasm32v1-none/release/escrow.wasm
├── frontend/
│   ├── app/
│   │   ├── layout.tsx                   # Dual wallet providers
│   │   ├── page.tsx                     # Landing
│   │   ├── funder/page.tsx              # Funder dashboard
│   │   └── beneficiary/
│   │       ├── auth/page.tsx            # NRC login/register
│   │       └── page.tsx                 # Beneficiary dashboard
│   └── src/
│       ├── blockchain/
│       │   ├── stellarConfig.ts         # Contract IDs, RPC, passphrase
│       │   ├── stellarClient.ts         # Build/simulate contract calls
│       │   └── transactionService.ts    # Sign + submit + poll
│       ├── context/
│       │   ├── WalletContext.tsx        # Freighter (funder)
│       │   └── EmbeddedWalletContext.tsx # NRC session (beneficiary)
│       ├── lib/
│       │   └── walletAuth.ts            # NRC account manager + Friendbot
│       └── components/
│           ├── Navbar.tsx               # Route-aware wallet button
│           ├── WalletConnectButton.tsx    # Freighter connect
│           └── BeneficiaryWalletButton.tsx
├── tutorial.md                          # User guide (updated)
├── QA_TEST.md                           # E2E QA playbook (may be partially stale)
└── memory_retrieve.md                   # This file
```

---

## 10. Dependencies (Frontend)

From `frontend/package.json`:

- `next` ^15
- `@stellar/stellar-sdk` ^15.1.0
- `@stellar/freighter-api` ^6.0.1
- `tailwindcss` ^4

---

## 11. Chronological Change Log (This Project Session)

### Phase A — Hybrid wallet architecture
- Created `frontend/src/lib/walletAuth.ts` (single PIN wallet, PBKDF2 + AES-GCM).
- Created `EmbeddedWalletContext`, `BeneficiaryWalletButton`.
- Added `signAndSubmitWithKeypair()` in `transactionService.ts`.
- Refactored `/beneficiary` to use embedded wallet instead of Freighter.
- Navbar route-aware: Freighter on funder routes, beneficiary button on `/beneficiary/*`.

### Phase B — Escrow ID refactor
- **Problem:** Original contract keyed escrows by beneficiary address → `escrow already exists for recipient` on second init for same beneficiary.
- **Contract:** Refactored to `DataKey::Escrow(u64)`, all functions take `escrow_id`.
- **Frontend:** All `stellarClient` builders + both dashboards updated for Escrow ID.
- Funder auto-generates Escrow ID with `Date.now()` on init.
- Beneficiary enters Escrow ID for lookup and proof submission.
- 16 Rust tests passing.

### Phase C — Contract redeployment
- Built WASM: `contracts/target/wasm32v1-none/release/escrow.wasm` (6444 bytes).
- Deployed to testnet with identity `deployer`.
- New contract ID: `CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ`.
- Updated `stellarConfig.ts`.

### Phase D — Friendbot auto-funding
- **Problem:** New session keypairs failed with `ACCOUNT_NOT_FOUND` on testnet.
- Added `fundTestnetAccount()` called during wallet creation.
- Registration overlay: *"Initializing and activating session wallet on Testnet…"*

### Phase E — NRC multi-account system
- **Problem:** Single wallet per device; need multiple beneficiaries on one phone.
- Refactored `walletAuth.ts` to `Record<NRC, StoredAccount>` dictionary.
- Added `/beneficiary/auth` with Log In / Create Account toggle.
- Dashboard: NRC display, Sign Out, Delete Account.
- Session in `sessionStorage`; accounts persist in `localStorage`.

### Phase F — Documentation
- Created/updated `tutorial.md` with full A→Z guide (funder → beneficiary → vendor, Escrow ID flow).
- Created this `memory_retrieve.md`.

---

## 12. Known Issues & Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| `ACCOUNT_NOT_FOUND` (beneficiary) | Should be fixed by Friendbot on registration; retry if offline |
| `escrow already exists for id` | Re-used Escrow ID — init again for new auto-generated ID |
| `amount mismatch` on fund | Fund amount ≠ init amount |
| `InvalidAction` / `UnreachableCodeReached` on init (old contract) | Was duplicate beneficiary on old contract — fixed by escrow_id refactor |
| WASM not found on deploy | Run deploy from `contracts/` dir, path `target/wasm32v1-none/release/escrow.wasm` |
| `Failed to find config identity` | Use real CLI identity e.g. `deployer`, not placeholder |
| `yarn: command not found` (Windows) | Use `npx yarn dev` |
| Simulation fails after contract change | Redeploy contract + update `stellarConfig.ts` |
| Beneficiary not authorized on proof | Wrong Escrow ID or NRC logged into wrong account |
| `QA_TEST.md` stale sections | Still references old beneficiary-key model and old contract ID — update if used for QA |

---

## 13. Git Status Notes (Session Start Snapshot)

At conversation start, uncommitted changes included:
- `.gitignore` (modified)
- `frontend/app/page.tsx` (modified)
- Untracked: `QA_TEST.md`, `SmartProtocol_Zambia_Final_Deliverable_Report.md`

Many files were added/modified during this session **without an explicit commit request** from the user. Check `git status` for current state before assuming what is committed.

---

## 14. What Is NOT Done / Future Work

- `QA_TEST.md` not fully updated for Escrow ID + NRC auth flow.
- `SmartProtocol_Zambia_Final_Deliverable_Report.md` may predate latest architecture.
- No `/vendor` dashboard (by design — vendor is passive).
- NRC validation is minimal (length check only, not strict format regex).
- PIN is 4 digits — convenience over high security (documented in tutorial).
- No mainnet deployment.
- Legacy wallet (`smartprotocol_embedded_wallet_v1`) not migrated to NRC model.
- Auth page does not require PIN confirmation on registration (only single PIN field).

---

## 15. Quick Commands Cheat Sheet

```bash
# Dev server
npx yarn dev

# Frontend production build
cd frontend && npm run build

# Contract tests
cd contracts/contracts/escrow && cargo test

# Contract build
cd contracts && stellar contract build

# Contract deploy
cd contracts && stellar contract deploy \
  --wasm target/wasm32v1-none/release/escrow.wasm \
  --source-account deployer \
  --network testnet

# List Stellar CLI identities
stellar keys ls
```

---

## 16. URLs for Testing

| Resource | URL |
|----------|-----|
| Local app | http://localhost:3000 |
| Funder | http://localhost:3000/funder |
| Beneficiary auth | http://localhost:3000/beneficiary/auth |
| Beneficiary dashboard | http://localhost:3000/beneficiary |
| Stellar Expert (testnet) | https://stellar.expert/explorer/testnet |
| Friendbot | https://friendbot.stellar.org |
| Stellar Laboratory | https://laboratory.stellar.org/#account-creator?network=test |

---

## 17. Session Debugging & Decisions (Narrative History)

This section captures **conversation-level context** — errors encountered, root causes, fixes applied, and architectural decisions made during the August 22, 2026 session. It supplements Section 11 (phase summary) with the "why" and "how we got here."

### 17.1 Initial request: Hybrid wallet architecture

**User goal:** Keep Freighter for funders; replace Freighter for beneficiaries with an embedded session wallet to reduce friction for mobile users in emerging markets.

**Decisions made:**
- Split signing at the **transaction layer**, not just UI: funders use `signAndSubmitTransaction()` (Freighter); beneficiaries use `signAndSubmitWithKeypair()` (local SDK).
- Keep both `WalletProvider` and `EmbeddedWalletProvider` in root layout — funder and beneficiary pages use different contexts.
- Navbar becomes **route-aware**: `WalletConnectButton` on `/funder`, `BeneficiaryWalletButton` on `/beneficiary/*`.
- Beneficiary public key stored in localStorage encrypted with 4-digit PIN (PBKDF2 100k + AES-GCM-256).
- PIN prompted on proof submission; optional navbar "Enter PIN to Unlock" for session convenience.

**Files created in this phase:** `walletAuth.ts`, `EmbeddedWalletContext.tsx`, `BeneficiaryWalletButton.tsx`.

---

### 17.2 Tutorial and dev server setup

**User actions:**
- Created `tutorial.md` (later updated multiple times).
- Ran dev server with `npx yarn dev` because `yarn` was not on PATH (Windows/Git Bash).

**Terminal notes:**
- Local: `http://localhost:3000`
- Network URL for phone testing: `http://192.168.x.x:3000` (shown in Next.js dev output)
- npm warnings about unknown env config (`devdir`, `argv`) — harmless

---

### 17.3 Debug incident: `init_escrow` simulation failure

**Error reported:**
```
StellarClientError: HostError: Error(WasmVm, InvalidAction)
VM call trapped: UnreachableCodeReached, init_escrow
```

**Transaction context (from event log):**
- Funder: `GBSZBTJCSJZVDD7J7ZN74UTVKWKATNCAQNHTH7FZWQFPXYVDBVNJ2MCP`
- Beneficiary: `GBAAC6NUSV6HSUW5AGBAWNZBTS4SS23SPWUD6ZPYGKUDFXMQXPITTS3J`
- Vendor: `GCNSLDLKTJOXJ2MWSLVD6VDAVL6MXA4IZCDX2S5DKM75FGUPHKBDOZA2`
- Amount: 500 XLM (5000000000 stroops)

**Investigation:**
- Queried on-chain `get_escrow` for beneficiary address against **old contract** `CABMN45…`.
- Escrow already existed for that beneficiary: status **Released**, amount **0** (completed prior test run).

**Root cause:** Old contract keyed escrows by **beneficiary address** — one escrow per beneficiary forever. Re-initializing for the same beneficiary address triggered contract panic `escrow already exists for recipient`, surfaced as opaque `UnreachableCodeReached` in Soroban diagnostics.

**Immediate workaround told to user:** Create new beneficiary session wallet OR use status reader to verify existing escrow.

**Architectural fix (Phase B):** User requested refactor to `escrow_id: u64` primary key — allows multiple deliveries per beneficiary.

---

### 17.4 Escrow ID refactor — design decisions

**Contract changes:**
- `DataKey::Escrow(u64)` replaces `Map<Address, Escrow>` / single `Escrows` map.
- Renamed struct to `EscrowData`; `recipient` field retains beneficiary for `submit_proof` authorization.
- `submit_proof` no longer takes separate `recipient` arg — loads escrow by ID, verifies `beneficiary == escrow.recipient`.
- `fund_escrow` and `release_funds` no longer take beneficiary address — only `escrow_id` + funder.
- Duplicate ID panic: `escrow already exists for id`.
- Added test: `same_beneficiary_can_have_multiple_escrows`.

**Frontend changes:**
- All `stellarClient` functions take `escrowId` as first parameter.
- Funder generates Escrow ID with `Date.now()` at init submit time; displays prominently.
- Beneficiary enters Escrow ID manually (provided by funder).
- Status reader on funder page queries by Escrow ID, not beneficiary address.

**Important:** Frontend changes require **new contract deployment** — old `CABMN45…` contract ABI does not match new escrow_id-first signatures.

---

### 17.5 Contract build & deploy debugging

**Build success:**
```bash
cd contracts && stellar contract build
# escrow.wasm: 6444 bytes optimized
# Exported: init_escrow, fund_escrow, submit_proof, release_funds, get_escrow
```

**Deploy failures encountered:**

| Attempt | Error | Cause |
|---------|-------|-------|
| From project root | `reading file target/wasm32v1-none/release/escrow.wasm: path not found` | WASM lives under `contracts/target/…`, not root `target/…` |
| From `contracts/contracts/` | Same path error | Wrong subdirectory — one level too deep |
| `--source-account YOUR_IDENTITY_NAME` | `Failed to find config identity` | Placeholder string, not real CLI identity |
| `--wasm target/wasm32-unknown-unknown/release/your_contract_name.wasm` | Path not found | Wrong target triple and placeholder filename |

**Resolution:**
- Deploy from `SmartProtocolZm/contracts/` directory.
- Use configured identity **`deployer`** (`stellar keys ls` showed: `deployer`, `beneficiary-demo`, etc.).
- Successful deploy command:
  ```bash
  cd ~/Desktop/SmartProtocolZm/contracts
  stellar contract deploy \
    --wasm target/wasm32v1-none/release/escrow.wasm \
    --source-account deployer \
    --network testnet
  ```
- New contract ID: `CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ`
- Updated `frontend/src/blockchain/stellarConfig.ts` automatically during session.

**Deployer public key:** `GDXSKWYHS6MZC7263P3JTEGSIKVT2ONBDRSL4XTKLHZUKH4WFG2PM6A2`

---

### 17.6 Debug incident: `ACCOUNT_NOT_FOUND` on beneficiary transactions

**Problem:** Embedded wallet generates keypair locally, but Stellar requires accounts to exist on-ledger before they can sign/submit Soroban transactions. New random keypairs are not funded by default.

**Fix (Phase D):**
- Added `fundTestnetAccount(publicKey)` → GET `https://friendbot.stellar.org/?addr=PUBLIC_KEY`
- Called inside `createEmbeddedWallet()` / `createAccount()` **before** persisting to localStorage.
- If Friendbot fails: wallet **not saved**; errors `FRIENDBOT_OFFLINE` or `FRIENDBOT_FAILED`.
- UI overlay during registration: *"Initializing and activating session wallet on Testnet…"*

**TypeScript note:** Web Crypto API required `toArrayBuffer()` helper for PBKDF2 salt/iv — fixed `BufferSource` type error during build.

---

### 17.7 NRC multi-account refactor — design decisions

**User goal:** Multiple beneficiary accounts on one device, keyed by National Registration Card (NRC) number.

**Storage migration:**
- Old: single key `smartprotocol_embedded_wallet_v1` (one wallet per device).
- New: `smartprotocol_accounts_v2` → `Record<NRC, { publicKey, encryptedKey }>`.
- Active session: `smartprotocol_active_nrc_v2` in `sessionStorage`.
- Legacy key not auto-migrated — existing single-wallet users must re-register.

**Auth flow split:**
- `/beneficiary/auth` — Log In / Create Account toggle (NRC + PIN).
- `/beneficiary` — dashboard, auth-gated via `useEffect` redirect.

**Session semantics:**
- **Sign Out:** clears `sessionStorage` + React state; NRC data remains in `localStorage`.
- **Delete Account:** removes NRC entry from `localStorage` + clears session.
- Page refresh with active session: restores NRC + publicKey from storage, keypair null until PIN unlock.

**Proof submission PIN flow:**
- If keypair in memory → sign directly.
- If locked → PIN modal → `loginAccount(activeNrc, pin)` → `submitProofWithKeypair()`.

**NRC validation:** Minimal — trim whitespace, min length 6. No strict `123456/11/1` regex yet.

---

### 17.8 Build verification milestones

All passed during session:
- `cargo test` — 16/16 escrow contract tests
- `npm run build` (frontend) — after each major refactor
- Dev server compiled routes: `/`, `/funder`, `/beneficiary`, `/beneficiary/auth`

---

### 17.9 Documentation evolution

| Document | Status |
|----------|--------|
| `tutorial.md` | Updated for hybrid wallets, Escrow ID, Friendbot, NRC auth, deploy steps |
| `memory_retrieve.md` | Created as AI reference dump; this section added on user request |
| `QA_TEST.md` | **Stale** — still references beneficiary-as-key, old contract, Freighter for beneficiary |
| `SmartProtocol_Zambia_Final_Deliverable_Report.md` | **Likely stale** — predates escrow_id + NRC changes |

---

### 17.10 Key architectural invariants (do not break)

1. **Funder never uses embedded wallet** — always Freighter via `WalletContext`.
2. **Beneficiary never uses Freighter** — always NRC session via `EmbeddedWalletContext`.
3. **All contract writes require correct `escrow_id`** — shared between funder and beneficiary out-of-band (SMS, etc.).
4. **Fund amount must exactly match init amount** — contract enforces `amount mismatch` panic.
5. **Contract ID in `stellarConfig.ts` must match deployed WASM** — mismatch causes simulation failures with cryptic errors.
6. **Beneficiary account must exist on testnet** — Friendbot on registration handles this.
7. **`submit_proof` caller must match `recipient` stored in escrow** — contract enforces; frontend also checks on lookup.

---

### 17.11 User workflow preferences observed

- User on **Windows** with Git Bash; prefers `npx yarn dev` over bare `yarn`.
- User did **not** request git commits during session — many changes may be uncommitted.
- User wanted tutorial as operational guide; memory dump for AI continuity.
- Mobile beneficiary testing intended via network URL from dev server.

---

*Last updated: August 22, 2026 — reflects state after NRC multi-account beneficiary system, Escrow ID contract refactor, and testnet redeployment to `CDZD44…`.*
