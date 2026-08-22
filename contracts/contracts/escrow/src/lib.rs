#![no_std]

mod test;

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Escrow(u64),
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

/// Escrow record stored at `DataKey::Escrow(escrow_id)`.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct EscrowData {
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
    /// Creates a new escrow entry keyed by `escrow_id`.
    ///
    /// Security:
    /// - `funder.require_auth()` ensures only the declared funder can initialize.
    /// - Rejects duplicate escrows for the same `escrow_id`.
    /// - Locks the Native XLM SAC address on first use to prevent token substitution.
    pub fn init_escrow(
        env: Env,
        escrow_id: u64,
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

        let escrow_key = DataKey::Escrow(escrow_id);
        if storage.has(&escrow_key) {
            panic!("escrow already exists for id");
        }

        storage.set(
            &escrow_key,
            &EscrowData {
                funder: funder.clone(),
                vendor,
                amount,
                status: EscrowStatus::Locked,
                recipient,
            },
        );
    }

    /// Deposits Native XLM into this contract for a specific escrow.
    ///
    /// Security:
    /// - Only the stored `funder` may call this function (`funder.require_auth()`).
    /// - Enforces `Locked -> Pending` (funds must not be deposited twice).
    pub fn fund_escrow(env: Env, escrow_id: u64, funder: Address, amount: i128) {
        funder.require_auth();

        let storage = env.storage().instance();
        let escrow_key = DataKey::Escrow(escrow_id);
        let mut escrow: EscrowData = storage
            .get(&escrow_key)
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
        storage.set(&escrow_key, &escrow);
    }

    /// Beneficiary (farmer) triggers milestone sign-off for a specific escrow.
    ///
    /// Security:
    /// - Only the stored `recipient` may call (`beneficiary.require_auth()`).
    /// - Enforces `Pending -> Released` (proof only after funding).
    pub fn submit_proof(
        env: Env,
        escrow_id: u64,
        beneficiary: Address,
        proof_hash: BytesN<32>,
    ) {
        beneficiary.require_auth();

        let storage = env.storage().instance();
        let escrow_key = DataKey::Escrow(escrow_id);
        let mut escrow: EscrowData = storage
            .get(&escrow_key)
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
        storage.set(&escrow_key, &escrow);
    }

    /// Sends locked Native XLM to the vendor after proof submission.
    ///
    /// Security:
    /// - Only the escrow `funder` may release (`funder.require_auth()`).
    /// - Requires `Released` status (proof already submitted by beneficiary).
    /// - Clears `amount` after transfer to prevent double-spend on re-entry.
    pub fn release_funds(env: Env, escrow_id: u64, funder: Address) {
        funder.require_auth();

        let storage = env.storage().instance();
        let escrow_key = DataKey::Escrow(escrow_id);
        let mut escrow: EscrowData = storage
            .get(&escrow_key)
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
        storage.set(&escrow_key, &escrow);
    }

    pub fn get_escrow(env: Env, escrow_id: u64) -> Option<EscrowData> {
        env.storage().instance().get(&DataKey::Escrow(escrow_id))
    }

    fn native_xlm_token(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::NativeXlmToken)
            .unwrap_or_else(|| panic!("native_xlm_token not initialized"))
    }
}
