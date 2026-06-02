use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Map};

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Escrows,
    NativeXlmToken,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum EscrowStatus {
    Locked,
    Pending,
    Released,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Escrow {
    pub funder: Address,
    pub vendor: Address,
    pub amount: i128,
    pub status: EscrowStatus,
    pub recipient: Address,
}

#[contract]
pub struct EscrowFactoryContract;

#[contractimpl]
impl EscrowFactoryContract {
    pub fn init(env: Env, native_xlm_token: Address) {
        if env.storage().instance().has(&DataKey::NativeXlmToken) {
            panic!("already initialized");
        }
        env.storage()
            .instance()
            .set(&DataKey::NativeXlmToken, &native_xlm_token);
    }

    pub fn fund_escrow(
        env: Env,
        funder: Address,
        vendor: Address,
        recipient: Address,
        amount: i128,
    ) {
        funder.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }

        let mut escrows = Self::escrows_or_default(&env);
        if escrows.contains_key(recipient.clone()) {
            panic!("escrow already exists for recipient");
        }

        // fund_escrow logic:
        // 1) Authenticate the funder and validate amount.
        // 2) Move Native XLM (via SAC token client) from funder -> this contract.
        // 3) Persist a new escrow in a factory map keyed by recipient address.
        let native_xlm_token = Self::native_xlm_token(&env);
        let token_client = token::Client::new(&env, &native_xlm_token);
        token_client.transfer(&funder, &env.current_contract_address(), &amount);

        let escrow = Escrow {
            funder,
            vendor,
            amount,
            status: EscrowStatus::Locked,
            recipient: recipient.clone(),
        };
        escrows.set(recipient, escrow);
        env.storage().instance().set(&DataKey::Escrows, &escrows);
    }

    pub fn submit_proof(env: Env, vendor: Address, recipient: Address) {
        vendor.require_auth();
        let mut escrows = Self::escrows_or_default(&env);
        let mut escrow = escrows
            .get(recipient.clone())
            .unwrap_or_else(|| panic!("escrow not found"));

        if escrow.vendor != vendor {
            panic!("only vendor can submit proof");
        }
        if escrow.status != EscrowStatus::Locked {
            panic!("invalid escrow state");
        }

        // submit_proof logic:
        // 1) Vendor signs this call to prove milestone submission intent.
        // 2) Escrow moves from Locked -> Pending, awaiting final release action.
        // 3) No payout happens here, reducing accidental/early fund movement risk.
        escrow.status = EscrowStatus::Pending;
        escrows.set(recipient, escrow);
        env.storage().instance().set(&DataKey::Escrows, &escrows);
    }

    pub fn release_escrow(env: Env, funder: Address, recipient: Address) {
        funder.require_auth();
        let mut escrows = Self::escrows_or_default(&env);
        let mut escrow = escrows
            .get(recipient.clone())
            .unwrap_or_else(|| panic!("escrow not found"));

        if escrow.funder != funder {
            panic!("only funder can release");
        }
        if escrow.status != EscrowStatus::Pending {
            panic!("escrow must be pending");
        }

        let native_xlm_token = Self::native_xlm_token(&env);
        let token_client = token::Client::new(&env, &native_xlm_token);
        token_client.transfer(&env.current_contract_address(), &escrow.recipient, &escrow.amount);

        escrow.status = EscrowStatus::Released;
        escrows.set(recipient, escrow);
        env.storage().instance().set(&DataKey::Escrows, &escrows);
    }

    pub fn get_escrow(env: Env, recipient: Address) -> Option<Escrow> {
        let escrows = Self::escrows_or_default(&env);
        escrows.get(recipient)
    }

    fn native_xlm_token(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::NativeXlmToken)
            .unwrap_or_else(|| panic!("not initialized"))
    }

    fn escrows_or_default(env: &Env) -> Map<Address, Escrow> {
        env.storage()
            .instance()
            .get(&DataKey::Escrows)
            .unwrap_or_else(|| Map::new(env))
    }
}
