-- SmartProtocol Zambia — rollback for 0004_stellar_transaction_audit.sql
--
-- WARNING: This permanently deletes every audit record in
-- public.stellar_transaction_audit. Export the table first. Never run this
-- after audit evidence has been captured.
--
-- Drops public.stellar_transaction_audit, including its indexes, row-level
-- security, and grants.
--
-- Scope: public.stellar_transaction_audit ONLY. Does not touch beneficiaries,
-- vendors, funders, or beneficiary_pin_backfills.
--
-- Not applied automatically. Paste into the Supabase SQL editor only when
-- this table should be removed.

begin;

drop table if exists public.stellar_transaction_audit;

commit;

-- Verification (run separately after applying)
-- select to_regclass('public.stellar_transaction_audit');
--
-- Expect null.
