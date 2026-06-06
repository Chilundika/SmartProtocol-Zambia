# SmartProtocol Zambia — Institutional Memory (`memoryhistory.md`)

> **Purpose:** Handoff “brain” for a fresh AI session. Read this file first before making changes.  
> **Last updated:** June 5, 2026 (Phase 3 — testnet deploy + transaction execution)  
> **Repository:** [https://github.com/Chilundika/SmartProtocol-Zambia.git](https://github.com/Chilundika/SmartProtocol-Zambia.git)  
> **Branch:** `main` (synced with `origin/main` at commit `d2c27a3`)

---

## 1. Project Genesis & Constraints

### Name & program context

- **Project name:** SmartProtocol Zambia  
- **Program / pitch context:** Instaward Project  
- **Product model:** **Verified Milestone Payout (VMP)** — funds locked in on-chain escrow until a beneficiary provides cryptographic sign-off, then the funder releases payment to the vendor.

### Hard constraints (non-negotiable for MVP)

| Constraint | Meaning |
|------------|---------|
| **NO biometric ID** | Do not integrate fingerprint, face, or national-ID hardware/SDK flows. |
| **NO offline SMS gateways** | No SMS/USSD proof or payout rails in MVP. |
| **Native XLM only** | Escrow asset is Native XLM via Stellar Asset Contract (SAC) `token::Client` — not custom tokens or multi-asset support in MVP. |

### Core roles (on-chain + UI language)

| Role | Responsibility |
|------|----------------|
| **Funder** | Creates escrow, deposits XLM, triggers `release_funds` to vendor |
| **Beneficiary / recipient / farmer** | Submits milestone proof via `submit_proof` |
| **Vendor** | Receives XLM after proof + funder release |

### VMP lifecycle (contract state machine)

```
init_escrow     →  Locked    (entry created, not funded)
fund_escrow     →  Pending   (XLM in contract)
submit_proof    →  Released  (beneficiary sign-off; MVP uses proof_hash placeholder)
release_funds   →  Paid out  (vendor receives XLM; amount zeroed on-chain)
```

---

## 2. Current Architecture Snapshot

### Monorepo layout

```
SmartProtocolZm/                    # Git root (npm workspaces for frontend)
├── README.md
├── package.json                    # workspaces: ["frontend"]
├── package-lock.json               # Root lockfile (hoists some deps)
├── memoryhistory.md                # THIS FILE
├── updates_report.md               # Report 1 — bootstrap → escrow tests
├── updates_report_2.md             # Report 2 — housekeeping, wallet, config
├── updates_report_3.md             # Report 3 — UI core + stellarClient audit
│
├── contracts/                      # Rust / Soroban workspace ROOT
│   ├── Cargo.toml                  # members = ["contracts/*"], soroban-sdk = "23"
│   ├── Cargo.lock
│   ├── README.md
│   └── contracts/
│       ├── escrow/                 # ★ PRIMARY VMP contract
│       │   ├── Cargo.toml          # crate name: escrow, cdylib
│       │   └── src/
│       │       ├── lib.rs          # EscrowFactoryContract + all logic
│       │       └── test.rs         # 15 unit tests
│       └── hello_world/            # Soroban starter only (do not confuse with escrow)
│           └── src/lib.rs
│
└── frontend/                       # Next.js 15 App Router app
    ├── app/
    │   ├── layout.tsx              # WalletProvider wrapper + metadata
    │   ├── page.tsx                # Landing + Navbar
    │   └── globals.css             # Tailwind v4 @import "tailwindcss"
    └── src/
        ├── blockchain/
        │   ├── stellarConfig.ts    # RPC, passphrase, live testnet contract IDs
        │   ├── stellarClient.ts    # RPC simulate + XDR builders
        │   └── transactionService.ts # Freighter sign + RPC submit + poll
        ├── components/
        │   ├── Navbar.tsx
        │   └── WalletConnectButton.tsx
        ├── context/
        │   └── WalletContext.tsx
        └── types/
            └── wallet.d.ts         # window.freighterApi / starlight types
```

**Important path note:** The Soroban escrow crate lives at `contracts/contracts/escrow/` (double `contracts/`), not `contracts/escrow/`. Workspace glob `contracts/*` resolves correctly.

### Exact tech stack

| Layer | Technology | Version / notes |
|-------|------------|-----------------|
| Frontend framework | **Next.js** (App Router, Turbopack dev/build) | 15.5.19 |
| UI | **React** | 19.1.0 |
| Styling | **Tailwind CSS** | v4 (`@tailwindcss/postcss`) |
| Language | **TypeScript** | ^5 |
| Stellar SDK | **`@stellar/stellar-sdk`** | ^15.1.0 |
| Wallet | **`@stellar/freighter-api`** | ^6.0.1 |
| Smart contracts | **Soroban** (`soroban-sdk`) | **23** (workspace dependency) |
| Rust edition | 2021 | |
| WASM target | `wasm32v1-none` | Required: `rustup target add wasm32v1-none` |
| CLI (deploy) | **Stellar CLI** (`stellar contract build/deploy`) | Not committed; install locally |

### Configuration constants (live Testnet — Phase 3)

File: `frontend/src/blockchain/stellarConfig.ts`

| Constant | Current state |
|----------|----------------|
| `STELLAR_TESTNET_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `STELLAR_TESTNET_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` |
| `ESCROW_FACTORY_CONTRACT_ID` | `CABMN45ARQKZ6ISJUXHVDGB236U6IEIC2ZO2V24YZB6D7JQOUVL5VFCH` |
| `NATIVE_XLM_TOKEN_CONTRACT_ID` | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

---

## 3. What Is Built & Verified (The Truth)

### 3.1 Soroban escrow contract

**Canonical source:** `contracts/contracts/escrow/src/lib.rs`  
**Contract type:** `EscrowFactoryContract`

| Feature | Status | Location / notes |
|---------|--------|------------------|
| Factory pattern | **Done** | `Map<Address, Escrow>` keyed by `recipient` in instance storage (`DataKey::Escrows`) |
| `Escrow` struct | **Done** | `funder`, `vendor`, `amount`, `status`, `recipient` |
| `EscrowStatus` enum | **Done** | `Locked`, `Pending`, `Released` |
| `init_escrow` | **Done** | Funder auth; locks Native XLM SAC address |
| `fund_escrow` | **Done** | Funder → contract XLM transfer |
| `submit_proof` | **Done** | Beneficiary auth; non-zero `proof_hash` MVP |
| `release_funds` | **Done** | Funder → vendor transfer; `amount` zeroed |
| `get_escrow` | **Done** | Read-only query |

**Tests:** `contracts/contracts/escrow/src/test.rs` — **15 tests passing** (happy path + negative security cases).

**Commands verified:**
```bash
cd contracts
cargo test -p escrow
cargo build -p escrow --target wasm32v1-none --release
```

**WASM output:** `contracts/target/wasm32v1-none/release/escrow.wasm`

**Housekeeping done:** Legacy duplicate `contracts/contracts/hello_world/src/escrow.rs` was **deleted**. `hello_world` restored to standard template only.

**Not done on-chain:** Real ed25519 proof verification (contract still accepts any non-zero 32-byte `proof_hash`). No `escrow_id` — one escrow per `recipient` address in MVP.

---

### 3.2 Frontend — wallet layer

| Feature | Status | File |
|---------|--------|------|
| `WalletProvider` global wrap | **Done** | `frontend/app/layout.tsx` |
| `WalletContext` | **Done** | `frontend/src/context/WalletContext.tsx` |
| State: `isConnected`, `publicKey`, `isConnecting` | **Done** | |
| `connectWallet` / `disconnectWallet` | **Done** | Freighter-first; fallbacks: `window.freighterApi`, `window.starlight` |
| Session restore on mount | **Done** | `getAddress()` when already authorized |
| Window types | **Done** | `frontend/src/types/wallet.d.ts` |

**Not done in WalletContext:** `signAuthEntry` (not needed for MVP flows). Signing/submit lives in `transactionService.ts` (Phase 3).

---

### 3.3 Frontend — UI core

| Feature | Status | File |
|---------|--------|------|
| Responsive Navbar | **Done** | `frontend/src/components/Navbar.tsx` |
| Branding “SmartProtocol Zambia” | **Done** | |
| Nav links (hash anchors) | **Done** | `#funder-dashboard`, `#beneficiary-signoff` |
| Wallet connect button | **Done** | `frontend/src/components/WalletConnectButton.tsx` (uses `useWallet`) |
| VMP landing page | **Done** | `frontend/app/page.tsx` |
| App metadata | **Done** | `frontend/app/layout.tsx` |

**Not done:** Dedicated `/funder` or `/beneficiary` routes, escrow forms, transaction status UI, toasts.

---

### 3.4 Frontend — blockchain client (`stellarClient.ts`)

**File:** `frontend/src/blockchain/stellarClient.ts`  
**Pattern:** Soroban RPC `simulateTransaction` + `assembleTransaction` → returns **XDR string** for Freighter signing via `transactionService.ts`.

| Client function | Contract method | Status |
|-----------------|-----------------|--------|
| `getEscrowState(recipient, simulationSource?)` | `get_escrow` | **Done** — read via simulation |
| `buildInitEscrowTx(funder, vendor, amount, recipient)` | `init_escrow` | **Done** |
| `buildFundEscrowTx(funder, recipient, amount)` | `fund_escrow` | **Done** |
| `buildSubmitProofTx(beneficiary, proofHash, recipient?)` | `submit_proof` | **Done** |
| `buildReleaseFundsTx(funder, recipient)` | `release_funds` | **Done** (added before commit `d2c27a3`) |

**Error type:** `StellarClientError` with codes (`CONFIG_NOT_SET`, `RPC_ERROR`, `SIMULATION_FAILED`, etc.) for UI display.

---

### 3.5 Frontend — transaction execution (`transactionService.ts`)

**File:** `frontend/src/blockchain/transactionService.ts`  
**Pattern:** Freighter `signTransaction` → `rpc.Server.sendTransaction` → poll `getTransaction` until `SUCCESS` or `FAILED`.

| Feature | Status | Notes |
|---------|--------|-------|
| `signAndSubmitTransaction(xdr)` | **Done** | Full sign → submit → poll pipeline |
| `TransactionSubmitResult` | **Done** | `{ txHash, status, signerAddress }` |
| `TransactionServiceError` | **Done** | Typed codes for UI (`SIGNING_FAILED`, `LEDGER_FAILED`, etc.) |
| UI integration | **Not done** | No React page imports this module yet (P1) |

---

### 3.6 Build & CI verification

| Check | Result |
|-------|--------|
| `cd frontend && npx tsc --noEmit` | Pass |
| `cd frontend && npm run build` | Pass |
| `cd contracts && cargo test -p escrow` | 15 passed |

**Known non-blocking warning:** Multiple lockfiles (`/package-lock.json` vs `frontend/package-lock.json`) — Turbopack may warn; build still succeeds.

**CI/CD:** No GitHub Actions workflow yet.

---

### 3.7 Git history (institutional timeline)

| Commit | Summary |
|--------|---------|
| `c6a91d5` | Initial monorepo: Next.js + Soroban workspace |
| `60c3b53` | Escrow tests hardened; hello_world cleanup; `updates_report.md` |
| `a8d2c9d` | Week 2: stellar-sdk, freighter-api, WalletContext, stellarConfig |
| `6b91f11` | `updates_report_2.md` |
| `d2c27a3` | stellarClient (full parity), Navbar, landing, `updates_report_3.md` |

**Remote:** `origin/main` at `d2c27a3`. Local has uncommitted Phase 3: `stellarConfig.ts` (live IDs), `transactionService.ts`, `updates_report_4.md`.

---

## 4. Where We Paused (The Exact Execution State)

### Current phase

**Phase 3 complete — infrastructure ready; P1 UI wiring is the critical path.**

The codebase can:

- Connect Freighter and show wallet state in the UI  
- Build and simulate all five contract interactions via `stellarClient.ts`  
- **Sign, submit, and confirm** transactions via `transactionService.ts` against the deployed factory  
- Target live Testnet contract IDs in `stellarConfig.ts`  
- Run all escrow unit tests and produce WASM  

The codebase **cannot yet**:

- Drive escrow flows from **dashboard UI** (no forms calling builders + `signAndSubmitTransaction`)  
- Show **live** escrow state from testnet in the UI after user actions (P1 status panel)  
- Provide transaction progress / error toasts to end users (P1)

### Correction vs older notes

Some earlier sprint notes (including Report 3 draft) listed `buildReleaseFundsTx` as missing. **That is outdated.** `buildReleaseFundsTx` **exists** in `frontend/src/blockchain/stellarClient.ts` and was pushed in `d2c27a3`.

### Immediate backlog (ordered)

1. ~~**Deploy escrow to Stellar Testnet**~~ — **DONE** (`CABMN45…VFCH`)  
2. ~~**Update `stellarConfig.ts`** with live contract IDs~~ — **DONE**  
3. ~~**Implement `signAndSubmitTransaction`** in `transactionService.ts`~~ — **DONE**  
4. **Wire UI forms** on `/funder` and `/beneficiary` routes → `build*Tx` + `signAndSubmitTransaction` + `getEscrowState` (**P1**)  
5. **Transaction status UI** — surface `TransactionServiceError` / success `txHash` (**P1**)  
6. **Fund testnet accounts** (Friendbot) for demo funder / beneficiary / vendor (**P1/P2**)  
7. **Commit & push** Phase 3 artifacts to `origin/main`  
8. **Optional contract hardening:** real cryptographic proof verification (replace MVP `proof_hash` check) (**P2**)

### What is explicitly NOT the next priority

- Biometric ID, SMS gateways, multi-asset escrows  
- Rewriting working contract tests or changing factory map keying without explicit approval  
- Deleting or “simplifying” `WalletContext` / `stellarClient` without permission  

---

## 5. New Session Directives (Rules for the Next AI)

### Mandatory rules

1. **Read this file first**, then `updates_report_3.md` for sprint detail, then inspect paths before editing.  
2. **Never overwrite existing working code** (contract `lib.rs`, `stellarClient.ts` builders, `WalletContext`, tests) **without explicit user permission**. Prefer additive changes.  
3. **Do not modify** `contracts/contracts/hello_world/` except bugfixes — it is a Soroban template only.  
4. **Do not commit secrets** (`.env`, keys, seeds) — config uses placeholders in `stellarConfig.ts`.  
5. **Run from correct directories:**  
   - Rust: `cd contracts` (not nested `contracts/contracts`)  
   - Frontend: `cd frontend`  
   - Git: repo root `SmartProtocolZm/`  
6. **Match conventions:** Tailwind v4 utilities, `"use client"` for wallet hooks, `@/*` import alias to frontend root.

### Priority order for the next session

| Priority | Task | Status |
|----------|------|--------|
| ~~**P0**~~ | ~~Soroban CLI testnet deploy + update `stellarConfig.ts`~~ | **Done** |
| ~~**P0**~~ | ~~`signAndSubmitTransaction` (Freighter + RPC)~~ | **Done** |
| **P1** | Funder / beneficiary dashboard pages + forms wired to `stellarClient` + `transactionService` | Next |
| **P1** | Live `getEscrowState` display + transaction status UI after actions | Next |
| **P2** | GitHub Actions CI, proof verification upgrade, lockfile cleanup | Backlog |

### Do NOT redo (already complete)

- Escrow factory contract logic in `contracts/contracts/escrow/src/lib.rs`  
- 15 escrow unit tests  
- `buildInitEscrowTx`, `buildFundEscrowTx`, `buildSubmitProofTx`, **`buildReleaseFundsTx`**  
- Navbar, WalletConnectButton, landing page, WalletProvider  

### Key file quick reference

| Need | Path |
|------|------|
| Contract logic | `contracts/contracts/escrow/src/lib.rs` |
| Contract tests | `contracts/contracts/escrow/src/test.rs` |
| RPC / XDR client | `frontend/src/blockchain/stellarClient.ts` |
| Sign + submit + poll | `frontend/src/blockchain/transactionService.ts` |
| Config | `frontend/src/blockchain/stellarConfig.ts` |
| Wallet | `frontend/src/context/WalletContext.tsx` |
| UI shell | `frontend/src/components/Navbar.tsx`, `WalletConnectButton.tsx` |
| Entry page | `frontend/app/page.tsx` |
| Root layout | `frontend/app/layout.tsx` |

### Useful commands

```bash
# Contracts
cd contracts
cargo test -p escrow
cargo build -p escrow --target wasm32v1-none --release
stellar contract build   # if Stellar CLI installed

# Frontend
cd frontend
npm run dev
npm run build
npx tsc --noEmit

# Git (repo root)
git status
git pull origin main
```

---

## 6. Supplementary documentation

| Document | Contents |
|----------|----------|
| `updates_report.md` | Full bootstrap: monorepo, escrow design, first tests, WASM |
| `updates_report_2.md` | Housekeeping, git, Week 2 wallet + config |
| `updates_report_3.md` | UI + stellarClient audit, gap analysis, build verification |
| `updates_report_4.md` | Testnet deploy, transactionService, P0 closure, P1 gaps |
| `README.md` | Quick start for devs |

---

*End of institutional memory. Update this file at the end of each major sprint.*
