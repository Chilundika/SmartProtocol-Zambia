# Mainnet readiness checklist

Status: **not Mainnet-ready**. This is a readiness record for the Security Hardening and Mainnet-Readiness package. It is not a third-party security audit, and it does not authorize a Mainnet deployment.

Mainnet deployment, Mainnet funds, and contract redeployment are out of scope. They stay blocked until an independent third-party security audit is finished and every gate below is PASS. Live Testnet evidence is not Mainnet approval.

The source review began from `sprint/instawards` at `cbc4951cff3b0591eea5368722a3c0ec74783a6a`, plus the rollback `supabase/rollbacks/0004_stellar_transaction_audit_rollback.sql`. That earlier pass did not query a live database and did not run Testnet transactions. The 26 November 2026 revision below replaces those stale limits where a later Testnet check actually ran. It records one Stellar Testnet escrow and one targeted audit-table query. It does not record a Mainnet deployment, Mainnet funding, contract redeployment, an external audit, production rate limiting, formal deployer-key custody, monitoring, incident response, or anonymous-RLS hardening.

A gate is PASS only when the recorded evidence proves the requirement. FAIL means the requirement is unmet or the evidence does not prove it. Every gate must pass, including an independent third-party audit, before Mainnet may be considered.

## Summary

| Gate | Status |
|---|---|
| Expanded escrow contract tests and test report | PASS |
| Testnet end-to-end escrow workflow | PASS |
| Deployed contract ID and Testnet network configuration | FAIL |
| Funder, Beneficiary, and Vendor wallet and signing validation | PASS |
| Supabase migrations and Edge Function deployment | PASS |
| Vercel environment configuration | PASS |
| Server secrets and deployment-account handling | FAIL |
| External third-party contract security audit | FAIL |
| Anonymous RLS on `vendors` and `funders` | FAIL |
| Incident response, rollback, monitoring, and audit-log verification | FAIL |

## Evidence revision — 26 November 2026

This entry records a completed Stellar Testnet run. It does not approve Mainnet. No Mainnet deployment occurred.

Recorded escrow:

- Escrow ID: `1795695966028`
- Amount: 96 XLM
- Network: Stellar Testnet
- Contract ID: `CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ`

Role public keys:

- Funder: `GCKUSXI6E2G6M7IX3TF6TOQT6MWJIDRXH7LJHUTCHJNYBOY6OPSSH2U5`
- Beneficiary: `GBDLQTAM2F3PXPLPNQOTS4ANKTXGJJ2SRGNU54SQDLEGQZHRZKV4NFON`
- Vendor: `GBJOIQKV6ERL23EXH7MEC6WY6J6OI2SOZUQHHHYCCT2QFMB35HWTBIB4`

The Funder signed `init_escrow`, `fund_escrow`, and `release_funds` with Freighter on Testnet. The Beneficiary signed `submit_proof` with the embedded wallet. The Vendor path is read-and-watch. It is not a signing path.

Successful Stellar Testnet transactions:

| Step | Hash | Ledger | Processed (UTC) | Resulting state |
|---|---|---|---|---|
| `init_escrow` | `6c2bf09aaa85ba3f6c23f1fd4c3ec8ff7b5639c3e88c9ec29c2d74e3177905da` | 5934467 | 2026-11-26 12:26:18 | Locked, 96 XLM |
| `fund_escrow` | `beb10b21b08ee1b7bbb25c856b6d56fcedbf8569d92ce764f48fc476954b8614` | 5934485 | 2026-11-26 12:27:48 | Pending, 96 XLM |
| `submit_proof` | `7501584a17bb8862d20f660aa44b6e0b10b6d12a6144263970a55e367a87ba93` | 5934496 | 2026-11-26 12:28:43 | Released, 96 XLM |
| `release_funds` | `2677e25448c405588569332afb790bcf46999bbd408e2be2822de15ba3de90af` | 5934516 | 2026-11-26 12:30:23 | Released, 0 XLM |

Other checks from the same date:

