#![no_std]

mod test;

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env, Map};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Escrows,
    NativeXlmToken,
}

// ---------------------------------------------------------------------------
// Escrow state model
// ---------------------------------------------------------------------------

/// VMP lifecycle for the MVP:
/// - `Locked`: escrow created, awaiting Native XLM deposit
/// - `Pending`: funds deposited, awaiting beneficiary cryptographic sign-off
/// - `Released`: proof accepted, ready for funder to pay the vendor
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum EscrowStatus {
    Locked,
    Pending,
    Released,
}

/// Factory record stored in `Map<Address, Escrow>` keyed by `recipient`
/// (beneficiary / farmer).
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Escrow {
    pub funder: Address,
    pub vendor: Address,
    pub amount: i128,
    pub status: EscrowStatus,
    pub recipient: Address,
}

// ---------------------------------------------------------------------------
// Escrow factory contract
// ---------------------------------------------------------------------------

#[contract]
pub struct EscrowFactoryContract;

#[contractimpl]
impl EscrowFactoryContract {
    /// Creates a new escrow entry in the factory map.
    ///
    /// Security:
    /// - `funder.require_auth()` ensures only the declared funder can initialize.
    /// - Rejects duplicate escrows for the same `recipient`.
    /// - Locks the Native XLM SAC address on first use to prevent token substitution.
    pub fn init_escrow(
        env: Env,
        funder: Address,
        native_xlm_token: Address,
        vendor: Address,
        recipient: Address,
        amount: i128,
    ) {
        funder.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let storage = env.storage().instance();
        if storage.has(&DataKey::NativeXlmToken) {
            let existing: Address = storage
                .get(&DataKey::NativeXlmToken)
                .unwrap_or_else(|| panic!("native token missing"));
            if existing != native_xlm_token {
                panic!("native_xlm_token mismatch");
            }
        } else {
            storage.set(&DataKey::NativeXlmToken, &native_xlm_token);
        }

        let mut escrows = Self::escrows_or_default(&env);
        if escrows.contains_key(recipient.clone()) {
            panic!("escrow already exists for recipient");
        }

        escrows.set(
            recipient.clone(),
            Escrow {
                funder: funder.clone(),
                vendor,
                amount,
                status: EscrowStatus::Locked,
                recipient,
            },
        );
        storage.set(&DataKey::Escrows, &escrows);
    }

    /// Deposits Native XLM into this contract for a specific escrow.
    ///
    /// Security:
    /// - Only the stored `funder` may call this function (`funder.require_auth()`).
    /// - Enforces `Locked -> Pending` (funds must not be deposited twice).
    ///
    /// `fund_escrow` logic:
    /// 1) Authenticate the funder and load the escrow by `recipient`.
    /// 2) Validate amount and state (`Locked`).
    /// 3) Transfer Native XLM (SAC) from funder -> contract via `token::Client`.
    /// 4) Move status to `Pending` so the beneficiary can submit proof.
    pub fn fund_escrow(env: Env, funder: Address, recipient: Address, amount: i128) {
        funder.require_auth();

        let mut escrows = Self::escrows_or_default(&env);
        let mut escrow = escrows
            .get(recipient.clone())
            .unwrap_or_else(|| panic!("escrow not found"));

        if escrow.funder != funder {
            panic!("only funder can fund this escrow");
        }
        if escrow.status != EscrowStatus::Locked {
            panic!("escrow must be Locked");
        }
        if amount <= 0 || amount != escrow.amount {
            panic!("amount mismatch");
        }

        let native_xlm_token = Self::native_xlm_token(&env);
        let token_client = token::Client::new(&env, &native_xlm_token);
        token_client.transfer(&funder, &env.current_contract_address(), &amount);

        escrow.status = EscrowStatus::Pending;
        escrows.set(recipient, escrow);
        env.storage().instance().set(&DataKey::Escrows, &escrows);
    }

    /// Beneficiary (farmer) triggers milestone sign-off.
    ///
    /// Security:
    /// - Only `beneficiary` matching `escrow.recipient` may call
    ///   (`beneficiary.require_auth()`).
    /// - Enforces `Pending -> Released` (proof only after funding).
    ///
    /// `submit_proof` logic:
    /// 1) Authenticate the beneficiary and load the escrow.
    /// 2) Require escrow to be `Pending` (funds already locked in contract).
    /// 3) MVP: accept a non-zero `proof_hash` as cryptographic sign-off placeholder.
    /// 4) Mark escrow `Released` so the funder can execute payout to vendor.
    pub fn submit_proof(
        env: Env,
        beneficiary: Address,
        recipient: Address,
        proof_hash: BytesN<32>,
    ) {
        beneficiary.require_auth();

        let mut escrows = Self::escrows_or_default(&env);
        let mut escrow = escrows
            .get(recipient.clone())
            .unwrap_or_else(|| panic!("escrow not found"));

        if escrow.recipient != beneficiary {
            panic!("only beneficiary can submit proof");
        }
        if escrow.status != EscrowStatus::Pending {
            panic!("escrow must be Pending");
        }

        let zero = BytesN::<32>::from_array(&env, &[0u8; 32]);
        if proof_hash == zero {
            panic!("proof_hash required");
        }

        escrow.status = EscrowStatus::Released;
        escrows.set(recipient, escrow);
        env.storage().instance().set(&DataKey::Escrows, &escrows);
    }

    /// Sends locked Native XLM to the vendor after proof submission.
    ///
    /// Security:
    /// - Only the escrow `funder` may release (`funder.require_auth()`).
    /// - Requires `Released` status (proof already submitted by beneficiary).
    /// - Clears `amount` after transfer to prevent double-spend on re-entry.
    ///
    /// `release_funds` logic:
    /// 1) Authenticate funder and verify escrow is `Released`.
    /// 2) Transfer Native XLM from contract -> `vendor`.
    /// 3) Zero out `amount` as an idempotency guard.
    pub fn release_funds(env: Env, funder: Address, recipient: Address) {
        funder.require_auth();

        let mut escrows = Self::escrows_or_default(&env);
        let mut escrow = escrows
            .get(recipient.clone())
            .unwrap_or_else(|| panic!("escrow not found"));

        if escrow.funder != funder {
            panic!("only funder can release funds");
        }
        if escrow.status != EscrowStatus::Released {
            panic!("escrow must be Released (proof submitted)");
        }
        if escrow.amount <= 0 {
            panic!("escrow already paid out");
        }

        let payout = escrow.amount;
        let native_xlm_token = Self::native_xlm_token(&env);
        let token_client = token::Client::new(&env, &native_xlm_token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.vendor,
            &payout,
        );

        escrow.amount = 0;
        escrows.set(recipient, escrow);
        env.storage().instance().set(&DataKey::Escrows, &escrows);
    }

    pub fn get_escrow(env: Env, recipient: Address) -> Option<Escrow> {
        Self::escrows_or_default(&env).get(recipient)
    }

    fn native_xlm_token(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::NativeXlmToken)
            .unwrap_or_else(|| panic!("native_xlm_token not initialized"))
    }

    fn escrows_or_default(env: &Env) -> Map<Address, Escrow> {
        env.storage()
            .instance()
            .get(&DataKey::Escrows)
            .unwrap_or_else(|| Map::new(env))
    }
}
