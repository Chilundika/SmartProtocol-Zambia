-- SmartProtocol Zambia — two-phase trust-on-first-use backfill
--
-- Scope: public.beneficiaries ONLY. Does not touch vendors or funders.
--
-- Splits the legacy-account PIN backfill into stage-then-commit so a mistyped
-- PIN no longer permanently locks a pre-migration account.
--
-- Before: verify-pin wrote pin_hash immediately. If the submitted PIN was a
-- typo, the stored hash and the AES-GCM ciphertext disagreed forever and the
-- account needed an administrator.
--
-- After: verify-pin stages the candidate hash here and hands the client a
-- token. The client decrypts locally, and only on success calls
-- confirm-backfill to promote pending_pin_hash into pin_hash. A typo fails to
-- decrypt, nothing is promoted, and the user just retries.
--
-- Apply AFTER 0001 and BEFORE deploying the updated Edge Function.
--
-- Not applied automatically. Paste into the Supabase SQL editor.

begin;

-- ---------------------------------------------------------------------------
-- Staging columns
--
-- pending_token_hash stores SHA-256 of the token, never the token itself, so a
-- database leak does not let an attacker promote someone's staged hash.
--
-- These inherit no anon grants: 0001 revoked table-level privileges and granted
-- SELECT only on (nrc, public_key, created_at), and column grants are not
-- extended to columns added later. Nothing further is needed here.
--
-- Note for rollback: 0001's rollback script re-grants table-wide access to anon,
-- which would expose pending_pin_hash along with everything else. That is the
-- pre-migration world by definition, but clear the staging columns if you roll
-- back with rows mid-flight (statement at the bottom of this file).
-- ---------------------------------------------------------------------------

alter table public.beneficiaries
  add column if not exists pending_pin_hash text,
  add column if not exists pending_token_hash text,
  add column if not exists pending_token_expires_at timestamptz;

-- Supports expiry sweeps. Partial, because the overwhelming majority of rows
-- have no backfill in flight.
create index if not exists beneficiaries_pending_token_expiry_idx
  on public.beneficiaries (pending_token_expires_at)
  where pending_token_hash is not null;

commit;

-- ---------------------------------------------------------------------------
-- Verification (run separately)
-- ---------------------------------------------------------------------------

-- Expect still exactly nrc, public_key, created_at. The new columns must NOT
-- appear here.
-- select grantee, column_name, privilege_type
-- from information_schema.column_privileges
-- where table_schema = 'public'
--   and table_name = 'beneficiaries'
--   and grantee in ('anon', 'authenticated')
-- order by grantee, column_name;

-- Backfills currently staged but not yet confirmed. A row lingering here means
-- the client received a ciphertext it could not decrypt, i.e. a wrong PIN on a
-- legacy account. Expected to be small and short-lived.
-- select nrc, pending_token_expires_at
-- from public.beneficiaries
-- where pending_token_hash is not null
-- order by pending_token_expires_at desc;

-- Staged-but-never-confirmed attempts are the signal that a legacy user is
-- struggling with their PIN, or that someone is probing NRCs. Cross-check
-- against beneficiary_pin_backfills, which only records confirmed migrations.
-- select count(*) as staged_and_expired
-- from public.beneficiaries
-- where pending_token_hash is not null
--   and pending_token_expires_at < now();

-- ---------------------------------------------------------------------------
-- Housekeeping
--
-- Expired staging data is inert — confirm-backfill rejects it on expiry — so
-- sweeping is optional hygiene rather than a correctness requirement.
-- ---------------------------------------------------------------------------

-- update public.beneficiaries
-- set pending_pin_hash = null,
--     pending_token_hash = null,
--     pending_token_expires_at = null
-- where pending_token_hash is not null
--   and pending_token_expires_at < now() - interval '1 day';

-- ---------------------------------------------------------------------------
-- Rollback
--
-- Safe to run any time the updated function is not deployed. Dropping these
-- columns discards only in-flight staging state, never a confirmed pin_hash.
-- ---------------------------------------------------------------------------

-- alter table public.beneficiaries
--   drop column if exists pending_pin_hash,
--   drop column if exists pending_token_hash,
--   drop column if exists pending_token_expires_at;
