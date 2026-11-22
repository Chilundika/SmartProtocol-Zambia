#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token, Address, BytesN, Env, IntoVal,
};

const ESCROW_ID: u64 = 1;
const ESCROW_ID_2: u64 = 2;

/// Shared test harness: registers contract, Native XLM SAC, and mints to funder.
struct EscrowHarness {
    env: Env,
    client: EscrowFactoryContractClient<'static>,
    funder: Address,
    vendor: Address,
    beneficiary: Address,
    native_xlm: Address,
    amount: i128,
    escrow_id: u64,
}

impl EscrowHarness {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowFactoryContract, ());
        let client = EscrowFactoryContractClient::new(&env, &contract_id);

        let funder = Address::generate(&env);
        let vendor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let native_xlm = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();

        let amount: i128 = 1_000;
        let asset_client = token::StellarAssetClient::new(&env, &native_xlm);
        asset_client.mint(&funder, &amount);

        Self {
            env,
            client,
            funder,
            vendor,
            beneficiary,
            native_xlm,
            amount,
            escrow_id: ESCROW_ID,
        }
    }

    fn init_locked(&self) {
        self.client.init_escrow(
            &self.escrow_id,
            &self.funder,
            &self.native_xlm,
            &self.vendor,
            &self.beneficiary,
            &self.amount,
        );
    }

    fn fund(&self) {
        self.client
            .fund_escrow(&self.escrow_id, &self.funder, &self.amount);
    }

    fn submit_valid_proof(&self) {
        let proof_hash = BytesN::from_array(&self.env, &[1u8; 32]);
        self.client
            .submit_proof(&self.escrow_id, &self.beneficiary, &proof_hash);
    }

    fn to_pending(&self) {
        self.init_locked();
        self.fund();
    }

    fn to_released(&self) {
        self.to_pending();
        self.submit_valid_proof();
    }

    /// Replaces recording auth with an empty enforcing set.
    /// The next contract call has no signer authorization.
    fn enforce_no_auth(&self) {
        self.env.set_auths(&[]);
    }

    /// Authorizes `signer` for one invocation. A call that requires a
    /// different address fails that address's `require_auth`.
    fn authorize_other(
        &self,
        signer: &Address,
        fn_name: &str,
        args: soroban_sdk::Vec<soroban_sdk::Val>,
    ) {
        self.env.mock_auths(&[MockAuth {
            address: signer,
            invoke: &MockAuthInvoke {
                contract: &self.client.address,
                fn_name,
                args,
                sub_invokes: &[],
            },
        }]);
    }
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

#[test]
fn happy_path_fund_sign_release() {
    let h = EscrowHarness::new();

    h.init_locked();
    let locked = h.client.get_escrow(&h.escrow_id).unwrap();
    assert_eq!(locked.status, EscrowStatus::Locked);
    assert_eq!(locked.amount, h.amount);

    h.fund();
    let pending = h.client.get_escrow(&h.escrow_id).unwrap();
    assert_eq!(pending.status, EscrowStatus::Pending);

    h.submit_valid_proof();
    let released = h.client.get_escrow(&h.escrow_id).unwrap();
    assert_eq!(released.status, EscrowStatus::Released);
    assert_eq!(released.amount, h.amount);

    h.client.release_funds(&h.escrow_id, &h.funder);

    let final_state = h.client.get_escrow(&h.escrow_id).unwrap();
    assert_eq!(final_state.status, EscrowStatus::Released);
    assert_eq!(final_state.amount, 0);

    let token_client = token::Client::new(&h.env, &h.native_xlm);
    assert_eq!(token_client.balance(&h.vendor), h.amount);
}

#[test]
fn same_beneficiary_can_have_multiple_escrows() {
    let h = EscrowHarness::new();

    h.init_locked();
    h.client.init_escrow(
        &ESCROW_ID_2,
        &h.funder,
        &h.native_xlm,
        &h.vendor,
        &h.beneficiary,
        &h.amount,
    );

    let first = h.client.get_escrow(&ESCROW_ID).unwrap();
    let second = h.client.get_escrow(&ESCROW_ID_2).unwrap();

    assert_eq!(first.recipient, h.beneficiary);
    assert_eq!(second.recipient, h.beneficiary);
    assert_eq!(first.status, EscrowStatus::Locked);
    assert_eq!(second.status, EscrowStatus::Locked);
}

