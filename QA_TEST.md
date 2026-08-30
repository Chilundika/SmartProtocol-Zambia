# SmartProtocol Zambia — E2E Testnet QA Playbook

Live, end-to-end transaction test for the local Next.js application (`localhost:3000`) on **Stellar Testnet**.

**Environment**

- **Blockchain:** Stellar Testnet
- **Escrow contract:** `CABMN45ARQKZ6ISJUXHVDGB236U6IEIC2ZO2V24YZB6D7JQOUVL5VFCH`
- **Config:** `frontend/src/blockchain/stellarConfig.ts` (Testnet)
- **Local app:** `yarn dev` → `http://localhost:3000`
- **Wallets:** 3 Chrome profiles, each with Freighter on Stellar Testnet

| Chrome profile | Role |
|----------------|------|
| Profile 1 | Funder (Friendbot-funded XLM) |
| Profile 2 | Beneficiary |
| Profile 3 | Vendor / Service Provider |

---

## App map (what exists today)

| Route | Role | Purpose |
|-------|------|---------|
| `http://localhost:3000/` | All | Landing; links to dashboards |
| `http://localhost:3000/funder` | Profile 1 (Funder) | `init_escrow`, `fund_escrow`, `release_funds`, status reader |
| `http://localhost:3000/beneficiary` | Profile 2 (Beneficiary) | `submit_proof`, delivery lookup |

There is **no `/vendor` page**. The vendor (Profile 3) observes payout via **Freighter balance** and/or the **Funder Dashboard escrow status reader** (any profile can open `/funder` read-only for status).

**On-chain contract:** `CABMN45ARQKZ6ISJUXHVDGB236U6IEIC2ZO2V24YZB6D7JQOUVL5VFCH` (Testnet)

**Status machine:** `Locked` → `Pending` → `Released` → vendor paid (`amount` zeroed)

---

## Phase 0 — Pre-flight check (all 3 profiles)

### 0.1 Freighter extension (each Chrome profile)

1. Open Freighter → **Settings → Network → Testnet** (`Test SDF Network ; September 2015`).
2. Copy each profile’s **public key** (`G…`) from Freighter.
3. Ensure accounts are funded on Testnet (Funder via Friendbot; Beneficiary and Vendor need accounts too — they sign transactions and must exist on-chain).

Label them for the test run:

- **Funder (P1):** `G_FUNDER…`
- **Beneficiary (P2):** `G_BENEFICIARY…`
- **Vendor (P3):** `G_VENDOR…`

### 0.2 Verify connection inside the app (per profile)

1. Open `http://localhost:3000` in that profile.
2. Click **Connect Freighter** in the navbar.
3. Approve access in Freighter.

**Where the public key appears:**

| Profile | Page | What to verify |
|---------|------|----------------|
| P1 Funder | `/funder` | Header shows full key: `Funder: G…` |
| P2 Beneficiary | `/beneficiary` | **Delivery verification → Connected wallet** shows full `G…` |
| P3 Vendor | Any page | Navbar shows truncated key (`G…XXXX`); use Freighter to confirm full key |

**Testnet in the app:** The frontend is hard-wired to Testnet in `stellarConfig.ts` and `transactionService.ts` (`STELLAR_TESTNET_NETWORK_PASSPHRASE`). There is no network badge in the UI — the Freighter signing popup is where you confirm **Testnet** before approving.

**Pass criteria:** Navbar shows connected (not “Connect Freighter”), and the full public key on the role page matches the Freighter key for that profile.

---

## Phase 1 — Funder flow (Profile 1)

**URL:** `http://localhost:3000/funder`

### Step 1.1 — Initialize escrow

**Section:** *Initialize escrow*

| Field | Value |
|-------|-------|
| **Vendor address** | `G_VENDOR…` (Profile 3) |
| **Beneficiary address** | `G_BENEFICIARY…` (Profile 2) |
| **Amount (XLM)** | e.g. `10` |

