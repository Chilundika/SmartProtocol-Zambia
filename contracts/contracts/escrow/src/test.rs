#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env};

/// Shared test harness: registers contract, Native XLM SAC, and mints to funder.
struct EscrowHarness {
    env: Env,
    client: EscrowFactoryContractClient<'static>,
    funder: Address,
    vendor: Address,
    beneficiary: Address,
    native_xlm: Address,
    amount: i128,
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
        }
    }

    fn init_locked(&self) {
        self.client.init_escrow(
            &self.funder,
            &self.native_xlm,
            &self.vendor,
            &self.beneficiary,
            &self.amount,
        );
    }

    fn fund(&self) {
        self.client
            .fund_escrow(&self.funder, &self.beneficiary, &self.amount);
    }

    fn submit_valid_proof(&self) {
        let proof_hash = BytesN::from_array(&self.env, &[1u8; 32]);
        self.client
            .submit_proof(&self.beneficiary, &self.beneficiary, &proof_hash);
    }

    fn to_pending(&self) {
        self.init_locked();
        self.fund();
    }

    fn to_released(&self) {
        self.to_pending();
        self.submit_valid_proof();
    }
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

#[test]
fn happy_path_fund_sign_release() {
    let h = EscrowHarness::new();

    h.init_locked();
    let locked = h.client.get_escrow(&h.beneficiary).unwrap();
    assert_eq!(locked.status, EscrowStatus::Locked);
    assert_eq!(locked.amount, h.amount);

    h.fund();
    let pending = h.client.get_escrow(&h.beneficiary).unwrap();
    assert_eq!(pending.status, EscrowStatus::Pending);

    h.submit_valid_proof();
    let released = h.client.get_escrow(&h.beneficiary).unwrap();
    assert_eq!(released.status, EscrowStatus::Released);
    assert_eq!(released.amount, h.amount);

    h.client.release_funds(&h.funder, &h.beneficiary);

    let final_state = h.client.get_escrow(&h.beneficiary).unwrap();
    assert_eq!(final_state.status, EscrowStatus::Released);
    assert_eq!(final_state.amount, 0);

    let token_client = token::Client::new(&h.env, &h.native_xlm);
    assert_eq!(token_client.balance(&h.vendor), h.amount);
}

// ---------------------------------------------------------------------------
// init_escrow negative paths
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "amount must be positive")]
fn init_escrow_rejects_zero_amount() {
    let h = EscrowHarness::new();
    h.client.init_escrow(
        &h.funder,
        &h.native_xlm,
        &h.vendor,
        &h.beneficiary,
        &0,
    );
}

#[test]
#[should_panic(expected = "escrow already exists for recipient")]
fn init_escrow_rejects_duplicate_recipient() {
    let h = EscrowHarness::new();
    h.init_locked();
    h.client.init_escrow(
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
fn fund_escrow_rejects_unknown_recipient() {
    let h = EscrowHarness::new();
    let stranger = Address::generate(&h.env);
    h.client.fund_escrow(&h.funder, &stranger, &h.amount);
}

#[test]
#[should_panic(expected = "only funder can fund this escrow")]
fn fund_escrow_rejects_wrong_funder() {
    let h = EscrowHarness::new();
    h.init_locked();
    let impostor = Address::generate(&h.env);
    h.client
        .fund_escrow(&impostor, &h.beneficiary, &h.amount);
}

#[test]
#[should_panic(expected = "amount mismatch")]
fn fund_escrow_rejects_wrong_amount() {
    let h = EscrowHarness::new();
    h.init_locked();
    h.client
        .fund_escrow(&h.funder, &h.beneficiary, &(h.amount - 1));
}

#[test]
#[should_panic(expected = "escrow must be Locked")]
fn fund_escrow_rejects_double_funding() {
    let h = EscrowHarness::new();
    h.to_pending();
    h.client
        .fund_escrow(&h.funder, &h.beneficiary, &h.amount);
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
    h.client
        .submit_proof(&impostor, &h.beneficiary, &proof_hash);
}

#[test]
#[should_panic(expected = "proof_hash required")]
fn submit_proof_rejects_zero_hash() {
    let h = EscrowHarness::new();
    h.to_pending();
    let zero = BytesN::from_array(&h.env, &[0u8; 32]);
    h.client
        .submit_proof(&h.beneficiary, &h.beneficiary, &zero);
}

#[test]
#[should_panic(expected = "escrow must be Pending")]
fn submit_proof_rejects_before_funding() {
    let h = EscrowHarness::new();
    h.init_locked();
    let proof_hash = BytesN::from_array(&h.env, &[3u8; 32]);
    h.client
        .submit_proof(&h.beneficiary, &h.beneficiary, &proof_hash);
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
    h.client.release_funds(&attacker, &h.beneficiary);
}

#[test]
#[should_panic(expected = "escrow must be Released (proof submitted)")]
fn release_funds_rejects_before_proof() {
    let h = EscrowHarness::new();
    h.to_pending();
    h.client.release_funds(&h.funder, &h.beneficiary);
}

#[test]
#[should_panic(expected = "escrow must be Released (proof submitted)")]
fn release_funds_rejects_when_only_locked() {
    let h = EscrowHarness::new();
    h.init_locked();
    h.client.release_funds(&h.funder, &h.beneficiary);
}

#[test]
#[should_panic(expected = "escrow already paid out")]
fn release_funds_rejects_empty_escrow() {
    let h = EscrowHarness::new();
    h.to_released();
    h.client.release_funds(&h.funder, &h.beneficiary);
    // Second release: amount is 0 after first payout.
    h.client.release_funds(&h.funder, &h.beneficiary);
}

#[test]
#[should_panic(expected = "escrow not found")]
fn release_funds_rejects_unknown_recipient() {
    let h = EscrowHarness::new();
    let stranger = Address::generate(&h.env);
    h.client.release_funds(&h.funder, &stranger);
}
