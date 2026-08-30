# SmartProtocol Zambia — Milestone Memory Dump (`milestonememorydump.md`)

> **Purpose:** Definitive institutional “brain” for post-engineering maintenance, Instawards presentation support, and future expansion.  
> **Phase:** Engineering & Deployment — **COMPLETE** (transitioning to Presentation)  
> **Last updated:** June 7, 2026  
> **Repository:** [https://github.com/Chilundika/SmartProtocol-Zambia.git](https://github.com/Chilundika/SmartProtocol-Zambia.git)  
> **Live deployment:** [https://smartprotocol-zm.vercel.app/](https://smartprotocol-zm.vercel.app/)

---

## 1. Project Genesis & Target Audience

### Name

**SmartProtocol Zambia**

### Goal

A **cryptographically secure, decentralized escrow** and **Verified Milestone Payout (VMP)** system built for **agricultural and service subsidies**. Funds are locked on-chain in Native XLM until a beneficiary provides cryptographic sign-off; only then can the funder release payment to the vendor.

### Context

Official **MVP submission for the Instawards program** (Instaward Project). The product demonstrates practical Soroban smart-contract infrastructure applied to real-world subsidy and milestone-payment challenges in Zambia.

### Core roles (on-chain + UI language)

| Role | Responsibility |
|------|----------------|
| **Funder** | Creates escrow, deposits XLM, triggers `release_funds` to vendor |
| **Beneficiary / recipient / farmer** | Submits milestone proof via `submit_proof` |
| **Vendor** | Receives XLM after proof + funder release |

### Hard MVP constraints (non-negotiable)

| Constraint | Meaning |
|------------|---------|
| **NO biometric ID** | No fingerprint, face, or national-ID hardware/SDK flows |
| **NO offline SMS gateways** | No SMS/USSD proof or payout rails in MVP |
| **Native XLM only** | Escrow asset is Native XLM via Stellar Asset Contract (SAC) — not custom tokens or multi-asset support |

### VMP lifecycle (contract state machine)

```
init_escrow     →  Locked    (entry created, not funded)
fund_escrow     →  Pending   (XLM in contract)
submit_proof    →  Released  (beneficiary sign-off; MVP uses proof_hash placeholder)
release_funds   →  Paid out  (vendor receives XLM; amount zeroed on-chain)
```

---

## 2. Current Architecture & Stack Snapshot

### Monorepo layout

```
SmartProtocolZm/                         # Git root
├── README.md                            # Judge-facing documentation (Instawards)
├── milestonememorydump.md               # THIS FILE
├── package.json                         # Yarn workspaces root
├── yarn.lock                            # Mandatory lockfile (see §4.3)
│
├── contracts/                           # Rust / Soroban workspace ROOT
│   ├── Cargo.toml                       # members = ["contracts/*"], soroban-sdk = 23
│   └── contracts/
│       ├── escrow/                      # ★ PRIMARY VMP contract
│       │   └── src/
│       │       ├── lib.rs               # EscrowFactoryContract + all logic
│       │       └── test.rs              # 15 unit tests (verified passing)
│       └── hello_world/                 # Soroban template only — do not confuse with escrow
│
└── frontend/                            # Next.js 15 App Router app
    ├── app/
    │   ├── page.tsx                     # Landing + hero logo
    │   ├── layout.tsx                   # WalletProvider wrapper
    │   ├── funder/page.tsx              # Funder dashboard
    │   ├── beneficiary/page.tsx         # Beneficiary sign-off dashboard
    │   ├── favicon.ico                  # Custom branded favicon
    │   └── logo.png / logo.jpeg         # Brand assets (hero uses logo.png)
    └── src/
        ├── blockchain/
        │   ├── stellarConfig.ts         # RPC, passphrase, live testnet contract IDs
        │   ├── stellarClient.ts         # RPC simulate + XDR builders + parsing
        │   └── transactionService.ts    # Freighter sign + RPC submit + poll
        ├── components/                  # Navbar, WalletConnectButton
        └── context/WalletContext.tsx    # Freighter wallet state
```

**Path note:** The Soroban escrow crate lives at `contracts/contracts/escrow/` (double `contracts/`), not `contracts/escrow/`.

### Exact tech stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Frontend framework | **Next.js 15** (App Router) | Production build uses `next build` (Turbopack removed from build script) |
| UI | **React 19**, **TypeScript 5** | |
| Styling | **Tailwind CSS v4** | `@tailwindcss/postcss`; system font stack (Google Fonts removed for offline builds) |
| Stellar SDK | **`@stellar/stellar-sdk` ^15.1.0** | Unified imports from main package + `rpc` namespace |
| Wallet | **`@stellar/freighter-api` ^6.0.1** | Browser extension signing |
| Smart contracts | **Soroban** (`soroban-sdk` **23**) | Rust 2021, `wasm32v1-none` target |
| Package manager | **Yarn** | **Mandatory** — see §4.3 |
| Hosting | **Vercel** | Global production deployment |
| CLI (local deploy) | **Stellar CLI** | Not committed; install locally for contract ops |

### Live testnet configuration

File: `frontend/src/blockchain/stellarConfig.ts`

| Constant | Value |
|----------|-------|
| `STELLAR_TESTNET_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `STELLAR_TESTNET_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` |
| `ESCROW_FACTORY_CONTRACT_ID` | `CABMN45ARQKZ6ISJUXHVDGB236U6IEIC2ZO2V24YZB6D7JQOUVL5VFCH` |
| `NATIVE_XLM_TOKEN_CONTRACT_ID` | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

---

## 3. What Is Built, Verified, and LIVE (The Truth)

### Smart contracts — deployed & verified

| Item | Status | Location |
|------|--------|----------|
| `EscrowFactoryContract` on Stellar Testnet | **LIVE** | WASM from `contracts/contracts/escrow/` |
| State machine `Locked → Pending → Released` | **Enforced on-chain** | `contracts/contracts/escrow/src/lib.rs` |
| Factory map keyed by `recipient` | **Done** | One escrow per beneficiary address (MVP) |
| Unit tests | **15 passing** | `contracts/contracts/escrow/src/test.rs` |
| Real ed25519 proof verification | **Not in MVP** | Contract accepts any non-zero 32-byte `proof_hash` |

**Verify locally:** `cd contracts && cargo test -p escrow`

### Blockchain client — full transaction pipeline

File: `frontend/src/blockchain/stellarClient.ts`

| Client function | Contract method | Status |
|-----------------|-----------------|--------|
| `getEscrowState(recipient, simulationSource?)` | `get_escrow` | **Live** — read via RPC simulation |
| `buildInitEscrowTx(funder, vendor, amountXlm, recipient)` | `init_escrow` | **Live** — XLM → stroops in client |
| `buildFundEscrowTx(funder, recipient, amountXlm)` | `fund_escrow` | **Live** |
| `buildSubmitProofTx(beneficiary, proofHash, recipient?)` | `submit_proof` | **Live** |
| `buildReleaseFundsTx(funder, recipient)` | `release_funds` | **Live** |

File: `frontend/src/blockchain/transactionService.ts`

| Function | Status |
|----------|--------|
| `signAndSubmitTransaction(xdr)` | **Live** — Freighter sign → `rpc.Server.sendTransaction` → `getTransaction` poll until `SUCCESS` |

**Error types for UI:** `StellarClientError`, `TransactionServiceError` (typed `code` fields for display).

### UI/UX — dashboards live on production

| Surface | Route | File | Capabilities |
|---------|-------|------|--------------|
| Landing | `/` | `frontend/app/page.tsx` | Hero logo, VMP pitch, nav to dashboards |
| Funder dashboard | `/funder` | `frontend/app/funder/page.tsx` | Init / Fund / Release forms; Escrow Status Reader; Freighter writes |
| Beneficiary sign-off | `/beneficiary` | `frontend/app/beneficiary/page.tsx` | Delivery verification readout; proof submission; demo hash generator |
| Wallet layer | Global | `frontend/src/context/WalletContext.tsx` | Connect, disconnect, session restore |
| Navigation | Global | `frontend/src/components/Navbar.tsx` | Links to `/funder`, `/beneficiary` |

**Escrow Status Readers** call `getEscrowState` against the **deployed** factory contract and display status (`Locked` / `Pending` / `Released`), XLM balance, funder, and vendor.

### Deployment — globally accessible

| Item | Status |
|------|--------|
| Vercel production URL | **LIVE:** [https://smartprotocol-zm.vercel.app/](https://smartprotocol-zm.vercel.app/) |
| README for judges | **Updated** | `README.md` — tester guide, lifecycle, engineering notes |
| Production build | **Verified** | `yarn build` (webpack; no Turbopack in build) |
| End-to-end VMP loop | **Functionally verified** | Init → Fund → Proof → Release on testnet via live UI |

### Demonstrated user flow (testnet)

1. **Funder** (`/funder`): Connect Freighter → Initialize escrow → Fund escrow → (after beneficiary proof) Release payout.
2. **Beneficiary** (`/beneficiary`): Connect Freighter → Check delivery status → Submit proof hash (or **Generate Demo Hash** for presentations).
3. **Vendor**: Receives XLM on-chain after funder executes `release_funds`.

---

## 4. Major Technical Hurdles Overcome (Crucial Knowledge)

> **WARNING:** These workarounds exist for real production bugs. Do **not** remove or “simplify” them without explicit user approval.

### 4.1 Turbopack dual-package hazard (Stellar SDK `instanceof` crash)

**Symptom:** `expected a 'Transaction', got: [object Object]` during `assembleTransaction` in Next.js / Turbopack bundling.

**Root cause:** Duplicate `@stellar/stellar-base` instances in memory break `instanceof` checks across package boundaries.

**Fix location:** `frontend/src/blockchain/stellarClient.ts` → `buildContractTransactionXdr()`

**Pattern:** Re-hydrate the transaction through the unified SDK `Transaction` class immediately before assembly:

- `new Transaction(tx.toXDR(), STELLAR_TESTNET_NETWORK_PASSPHRASE)`
- `rpc.assembleTransaction(safeTx, parsed).build()`

**Also required:** All Stellar imports unified from `@stellar/stellar-sdk` main entry (including `rpc` namespace). **Do not** import from `@stellar/stellar-base` or deep `/lib/` paths.

### 4.2 Soroban enum parsing (Rust → JS deserialization)

**Symptom:** Escrow status failed to parse; RPC returned enums as single-element arrays (e.g. `["Locked"]`).

**Fix location:** `frontend/src/blockchain/stellarClient.ts`

**Functions:**

- `parseEscrowStatus()` — unwraps `Array.isArray(value) ? value[0] : value` before matching `"Locked" | "Pending" | "Released"`.
- `parseEscrowStruct()` — normalizes `record.status` the same way before calling `parseEscrowStatus`.

### 4.3 Vercel Linux compilation bug (Tailwind v4 / lightningcss)

**Symptom:** Vercel build failed — `lightningcss` could not find Linux native binary (`Cannot find module '../lightningcss.linux-x64-gnu.node'`). Related to npm optional dependency resolution ([npm #4828](https://github.com/npm/cli/issues/4828)).

**Mitigations applied (all must remain):**

| Change | Location |
|--------|----------|
| **Migrated from npm to Yarn** | Root `yarn.lock`; install with `yarn install` only |
| **Removed `--turbopack` from production build** | `frontend/package.json` → `"build": "next build"` |
| **Explicit Linux lightningcss optional deps** | Root `package.json` → `lightningcss-linux-x64-gnu`, `lightningcss-linux-x64-musl` |
| **Removed npm lockfiles** | `package-lock.json` and `frontend/package-lock.json` deleted from repo |

**Dev server** may still use Turbopack (`next dev --turbopack` in `frontend/package.json`); **production build must not**.

### 4.4 Additional client-side fixes (do not regress)

| Issue | Fix location |
|-------|--------------|
| XLM amounts must be stroops on-chain | `xlmToStroops()` in `stellarClient.ts`; used by `buildInitEscrowTx` and `buildFundEscrowTx` |
| Deep Soroban simulation errors hidden | `console.error("RPC Simulation Failure:", error)` in `stellarClient.ts` catch paths |
| Google Fonts fetch broke offline/CI builds | Removed `next/font/google` from `frontend/app/layout.tsx`; system fonts in `frontend/app/globals.css` |
| Freighter signing + ledger confirmation | Full pipeline in `frontend/src/blockchain/transactionService.ts` |

---

## 5. Where We Paused (The Exact Execution State)

### Current phase

**Presentation — Instawards submission and demo preparation.**

The **engineering and deployment phases are 100% complete** and **functionally verified on the public internet**.

### What is done

- Soroban escrow contract **deployed** to Stellar Testnet with live IDs in `stellarConfig.ts`
- Full **read + write** blockchain client and **transaction execution** layer
- **Funder** and **Beneficiary** dashboards wired end-to-end
- **Vercel** global deployment live
- **README.md** tailored for Instawards judges (tester guide, lifecycle, engineering notes)
- **Branding:** custom favicon (`frontend/app/favicon.ico`), circular hero logo (`frontend/app/logo.png` on landing page)
- Internal dev reports **removed from Git tracking** and listed in `frontend/.gitignore`:
  - `memoryhistory.md`, `updates_report.md`, `updates_report_2.md`, `updates_report_3.md`, `updates_report_4.md`

### What is NOT the active focus

- New contract features (real ed25519 proof verification, multi-asset, biometric ID, SMS gateways)
- Rewriting `stellarClient.ts` assembly logic or switching back to npm
- Major UI refactors or architectural changes to the stable release

### Primary focus moving forward

**Non-destructive presentation work:**

- Demo scripts and walkthroughs for live Instawards presentation
- Slide decks and pitch materials
- Judge onboarding copy (Friendbot funding steps, role assignments for demo accounts)
- Optional: screen recordings, FAQ, troubleshooting one-pagers

---

## 6. New Session Directives (Rules for the Next AI)

### Mandatory mindset

Treat the current codebase as a **highly stable production release**. The live Vercel deployment and testnet contract are the source of truth. Favor **additive, non-breaking** changes only.

### NEVER do without explicit user permission

1. **Alter `stellarClient.ts` transaction assembly logic** — especially the `safeTx` re-hydration patch and unified `@stellar/stellar-sdk` import pattern.
2. **Change the package manager back to npm** or reintroduce `package-lock.json`.
3. **Remove Yarn**, `yarn.lock`, or the `lightningcss-linux-*` optional dependencies.
4. **Remove `--turbopack` workaround context** by re-adding Turbopack to production `build` without testing Vercel.
5. **Remove enum array unwrapping** in `parseEscrowStatus` / `parseEscrowStruct`.
6. **Rewrite or delete** working contract logic (`contracts/contracts/escrow/src/lib.rs`), passing tests, `transactionService.ts`, or `WalletContext.tsx`.
7. **Re-commit internal dev reports** that were intentionally gitignored.
8. **Modify `contracts/contracts/hello_world/`** except bugfixes — it is a Soroban template only.

### Safe tasks for presentation phase

| Task | Examples |
|------|----------|
| Documentation | Demo scripts, slide outlines, judge quick-start, FAQ |
| Copy / content | Landing page text tweaks, README clarifications |
| Assets | Presentation graphics (not core logic changes) |
| Observability | Read-only testnet smoke-test instructions |

### Key file quick reference

| Need | Path |
|------|------|
| Contract logic | `contracts/contracts/escrow/src/lib.rs` |
| Contract tests | `contracts/contracts/escrow/src/test.rs` |
| Testnet config | `frontend/src/blockchain/stellarConfig.ts` |
| RPC / XDR client | `frontend/src/blockchain/stellarClient.ts` |
| Sign + submit + poll | `frontend/src/blockchain/transactionService.ts` |
| Wallet | `frontend/src/context/WalletContext.tsx` |
| Funder UI | `frontend/app/funder/page.tsx` |
| Beneficiary UI | `frontend/app/beneficiary/page.tsx` |
| Landing | `frontend/app/page.tsx` |
| Judge README | `README.md` |
| Live URL | [https://smartprotocol-zm.vercel.app/](https://smartprotocol-zm.vercel.app/) |

### Useful commands

```bash
# Frontend (use Yarn only)
yarn install
yarn dev          # from repo root, or: cd frontend && yarn dev
yarn build

# Contracts
cd contracts
cargo test -p escrow
cargo build -p escrow --target wasm32v1-none --release

# Git
git status
git pull origin main
```

### Institutional memory lineage

| Document | Role |
|----------|------|
| `milestonememorydump.md` | **THIS FILE** — post-engineering definitive brain |
| `README.md` | Public / judge-facing project documentation |
| `memoryhistory.md` (local only, gitignored) | Historical sprint handoff notes |
| `updates_report*.md` (local only, gitignored) | Sprint audit reports |

---

*End of milestone memory dump. Engineering phase complete. Presentation phase begins.*