// ---------------------------------------------------------------------------
// init_escrow negative paths
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "amount must be positive")]
fn init_escrow_rejects_zero_amount() {
    let h = EscrowHarness::new();
    h.client.init_escrow(
        &h.escrow_id,
        &h.funder,
        &h.native_xlm,
        &h.vendor,
        &h.beneficiary,
        &0,
    );
}

#[test]
#[should_panic(expected = "escrow already exists for id")]
fn init_escrow_rejects_duplicate_id() {
    let h = EscrowHarness::new();
    h.init_locked();
    h.client.init_escrow(
        &h.escrow_id,
        &h.funder,
        &h.native_xlm,
        &h.vendor,
        &h.beneficiary,
        &h.amount,
    );
}

// ---------------------------------------------------------------------------
// fund_escrow negative paths
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "escrow not found")]
fn fund_escrow_rejects_unknown_id() {
    let h = EscrowHarness::new();
    h.client.fund_escrow(&999, &h.funder, &h.amount);
}

#[test]
#[should_panic(expected = "only funder can fund this escrow")]
fn fund_escrow_rejects_wrong_funder() {
    let h = EscrowHarness::new();
    h.init_locked();
    let impostor = Address::generate(&h.env);
    h.client.fund_escrow(&h.escrow_id, &impostor, &h.amount);
}

#[test]
#[should_panic(expected = "amount mismatch")]
fn fund_escrow_rejects_wrong_amount() {
    let h = EscrowHarness::new();
    h.init_locked();
    h.client
        .fund_escrow(&h.escrow_id, &h.funder, &(h.amount - 1));
}

#[test]
#[should_panic(expected = "escrow must be Locked")]
fn fund_escrow_rejects_double_funding() {
    let h = EscrowHarness::new();
    h.to_pending();
    h.client.fund_escrow(&h.escrow_id, &h.funder, &h.amount);
}

// ---------------------------------------------------------------------------
// submit_proof negative paths
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "only beneficiary can submit proof")]
fn submit_proof_rejects_wrong_beneficiary() {
    let h = EscrowHarness::new();
    h.to_pending();
    let impostor = Address::generate(&h.env);
    let proof_hash = BytesN::from_array(&h.env, &[2u8; 32]);
    h.client.submit_proof(&h.escrow_id, &impostor, &proof_hash);
}

#[test]
#[should_panic(expected = "proof_hash required")]
fn submit_proof_rejects_zero_hash() {
    let h = EscrowHarness::new();
    h.to_pending();
    let zero = BytesN::from_array(&h.env, &[0u8; 32]);
    h.client.submit_proof(&h.escrow_id, &h.beneficiary, &zero);
}

#[test]
#[should_panic(expected = "escrow must be Pending")]
fn submit_proof_rejects_before_funding() {
    let h = EscrowHarness::new();
    h.init_locked();
    let proof_hash = BytesN::from_array(&h.env, &[3u8; 32]);
    h.client.submit_proof(&h.escrow_id, &h.beneficiary, &proof_hash);
}

// ---------------------------------------------------------------------------
// release_funds negative paths
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "only funder can release funds")]
fn release_funds_rejects_unauthorized_address() {
    let h = EscrowHarness::new();
    h.to_released();
    let attacker = Address::generate(&h.env);
    h.client.release_funds(&h.escrow_id, &attacker);
}

#[test]
#[should_panic(expected = "escrow must be Released (proof submitted)")]
fn release_funds_rejects_before_proof() {
    let h = EscrowHarness::new();
    h.to_pending();
    h.client.release_funds(&h.escrow_id, &h.funder);
}

#[test]
#[should_panic(expected = "escrow must be Released (proof submitted)")]
fn release_funds_rejects_when_only_locked() {
    let h = EscrowHarness::new();
    h.init_locked();
    h.client.release_funds(&h.escrow_id, &h.funder);
}

#[test]
#[should_panic(expected = "escrow already paid out")]
fn release_funds_rejects_empty_escrow() {
    let h = EscrowHarness::new();
    h.to_released();
    h.client.release_funds(&h.escrow_id, &h.funder);
    h.client.release_funds(&h.escrow_id, &h.funder);
}

#[test]
#[should_panic(expected = "escrow not found")]
fn release_funds_rejects_unknown_id() {
    let h = EscrowHarness::new();
    h.client.release_funds(&999, &h.funder);
}