- `cargo test --manifest-path contracts/Cargo.toml` passed with 36 escrow tests passed and 0 failed.
- The Testnet-only deploy dry-run passed. It did not invoke the Stellar CLI and did not deploy a contract.
- The Vercel Production deployment was Ready.
- Beneficiary lifecycle notifications appeared without a manual browser refresh: escrow funded at 26 Nov 2026, 2:27 PM; beneficiary proof submitted at 26 Nov 2026, 2:29 PM; vendor payout released at 26 Nov 2026, 2:31 PM.
- A targeted Supabase query for escrow ID `1795695966028` returned exactly four records: `init_escrow`, `fund_escrow`, `submit_proof`, and `release_funds`. All four had `ledger_status` `SUCCESS`. That targeted query is the proof for this escrow. A global audit-table count is not.
- All four transaction hashes were opened in Stellar Expert Testnet and showed Successful.
- Supabase migrations `0001` through `0004` are applied.
- `beneficiary-auth`, `transaction-audit`, and `escrow-audit-history` are deployed and active.
- `stellar_transaction_audit` has row-level security enabled. The live audit-table policy query returned zero policies. Anonymous direct browser access was denied.
- `ESCROW_CONTRACT_ID` exists as a server-side Supabase Edge Function secret. Its value is not recorded here.
- Vercel Production and Preview use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. No service-role key was found in the Vercel frontend environment-variable names.

## 1. Expanded escrow contract tests and test report

**PASS.**

`docs/security/ESCROW_TEST_REPORT.md` records `cargo test --manifest-path contracts/Cargo.toml` on this branch. The escrow crate reported 36 passed, 0 failed, 0 ignored. The report lists cargo and rustc 1.96.0 and soroban-sdk 23.5.3. It says the 16 tests already in `contracts/contracts/escrow/src/test.rs` were kept, and that `contracts/contracts/escrow/src/lib.rs` was not modified for that run. The 26 November 2026 run again reported 36 escrow tests passed and 0 failed.

This pass covers the host suite and the written report only. The same report says the tests run inside the Soroban host, do not submit Testnet transactions, and do not prove that deployed bytecode matches the source.

## 2. Testnet end-to-end escrow workflow

**PASS.**

On 26 November 2026 the complete escrow lifecycle ran on Stellar Testnet against contract `CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ`. Escrow ID `1795695966028` moved through all four writes for 96 XLM. No Mainnet deployment occurred.

| Step | Signer | Hash | Ledger | Processed (UTC) | State after the write |
|---|---|---|---|---|---|
| `init_escrow` | Funder `GCKUSXI6E2G6M7IX3TF6TOQT6MWJIDRXH7LJHUTCHJNYBOY6OPSSH2U5`, Freighter | `6c2bf09aaa85ba3f6c23f1fd4c3ec8ff7b5639c3e88c9ec29c2d74e3177905da` | 5934467 | 2026-11-26 12:26:18 | Locked, 96 XLM |
| `fund_escrow` | Funder `GCKUSXI6E2G6M7IX3TF6TOQT6MWJIDRXH7LJHUTCHJNYBOY6OPSSH2U5`, Freighter | `beb10b21b08ee1b7bbb25c856b6d56fcedbf8569d92ce764f48fc476954b8614` | 5934485 | 2026-11-26 12:27:48 | Pending, 96 XLM |
| `submit_proof` | Beneficiary `GBDLQTAM2F3PXPLPNQOTS4ANKTXGJJ2SRGNU54SQDLEGQZHRZKV4NFON`, embedded wallet | `7501584a17bb8862d20f660aa44b6e0b10b6d12a6144263970a55e367a87ba93` | 5934496 | 2026-11-26 12:28:43 | Released, 96 XLM |
| `release_funds` | Funder `GCKUSXI6E2G6M7IX3TF6TOQT6MWJIDRXH7LJHUTCHJNYBOY6OPSSH2U5`, Freighter | `2677e25448c405588569332afb790bcf46999bbd408e2be2822de15ba3de90af` | 5934516 | 2026-11-26 12:30:23 | Released, 0 XLM |

The Vendor public key for this run was `GBJOIQKV6ERL23EXH7MEC6WY6J6OI2SOZUQHHHYCCT2QFMB35HWTBIB4`. That role watched the escrow. It did not sign a write.

A targeted Supabase query for escrow ID `1795695966028` returned exactly those four operations. Each stored row had `ledger_status` `SUCCESS`. Only that targeted query proves these four rows. A global count of `stellar_transaction_audit` does not. All four hashes were opened in Stellar Expert Testnet and showed Successful.

`QA_TEST.md` remains a playbook. This section's pass is the recorded run above, not that playbook.

## 3. Deployed contract ID and Testnet network configuration

**FAIL.**

The frontend source is pointed at Testnet. `frontend/src/blockchain/stellarConfig.ts` sets:

- RPC `https://soroban-testnet.stellar.org`
- passphrase `Test SDF Network ; September 2015`
- escrow contract ID `CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ`
- native XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

