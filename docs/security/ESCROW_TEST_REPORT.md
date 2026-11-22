# Escrow contract test report

Recorded from `sprint/instawards`. `contracts/contracts/escrow/src/lib.rs` was not modified. No test showed the contract accepting a call it should reject.

## How to reproduce

From the repository root:

```
cargo test --manifest-path contracts/Cargo.toml
```

Toolchain used for the run below:

| Tool | Version |
|---|---|
| cargo | 1.96.0 (30a34c682 2026-05-25) |
| rustc | 1.96.0 (ac68faa20 2026-05-25) |
| soroban-sdk | 23.5.3 (`contracts/Cargo.lock`) |

The escrow crate runs with `soroban-sdk` feature `testutils` (`contracts/contracts/escrow/Cargo.toml`). Tests execute in the Soroban host inside the process. They do not submit transactions to Testnet and do not call the deployed contract.

Result of that command:

- `escrow`: 36 passed, 0 failed, 0 ignored
- `hello_world`: 1 passed (`test::placeholder`), 0 failed

`hello_world` is the workspace placeholder. It is not an escrow test and is not in the tables below.

## Results

The 16 tests that were already in `contracts/contracts/escrow/src/test.rs` are unchanged. They construct `EscrowHarness::new()`, which calls `env.mock_all_auths()`. Their panics are contract `panic!` strings. They do not prove `require_auth`.

Each new `auth_*` failure test starts with `EscrowHarness::new()`, which calls `env.mock_all_auths()` for setup. Before the call under test, the test replaces that configuration with `set_auths(&[])` or with `mock_auths` for a different address. The call under test then panics with a host error whose text contains `HostError: Error(Auth, InvalidAction)`.

