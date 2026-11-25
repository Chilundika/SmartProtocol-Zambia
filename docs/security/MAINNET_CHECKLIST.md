# Mainnet readiness checklist

Status: **not Mainnet-ready**. This is a readiness record for the Security Hardening and Mainnet-Readiness package. It is not a third-party security audit, and it does not authorize a Mainnet deployment.

Mainnet deployment, Mainnet funds, and contract redeployment are out of scope. They stay blocked until an independent third-party security audit is finished and every gate below is PASS.

Reviewed from `sprint/instawards` at `cbc4951cff3b0591eea5368722a3c0ec74783a6a`. Claims below use files in that tree, plus the rollback `supabase/rollbacks/0004_stellar_transaction_audit_rollback.sql`. This review did not query a live database, did not call Stellar RPC, did not apply a migration, and did not deploy an Edge Function or a contract.

A gate is PASS only when the repository proves the requirement. FAIL means the requirement is unmet or the repository does not prove it.

## Summary

| Gate | Status |
|---|---|
| Expanded escrow contract tests and test report | PASS |
| Testnet end-to-end escrow workflow | FAIL |
| Deployed contract ID and Testnet network configuration | FAIL |
| Funder, Beneficiary, and Vendor wallet and signing validation | FAIL |
| Supabase migrations and Edge Function deployment | FAIL |
| Vercel environment configuration | FAIL |
| Server secrets and deployment-account handling | FAIL |
| External third-party contract security audit | FAIL |
| Anonymous RLS on `vendors` and `funders` | FAIL |
| Incident response, rollback, monitoring, and audit-log verification | FAIL |

## 1. Expanded escrow contract tests and test report

**PASS.**

`docs/security/ESCROW_TEST_REPORT.md` records `cargo test --manifest-path contracts/Cargo.toml` on this branch. The escrow crate reported 36 passed, 0 failed, 0 ignored. The report lists cargo and rustc 1.96.0 and soroban-sdk 23.5.3. It says the 16 tests already in `contracts/contracts/escrow/src/test.rs` were kept, and that `contracts/contracts/escrow/src/lib.rs` was not modified for that run.

This pass covers the host suite and the written report only. The same report says the tests run inside the Soroban host, do not submit Testnet transactions, and do not prove that deployed bytecode matches the source.

## 2. Testnet end-to-end escrow workflow

**FAIL.**

The repository does not contain a recorded Testnet run of `init_escrow`, `fund_escrow`, `submit_proof`, and `release_funds` against the contract ID in `frontend/src/blockchain/stellarConfig.ts`.

`QA_TEST.md` is a playbook, not a completed result. It now names contract `CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ` and the `/vendor` page. It does not record a completed Testnet run, so it still cannot be used as evidence for the current tree.

Pass requires a written Testnet result for the current contract ID: each of the four writes, the signer for that write, the transaction hash, the ledger status, and the escrow state read back after each step.

## 3. Deployed contract ID and Testnet network configuration

**FAIL.**

The frontend source is pointed at Testnet. `frontend/src/blockchain/stellarConfig.ts` sets:

- RPC `https://soroban-testnet.stellar.org`
- passphrase `Test SDF Network ; September 2015`
- escrow contract ID `CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ`
- native XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

`frontend/src/blockchain/stellarClient.ts` and `frontend/src/blockchain/transactionService.ts` use those Testnet constants. `contracts/scripts/deploy-escrow.sh` is dry-run only. It does not invoke the Stellar CLI. It exits 2 for Mainnet, `public`, and the public network passphrase. The script comment states that it has no deployment path.

The config file still says to replace the escrow ID after `stellar contract deploy`. No repository record shows that `CDZD44LXVV4RO7A224YMIFWGIMZ5ZFWCO6AJRYPHLZ5EBMYUAT4TP2BQ` was built from the current `contracts/contracts/escrow/src/lib.rs`, or that its on-chain bytecode was compared with that source. The host test report states the same limit.

Pass requires that comparison, plus a record that the frontend ID, the server `ESCROW_CONTRACT_ID` secret, and the compared bytecode are the same Testnet contract. Mainnet redeployment remains out of scope.

## 4. Funder, Beneficiary, and Vendor wallet and signing validation

**FAIL.**

The source shows three different wallet paths, and no recorded validation of those paths:

- Funder writes use Freighter through `signAndSubmitTransaction` in `frontend/src/blockchain/transactionService.ts`, called from `frontend/app/funder/page.tsx`.
- Beneficiary proof uses an embedded keypair through `signAndSubmitWithKeypair` in the same service, called from `frontend/app/beneficiary/page.tsx`.
- Vendor uses `useVendorWallet` in `frontend/app/vendor/page.tsx`. That page reads escrow state. It does not call `signAndSubmitTransaction` or `signAndSubmitWithKeypair`.

Pass requires a recorded Testnet check for each role: the account that signed or authenticated, the network Freighter or the embedded signer used, and the result of the role's escrow action. Vendor validation must state that the vendor path is read-and-watch unless a later change adds a vendor signature.

## 5. Supabase migrations and Edge Function deployment

**FAIL.**

The repository contains migration files `supabase/migrations/0001_beneficiaries_pin_lockout.sql`, `0002_beneficiary_pin_backfill_audit.sql`, `0003_beneficiary_backfill_tokens.sql`, and `0004_stellar_transaction_audit.sql`. It contains Edge Function source at `supabase/functions/beneficiary-auth/index.ts`, `supabase/functions/transaction-audit/index.ts`, and `supabase/functions/escrow-audit-history/index.ts`. `0004` says to apply it before deploying `transaction-audit`. `escrow-audit-history` reads that table and re-verifies each stored hash.