`frontend/src/blockchain/stellarClient.ts` and `frontend/src/blockchain/transactionService.ts` use those Testnet constants. The 26 November 2026 lifecycle used that same Testnet contract ID. `contracts/scripts/deploy-escrow.sh` is dry-run only. The Testnet-only deploy dry-run passed. It did not invoke the Stellar CLI and did not deploy a contract. It exits 2 for Mainnet, `public`, and the public network passphrase. The script comment states that it has no deployment path. Mainnet remains out of scope.

The config file still says to replace the escrow ID after `stellar contract deploy`. No repository record shows a reproducible comparison between the current `contracts/contracts/escrow/src/lib.rs` and the deployed bytecode of `CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ`. The host test report states the same limit. Testnet configuration and the deployed Testnet ID are evidenced. The missing bytecode comparison keeps this gate FAIL.

Pass requires that comparison, plus a record that the frontend ID, the server `ESCROW_CONTRACT_ID` secret, and the compared bytecode are the same Testnet contract. Mainnet redeployment remains out of scope.

## 4. Funder, Beneficiary, and Vendor wallet and signing validation

**PASS.**

The 26 November 2026 Testnet run checked each role:

- Funder `GCKUSXI6E2G6M7IX3TF6TOQT6MWJIDRXH7LJHUTCHJNYBOY6OPSSH2U5` signed `init_escrow`, `fund_escrow`, and `release_funds` with Freighter on Stellar Testnet. Those three transactions succeeded, as recorded in section 2.
- Beneficiary `GBDLQTAM2F3PXPLPNQOTS4ANKTXGJJ2SRGNU54SQDLEGQZHRZKV4NFON` signed `submit_proof` with the embedded wallet. That transaction succeeded.
- Vendor `GBJOIQKV6ERL23EXH7MEC6WY6J6OI2SOZUQHHHYCCT2QFMB35HWTBIB4` used the read-and-watch path. The vendor page reads escrow state. It does not call `signAndSubmitTransaction` or `signAndSubmitWithKeypair`. This run did not add a vendor signature.

The source paths remain Freighter through `signAndSubmitTransaction` for funder writes, `signAndSubmitWithKeypair` for the beneficiary proof, and `useVendorWallet` for the vendor page.

## 5. Supabase migrations and Edge Function deployment

**PASS.**

The repository contains migration files `supabase/migrations/0001_beneficiaries_pin_lockout.sql`, `0002_beneficiary_pin_backfill_audit.sql`, `0003_beneficiary_backfill_tokens.sql`, and `0004_stellar_transaction_audit.sql`. It contains Edge Function source at `supabase/functions/beneficiary-auth/index.ts`, `supabase/functions/transaction-audit/index.ts`, and `supabase/functions/escrow-audit-history/index.ts`. `0004` says to apply it before deploying `transaction-audit`. `escrow-audit-history` reads that table and re-verifies each stored hash. `0004` and `transaction-audit` were committed in `b5bff64aed29`. `escrow-audit-history` was committed in `cbc4951cff3b0591eea5368722a3c0ec74783a6a`.

On 26 November 2026, migrations `0001` through `0004` were applied. `beneficiary-auth`, `transaction-audit`, and `escrow-audit-history` were deployed and active. `stellar_transaction_audit` had row-level security enabled. The live audit-table policy query returned zero policies. Anonymous direct browser access to that table was denied.

`docs/beneficiary_auth_deployment_runbook.md` describes a manual staging-then-production sequence for beneficiary auth. It tells the operator to run `supabase/migrations/0001_beneficiaries_pin_lockout_rollback.sql`. The rollback file in this repository is `supabase/rollbacks/0001_beneficiaries_pin_lockout_rollback.sql`. A rollback for the audit table now exists at `supabase/rollbacks/0004_stellar_transaction_audit_rollback.sql`. This checklist does not apply it.

## 6. Vercel environment configuration

**PASS.**

