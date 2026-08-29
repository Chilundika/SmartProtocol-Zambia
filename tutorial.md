# SmartProtocol Zambia — User Tutorial

This guide walks you through SmartProtocol Zambia **from start to finish**: vendor registration, funder verification, beneficiary sign-off, and vendor payout — on **Stellar Testnet**.

The app runs locally at **http://localhost:3000** (`npx yarn dev` from the project root).

---

## What the system does

SmartProtocol Zambia is a milestone-based escrow on Stellar (Soroban). A **funder** locks XLM until a **beneficiary** confirms delivery with a cryptographic proof. After proof is on-chain, the funder **releases** the payout to the **vendor**.

Vendors must **register and be verified** by a funder before they can be selected for a new escrow. They then watch on-chain status so they only dispatch goods after funds are locked.

Each delivery is tracked by a unique **Escrow ID** (a number). The same beneficiary can have **multiple active escrows** with different IDs.

**Status flow:**

```
Locked  →  Pending  →  Released  →  (vendor paid, balance zeroed)
```

| Status | Meaning | Vendor dispatch? |
|--------|---------|------------------|
| **Locked** | Escrow record created; XLM not yet deposited | **No** — record only |
| **Pending** | XLM locked in the contract; waiting for beneficiary sign-off | **Yes** — funds are locked |
| **Released** | Beneficiary submitted proof; funder can pay the vendor | Goods should already be delivered |

---

## Roles at a glance

