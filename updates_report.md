# SmartProtocol Zambia — Comprehensive Updates Report

**Project:** SmartProtocol Zambia (VMP — Verified Milestone Payout)  
**Report generated:** June 4, 2026  
**Repository:** [https://github.com/Chilundika/SmartProtocol-Zambia.git](https://github.com/Chilundika/SmartProtocol-Zambia.git)  
**Local path:** `SmartProtocolZm/`

---

## 1. Executive Summary

SmartProtocol Zambia is a full-stack monorepo for a **Verified Milestone Payout (VMP)** system: funds are locked in on-chain escrow and released after a cryptographic sign-off from the beneficiary (farmer), with payout to the vendor.

Work completed to date includes:

- Monorepo scaffolding (frontend + Soroban contracts workspace)
- Next.js 15 frontend with TypeScript, Tailwind CSS v4, and App Router
- Soroban **escrow factory contract** with Native XLM (Stellar Asset Contract) support
- Workspace configuration verified and corrected
- **15 unit tests** (happy path + negative security paths) — all passing
- Release WASM build for the escrow crate (`wasm32v1-none`)

The project has been pushed to GitHub at least once (`Initial commit` on `main`). Some local changes (expanded test suite and Soroban test snapshots) may still be uncommitted.

---

## 2. Product Context

| Concept | Description |
|--------|-------------|
| **VMP** | Verified Milestone Payout — escrow holds funds until milestone proof is submitted |
| **Funder** | Party that creates and funds the escrow; authorizes final release to vendor |
| **Beneficiary / recipient** | Farmer (or milestone recipient) who submits cryptographic sign-off (`submit_proof`) |
| **Vendor** | Service provider who receives XLM after proof and funder release |
| **MVP asset** | Native XLM via Stellar Asset Contract (SAC) `token::Client` |

### Intended on-chain flow

```
init_escrow     →  Locked    (entry created, not yet funded)
fund_escrow     →  Pending   (Native XLM deposited into contract)
submit_proof    →  Released  (beneficiary sign-off; MVP uses proof_hash placeholder)
release_funds   →  Paid      (funder sends XLM to vendor; amount zeroed)
```

---

## 3. Timeline of Work

| Phase | What happened |
|-------|----------------|
| **Monorepo bootstrap** | Empty repo structured with `frontend/`, `contracts/`, root `README.md`, `.gitignore`, and npm workspaces |
| **Frontend init** | `create-next-app@15` — Next.js 15.5.19, React 19, Tailwind v4, TypeScript, ESLint, Turbopack |
| **Contracts workspace** | Soroban-style Rust workspace under `contracts/` with `soroban-sdk = "23"` |
| **Hello World crate** | Starter `hello_world` contract retained as Soroban template |
| **Escrow development** | VMP escrow logic implemented; early draft briefly lived under `hello_world/src/escrow.rs`, then consolidated into dedicated `contracts/contracts/escrow/` crate |
| **Configuration fixes** | Workspace `members` corrected; duplicate package name `escrow` on `hello_world` reverted to `hello-world` |
| **Audits** | Workspace and `lib.rs` reviewed — confirmed struct, factory map, functions, and access controls |
| **Test hardening** | Single happy-path test expanded to 15 tests covering unauthorized access and invalid state transitions |
| **WASM build** | `wasm32v1-none` Rust target installed; release build succeeded |
| **GitHub** | Remote `origin` → `Chilundika/SmartProtocol-Zambia`; initial commit on `main` |

---

## 4. Repository Structure

```
SmartProtocolZm/
├── README.md                    # Monorepo overview and quick start
├── package.json                 # npm workspaces (frontend only)
├── .gitignore
├── updates_report.md            # This document
│
├── frontend/                    # Next.js 15 application
│   ├── app/                     # App Router (layout, page, globals.css)
│   ├── public/
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.ts
│   ├── postcss.config.mjs
│   └── eslint.config.mjs
│
└── contracts/                   # Rust / Soroban workspace root
    ├── Cargo.toml               # Workspace: members = ["contracts/*"]
    ├── Cargo.lock
    ├── README.md
    ├── target/                  # Build artifacts (gitignored)
    └── contracts/
        ├── escrow/              # ★ Primary VMP contract
        │   ├── Cargo.toml
        │   ├── src/
        │   │   ├── lib.rs       # Escrow factory contract
        │   │   └── test.rs      # 15 unit tests
        │   └── test_snapshots/  # Soroban env snapshots (from tests)
        └── hello_world/         # Soroban starter (unchanged purpose)
            ├── Cargo.toml
            └── src/
                ├── lib.rs       # Re-exports mod escrow (legacy module file present)
                ├── escrow.rs    # Older duplicate scaffold — not the canonical contract
                └── test.rs
```

---

## 5. Frontend (`/frontend`)

### Stack

| Technology | Version / notes |
|------------|-----------------|
| Next.js | 15.5.19 |
| React | 19.1.0 |
| TypeScript | ^5 |
| Tailwind CSS | v4 (`@tailwindcss/postcss`) |
| ESLint | `eslint-config-next` 15.5.19 |
| Dev bundler | Turbopack (`next dev --turbopack`) |

### Status

- Default Next.js App Router template (no custom SmartProtocol UI yet)
- Runnable via root or frontend:

```bash
cd frontend && npm run dev
# or from repo root:
npm run dev
```

---

## 6. Contracts Workspace (`/contracts`)

### Workspace `Cargo.toml`

```toml
[workspace]
resolver = "2"
members = ["contracts/*"]

[workspace.dependencies]
soroban-sdk = "23"
```

- **Release profile** tuned for Soroban size limits (`opt-level = "z"`, LTO, `panic = "abort"`, etc.)
- **`release-with-logs`** profile available for debug builds

### Workspace members

| Crate | Package name | Purpose |
|-------|--------------|---------|
| `contracts/contracts/escrow` | `escrow` | VMP escrow factory (production target) |
| `contracts/contracts/hello_world` | `hello-world` | Soroban hello-world starter |

### Configuration audit (confirmed correct)

- Escrow is included via glob `contracts/*` → resolves to `contracts/contracts/escrow`
- `contracts/contracts/escrow/Cargo.toml`:
  - `crate-type = ["cdylib"]`
  - `soroban-sdk = { workspace = true }` → **v23**
- No separate `contracts/escrow` at workspace root (path is `contracts/contracts/escrow`)

---

## 7. Escrow Contract — Implementation Details

**Location:** `contracts/contracts/escrow/src/lib.rs`  
**Contract type:** `EscrowFactoryContract`

### Data model

**`EscrowStatus` enum**

- `Locked` — created, awaiting deposit  
- `Pending` — funded, awaiting beneficiary proof  
- `Released` — proof accepted, awaiting funder payout to vendor  

**`Escrow` struct**

| Field | Type | Role |
|-------|------|------|
| `funder` | `Address` | Creates, funds, and releases |
| `vendor` | `Address` | Receives payout |
| `amount` | `i128` | Escrow amount (zeroed after payout) |
| `status` | `EscrowStatus` | Lifecycle state |
| `recipient` | `Address` | Beneficiary / farmer |

### Factory pattern

- Instance storage key `DataKey::Escrows` → `Map<Address, Escrow>`
- Map keyed by **`recipient`** (one active escrow per recipient address in MVP)
- `DataKey::NativeXlmToken` stores SAC address for Native XLM (set on first `init_escrow`, immutable thereafter)

### Public functions

| Function | Authorized caller | Behavior |
|----------|-------------------|----------|
| `init_escrow` | `funder` | Creates `Locked` entry; validates amount > 0; rejects duplicate recipient |
| `fund_escrow` | `funder` | Transfers Native XLM funder → contract; `Locked` → `Pending` |
| `submit_proof` | `beneficiary` (= `recipient`) | Requires non-zero `proof_hash`; `Pending` → `Released` |
| `release_funds` | `funder` | Transfers contract → `vendor`; sets `amount = 0` |
| `get_escrow` | Read-only | Returns `Option<Escrow>` |

### Security controls

- `Address::require_auth()` on role-specific entrypoints
- Field checks: `escrow.funder`, `escrow.recipient` must match caller
- Strict state machine (invalid transitions panic)
- Amount validation on fund; idempotent release via `amount = 0`
- Native XLM token address cannot be swapped after first init

### MVP limitations (documented for future work)

1. **`proof_hash`** — placeholder only; no on-chain ed25519 / hash verification yet  
2. **One escrow per recipient** — no `escrow_id`; multiple milestones per farmer need keying change  
3. **`release_funds` requires funder** — beneficiary cannot trigger payout (by design in current spec)  
4. **Stellar CLI** — not required for `cargo test` / `cargo build`; needed for deploy/optimize on network  

---

## 8. Unit Tests

**Location:** `contracts/contracts/escrow/src/test.rs`  
**Module:** Included from `lib.rs` via `mod test;`

### Results (last run)

```
running 15 tests
test result: ok. 15 passed; 0 failed
```

### Coverage matrix

| Test | Type |
|------|------|
| `happy_path_fund_sign_release` | Happy path + vendor token balance |
| `init_escrow_rejects_zero_amount` | Negative |
| `init_escrow_rejects_duplicate_recipient` | Negative |
| `fund_escrow_rejects_unknown_recipient` | Negative |
| `fund_escrow_rejects_wrong_funder` | Negative |
| `fund_escrow_rejects_wrong_amount` | Negative |
| `fund_escrow_rejects_double_funding` | Negative |
| `submit_proof_rejects_wrong_beneficiary` | Negative |
| `submit_proof_rejects_zero_hash` | Negative |
| `submit_proof_rejects_before_funding` | Negative |
| `release_funds_rejects_unauthorized_address` | Negative |
| `release_funds_rejects_before_proof` | Negative |
| `release_funds_rejects_when_only_locked` | Negative |
| `release_funds_rejects_empty_escrow` | Negative (double release) |
| `release_funds_rejects_unknown_recipient` | Negative |

### Test artifacts

Soroban SDK may write snapshot JSON under:

`contracts/contracts/escrow/test_snapshots/test/*.json`

These are generated during test runs and are currently **untracked** in git.

---

## 9. Build & Toolchain

### Environment verified

| Tool | Version (observed) |
|------|-------------------|
| Node.js | v22.22.0 |
| npm | 11.12.1 |
| Rust / cargo | 1.96.0 |
| `wasm32v1-none` | Installed (required for contract WASM build) |

### Stellar / Soroban CLI

- **Not installed** during initial setup (install timed out)
- Manual scaffolding used instead of `stellar contract init`
- Recommended for deploy: [Stellar CLI](https://developers.stellar.org/docs/tools/cli)

### Build commands

**Unit tests (host target):**

```bash
cd contracts
cargo test -p escrow
```

**Release WASM:**

```bash
cd contracts
cargo build -p escrow --target wasm32v1-none --release
```

**Output artifact:**

```
contracts/target/wasm32v1-none/release/escrow.wasm
```

**One-time prerequisite (if `can't find crate for core`):**

```bash
rustup target add wasm32v1-none
```

---

## 10. Git & GitHub Status

| Item | Value |
|------|--------|
| Remote | `https://github.com/Chilundika/SmartProtocol-Zambia.git` |
| Branch | `main` |
| Latest commit (logged) | `c6a91d5` — *Initial commit: SmartProtocol Zambia - Soroban smart contracts and Next.js frontend* |

### Uncommitted local changes (as of report)

- **Modified:** `contracts/contracts/escrow/src/test.rs` (expanded test suite)
- **Untracked:** `contracts/contracts/escrow/test_snapshots/**` (15 JSON snapshot files)

Recommend committing test updates and adding `test_snapshots/` to `.gitignore` if snapshots should not be versioned.

---

## 11. Issues Encountered & Resolutions

| Issue | Resolution |
|-------|------------|
| Stellar CLI install timeout | Soroban workspace scaffolded manually to match `stellar contract init` layout |
| Workspace member `escrow` pointed to missing path | Removed invalid `members = ["escrow"]`; kept `contracts/*` only |
| Duplicate crate name `escrow` on `hello_world` | Renamed package back to `hello-world` |
| `Symbol::new` / `env.invoker()` compile errors | Switched to `DataKey` enum + explicit `Address` params with `require_auth()` |
| `cargo build` — `can't find crate for core` | `rustup target add wasm32v1-none` |
| Escrow logic initially under `hello_world/src/escrow.rs` | Canonical implementation lives in `contracts/contracts/escrow/src/lib.rs` |

---

## 12. What Is Not Done Yet

- Custom frontend UI for VMP (wallet connect, escrow creation, proof upload)
- On-chain cryptographic proof verification (beyond `proof_hash` non-zero check)
- Contract deployment to Stellar testnet/mainnet
- Contract events / indexing for frontend
- Escrow ID support for multiple milestones per beneficiary
- Integration tests against live RPC
- CI/CD pipeline (GitHub Actions)
- `hello_world/src/escrow.rs` cleanup (legacy duplicate; `hello_world` still `mod escrow`)

---

## 13. Recommended Next Steps

1. **Commit** expanded tests (and decide on `test_snapshots/` in `.gitignore`)  
2. **Install Stellar CLI** and run `stellar contract build` / deploy to testnet  
3. **Wire frontend** to contract ID and RPC (e.g. `@stellar/stellar-sdk`)  
4. **Replace `proof_hash` MVP** with real signature verification  
5. **Add `escrow_id`** to factory map for multi-milestone support  
6. **Remove or isolate** legacy `hello_world/src/escrow.rs` to avoid confusion  

---

## 14. Quick Command Reference

```bash
# Frontend dev server
cd frontend && npm run dev

# All contract tests in workspace
cd contracts && cargo test

# Escrow tests only
cd contracts && cargo test -p escrow

# Escrow WASM release build
cd contracts && cargo build -p escrow --target wasm32v1-none --release

# Single test
cd contracts && cargo test -p escrow happy_path_fund_sign_release
```

---

## 15. Document History

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | 2026-06-04 | Initial comprehensive report covering monorepo setup through escrow tests and WASM build |

---

*End of report.*
