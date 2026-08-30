-- SmartProtocol Zambia — rollback for 0001_beneficiaries_pin_lockout.sql
--
-- Restores anon's full access to public.beneficiaries so the browser can read
-- encrypted_key directly again and login works without the Edge Function.
-- Use this if the sequence breaks midway on staging.
--
-- Scope: public.beneficiaries ONLY. Does not touch vendors or funders.
--
-- Does NOT drop the columns 0001 added. pin_hash holds real credential data
-- for anyone who registered or logged in after the migration, and dropping it
-- destroys that irrecoverably — those accounts would be pushed back onto the
-- trust-on-first-use path on the next roll-forward. The columns are additive
-- and the pre-migration client ignores them, so leaving them costs nothing.
--
-- Not applied automatically. Paste into the Supabase SQL editor.

begin;

-- ---------------------------------------------------------------------------
-- 1. Remove the restrictive read policy
-- ---------------------------------------------------------------------------

drop policy if exists "beneficiaries_anon_read_public" on public.beneficiaries;

-- ---------------------------------------------------------------------------
-- 2. Restore table-level grants
--
-- The revoke is required, not redundant: 0001 left column-level SELECT grants
-- on (nrc, public_key, created_at), and re-granting at table level on top of
-- those leaves the column entries behind in information_schema, which makes
-- the state hard to read the next time someone audits it. Revoking first
-- clears them so the end state matches a fresh Supabase default.
-- ---------------------------------------------------------------------------

revoke all on public.beneficiaries from anon, authenticated;

grant all on public.beneficiaries to anon, authenticated;
grant all on public.beneficiaries to service_role;

-- ---------------------------------------------------------------------------
-- 3. Restore the original blanket policy from schema.sql
-- ---------------------------------------------------------------------------

alter table public.beneficiaries enable row level security;

drop policy if exists "beneficiaries_anon_all" on public.beneficiaries;
create policy "beneficiaries_anon_all"
  on public.beneficiaries for all
  to anon
  using (true)
  with check (true);

commit;

-- ---------------------------------------------------------------------------
-- Verification (run separately after committing)
-- ---------------------------------------------------------------------------

-- Expect beneficiaries_anon_all with cmd = ALL, and no read_public policy.
-- select policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public' and tablename = 'beneficiaries';

-- Expect zero rows: no column-level leftovers from 0001.
-- select grantee, column_name, privilege_type
-- from information_schema.column_privileges
-- where table_schema = 'public'
--   and table_name = 'beneficiaries'
--   and grantee in ('anon', 'authenticated');

-- Expect SELECT/INSERT/UPDATE/DELETE for anon at table level.
-- select grantee, privilege_type
-- from information_schema.table_privileges
-- where table_schema = 'public'
--   and table_name = 'beneficiaries'
--   and grantee in ('anon', 'authenticated')
-- order by grantee, privilege_type;

-- ---------------------------------------------------------------------------
-- Optional: also drop the 0001 columns
--
-- Only if you are abandoning the server-side approach entirely. This discards
-- every PIN hash recorded so far. Read the note at the top first.
-- ---------------------------------------------------------------------------

-- alter table public.beneficiaries
--   drop column if exists pin_hash,
--   drop column if exists failed_pin_attempts,
--   drop column if exists locked_until,
--   drop column if exists last_attempt_at;