Click **Initialize escrow**.

**UI while processing:** Spinner — `Signing and submitting init_escrow…`

**Freighter prompt:** Soroban contract invocation on **Testnet**; signer = Funder. Approve.

**Expected on-chain:** Status = **`Locked`** (record created, no XLM moved yet).

**Success UI:** Green banner — *Transaction confirmed on ledger* + **View on Stellar Expert →**

### Step 1.2 — Confirm init (status reader)

**Section:** *Escrow status reader*

| Field | Value |
|-------|-------|
| **Beneficiary address (escrow key)** | `G_BENEFICIARY…` |

Click **Refresh status**.

**Expected:**

- Status badge: **`Locked`**
- XLM balance (escrow): `10 XLM` (configured amount, not yet deposited)
- Funder: `G_FUNDER…`
- Vendor: `G_VENDOR…`

### Step 1.3 — Fund escrow

**Section:** *Fund escrow*

| Field | Value |
|-------|-------|
| **Beneficiary address** | `G_BENEFICIARY…` (same as init) |
| **Amount (XLM)** | **`10`** — must **exactly match** init amount |

> **Contract rule:** `fund_escrow` panics on `amount mismatch` if fund ≠ init amount.

Click **Fund escrow**.

**UI:** Spinner — `Signing and submitting fund_escrow…`

**Freighter prompt:** Native XLM transfer from Funder → escrow contract; signer = Funder.

**Expected on-chain:** Status → **`Pending`**; XLM locked in contract.

**Refresh status** again → Status **`Pending`**, balance **`10 XLM`**.

**Record txHash #1 (init) and #2 (fund)** from the success banner (see Evidence section).

---

## Phase 2 — Beneficiary verification (Profile 2)

**URL:** `http://localhost:3000/beneficiary`

### Step 2.1 — Connect & lookup

1. **Connect Freighter** (must be Beneficiary account `G_BENEFICIARY…`).
2. **Delivery verification → Connected wallet** should show that key.
3. Click **Check delivery status**.

**Expected readiness banner (amber):**

> *“Escrow is funded and waiting for your cryptographic sign-off.”*

**Escrow panel:**

| Field | Expected |
|-------|----------|
| Status | **`Pending`** (amber badge) |
| Escrow balance | `10 XLM` |
| Vendor | `G_VENDOR…` |

If status is **`Locked`**, funding did not complete or wrong beneficiary key was used.

### Step 2.2 — Submit cryptographic proof

**Section:** *Cryptographic sign-off*

1. Click **Generate Demo Hash** (or paste 64 hex chars, optional `0x` prefix).
2. Click **Confirm Receipt & Unlock Funds**.

**UI:** Full-screen overlay — *Submitting milestone proof…* / *Confirm the transaction in Freighter.*

**Freighter prompt:** `submit_proof` on Testnet; signer = Beneficiary.

**Success UI (green banner):**

- *Milestone proof submitted successfully*
- *Escrow status advanced to **Released***
- **View on Stellar Expert** button

**After refresh / re-lookup:**

- Status badge: **`Released`** (green)
- Readiness: *“Proof already submitted. Funder can release payout to the vendor.”*

**Record txHash #3 (proof).**

---

## Phase 3 — Vendor observation (Profile 3)

There is no vendor dashboard. Use these methods:

### Option A — Freighter balance (primary)

1. In Profile 3, note XLM balance **before** release.
2. After Funder completes Phase 4, refresh Freighter → balance should increase by **10 XLM** (minus negligible fees).

### Option B — Funder status reader (read-only)

Any browser can open `http://localhost:3000/funder`:

1. Enter **Beneficiary address** = `G_BENEFICIARY…`
2. **Refresh status**

**Before release:** Status **`Released`**, balance `10 XLM`, Vendor = `G_VENDOR…`

**After release:** Status still **`Released`**, but **XLM balance (escrow) = `0 XLM`** (contract zeroes `amount` after payout)

---

