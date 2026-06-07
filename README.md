# PROJECT NAME: SmartProtocol Zambia 
# Accessible at : [https://smartprotocol-zm.vercel.app/]

**A Decentralized Escrow and Milestone Verification Protocol on the Stellar Testnet**

SmartProtocol Zambia is a Web3 application designed to bring cryptographically secure, milestone-based funding to agricultural and service subsidies. Built as part of Master's degree research at the University of Zambia (UNZA), this platform utilizes Soroban Smart Contracts to ensure that locked funds are only released to vendors once beneficiaries provide verifiable cryptographic proof of receipt.

[![Live Demo](https://img.shields.io/badge/Live_Demo-Vercel-black?style=for-the-badge&logo=vercel)](https://smartprotocol-zm.vercel.app/)
[![Network](https://img.shields.io/badge/Network-Stellar_Testnet-blue?style=for-the-badge)](https://stellar.org/)

---

## Architecture & Tech Stack

This project is a full-stack decentralized application (dApp) split into a Rust-based smart contract layer and a modern React frontend.

* **Frontend:** Next.js 15 (App Router), React, TypeScript.
* **Styling:** Tailwind CSS v4.
* **Blockchain Layer:** `@stellar/stellar-sdk` for RPC communication and XDR transaction assembly.
* **Smart Contracts:** Soroban / Rust (compiled to WebAssembly).
* **Wallet Integration:** Freighter Browser Extension.
* **Package Manager:** Yarn (Required for cross-platform Rust binary compilation in Tailwind v4).

---

## Tester's Guide (How to Use the Live App)

To interact with the live Testnet environment, users do not need traditional accounts or passwords. Instead, you must use a Stellar-compatible browser wallet.

**1. Install & Configure Freighter**
* Download the [Freighter Browser Extension](https://www.freighter.app/).
* Open the extension, navigate to **Settings (Gear Icon) -> Preferences -> Network**, and select **Testnet**.

**2. Fund Your Test Wallet**
* Copy your Freighter public key (starts with `G...`).
* Visit the [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#create-account) to instantly fund your wallet with 10,000 free Testnet XLM.

**3. Execution Lifecycle**
1. **Funder:** Connect to `/funder`, initialize an escrow with a Vendor and Beneficiary address, and deposit Native XLM. The state moves to `Pending`.
2. **Beneficiary:** Connect to `/beneficiary` and submit the cryptographic Proof Hash to confirm receipt of goods/services. The state moves to `Released`.
3. **Funder:** Return to `/funder` and execute the final payout, pushing the locked Native XLM directly to the Vendor's wallet.

---

## Local Development Setup

If you wish to clone this repository and run the Next.js frontend locally, follow these steps:

### Prerequisites
* Node.js v18.17+
* [Yarn](https://yarnpkg.com/) (`npm install -g yarn`)
* Freighter Wallet Extension

## Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/Chilundika/SmartProtocol-Zambia.git](https://github.com/Chilundika/SmartProtocol-Zambia.git)
   cd SmartProtocol-Zambia/frontend


## Install dependencies:
Note: You must use yarn instead of npm to ensure @tailwindcss/oxide downloads the correct OS-specific Rust binaries.

**Bash**
yarn install
Start the development server:

**Bash**
yarn dev
Open http://localhost:3000 with your browser to see the application.

## Engineering Notes & Workarounds
During development and deployment, several advanced Web3 and edge-runtime challenges were mitigated:

Stellar SDK & Turbopack Dual-Package Hazard: Implemented a re-hydration patch in stellarClient.ts (new Transaction(tx.toXDR())) to bypass instanceof memory reference bugs when compiling transaction XDR under Next.js Turbopack.

Soroban Enum Parsing: Created a client-side unwrap utility to format Rust contract Enums (which deserialize as single-item arrays like ["Locked"] via the RPC) into strictly typed TypeScript strings.

Tailwind v4 / Vercel Linux Compilation: Migrated the frontend package manager entirely from npm to Yarn to bypass the npm #4828 optional dependency bug, ensuring the lightningcss Linux binary successfully compiles on Vercel's build servers.

## Project Status & Acknowledgements

Developed by Chilundika as an official MVP. 

This project was built to demonstrate the practical, high-impact application of Soroban smart contracts and decentralized Web3 infrastructure in solving real-world agricultural and service subsidy challenges in Zambia.