| Test | Function | Category | What it proves | Result |
|---|---|---|---|---|
| `happy_path_fund_sign_release` | `init_escrow`, `fund_escrow`, `submit_proof`, `release_funds`, `get_escrow` | state transition | Locked, then Pending, then Released with the original amount, then Released with amount 0. Vendor token balance equals the escrow amount. | passed |
| `same_beneficiary_can_have_multiple_escrows` | `init_escrow` | state transition | Two ids for the same recipient both stay Locked. | passed |
| `init_escrow_rejects_zero_amount` | `init_escrow` | input validation | Amount `0` panics `amount must be positive`. | passed |
| `init_escrow_rejects_duplicate_id` | `init_escrow` | duplicate operation | A second `init_escrow` for the same id panics `escrow already exists for id`. | passed |
| `fund_escrow_rejects_unknown_id` | `fund_escrow` | state transition | Id `999` with no stored escrow panics `escrow not found`. | passed |
| `fund_escrow_rejects_wrong_funder` | `fund_escrow` | authorization | Under `mock_all_auths`, an address argument other than the stored funder panics `only funder can fund this escrow`. This is the stored-address check, not `require_auth`. | passed |
| `fund_escrow_rejects_wrong_amount` | `fund_escrow` | input validation | Amount `escrow.amount - 1` panics `amount mismatch`. | passed |
| `fund_escrow_rejects_double_funding` | `fund_escrow` | duplicate operation | A second fund while status is Pending panics `escrow must be Locked`. | passed |
| `submit_proof_rejects_wrong_beneficiary` | `submit_proof` | authorization | Under `mock_all_auths`, an address argument other than the stored recipient panics `only beneficiary can submit proof`. This is the stored-address check, not `require_auth`. | passed |
| `submit_proof_rejects_zero_hash` | `submit_proof` | input validation | A 32-byte zero hash panics `proof_hash required`. | passed |
| `submit_proof_rejects_before_funding` | `submit_proof` | state transition | Proof while status is Locked panics `escrow must be Pending`. | passed |
| `release_funds_rejects_unauthorized_address` | `release_funds` | authorization | Under `mock_all_auths`, an address argument other than the stored funder panics `only funder can release funds`. This is the stored-address check, not `require_auth`. | passed |
| `release_funds_rejects_before_proof` | `release_funds` | state transition | Release while status is Pending panics `escrow must be Released (proof submitted)`. | passed |
| `release_funds_rejects_when_only_locked` | `release_funds` | state transition | Release while status is Locked panics `escrow must be Released (proof submitted)`. | passed |
| `release_funds_rejects_empty_escrow` | `release_funds` | duplicate operation | A second release, after amount has been set to 0, panics `escrow already paid out`. | passed |
| `release_funds_rejects_unknown_id` | `release_funds` | state transition | Id `999` with no stored escrow panics `escrow not found`. | passed |
| `auth_init_escrow_rejects_missing_auth` | `init_escrow` | authorization | With enforcing auth and no authorization entries, `init_escrow` panics `HostError: Error(Auth, InvalidAction)`. | passed |
| `auth_init_escrow_rejects_other_signer` | `init_escrow` | authorization | Authorizing a different address for that call panics with text containing `HostError: Error(Auth, InvalidAction)`. | passed |
| `auth_fund_escrow_rejects_missing_auth` | `fund_escrow` | authorization | After a Locked escrow exists, funding with no authorization entries panics `HostError: Error(Auth, InvalidAction)`. | passed |
| `auth_fund_escrow_rejects_other_signer` | `fund_escrow` | authorization | Authorizing a different address for `fund_escrow` panics with text containing `HostError: Error(Auth, InvalidAction)`. | passed |
| `auth_submit_proof_rejects_missing_auth` | `submit_proof` | authorization | After Pending, proof with no authorization entries panics `HostError: Error(Auth, InvalidAction)`. | passed |
| `auth_submit_proof_rejects_other_signer` | `submit_proof` | authorization | Authorizing a different address for `submit_proof` panics with text containing `HostError: Error(Auth, InvalidAction)`. | passed |
| `auth_release_funds_rejects_missing_auth` | `release_funds` | authorization | After Released, release with no authorization entries panics `HostError: Error(Auth, InvalidAction)`. | passed |
| `auth_release_funds_rejects_other_signer` | `release_funds` | authorization | Authorizing a different address for `release_funds` panics with text containing `HostError: Error(Auth, InvalidAction)`. | passed |
| `auth_get_escrow_returns_record_without_auth` | `get_escrow` | authorization | With enforcing auth and no authorization entries, `get_escrow` still returns the stored funder, vendor, recipient, amount, and Locked status. The function has no `require_auth`. | passed |
| `input_init_escrow_rejects_negative_amount` | `init_escrow` | input validation | Amount `-1` panics `amount must be positive`. | passed |
| `input_init_escrow_rejects_native_token_mismatch` | `init_escrow` | input validation | After the first init stores a SAC address, init of a second id with a different SAC panics `native_xlm_token mismatch`. | passed |
| `input_fund_escrow_rejects_negative_amount` | `fund_escrow` | input validation | Funding a Locked escrow with amount `-1` panics `amount mismatch`. | passed |
| `input_submit_proof_rejects_unknown_id` | `submit_proof` | input validation | Proof for id `999` with nothing stored panics `escrow not found`. | passed |
| `state_get_escrow_unknown_id_returns_none` | `get_escrow` | state transition | Id `999` returns `None` while the created id still returns `Some`. | passed |
| `state_fund_escrow_rejects_after_release` | `fund_escrow` | state transition | Funding again after proof, while status is Released and amount is still the original amount, panics `escrow must be Locked`. | passed |
| `state_submit_proof_rejects_after_payout` | `submit_proof` | state transition | A non-zero proof after payout is rejected with `escrow must be Pending`. | passed |
| `state_get_escrow_after_payout_is_released_with_zero_amount` | `get_escrow` | state transition | After `release_funds`, the stored record is still present, status is Released, and amount is 0. Funder, vendor, and recipient are unchanged. | passed |
| `state_submit_proof_distinct_hashes_store_equal_records` | `submit_proof` | state transition | Two different non-zero hashes on two escrows leave `EscrowData` values that compare equal: Released and the original amount. The stored record does not retain which hash was submitted. | passed |
| `dup_submit_proof_rejects_second_proof` | `submit_proof` | duplicate operation | A second non-zero proof after status is Released, before payout, panics `escrow must be Pending`. | passed |
| `dup_get_escrow_second_read_matches_first` | `get_escrow` | duplicate operation | Two reads of the same id return equal `EscrowData`. | passed |

## Coverage matrix

Each cell names the tests that cover it. Where the contract has no check of that kind, the cell says so and cites the line.