## Phase 4 — Funder releases payout (Profile 1 again)

Back on **`/funder`** with Funder wallet connected.

**Section:** *Release payout*

| Field | Value |
|-------|-------|
| **Beneficiary address** | `G_BENEFICIARY…` |

Click **Release to vendor** (amber button).

**Prerequisite:** Status must be **`Released`** (beneficiary proof done). Otherwise contract panics: `escrow must be Released (proof submitted)`.

**UI:** Spinner — `Signing and submitting release_funds…`

**Freighter prompt:** Contract → Vendor XLM transfer; signer = Funder.

**Success UI:** Green *Transaction confirmed on ledger* + Stellar Expert link.

**Refresh status** → escrow balance **`0 XLM`**.

**Record txHash #4 (release).**

---

## Phase 5 — Evidence extraction (tx hashes)

### In the UI (easiest)

After each successful transaction, both dashboards show a link:

```
https://stellar.expert/explorer/testnet/tx/<txHash>
```

- **Funder page:** *View on Stellar Expert →* (green feedback panel)
- **Beneficiary page:** *View on Stellar Expert* (green success banner)

Right-click → copy link, or open and copy hash from the URL.

### In the browser console (DevTools → Console)

Filter for `[transactionService]`. Key log lines:

| Event | Log message | Contains |
|-------|-------------|----------|
| Submitted | `Transaction submitted to RPC.` | `{ txHash, sendStatus }` |
| Confirmed | `Transaction cleared on ledger.` | `{ txHash, ledger }` |
| Failed | `Transaction reverted on ledger.` | `{ txHash, ledger }` |

Example manual extraction in console:

```javascript
// After a tx completes, search console for:
// [transactionService] Transaction cleared on ledger. { txHash: "abc123...", ledger: 12345 }
```

### Verification on Stellar Expert

For each of the 4 hashes, confirm on Testnet explorer:

1. **Init** — `init_escrow` on contract `CABMN…`
2. **Fund** — XLM SAC transfer into escrow; status → Pending
3. **Proof** — `submit_proof` by beneficiary; status → Released
4. **Release** — XLM transfer to `G_VENDOR…`; escrow amount → 0

---

## End-to-end checklist (quick reference)

```
[ ] P1/P2/P3: Freighter on Testnet, keys copied
[ ] P1: /funder → Init (vendor + beneficiary + 10 XLM) → Locked
[ ] P1: Fund (beneficiary + 10 XLM, MUST match init) → Pending
[ ] P2: /beneficiary → Check delivery → Pending
[ ] P2: Generate Demo Hash → Confirm Receipt → Released
[ ] P3: Note Freighter XLM balance (baseline)
[ ] P1: Release to vendor → Vendor +10 XLM, escrow 0
[ ] All: 4 txHashes on stellar.expert/explorer/testnet
```

---

## Common failure modes

| Symptom | Likely cause |
|---------|----------------|
| `Connect Freighter` never resolves | Extension not installed / not on Testnet |
| `ACCOUNT_NOT_FOUND` | Profile account not funded on Testnet |
| `amount mismatch` on fund | Fund XLM ≠ Init XLM |
| Sign-off button disabled | Status not **`Pending`** (not funded yet) |
| `escrow must be Released` on release | Beneficiary proof not submitted |
| `SIGNING_FAILED` in UI | Wrong Freighter network or user rejected signature |
| `escrow already exists for recipient` | Re-running init for same beneficiary — use a fresh beneficiary key or a new test run |

---

## Role → page summary

| Chrome profile | Primary URL | Signs transactions? |
|----------------|-------------|---------------------|
| P1 Funder | `/funder` | Yes — init, fund, release |
| P2 Beneficiary | `/beneficiary` | Yes — submit_proof |
| P3 Vendor | Freighter only (+ optional `/funder` status reader) | No — receives XLM passively |

The vendor is configured at init time and paid when the funder calls **Release to vendor** after the beneficiary advances the escrow to **Released**.