| Role | Dashboard | Wallet | Signs transactions? |
|------|-----------|--------|-------------------|
| **Funder** | `/funder` and `/funder/vendors` | [Freighter](https://www.freighter.app) extension | Yes — init, fund, release |
| **Beneficiary** | `/beneficiary/auth` then `/beneficiary` | Embedded session wallet (NRC + 4-digit PIN) | Yes — submit proof |
| **Vendor** | `/vendor/auth` then `/vendor` | Embedded session wallet (Business TPIN + 4-digit PIN) | No — receives XLM; tracks escrow status |

**Hybrid wallet design:** Funders use Freighter on desktop. Beneficiaries and vendors use PIN-protected session wallets in the browser — no extension required.

**Vendor registry:** Registrations are stored in this browser (`smartprotocol_vendors_v1`). For the demo, the **vendor and funder must use the same browser/device** so the funder can see pending profiles and approve them.

---

## Testnet configuration

| Setting | Value |
|---------|-------|
| Network | Stellar Testnet |
| Escrow contract | `CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ` |
| Native XLM token | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Explorer | [stellar.expert/explorer/testnet](https://stellar.expert/explorer/testnet) |

Config file: `frontend/src/blockchain/stellarConfig.ts`

---

## Before you start

### 1. Run the app

From the project root:

```bash
yarn install
npx yarn dev
```

On Windows, `yarn` may not be on PATH — use **`npx yarn dev`**.

Open **http://localhost:3000** (or **http://192.168.x.x:3000** from a phone on the same Wi‑Fi for beneficiary testing). The terminal prints the network URL when the Next.js server starts.

### 2. Prepare three actors

For a full test you need three Stellar testnet accounts. Easiest setup: **one desktop browser** (funder + vendor registry + vendor portal) **and one phone** (beneficiary).

| Actor | Wallet setup |
|-------|----------------|
| **Funder** | Freighter on Testnet, funded via [Friendbot](https://laboratory.stellar.org/#account-creator?network=test) |
| **Beneficiary** | NRC + PIN account created inside the app (no Freighter). Registration funds the keypair via Friendbot automatically. |
| **Vendor** | Business TPIN + PIN account at `/vendor/auth` (no Freighter). Registration funds a session keypair via Friendbot. Funder must then **Verify** the profile. |

### 3. What each party shares

| From → To | What to share |
|-----------|----------------|
| Vendor → Funder | Register on the **same browser** the funder uses for `/funder/vendors` (TPIN, PACRA, documents). After approval, the public key is selected from the verified-vendor list. |
| Beneficiary → Funder | Beneficiary session wallet public key (`G…`) from **Your account** |
| Funder → Beneficiary | **Escrow ID** (generated at init) + confirmation when funded |
| Funder → Vendor | **Escrow ID** so the vendor can watch status (also auto-added to the vendor watchlist on this device after init) |

---

# Part 1 — Funder (A → Z)

**Escrow:** http://localhost:3000/funder  
**Vendor verification:** http://localhost:3000/funder/vendors

The funder drives the escrow lifecycle: **verify vendors**, create, fund, and release. All on-chain signing uses **Freighter**. The navbar shows **Connect Freighter** on funder routes. Tabs under the header switch between **Escrow** and **Vendor verification**.

---

## Step 1 — Connect Freighter

1. Open **Funder Dashboard** (`/funder`).
2. Click **Connect Freighter** in the navbar.
3. Approve access in the Freighter popup.
4. Confirm Freighter is on **Testnet** (`Test SDF Network ; September 2015`).
5. Verify the connected address is funded with testnet XLM.

The page header shows: `Funder: G…`

---

## Step 2 — Verify a vendor (required before init)

Open **Vendor verification** (`/funder/vendors`) or click the **Vendor verification** tab.

1. Filter **Pending** to see new registrations.
2. Select a business. Inspect:
   - Business name
   - Business TPIN / ID
   - PACRA registration number
   - Stellar address
   - Verification notes
   - Supporting document (preview images; download other files)
3. Click **Approve / Verified**.

You can also **Mark pending** or **Reject**.

**Rule:** Only vendors with status **Verified** appear in the Initialize escrow dropdown. If you try to init without a verified vendor, the app blocks the action with `VENDOR_NOT_VERIFIED`.

> If the list is empty, the vendor has not registered on **this browser**. Ask them to complete `/vendor/auth` here first (see Part 3).

---

## Step 3 — Gather the beneficiary address

Before initializing, collect:

| Field | Source |
|-------|--------|
| **Verified vendor** | Selected from the dropdown (approved in Step 2) |
| **Beneficiary address** | Beneficiary’s session wallet public key from `/beneficiary` (**Your account**) |

Ask the beneficiary to register first (Part 2) so they already have a public key to share.

---

## Step 4 — Initialize escrow

In **Initialize escrow**:

| Field | Example |
|-------|---------|
| Verified vendor | `Lusaka Agro Supplies Ltd · 1001234567` (dropdown) |
| Beneficiary address | `GB…` (beneficiary session wallet) |
| Amount (XLM) | `10` |

Click **Initialize escrow** → approve in Freighter.

**What happens:**

- The app auto-generates a unique **Escrow ID** (`Date.now()`, e.g. `1734876543210`).
- The ID appears in the **Active escrow ID** panel.
- On-chain status → **Locked** (record only; no XLM moved yet).
- The Escrow ID is added to that vendor’s **watchlist** on this device.

**Important:** Copy the Escrow ID and send it to the **beneficiary** and the **vendor** (SMS, WhatsApp, etc.).

---

## Step 5 — Confirm initialization (status reader)

In **Escrow status reader**:

1. The Escrow ID field should already show your new ID.
2. Click **Refresh status**.

**Expected:**

| Field | Value |
|-------|-------|
| Escrow ID | Your generated ID |
| Status | **Locked** |
| XLM balance | `10 XLM` (configured amount, not yet deposited) |
| Beneficiary | Beneficiary’s `G…` |
| Vendor | Verified vendor’s `G…` |

---

## Step 6 — Fund escrow

In **Fund escrow**:

| Field | Value |
|-------|-------|
| Escrow ID | Same ID from Step 4 |
| Amount (XLM) | **Must exactly match** init amount (e.g. `10`) |

Click **Fund escrow** → approve in Freighter.

**Result:** Status → **Pending**. XLM is now locked in the smart contract.

Refresh the status reader to confirm **Pending** and balance **10 XLM**. Tell the vendor they may prepare dispatch.

> **Contract rule:** If fund amount ≠ init amount, the transaction fails with `amount mismatch`.

---

## Step 7 — Wait for beneficiary proof

Tell the beneficiary:

1. Their **Escrow ID**
2. That funding is complete

They sign proof on `/beneficiary`. You **cannot** release until they do.

When proof is submitted, refresh status → **Released**.

---

## Step 8 — Release payout to vendor

In **Release payout**:

| Field | Value |
|-------|-------|
| Escrow ID | Same ID used throughout |

Click **Release to vendor** → approve in Freighter.

**Result:**

- XLM sent to the vendor’s session-wallet address
- Escrow balance → **0 XLM**
- Status remains **Released**

---

## Funder checklist

- [ ] Freighter connected on Testnet
- [ ] Vendor registered and **Verified** on `/funder/vendors`
- [ ] Escrow initialized with a **verified vendor** → **Locked**
- [ ] Escrow ID copied and shared with beneficiary and vendor
- [ ] Escrow funded (matching amount) → **Pending**
- [ ] Beneficiary submitted proof → **Released**
- [ ] Payout released → vendor received XLM

Each successful transaction shows a green banner with **View on Stellar Expert →**.

---

# Part 2 — Beneficiary

**Auth:** http://localhost:3000/beneficiary/auth  
**Dashboard:** http://localhost:3000/beneficiary

Beneficiaries verify delivery and submit proof using an **embedded session wallet**. No Freighter on these pages. Visiting `/beneficiary` while logged out redirects to `/beneficiary/auth`.

The navbar on beneficiary routes shows **Log In**, **Enter PIN to Unlock**, or **Sign Out** — never Connect Freighter.

---

## Step 1 — Create an account (first visit)

1. Open **Beneficiary Sign-off** (`/beneficiary`) or go directly to `/beneficiary/auth`.
2. Toggle **Create Account**.
3. Enter your **NRC number** (example: `123456/11/1`). Spaces are ignored; the number must be at least 6 characters.
4. Choose a **4-digit PIN**.
5. Click **Register**.

An overlay appears: *Initializing and activating session wallet on Testnet…*  
The app generates a Stellar keypair, funds it via Friendbot, encrypts the secret with your PIN (PBKDF2 + AES-GCM), and stores it on **this device**.

On success you are redirected to `/beneficiary`.

> If Friendbot is down, the account is **not** saved. Wait and register again.

**Log In** (returning users): same page, toggle **Log In**, enter the same NRC + PIN.

---

## Step 2 — Share public key with funder

The dashboard **Your account** panel shows:

- **NRC number**
- **Public key** (`G…`)
- **Copy public key**
- Unlocked / Locked status

1. Click **Copy public key**.
2. Send it to your funder.

The funder uses this address when they **initialize** the escrow. Your public key identifies you as the authorized signer — the **Escrow ID** identifies which specific delivery you are confirming.

> **Keep your PIN private.** Anyone with your PIN and this browser can sign transactions for that NRC.

---

## Step 3 — Receive Escrow ID from funder

When the funder initializes your delivery, they will send you an **Escrow ID** (e.g. `1734876543210`). You need this to look up and sign off that specific escrow.

The same NRC can receive **multiple deliveries** — each has its own Escrow ID.

---

## Step 4 — Enter Escrow ID and check status

In **Delivery verification**:

1. Enter the **Escrow ID** from your funder.
2. Confirm your session wallet public key is displayed.
3. Click **Check delivery status**.

You can look up status while the wallet is **Locked**. Signing (next steps) needs the PIN.

**If ready for sign-off (funder has funded):**

- Readiness: *“Escrow is funded and waiting for your cryptographic sign-off.”*
- Status: **Pending**
- Escrow balance and vendor address shown

**If “No escrow found”:** Wrong Escrow ID, or funder has not initialized yet.

**If status is Locked:** Escrow exists but funder has not funded yet — wait.

**If “belongs to a different beneficiary”:** Wrong Escrow ID for this NRC’s public key — log in to the correct account or double-check the ID with the funder.

---

## Step 5 — Unlock wallet (for signing)

After a page refresh, the session NRC is remembered but the keypair is locked until you enter the PIN.

1. Click **Enter PIN to Unlock** in the navbar, **or** wait for the PIN modal when you submit proof.
2. Enter your 4-digit PIN → **Unlock**.

---

## Step 6 — Submit cryptographic proof

In **Cryptographic sign-off**:

1. Enter a **proof hash** (64 hex characters), or click **Generate Demo Hash** for testing.
2. Click **Confirm Receipt & Unlock Funds**.
3. If the wallet is locked, the modal **Enter PIN to sign** appears — enter PIN → **Sign & Submit**.
4. Wait for local signing and submission to testnet. Do not close the tab.

**Result:**

- Green banner: *Milestone proof submitted successfully*
- Status → **Released**
- Link to Stellar Expert

Re-run **Check delivery status** to confirm **Released**.

---

## Step 7 — Notify funder

Tell the funder proof is submitted so they can **Release to vendor** on their dashboard.

---

## Sign Out vs Delete Account

| Action | What it does |
|--------|----------------|
| **Sign Out** | Clears this tab’s session. Your NRC and encrypted key stay on the device. Log in again with NRC + PIN. |
| **Delete Account** | Removes this NRC from this device. Confirm with **Confirm Delete**. You cannot recover the keypair from the app. |

Several NRCs can exist on the same phone. Sign out, then **Log In** or **Create Account** with a different NRC.

---

## Beneficiary checklist

- [ ] Account created at `/beneficiary/auth` (NRC + PIN); Friendbot overlay completed
- [ ] Public key shared with funder
- [ ] Escrow ID received from funder
- [ ] Delivery lookup shows **Pending**
- [ ] Proof submitted with PIN → **Released**
- [ ] Funder notified to release payout

---

# Part 3 — Vendor Portal

**Auth:** http://localhost:3000/vendor/auth  
**Dashboard:** http://localhost:3000/vendor

Vendors register a business profile, wait for funder approval, then track escrow status before dispatching goods. Visiting `/vendor` while logged out redirects to `/vendor/auth`.

The navbar on vendor routes shows **Vendor Log In** or **Sign Out** — never Connect Freighter. Vendors do **not** sign escrow transactions; they receive XLM when the funder releases.

---

## Step 1 — Register your business

1. Open **Vendor Portal** (`/vendor`) or go directly to `/vendor/auth`.
2. Toggle **Register**.
3. Fill in:

| Field | Example / notes |
|-------|-----------------|
| Business TPIN / ID | `1001234567` (at least 6 characters) |
| Business name | `Lusaka Agro Supplies Ltd` |
| PACRA registration number | `120000012345` (at least 5 characters) |
| Document verification details | Text describing the certificate (tax clearance, PACRA extract, etc.) |
| Optional file | PDF or image, **max 400 KB** |
| 4-digit PIN | Session wallet PIN |

You must provide **notes and/or a file**.

4. Click **Submit for verification**.

An overlay appears: *Registering vendor and activating Testnet wallet…*  
The app generates a Stellar keypair, funds it via Friendbot, encrypts the secret with your PIN, and stores the **profile + wallet** on this device with status **pending**.

On success you are redirected to `/vendor`.

> If Friendbot is down, the account is **not** saved. Wait and register again.

**Log In** (returning users): toggle **Log In**, enter the same TPIN + PIN.

---

## Step 2 — Wait for funder verification

The dashboard shows your business name, TPIN, PACRA number, public key, and a status badge (**pending** / **Verified** / **rejected**).

While **pending**, funders cannot select you for a new escrow. Ask the funder to open `/funder/vendors` **in this same browser** and click **Approve / Verified**.

After approval, refresh `/vendor` — the badge should read **Verified**.

---

## Step 3 — Share (or copy) your public key

1. Click **Copy public key** if anyone needs the `G…` address outside the app.
2. For the in-app flow, the funder selects you from the **Verified vendor** list — you do not paste the address into Initialize escrow.

---

## Step 4 — Track escrow status before dispatch

After the funder initializes (and ideally funds) an escrow:

**Track by Escrow ID**

1. Enter the **Escrow ID** from the funder.
2. Click **Look up & watch escrow**.
3. If the on-chain vendor address matches yours, the ID is saved to your watchlist.

**Refresh by vendor address**

Re-queries every watched Escrow ID and keeps rows that match your public key. The contract is keyed by Escrow ID (there is no on-chain “list by vendor”), so address refresh uses your watchlist. If the funder initialized on this device, the ID is already there.

**How to read status**

| Status | Dispatch confidence |
|--------|---------------------|
| **Locked** | Record only — **do not dispatch** |
| **Pending** | Funds locked — **safe to prepare dispatch** |
| **Released** (amount > 0) | Proof submitted — payout pending |
| **Released** (0 XLM) | Payout complete |

The dashboard shows a **Locked → Pending → Released** track on each watched escrow.

---

## Step 5 — Confirm payment after release

When the funder releases:

- Watched escrow amount → **0 XLM**, status **Released**
- Or look up your account on [Stellar Expert Testnet](https://stellar.expert/explorer/testnet)

You can also use the funder **Escrow status reader** (read-only) with the same Escrow ID.

---

## Sign Out vs Delete Account

| Action | What it does |
|--------|----------------|
| **Sign Out** | Clears this tab’s session. TPIN profile stays on the device. Log in again with TPIN + PIN. |
| **Delete Account** | Removes this vendor profile from this device. Confirm with **Confirm Delete**. |

---

## Vendor checklist

- [ ] Registered at `/vendor/auth` (TPIN, PACRA, notes/file, PIN); Friendbot overlay completed
- [ ] Funder marked the profile **Verified** on `/funder/vendors` (same browser)
- [ ] Escrow ID received (or auto-watched after init)
- [ ] Status **Pending** before dispatching goods
- [ ] After release, escrow balance **0 XLM** / XLM received

---

# Complete A → Z timeline

Follow this order for a full end-to-end test (**vendor + funder on the same browser**):

| # | Who | Action | Expected result |
|---|-----|--------|-----------------|
| 1 | **Vendor** | **Register** at `/vendor/auth` (TPIN, PACRA, documents, PIN) | Pending profile + funded session wallet |
| 2 | **Funder** | Connect Freighter; open `/funder/vendors` → **Approve / Verified** | Vendor selectable for init |
| 3 | **Beneficiary** | **Create Account** at `/beneficiary/auth` (NRC + PIN); share `G…` with funder | Testnet account funded |
| 4 | **Funder** | On `/funder`, **Initialize escrow** (verified vendor + beneficiary + amount) | Status **Locked**; Escrow ID generated |
| 5 | **Funder** | Share **Escrow ID** with beneficiary and vendor | Vendor watchlist updated on this device |
| 6 | **Vendor** | Open `/vendor`; confirm escrow (look up ID if needed) | Status **Locked** — do not dispatch |
| 7 | **Funder** | **Fund escrow** (same ID, same amount) | Status **Pending** |
| 8 | **Vendor** | Refresh matching escrows | **Pending** — safe to prepare dispatch |
| 9 | **Beneficiary** | Enter Escrow ID → **Check delivery status** | Shows **Pending** |
| 10 | **Beneficiary** | **Confirm Receipt & Unlock Funds** (PIN) | Status **Released** |
| 11 | **Funder** | Refresh status → confirm **Released** | — |
| 12 | **Funder** | **Release to vendor** (same Escrow ID) | Escrow balance **0 XLM** |
| 13 | **Vendor** | Refresh watchlist or Stellar Expert | +XLM received |

---

## Multiple deliveries and multiple accounts

**Same beneficiary, many deliveries:** Escrows are keyed by **Escrow ID**, not by beneficiary address.

1. Funder initializes a **new** escrow → new Escrow ID (auto-generated).
2. The same beneficiary public key can be reused.
3. Beneficiary enters the **new** Escrow ID on `/beneficiary` for each delivery.

Only duplicate **Escrow IDs** are rejected (`escrow already exists for id`).

**Same device, many beneficiaries:** Create a separate NRC account for each person. Sign Out, then Log In or Create Account with another NRC.

**Same device, many vendors:** Each Business TPIN is a separate profile. Only **Verified** TPINs appear in the funder dropdown.

---

## Viewing transactions

After successful operations, the app shows **View on Stellar Expert**. Manual URL:

```
https://stellar.expert/explorer/testnet/tx/<transaction-hash>
```

Contract on testnet:
[CDZD44…TP2BQ on Stellar Lab](https://lab.stellar.org/r/testnet/contract/CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ)

---

## Troubleshooting

### Funder

| Problem | What to try |
|---------|-------------|
| **Connect Freighter** does nothing | Install Freighter; set Testnet; refresh page |
| Account not found | Fund funder via Friendbot |
| No vendors in the dropdown | No **Verified** profiles on this device — register at `/vendor/auth` here, then approve on `/funder/vendors` |
| **VENDOR_NOT_VERIFIED** | Select a verified vendor; pending/rejected TPINs cannot be used |
| **amount mismatch** on fund | Fund amount must exactly match init amount |
| **Release** fails | Beneficiary must submit proof first (status **Released**) |
| **escrow already exists for id** | That Escrow ID was used before — initialize again to get a new auto-generated ID |
| Simulation / contract errors | Confirm `stellarConfig.ts` has the latest deployed contract ID (`CDZD44…`) |

### Beneficiary

| Problem | What to try |
|---------|-------------|
| Redirected to auth | You are not logged in — **Log In** or **Create Account** at `/beneficiary/auth` |
| Overlay stuck / Friendbot failed | Network or Friendbot issue; account is not saved — try **Create Account** again |
| **NRC already exists** | Use **Log In** with that NRC, or pick a different NRC |
| **Incorrect PIN** | Re-enter carefully; forgotten PIN cannot be recovered — **Delete Account** (if you can log in) or use a new NRC on this device |
| No escrow found | Verify Escrow ID with funder; wait until they initialize |
| Wrong beneficiary error | Escrow ID belongs to another public key — log in to the matching NRC |
| Sign-off disabled | Status must be **Pending** (funder must fund first) |
| `ACCOUNT_NOT_FOUND` | Registration Friendbot step failed or was skipped; create a new account |
| Lost device / browser | Keys live in this browser’s local storage — same device required, or register a new NRC and share the new public key with the funder |

### Vendor

| Problem | What to try |
|---------|-------------|
| Redirected to auth | **Log In** or **Register** at `/vendor/auth` |
| Overlay / Friendbot failed | Account is not saved — register again |
| **TPIN already exists** | Use **Log In**, or a different TPIN |
| Still **pending** | Funder must **Approve / Verified** on `/funder/vendors` in the **same browser** |
| Empty watchlist | Look up the Escrow ID, or have the funder init on this device |
| Escrow belongs to another vendor | Wrong Escrow ID — confirm with the funder |
| No XLM received | Funder must complete **Release to vendor** after beneficiary proof |
| Document rejected (400 KB) | Upload a smaller file or use the notes field only |

### General

| Problem | What to try |
|---------|-------------|
| Wrong network | App and Freighter must both be on Testnet |
| `yarn: command not found` (Windows) | Use `npx yarn dev` |
| Phone cannot reach app | Use the Network URL from the terminal (e.g. `http://192.168.x.x:3000`) |
| Funder cannot see vendor registration | Registry is **per browser**. Register the vendor on the funder’s machine for the demo. |

---

## For developers: rebuild & redeploy contract

If you change the Rust contract in `contracts/contracts/escrow/`:

```bash
# Tests (16 unit tests)
cd contracts/contracts/escrow && cargo test

# Build from contracts/ (not repo root)
cd contracts
stellar contract build

stellar contract deploy \
  --wasm target/wasm32v1-none/release/escrow.wasm \
  --source-account deployer \
  --network testnet
```

WASM path is `contracts/target/wasm32v1-none/release/escrow.wasm`. Deploy from the **`contracts/`** directory.

Update `ESCROW_FACTORY_CONTRACT_ID` in `frontend/src/blockchain/stellarConfig.ts` with the new `C…` address, then restart the dev server.

Vendor verification is **off-chain** (local registry). The app blocks unverified vendors on `init_escrow`; the Soroban contract itself still accepts any vendor address if called outside the UI.

---

## Security notes

- **Funder:** Freighter holds keys; you approve each transaction in the extension.
- **Beneficiary:** Session wallet secret is PIN-encrypted in browser local storage, keyed by NRC. A 4-digit PIN is convenient for field use but not as strong as a hardware wallet — treat it like a mobile banking PIN.
- **Vendor:** Session wallet (TPIN + PIN) receives payouts. Business documents live in this browser’s local storage for the demo — do not upload real production secrets.
- **Testnet only:** Do not use mainnet funds with this deployment.

---

## Quick links

| Resource | URL |
|----------|-----|
| Home | http://localhost:3000/ |
| Funder Dashboard (escrow) | http://localhost:3000/funder |
| Funder — Vendor verification | http://localhost:3000/funder/vendors |
| Beneficiary auth (NRC + PIN) | http://localhost:3000/beneficiary/auth |
| Beneficiary Sign-off | http://localhost:3000/beneficiary |
| Vendor auth (TPIN + PIN) | http://localhost:3000/vendor/auth |
| Vendor Portal | http://localhost:3000/vendor |
| Stellar Expert (Testnet) | https://stellar.expert/explorer/testnet |
| Escrow contract (Testnet) | https://lab.stellar.org/r/testnet/contract/CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ |
| Freighter wallet | https://www.freighter.app |
| Friendbot (fund accounts) | https://laboratory.stellar.org/#account-creator?network=test |

For a detailed QA playbook with tx-hash evidence collection, see [QA_TEST.md](./QA_TEST.md). That file may still describe older flows (Freighter for beneficiaries, escrow keyed by address, passive vendors); prefer this tutorial for current steps.