This tree does not record that those migrations were applied to a hosted database, or that the three functions were deployed. `0004` and `transaction-audit` were committed in `b5bff64aed29`. `escrow-audit-history` was committed in `cbc4951cff3b0591eea5368722a3c0ec74783a6a`.

`docs/beneficiary_auth_deployment_runbook.md` describes a manual staging-then-production sequence for beneficiary auth. It tells the operator to run `supabase/migrations/0001_beneficiaries_pin_lockout_rollback.sql`. The rollback file in this repository is `supabase/rollbacks/0001_beneficiaries_pin_lockout_rollback.sql`. A rollback for the audit table now exists at `supabase/rollbacks/0004_stellar_transaction_audit_rollback.sql`. This checklist does not apply it.

Pass requires a dated record for the target project: each migration applied, all three functions deployed, and the verification queries from the runbook and from the comment at the end of `0004` actually run. Expected audit-table policy query result is zero rows.

## 6. Vercel environment configuration

**FAIL.**

`README.md` links to `https://smartprotocol-zm.vercel.app/`. The repository has no `vercel.json`. `frontend/.env.example` contains placeholders for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` only. There is no committed record of the Vercel project's environment names, environments (preview and production), or values. The contract ID is hardcoded in `stellarConfig.ts`, not selected by a Vercel environment variable.

Pass requires a record, without secret values, that the hosted project has the public Supabase URL and anon key set for the intended environment, that no service-role key is present in Vercel frontend env, and that the deployed frontend build is the Testnet configuration reviewed above.

## 7. Server secrets and deployment-account handling

**FAIL.**

`supabase/functions/transaction-audit/index.ts` reads `ESCROW_CONTRACT_ID` and `SUPABASE_SERVICE_ROLE_KEY` from the Edge Function environment. It does not import `frontend/src/blockchain/stellarConfig.ts`. `supabase/functions/beneficiary-auth/index.ts` also reads `SUPABASE_SERVICE_ROLE_KEY`. `frontend/src/lib/supabase.ts` reads only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `contracts/scripts/deploy-escrow.sh` does not read a secret or a deployment key. No tracked env file contains a service-role key or a Stellar secret.

The repository does not prove those Edge Function secrets are set, who can read them, or which Stellar account would be used for a future deployment. The dry-run script prints the label `deployer` and does not use an account.

Pass requires a record that `ESCROW_CONTRACT_ID` and `SUPABASE_SERVICE_ROLE_KEY` are set only as Edge Function secrets, that the service-role key is absent from the frontend bundle and from git, and that any future deployer account is named and stored outside the repository. Do not write secret values into this checklist.

## 8. External third-party contract security audit

**FAIL.** This gate blocks Mainnet.

`docs/security/` contains this checklist and `ESCROW_TEST_REPORT.md`. The test report is an internal host-test record. It is not an independent audit. No third-party audit report, scope, or auditor is in the repository.

Pass requires a completed independent third-party audit of the escrow contract that will be deployed, with the report stored or linked from this directory and its findings closed or explicitly accepted. Until that exists, Mainnet deployment, Mainnet funds, and contract redeployment stay blocked.

## 9. Anonymous RLS on `vendors` and `funders`

**FAIL.** This gate blocks Mainnet.

`supabase/schema.sql` lines 12–14 state that `vendors_anon_all` and `funders_anon_all` are still open and that no migration has replaced them. The file creates both policies `for all` to `anon` with `using (true)` and `with check (true)` at lines 57–68. `vendors.encrypted_key` is defined at line 28. `funders.encrypted_verifier` is defined at line 45.

Migrations `0001` through `0004` do not drop or replace those two policies. `0001` through `0003` change beneficiary access. `0004` creates `stellar_transaction_audit`, enables row-level security, grants `select` and `insert` to `service_role`, and grants nothing to `anon` or `authenticated`.

This checklist does not record a live database query. The blocker is the schema and migrations in the repository. Mainnet release stays blocked until a later migration replaces this access and a live check shows the open policies are gone. That migration is not in this tree.

## 10. Incident response, rollback, monitoring, and audit-log verification

**FAIL.**

The repository does not contain an incident-response procedure, an on-call contact, a monitoring configuration, or an alert destination.

Rollback coverage is incomplete. Scripts exist for `0001` (`supabase/rollbacks/0001_beneficiaries_pin_lockout_rollback.sql`) and `0004` (`supabase/rollbacks/0004_stellar_transaction_audit_rollback.sql`). The beneficiary runbook cites a path under `supabase/migrations/` for the 0001 script. There is still no rollback script for migrations `0002` or `0003`, and no recorded rollback drill.

Audit logging is source only. `0002` defines `beneficiary_pin_backfills`. `0004` defines `stellar_transaction_audit`, and `transaction-audit` is written to insert a row only after a Testnet `getTransaction` result is `SUCCESS` and the returned envelope matches the submitted signer, contract, function, and escrow ID. Neither the apply of those tables nor a check of a real audit row is recorded here.

Pass requires a written incident path, a rollback step that matches the files in this repository, a monitoring check for the hosted app and the Edge Functions, and a recorded read of both audit tables after a Testnet write. The `0004` policy query must return zero rows.