`README.md` links to `https://smartprotocol-zm.vercel.app/`. The repository has no `vercel.json`. `frontend/.env.example` contains placeholders for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` only. The contract ID is hardcoded in `stellarConfig.ts`, not selected by a Vercel environment variable.

On 26 November 2026 the Vercel Production deployment was Ready. Vercel Production and Preview use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. No service-role key was found in the Vercel frontend environment-variable names. Secret values are not recorded here.

## 7. Server secrets and deployment-account handling

**FAIL.**

`supabase/functions/transaction-audit/index.ts` reads `ESCROW_CONTRACT_ID` and `SUPABASE_SERVICE_ROLE_KEY` from the Edge Function environment. It does not import `frontend/src/blockchain/stellarConfig.ts`. `supabase/functions/beneficiary-auth/index.ts` also reads `SUPABASE_SERVICE_ROLE_KEY`. `frontend/src/lib/supabase.ts` reads only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `contracts/scripts/deploy-escrow.sh` does not read a secret or a deployment key. No tracked env file contains a service-role key or a Stellar secret.

On 26 November 2026, `ESCROW_CONTRACT_ID` was present as a server-side Supabase Edge Function secret. Its value is not recorded here. No service-role key was found among the Vercel frontend environment-variable names. This check does not prove who can read the Edge Function secrets, how that access is governed, or which Stellar account would be used for a future deployment. The dry-run script prints the label `deployer` and does not use an account. Formal deployer-key custody is not established.

Pass requires a record that `ESCROW_CONTRACT_ID` and `SUPABASE_SERVICE_ROLE_KEY` are set only as Edge Function secrets, that the service-role key is absent from the frontend bundle and from git, and that any future deployer account is named and stored outside the repository, with its custody recorded. Do not write secret values into this checklist.

## 8. External third-party contract security audit

**FAIL.** This gate blocks Mainnet.

`docs/security/` contains this checklist and `ESCROW_TEST_REPORT.md`. The test report is an internal host-test record. It is not an independent audit. No third-party audit report, scope, or auditor is in the repository. The 26 November 2026 Testnet run is not an external audit.

Pass requires a completed independent third-party audit of the escrow contract that will be deployed, with the report stored or linked from this directory and its findings closed or explicitly accepted. Until that exists, Mainnet deployment, Mainnet funds, and contract redeployment stay blocked.

## 9. Anonymous RLS on `vendors` and `funders`

**FAIL.** This gate blocks Mainnet.

`supabase/schema.sql` lines 12–14 state that `vendors_anon_all` and `funders_anon_all` are still open and that no migration has replaced them. The file creates both policies `for all` to `anon` with `using (true)` and `with check (true)` at lines 57–68. `vendors.encrypted_key` is defined at line 28. `funders.encrypted_verifier` is defined at line 45.

Migrations `0001` through `0004` do not drop or replace those two policies. `0001` through `0003` change beneficiary access. `0004` creates `stellar_transaction_audit`, enables row-level security, grants `select` and `insert` to `service_role`, and grants nothing to `anon` or `authenticated`. The 26 November 2026 audit-table check does not close this gate. Anonymous access to `vendors` and `funders` was not hardened.

The blocker remains the schema and migrations in the repository. Mainnet release stays blocked until a later migration replaces this access and a live check shows the open policies are gone. That migration is not in this tree.

## 10. Incident response, rollback, monitoring, and audit-log verification

**FAIL.**

The repository does not contain an incident-response procedure, an on-call contact, a monitoring configuration, or an alert destination. The 26 November 2026 run did not add monitoring, alerting, or an incident-response procedure.

Rollback coverage is incomplete. Scripts exist for `0001` (`supabase/rollbacks/0001_beneficiaries_pin_lockout_rollback.sql`) and `0004` (`supabase/rollbacks/0004_stellar_transaction_audit_rollback.sql`). The beneficiary runbook cites a path under `supabase/migrations/` for the 0001 script. There is still no rollback script for migrations `0002` or `0003`, and no recorded full rollback drill.

The Testnet escrow in section 2 does have verified audit rows. A targeted query for escrow ID `1795695966028` returned exactly four `stellar_transaction_audit` rows, one for each lifecycle write, each with `ledger_status` `SUCCESS`. Those four hashes showed Successful on Stellar Expert Testnet. That query does not verify `beneficiary_pin_backfills`, and a global row count of `stellar_transaction_audit` is not evidence for this escrow. `transaction-audit` still inserts a row only after a Testnet `getTransaction` result is `SUCCESS` and the returned envelope matches the submitted signer, contract, function, and escrow ID.

Pass requires a written incident path, a rollback step that matches the files in this repository, a completed rollback drill, a monitoring check for the hosted app and the Edge Functions, and a recorded read of both audit tables after a Testnet write. The `0004` policy query must return zero rows. The policy query for `stellar_transaction_audit` did return zero rows. The other pass conditions are unmet, so this gate stays FAIL.
