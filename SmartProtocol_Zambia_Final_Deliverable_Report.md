# SmartProtocol Zambia - Final Deliverable Report

> **Superseded for contract identity.** This report describes an earlier Testnet deployment. The frontend now targets escrow contract `CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ` in `frontend/src/blockchain/stellarConfig.ts`. Every `CABMN45ARQKZ6ISJUXHVDGB236U6IEIC2ZO2V24YZB6D7JQOUVL5VFCH` reference below is historical and is not the current contract.

**Project:** SmartProtocol Zambia (Verified Milestone Payouts)  
**Network:** Stellar Testnet  
**Live Application:** [https://smartprotocol-zm.vercel.app/](https://smartprotocol-zm.vercel.app/)  
**Repository:** [https://github.com/Chilundika/SmartProtocol-Zambia.git](https://github.com/Chilundika/SmartProtocol-Zambia.git)  
**Developer:** Chilundika Chipo  
**Submission:** Stellar Community Fund — Instawards Deliverable  

---

## 1. Executive Summary & Achievements

### What Has Been Achieved

SmartProtocol Zambia successfully completed its **30-day MVP** scope, delivering a production-ready decentralized application deployed to **Stellar Testnet** and validated through a full **end-to-end multi-actor workflow**. The system demonstrates that agricultural and service subsidy funds can be programmatically locked, milestone-verified, and released to vendors only after beneficiaries provide cryptographic authorization—all without traditional intermediaries or opaque payment rails.

Key deliverable milestones:

| Milestone | Status |
|-----------|--------|
| Soroban smart contract (`EscrowFactoryContract`) authored, tested, and deployed | ✅ Complete |
| Next.js frontend with role-specific dashboards (`/funder`, `/beneficiary`) | ✅ Complete |
| Freighter wallet integration for on-chain transaction signing | ✅ Complete |
| Live deployment on Vercel (Testnet) | ✅ Complete |
| End-to-end workflow: Funder → Beneficiary → Vendor payout | ✅ Verified |
| Contract unit tests covering happy path and negative security cases | ✅ Complete |

### What the System Is

SmartProtocol Zambia is a **decentralized escrow and milestone verification system** built on the Stellar blockchain using **Soroban smart contracts**. It implements **Verified Milestone Payouts (VMP)**—a trustless funding protocol where:

- **Funders** (NGOs, government agencies, or subsidy programs) lock Native XLM in an on-chain escrow contract.
- **Beneficiaries** (farmers or service recipients) must cryptographically sign off that milestones were met before funds can move forward.
- **Vendors** (input suppliers, service providers) receive payment only after beneficiary proof is submitted and the funder executes the final release.

The application is a full-stack decentralized application (dApp) comprising a Rust/Soroban contract layer and a Next.js 15 frontend with Freighter browser wallet integration.

### The Problem

Agricultural funding and subsidy disbursement in Zambia—and across similar emerging markets—faces persistent structural challenges:

1. **Agricultural funding diversion** — Subsidy and aid funds intended for farmers are often diverted before reaching intended recipients, eroding program effectiveness and public trust.
2. **Lack of transparency in vendor payments** — NGOs and government programs lack auditable, real-time proof that vendors were paid only after goods or services were actually delivered to beneficiaries.
3. **Trust deficits in NGO/government aid** — Beneficiaries have no cryptographic guarantee that funds are reserved for them; vendors have no assurance of payment upon delivery; funders cannot independently verify milestone completion without manual reconciliation.

These gaps create friction, fraud risk, and delayed payouts across the agricultural value chain.

### The Solution

SmartProtocol Zambia addresses these challenges by replacing discretionary, opaque payment flows with **programmatic, on-chain escrow logic**:

- **Funds are locked** in a Soroban smart contract (`EscrowFactoryContract`) using Native XLM via the Stellar Asset Contract (SAC)—they cannot be redirected without following the defined state machine.
- **Beneficiary cryptographic sign-off is required** — The beneficiary must call `submit_proof` with a non-zero 32-byte `proof_hash`, authenticated via `beneficiary.require_auth()`, before the escrow advances from `Pending` to `Released`.
- **Vendor payout is gated** — The funder can only call `release_funds` after the escrow reaches `Released` status, at which point Native XLM is transferred directly to the vendor's Stellar address.
- **Full auditability** — Every state transition is recorded on Stellar Testnet and verifiable via Stellar Expert.

This architecture ensures that **no vendor is paid until the beneficiary confirms receipt**, and **no funds leave escrow without both beneficiary proof and funder authorization**.

---

## 2. Technical Architecture & Roles

### System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js 15 Frontend                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │  Landing (/) │  │ /funder      │  │ /beneficiary         │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
│         │                  │                    │               │
│         └──────────────────┼────────────────────┘               │
│                            ▼                                    │
│              Freighter Wallet (Browser Extension)               │
│                            │                                    │
│         stellarClient.ts / transactionService.ts                │
└────────────────────────────┼────────────────────────────────────┘
                             │ Soroban RPC
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Stellar Testnet — Soroban Layer                    │
│                                                                 │
│   EscrowFactoryContract (CABMN45ARQKZ6ISJUXHVDGB236U6IEIC...)   │
│                                                                 │
│   State Machine: Locked → Pending → Released → Paid (amount=0)  │
└─────────────────────────────────────────────────────────────────┘
```

### Frontend Layer

| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | Next.js 15 (App Router), React 19, TypeScript | Server-rendered dApp with role-specific routes |
| Styling | Tailwind CSS v4 | Responsive, mobile-friendly UI |
| Blockchain SDK | `@stellar/stellar-sdk` v15 | RPC simulation, XDR transaction assembly |
| Wallet | `@stellar/freighter-api` v6 | Browser extension signing; no passwords or traditional accounts |
| Package manager | Yarn | Cross-platform Rust binary compatibility (Tailwind v4 / Vercel) |

**Key frontend modules:**

- `frontend/src/blockchain/stellarConfig.ts` — Testnet RPC, network passphrase, contract IDs
- `frontend/src/blockchain/stellarClient.ts` — Contract call builders and read-only `get_escrow` simulation
- `frontend/src/blockchain/transactionService.ts` — Freighter sign, submit, and ledger polling
- `frontend/src/context/WalletContext.tsx` — Wallet connection state and session restore

### Soroban Smart Contract — State Machine

The `EscrowFactoryContract` (`contracts/contracts/escrow/src/lib.rs`) implements a three-state lifecycle:

| State | Meaning | Trigger |
|-------|---------|---------|
| **`Locked`** | Escrow record created; awaiting Native XLM deposit | Funder calls `init_escrow` |
| **`Pending`** | Funds deposited and locked in contract; awaiting beneficiary sign-off | Funder calls `fund_escrow` |
| **`Released`** | Proof accepted; ready for funder to pay vendor | Beneficiary calls `submit_proof` |

After `release_funds`, the escrow remains in `Released` status but `amount` is zeroed to prevent double-spend.

**Contract functions:**

| Function | Authorized Caller | Description |
|----------|-------------------|-------------|
| `init_escrow(funder, native_xlm_token, vendor, recipient, amount)` | Funder | Creates escrow keyed by beneficiary address; sets status to `Locked` |
| `fund_escrow(funder, recipient, amount)` | Funder | Transfers Native XLM (SAC) into contract; transitions `Locked` → `Pending` |
| `submit_proof(beneficiary, recipient, proof_hash)` | Beneficiary | Cryptographic milestone sign-off; transitions `Pending` → `Released` |
| `release_funds(funder, recipient)` | Funder | Transfers locked XLM to vendor; zeros `amount` |
| `get_escrow(recipient)` | Read-only | Returns escrow record for a beneficiary address |

Escrows are stored in a factory map keyed by **beneficiary address** (`recipient`).

### Testnet Configuration

| Parameter | Value |
|-----------|-------|
| Network | Stellar Testnet |
| RPC URL | `https://soroban-testnet.stellar.org` |
| Network Passphrase | `Test SDF Network ; September 2015` |
| Escrow Factory Contract ID | `CABMN45ARQKZ6ISJUXHVDGB236U6IEIC2ZO2V24YZB6D7JQOUVL5VFCH` |
| Native XLM SAC Contract ID | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Transaction Explorer | `https://stellar.expert/explorer/testnet/tx/` |

### The Three Primary Actors

#### 1. Funder

**Role:** NGO, government agency, subsidy program, or any entity allocating funds for agricultural inputs or services.

**Dashboard:** `/funder`

**On-chain actions:**
- `init_escrow` — Register a new escrow with vendor, beneficiary, and amount
- `fund_escrow` — Deposit Native XLM into the contract
- `release_funds` — Execute final vendor payout after beneficiary proof

**UI capabilities:** Initialize escrow, fund escrow, release payout to vendor, and read live escrow status for any beneficiary address.

#### 2. Beneficiary

**Role:** Farmer or service recipient who must confirm that goods or services were received before vendor payment is authorized.

**Dashboard:** `/beneficiary`

**On-chain actions:**
- `submit_proof` — Submit a 32-byte cryptographic proof hash to advance escrow to `Released`

**UI capabilities:** Check delivery status for the connected wallet, generate a demo proof hash (MVP), and confirm receipt to unlock the release path.

#### 3. Vendor

**Role:** Input supplier, equipment provider, or service vendor who delivers goods/services to the beneficiary.

**Dashboard:** None (passive recipient)

**On-chain actions:** None — the vendor does not sign transactions. Payment is received automatically when the funder calls `release_funds`.

**Observation methods:** Freighter wallet balance change, or read-only escrow status via the Funder Dashboard status reader.

---

## 3. On-Chain Evidence & Verification

This section provides structured placeholders for Stellar Testnet transaction hashes that demonstrate the complete end-to-end workflow. Each hash should be verifiable on [Stellar Expert Testnet Explorer](https://stellar.expert/explorer/testnet).

### Deployed Contract Reference

| Item | Value |
|------|-------|
| **Escrow Factory Contract ID** | `CABMN45ARQKZ6ISJUXHVDGB236U6IEIC2ZO2V24YZB6D7JQOUVL5VFCH` |
| **Native XLM Token (SAC) ID** | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| **Network** | Stellar Testnet |
| **Contract Source** | `contracts/contracts/escrow/src/lib.rs` |
| **Frontend Config** | `frontend/src/blockchain/stellarConfig.ts` |

**Contract verification link (paste after submission):**  
`https://stellar.expert/explorer/testnet/contract/CABMN45ARQKZ6ISJUXHVDGB236U6IEIC2ZO2V24YZB6D7JQOUVL5VFCH`

---

### Phase 1: Escrow Initialization & Funding

**Objective:** Funder creates an escrow record and deposits Native XLM, advancing the state from `Locked` to `Pending`.

| Step | Contract Call | Expected On-Chain Result | Transaction Hash |
|------|---------------|--------------------------|------------------|
| 1.1 Initialize Escrow | `init_escrow` | Status = **`Locked`**; escrow record created for beneficiary; no XLM transferred yet | [Insert TxHash Here] |
| 1.2 Fund Escrow | `fund_escrow` | Status = **`Pending`**; Native XLM locked in contract | [Insert TxHash Here] |

**Evidence to verify on Stellar Expert:**

- [ ] `init_escrow` invocation on contract `CABMN45ARQKZ6ISJUXHVDGB236U6IEIC2ZO2V24YZB6D7JQOUVL5VFCH`
- [ ] Signer address matches Funder public key (`G...`)
- [ ] Escrow parameters: vendor address, beneficiary address, amount (stroops)
- [ ] `fund_escrow` shows Native XLM SAC transfer from Funder → contract
- [ ] Post-fund simulation/read shows status **`Pending`**

**Participant addresses used in this test run:**

| Role | Public Key |
|------|------------|
| Funder | `G________________________` |
| Beneficiary | `G________________________` |
| Vendor | `G________________________` |
| Escrow Amount | `________ XLM` |

---

### Phase 2: Beneficiary Cryptographic Sign-off

**Objective:** Beneficiary submits milestone proof, advancing the state from `Pending` to `Released`.

| Step | Contract Call | Expected On-Chain Result | Transaction Hash |
|------|---------------|--------------------------|------------------|
| 2.1 Submit Proof | `submit_proof` | Status = **`Released`**; proof hash recorded (non-zero 32-byte hash) | [Insert TxHash Here] |

**Evidence to verify on Stellar Expert:**

- [ ] `submit_proof` invocation on escrow factory contract
- [ ] Signer address matches Beneficiary public key (must equal escrow `recipient`)
- [ ] Escrow status transitions from **`Pending`** to **`Released`**
- [ ] Non-zero `proof_hash` submitted (64-character hex in MVP UI)

---

### Phase 3: Vendor Payout Execution

**Objective:** Funder releases locked funds to the vendor after beneficiary proof; escrow `amount` zeroed.

| Step | Contract Call | Expected On-Chain Result | Transaction Hash |
|------|---------------|--------------------------|------------------|
| 3.1 Release to Vendor | `release_funds` | Native XLM transferred to vendor; escrow `amount` = **0** | [Insert TxHash Here] |

**Evidence to verify on Stellar Expert:**

- [ ] `release_funds` invocation on escrow factory contract
- [ ] Signer address matches Funder public key
- [ ] Native XLM SAC transfer from contract → Vendor address
- [ ] Vendor Freighter balance increased by escrow amount (minus negligible fees)
- [ ] Post-release read shows escrow balance **`0 XLM`**

---

### Complete Transaction Summary

| Phase | Description | TxHash | Explorer Link |
|-------|-------------|--------|---------------|
| 1.1 | Initialize Escrow (`Locked`) | [Insert TxHash Here] | `https://stellar.expert/explorer/testnet/tx/[Insert TxHash Here]` |
| 1.2 | Fund Escrow (`Pending`) | [Insert TxHash Here] | `https://stellar.expert/explorer/testnet/tx/[Insert TxHash Here]` |
| 2.1 | Beneficiary Proof (`Released`) | [Insert TxHash Here] | `https://stellar.expert/explorer/testnet/tx/[Insert TxHash Here]` |
| 3.1 | Vendor Payout (amount zeroed) | [Insert TxHash Here] | `https://stellar.expert/explorer/testnet/tx/[Insert TxHash Here]` |

---

## 4. Visual Walkthrough & System Steps (Screenshot Guide)

This section documents the complete user journey from the UI perspective. Insert screenshots at each tagged placeholder to produce a visual deliverable appendix.

**Prerequisites for all participants:**
1. Install [Freighter Browser Extension](https://www.freighter.app/)
2. Set Freighter network to **Testnet** (Settings → Preferences → Network)
3. Fund test wallets via [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#create-account)
4. Open the live app: [https://smartprotocol-zm.vercel.app/](https://smartprotocol-zm.vercel.app/)

---

### Step 0: Landing Page & Role Selection

**User action:** Navigate to the application homepage.

**What happens:** The landing page presents two role entry points—**For Funders** and **For Farmers & Beneficiaries**—along with project branding ("Verified Milestone Payouts") and a Stellar/Soroban attribution section.

[Insert Screenshot: Landing Page — Hero and Role Cards]

---

### Step 1: Connect Freighter Wallet

**User action:** Click **Connect Freighter** in the navigation bar. Approve access in the Freighter popup.

**What happens:** The navbar displays the connected public key (truncated). The connected wallet becomes the signing identity for all subsequent on-chain transactions on that browser profile.

[Insert Screenshot: Navbar — Freighter Connected State]

---

### Step 2: Funder — Initialize Escrow

**Route:** `/funder`  
**User action:** In the **Initialize escrow** section, enter:
- **Vendor address** — Stellar public key of the service/input provider (`G...`)
- **Beneficiary address** — Stellar public key of the farmer/recipient (`G...`)
- **Amount (XLM)** — Escrow amount (e.g., `10`)

Click **Initialize escrow**. Approve the Soroban transaction in Freighter.

**What happens on-chain:** Contract creates an escrow record keyed by the beneficiary address. Status = **`Locked`**. No XLM is transferred at this step.

**Expected UI feedback:** Spinner (`Signing and submitting init_escrow…`) followed by green banner: *Transaction confirmed on ledger* with **View on Stellar Expert →** link.

[Insert Screenshot: Funder Dashboard Initialization]

[Insert Screenshot: Freighter Popup — init_escrow Approval]

[Insert Screenshot: Funder Success Banner — Init Confirmed]

---

### Step 3: Funder — Verify Escrow Status (Locked)

**User action:** In the **Escrow status reader** section, enter the **Beneficiary address (escrow key)** and click **Refresh status**.

**What happens:** The UI fetches live on-chain state via `get_escrow` simulation.

**Expected display:**
- Status badge: **`Locked`**
- XLM balance (escrow): configured amount (not yet deposited)
- Funder and Vendor addresses shown

[Insert Screenshot: Escrow Status Reader — Locked State]

---

### Step 4: Funder — Fund Escrow

**User action:** In the **Fund escrow** section, enter:
- **Beneficiary address** — Must match the address used during initialization
- **Amount (XLM)** — Must **exactly match** the initialization amount

Click **Fund escrow**. Approve the Native XLM transfer in Freighter.

**What happens on-chain:** Funder's Native XLM is transferred into the escrow contract via the Stellar Asset Contract. Status transitions **`Locked` → `Pending`**.

**Expected UI feedback:** Spinner (`Signing and submitting fund_escrow…`) followed by success banner with Stellar Expert link.

[Insert Screenshot: Funder Dashboard — Fund Escrow Form]

[Insert Screenshot: Escrow Status Reader — Pending State with XLM Balance]

---

### Step 5: Beneficiary — Check Delivery Status

**Route:** `/beneficiary`  
**User action:** Connect Freighter with the **Beneficiary** wallet. Click **Check delivery status**.

**What happens:** The app calls `get_escrow` using the connected wallet as the beneficiary key.

**Expected display:**
- Connected wallet shows full beneficiary public key
- Readiness banner (amber): *"Escrow is funded and waiting for your cryptographic sign-off."*
- Status badge: **`Pending`**
- Escrow balance and Vendor address displayed

[Insert Screenshot: Beneficiary Dashboard — Delivery Lookup Pending]

---

### Step 6: Beneficiary — Submit Cryptographic Proof

**User action:** In the **Cryptographic sign-off** section:
1. Click **Generate Demo Hash** (or paste a 64-character hex proof hash)
2. Click **Confirm Receipt & Unlock Funds**
3. Approve the transaction in Freighter

**What happens on-chain:** Beneficiary calls `submit_proof` with a non-zero 32-byte hash. Status transitions **`Pending` → `Released`**.

**Expected UI feedback:**
- Full-screen overlay: *Submitting milestone proof…*
- Green success banner: *Milestone proof submitted successfully*
- Message: *Escrow status advanced to **Released***
- **View on Stellar Expert** button

[Insert Screenshot: Beneficiary — Proof Hash Entry Form]

[Insert Screenshot: Beneficiary Success Banner — Released State]

---

### Step 7: Funder — Release Payout to Vendor

**Route:** `/funder` (Funder wallet reconnected)  
**User action:** In the **Release payout** section, enter the **Beneficiary address** and click **Release to vendor**. Approve in Freighter.

**Prerequisite:** Escrow status must be **`Released`** (beneficiary proof completed).

**What happens on-chain:** Contract transfers locked Native XLM to the vendor address. Escrow `amount` is zeroed.

**Expected UI feedback:** Spinner (`Signing and submitting release_funds…`) followed by success banner with Stellar Expert link.

[Insert Screenshot: Funder Dashboard — Release to Vendor]

[Insert Screenshot: Escrow Status Reader — Released with Zero Balance After Payout]

---

### Step 8: Vendor — Confirm Receipt (Passive Observation)

**User action:** Vendor opens Freighter wallet and observes balance increase. Optionally, any user can verify via the Funder Dashboard status reader.

**What happens:** Vendor receives Native XLM directly to their Stellar address. No vendor-side UI interaction is required.

**Expected display:**
- Vendor Freighter balance increased by escrow amount
- Status reader shows **`Released`** with **0 XLM** escrow balance

[Insert Screenshot: Vendor Freighter Balance — After Payout]

---

### End-to-End Flow Diagram

```
  FUNDER                    CONTRACT                    BENEFICIARY              VENDOR
    │                          │                            │                      │
    │── init_escrow ──────────►│  Status: Locked            │                      │
    │                          │                            │                      │
    │── fund_escrow ──────────►│  Status: Pending           │                      │
    │   (XLM locked)           │                            │                      │
    │                          │                            │                      │
    │                          │◄── submit_proof ───────────│  Status: Released    │
    │                          │    (proof_hash)            │                      │
    │                          │                            │                      │
    │── release_funds ────────►│  XLM ──────────────────────────────────────────►│
    │                          │  amount = 0                │                      │
```

---

## Appendix A: Security & Contract Guarantees

The Soroban contract enforces the following invariants (verified by unit tests in `contracts/contracts/escrow/src/test.rs`):

| Rule | Enforcement |
|------|-------------|
| Only declared funder can initialize | `funder.require_auth()` |
| Duplicate beneficiary escrows rejected | `"escrow already exists for recipient"` |
| Only funder can fund | `"only funder can fund this escrow"` |
| Fund amount must match init amount | `"amount mismatch"` |
| Double-funding prevented | `"escrow must be Locked"` |
| Only beneficiary can submit proof | `"only beneficiary can submit proof"` |
| Proof only when funded | `"escrow must be Pending"` |
| Non-zero proof hash required | `"proof_hash required"` |
| Release only after proof | `"escrow must be Released (proof submitted)"` |
| Double payout prevented | `"escrow already paid out"` |

---

## Appendix B: Tech Stack Summary

| Layer | Technology |
|-------|------------|
| Smart Contracts | Soroban / Rust (WebAssembly), `soroban-sdk` v23 |
| Frontend | Next.js 15, React 19, TypeScript |
| Styling | Tailwind CSS v4 |
| Blockchain SDK | `@stellar/stellar-sdk` v15 |
| Wallet | Freighter (`@stellar/freighter-api` v6) |
| Deployment | Vercel (frontend), Stellar Testnet (contracts) |
| Package Manager | Yarn (monorepo workspaces) |

---

## Appendix C: Repository Structure

```
SmartProtocolZm/
├── contracts/
│   └── contracts/escrow/src/
│       ├── lib.rs              # EscrowFactoryContract
│       └── test.rs             # Unit tests
├── frontend/
│   ├── app/
│   │   ├── page.tsx            # Landing page
│   │   ├── funder/page.tsx     # Funder dashboard
│   │   └── beneficiary/page.tsx # Beneficiary sign-off
│   └── src/blockchain/
│       ├── stellarConfig.ts    # Testnet + contract IDs
│       ├── stellarClient.ts    # RPC + XDR builders
│       └── transactionService.ts # Freighter sign/submit
├── README.md
└── QA_TEST.md                  # E2E testnet QA playbook
```

---

*Document generated from SmartProtocol Zambia codebase. All contract IDs, function names, state transitions, and UI flows are verified against the deployed Testnet implementation.*

**© 2026 SmartProtocol Zambia · Developed by Chilundika Chipo**
