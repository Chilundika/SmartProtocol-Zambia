#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env};

#[test]
fn vmp_escrow_happy_path() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(EscrowFactoryContract, ());
    let client = EscrowFactoryContractClient::new(&env, &contract_id);

    let funder = Address::generate(&env);
    let vendor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let native_xlm = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let amount: i128 = 1_000;
    let asset_client = token::StellarAssetClient::new(&env, &native_xlm);
    asset_client.mint(&funder, &amount);

    client.init_escrow(
        &funder,
        &native_xlm,
        &vendor,
        &beneficiary,
        &amount,
    );

    client.fund_escrow(&funder, &beneficiary, &amount);

    let proof_hash = BytesN::from_array(&env, &[1u8; 32]);
    client.submit_proof(&beneficiary, &beneficiary, &proof_hash);

    client.release_funds(&funder, &beneficiary);

    let escrow = client.get_escrow(&beneficiary).unwrap();
    assert_eq!(escrow.amount, 0);
    assert_eq!(escrow.status, EscrowStatus::Released);
}