// ---------------------------------------------------------------------------
// Authorization. EscrowHarness::new() calls mock_all_auths() so setup can
// mint and move state. Each test then calls enforce_no_auth or
// authorize_other, which replaces that auth configuration before the call
// under test.
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn auth_init_escrow_rejects_missing_auth() {
    let h = EscrowHarness::new();
    h.enforce_no_auth();
    h.client.init_escrow(
        &h.escrow_id,
        &h.funder,
        &h.native_xlm,
        &h.vendor,
        &h.beneficiary,
        &h.amount,
    );
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn auth_init_escrow_rejects_other_signer() {
    let h = EscrowHarness::new();
    let impostor = Address::generate(&h.env);
    h.authorize_other(
        &impostor,
        "init_escrow",
        (
            h.escrow_id,
            h.funder.clone(),
            h.native_xlm.clone(),
            h.vendor.clone(),
            h.beneficiary.clone(),
            h.amount,
        )
            .into_val(&h.env),
    );
    h.client.init_escrow(
        &h.escrow_id,
        &h.funder,
        &h.native_xlm,
        &h.vendor,
        &h.beneficiary,
        &h.amount,
    );
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn auth_fund_escrow_rejects_missing_auth() {
    let h = EscrowHarness::new();
    h.init_locked();
    h.enforce_no_auth();
    h.client
        .fund_escrow(&h.escrow_id, &h.funder, &h.amount);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn auth_fund_escrow_rejects_other_signer() {
    let h = EscrowHarness::new();
    h.init_locked();
    let impostor = Address::generate(&h.env);
    h.authorize_other(
        &impostor,
        "fund_escrow",
        (h.escrow_id, h.funder.clone(), h.amount).into_val(&h.env),
    );
    h.client
        .fund_escrow(&h.escrow_id, &h.funder, &h.amount);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn auth_submit_proof_rejects_missing_auth() {
    let h = EscrowHarness::new();
    h.to_pending();
    h.enforce_no_auth();
    let proof_hash = BytesN::from_array(&h.env, &[1u8; 32]);
    h.client
        .submit_proof(&h.escrow_id, &h.beneficiary, &proof_hash);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn auth_submit_proof_rejects_other_signer() {
    let h = EscrowHarness::new();
    h.to_pending();
    let impostor = Address::generate(&h.env);
    let proof_hash = BytesN::from_array(&h.env, &[1u8; 32]);
    h.authorize_other(
        &impostor,
        "submit_proof",
        (h.escrow_id, h.beneficiary.clone(), proof_hash.clone()).into_val(&h.env),
    );
    h.client
        .submit_proof(&h.escrow_id, &h.beneficiary, &proof_hash);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn auth_release_funds_rejects_missing_auth() {
    let h = EscrowHarness::new();
    h.to_released();
    h.enforce_no_auth();
    h.client.release_funds(&h.escrow_id, &h.funder);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn auth_release_funds_rejects_other_signer() {
    let h = EscrowHarness::new();
    h.to_released();
    let impostor = Address::generate(&h.env);
    h.authorize_other(
        &impostor,
        "release_funds",
        (h.escrow_id, h.funder.clone()).into_val(&h.env),
    );
    h.client.release_funds(&h.escrow_id, &h.funder);
}

/// `get_escrow` has no `require_auth`. A read still returns the stored record
/// when the environment is in enforcing mode with no authorizations.
#[test]
fn auth_get_escrow_returns_record_without_auth() {
    let h = EscrowHarness::new();
    h.init_locked();
    h.enforce_no_auth();
    let escrow = h.client.get_escrow(&h.escrow_id).unwrap();
    assert_eq!(escrow.funder, h.funder);
    assert_eq!(escrow.vendor, h.vendor);
    assert_eq!(escrow.recipient, h.beneficiary);
    assert_eq!(escrow.amount, h.amount);
    assert_eq!(escrow.status, EscrowStatus::Locked);
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "amount must be positive")]
fn input_init_escrow_rejects_negative_amount() {
    let h = EscrowHarness::new();
    h.client.init_escrow(
        &h.escrow_id,
        &h.funder,
        &h.native_xlm,
        &h.vendor,
        &h.beneficiary,
        &-1,
    );
}

#[test]
#[should_panic(expected = "native_xlm_token mismatch")]
fn input_init_escrow_rejects_native_token_mismatch() {
    let h = EscrowHarness::new();
    h.init_locked();
    let other_admin = Address::generate(&h.env);
    let other_token = h
        .env
        .register_stellar_asset_contract_v2(other_admin)
        .address();
    h.client.init_escrow(
        &ESCROW_ID_2,
        &h.funder,
        &other_token,
        &h.vendor,
        &h.beneficiary,
        &h.amount,
    );
}

#[test]
#[should_panic(expected = "amount mismatch")]
fn input_fund_escrow_rejects_negative_amount() {
    let h = EscrowHarness::new();
    h.init_locked();
    h.client.fund_escrow(&h.escrow_id, &h.funder, &-1);
}

#[test]
#[should_panic(expected = "escrow not found")]
fn input_submit_proof_rejects_unknown_id() {
    let h = EscrowHarness::new();
    let proof_hash = BytesN::from_array(&h.env, &[5u8; 32]);
    h.client
        .submit_proof(&999, &h.beneficiary, &proof_hash);
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

#[test]
fn state_get_escrow_unknown_id_returns_none() {
    let h = EscrowHarness::new();
    h.init_locked();
    assert!(h.client.get_escrow(&999).is_none());
    assert!(h.client.get_escrow(&h.escrow_id).is_some());
}

#[test]
#[should_panic(expected = "escrow must be Locked")]
fn state_fund_escrow_rejects_after_release() {
    let h = EscrowHarness::new();
    h.to_released();
    h.client
        .fund_escrow(&h.escrow_id, &h.funder, &h.amount);
}

#[test]
#[should_panic(expected = "escrow must be Pending")]
fn state_submit_proof_rejects_after_payout() {
    let h = EscrowHarness::new();
    h.to_released();
    h.client.release_funds(&h.escrow_id, &h.funder);
    let proof_hash = BytesN::from_array(&h.env, &[6u8; 32]);
    h.client
        .submit_proof(&h.escrow_id, &h.beneficiary, &proof_hash);
}

#[test]
fn state_get_escrow_after_payout_is_released_with_zero_amount() {
    let h = EscrowHarness::new();
    h.to_released();
    h.client.release_funds(&h.escrow_id, &h.funder);

    let stored = h.client.get_escrow(&h.escrow_id).unwrap();
    assert_eq!(stored.status, EscrowStatus::Released);
    assert_eq!(stored.amount, 0);
    assert_eq!(stored.funder, h.funder);
    assert_eq!(stored.vendor, h.vendor);
    assert_eq!(stored.recipient, h.beneficiary);
}

/// Two non-zero hashes leave stored records that compare equal. `EscrowData`
/// has no proof-hash field, so the hash used is not retained.
#[test]
fn state_submit_proof_distinct_hashes_store_equal_records() {
    let h = EscrowHarness::new();
    h.to_pending();
    let hash_a = BytesN::from_array(&h.env, &[1u8; 32]);
    h.client
        .submit_proof(&h.escrow_id, &h.beneficiary, &hash_a);

    h.client.init_escrow(
        &ESCROW_ID_2,
        &h.funder,
        &h.native_xlm,
        &h.vendor,
        &h.beneficiary,
        &h.amount,
    );
    // The harness mints one escrow amount. Fund the second escrow from a second mint.
    let asset_client = token::StellarAssetClient::new(&h.env, &h.native_xlm);
    asset_client.mint(&h.funder, &h.amount);
    h.client
        .fund_escrow(&ESCROW_ID_2, &h.funder, &h.amount);
    let hash_b = BytesN::from_array(&h.env, &[9u8; 32]);
    h.client
        .submit_proof(&ESCROW_ID_2, &h.beneficiary, &hash_b);

    let first = h.client.get_escrow(&ESCROW_ID).unwrap();
    let second = h.client.get_escrow(&ESCROW_ID_2).unwrap();
    assert_ne!(hash_a, hash_b);
    assert_eq!(first, second);
    assert_eq!(first.status, EscrowStatus::Released);
    assert_eq!(first.amount, h.amount);
}

// ---------------------------------------------------------------------------
// Duplicate operations
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "escrow must be Pending")]
fn dup_submit_proof_rejects_second_proof() {
    let h = EscrowHarness::new();
    h.to_released();
    let proof_hash = BytesN::from_array(&h.env, &[7u8; 32]);
    h.client
        .submit_proof(&h.escrow_id, &h.beneficiary, &proof_hash);
}

#[test]
fn dup_get_escrow_second_read_matches_first() {
    let h = EscrowHarness::new();
    h.init_locked();
    let first = h.client.get_escrow(&h.escrow_id).unwrap();
    let second = h.client.get_escrow(&h.escrow_id).unwrap();
    assert_eq!(first, second);
}