| Function | Authorization | State transition | Input validation | Duplicate operation |
|---|---|---|---|---|
| `init_escrow` | `auth_init_escrow_rejects_missing_auth`, `auth_init_escrow_rejects_other_signer` (`funder.require_auth`, `lib.rs:69`) | Creates Locked. `happy_path_fund_sign_release`, `same_beneficiary_can_have_multiple_escrows`. No prior-status guard in `lib.rs:60-101`. | `init_escrow_rejects_zero_amount`, `input_init_escrow_rejects_negative_amount` (`lib.rs:71-73`), `input_init_escrow_rejects_native_token_mismatch` (`lib.rs:76-82`) | `init_escrow_rejects_duplicate_id` (`lib.rs:87-90`) |
| `fund_escrow` | `auth_fund_escrow_rejects_missing_auth`, `auth_fund_escrow_rejects_other_signer` (`lib.rs:110`). `fund_escrow_rejects_wrong_funder` covers the stored-address check only (`lib.rs:118-120`), under `mock_all_auths`. | `fund_escrow_rejects_unknown_id` (`lib.rs:114-116`). `fund_escrow_rejects_double_funding` rejects Pending (`lib.rs:121-123`). `state_fund_escrow_rejects_after_release` rejects Released (`lib.rs:121-123`). | `fund_escrow_rejects_wrong_amount`, `input_fund_escrow_rejects_negative_amount` (`lib.rs:124-126`) | `fund_escrow_rejects_double_funding` |
| `submit_proof` | `auth_submit_proof_rejects_missing_auth`, `auth_submit_proof_rejects_other_signer` (`lib.rs:147`). `submit_proof_rejects_wrong_beneficiary` covers the stored-recipient check only (`lib.rs:155-157`), under `mock_all_auths`. | `submit_proof_rejects_before_funding` rejects Locked. `dup_submit_proof_rejects_second_proof` rejects Released before payout. `state_submit_proof_rejects_after_payout` rejects the proof with `escrow must be Pending` (`lib.rs:158-160`). `state_submit_proof_distinct_hashes_store_equal_records` shows both hashes end as the same Released record. | `submit_proof_rejects_zero_hash` (`lib.rs:162-165`). `input_submit_proof_rejects_unknown_id` panics `escrow not found` (`lib.rs:151-153`). | `dup_submit_proof_rejects_second_proof` |
| `release_funds` | `auth_release_funds_rejects_missing_auth`, `auth_release_funds_rejects_other_signer` (`lib.rs:178`). `release_funds_rejects_unauthorized_address` covers the stored-address check only (`lib.rs:186-188`), under `mock_all_auths`. | `release_funds_rejects_when_only_locked`, `release_funds_rejects_before_proof` (`lib.rs:189-191`). `release_funds_rejects_unknown_id` (`lib.rs:182-184`). After success, `state_get_escrow_after_payout_is_released_with_zero_amount` shows Released and amount 0 (`lib.rs:205-206`). | No amount argument. `release_funds_rejects_unknown_id` is the missing-id panic. `lib.rs:177-193` has no other input check, and this suite does not add one. | `release_funds_rejects_empty_escrow` (`lib.rs:192-194`) |
| `get_escrow` | `auth_get_escrow_returns_record_without_auth`. `lib.rs:209-210` performs a storage read and has no `require_auth`. | `state_get_escrow_unknown_id_returns_none` (`lib.rs:209-210`). `state_get_escrow_after_payout_is_released_with_zero_amount`. | `state_get_escrow_unknown_id_returns_none` returns `None` for id `999` and `Some` for the created id. That call does not panic. | `dup_get_escrow_second_read_matches_first` |

## Findings and design notes

`submit_proof` rejects a zero hash (`submit_proof_rejects_zero_hash`, `lib.rs:162-165`) and then does not store the hash. `lib.rs:167-168` writes the escrow back with status `Released` and leaves every other field unchanged. `EscrowData` (`lib.rs:37-43`) has funder, vendor, amount, status, and recipient, and no proof-hash field. `state_submit_proof_distinct_hashes_store_equal_records` shows two different non-zero hashes producing stored records that compare equal. The suite does not assert event contents or ledger metadata for that hash.

There is no `Paid` status. After a successful `release_funds`, `state_get_escrow_after_payout_is_released_with_zero_amount` and `happy_path_fund_sign_release` both read status `Released` and amount `0`. The happy path also reads the vendor token balance as the original amount. A later reader that treats "paid" as Released plus amount 0 is matching this stored shape. The contract does not store a separate paid flag.

No new test accepted an unauthorized call, a negative amount, a token mismatch, a second proof, or a second release. `lib.rs` was not changed.

Limits of this run:

- The original 16 tests enable `mock_all_auths` in `EscrowHarness::new()`. `fund_escrow_rejects_wrong_funder`, `submit_proof_rejects_wrong_beneficiary`, and `release_funds_rejects_unauthorized_address` therefore pass `require_auth` and fail on the later address comparison.
- The new authorization failure tests use that same harness to build earlier state, including the token mint, and then replace the auth manager before the call under test. The call under test is enforcing. Setup is not a proof of authorization.
- Authorization failures are matched on `HostError: Error(Auth, InvalidAction)` only. The tests do not match a signer address inside the panic text.
- `input_init_escrow_rejects_negative_amount` uses `-1`. `i128::MIN` is not a separate case. Zero is covered by the existing test.
- `state_submit_proof_distinct_hashes_store_equal_records` mints a second amount because the harness mints only one escrow amount. That mint is test setup.
- These tests do not reach the `native_xlm_token not initialized` panic in `lib.rs:213-217`. Funding a missing id fails earlier with `escrow not found` (`fund_escrow_rejects_unknown_id`).
- Nothing in this suite runs against Testnet, Mainnet, or the deployed contract id. Passing here does not prove the deployed bytecode matches this source.
