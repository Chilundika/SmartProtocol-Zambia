-- SmartProtocol Zambia — beneficiaries PIN lockout + RLS hardening
--
-- Scope: public.beneficiaries ONLY. This migration does not reference,
-- alter, or change privileges on public.vendors or public.funders.
--
-- After this runs, `encrypted_key` is no longer readable with the anon key.
-- The beneficiary login flow MUST go through the beneficiary-auth Edge
-- Function (service role) before the client can decrypt a session wallet.
-- Deploy the function before applying this, or beneficiary login breaks.
--
-- Not applied automatically. Paste into the Supabase SQL editor.

begin;

-- ---------------------------------------------------------------------------
-- 1. Lockout bookkeeping columns
--
-- pin_hash is nullable on purpose: existing rows predate it and have no
-- hash yet. The Edge Function must treat `pin_hash is null` as "cannot
-- verify" rather than "no PIN required".
-- ---------------------------------------------------------------------------

alter table public.beneficiaries
  add column if not exists pin_hash text,
  add column if not exists failed_pin_attempts int not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists last_attempt_at timestamptz;

-- No index on (nrc): it is already the primary key and therefore indexed.

-- ---------------------------------------------------------------------------
-- 2. Drop the blanket anon policy
-- ---------------------------------------------------------------------------

drop policy if exists "beneficiaries_anon_all" on public.beneficiaries;

alter table public.beneficiaries enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Replace table-level grants with column-level grants
--
-- Postgres does not consult column-level privileges while a table-level
-- privilege covers the same action, and a column-level REVOKE will not
-- remove a table-level grant. Supabase grants table-wide SELECT to anon by
-- default, so the table-level grant must be dropped first and then re-issued
-- per column. Skipping the revoke leaves encrypted_key readable.
--
-- Deliberately NOT granted to anon: encrypted_key, pin_hash,
-- failed_pin_attempts, locked_until, last_attempt_at.
-- ---------------------------------------------------------------------------

revoke all on public.beneficiaries from anon, authenticated;

grant select (nrc, public_key, created_at)
  on public.beneficiaries
  to anon;

-- service_role holds BYPASSRLS and needs full column access for the Edge
-- Function. Stated explicitly so the intent survives future grant changes.
grant all on public.beneficiaries to service_role;

-- ---------------------------------------------------------------------------
-- 4. Row-level read policy for anon
--
-- Row visibility is unrestricted; column visibility is enforced by the grant
-- in step 3. A query naming any non-granted column fails with SQLSTATE 42501.
-- ---------------------------------------------------------------------------

drop policy if exists "beneficiaries_anon_read_public" on public.beneficiaries;

create policy "beneficiaries_anon_read_public"
  on public.beneficiaries
  for select
  to anon
  using (true);

-- ---------------------------------------------------------------------------
-- 5. No INSERT / UPDATE / DELETE policies for anon
--
-- With RLS enabled and no permissive policy for these actions, all three are
-- denied for anon regardless of grants. Registration, lockout counter writes,
-- and account deletion therefore have to go through the Edge Function.
-- service_role bypasses RLS entirely, so it is unaffected.
-- ---------------------------------------------------------------------------

commit;

-- ---------------------------------------------------------------------------
-- Verification (run separately after committing)
-- ---------------------------------------------------------------------------

-- Expect exactly nrc, public_key, created_at with privilege_type = SELECT.
-- select grantee, table_name, column_name, privilege_type
-- from information_schema.column_privileges
-- where table_schema = 'public'
--   and table_name = 'beneficiaries'
--   and grantee in ('anon', 'authenticated')
-- order by grantee, column_name;

-- Expect a single policy: beneficiaries_anon_read_public (cmd = SELECT).
-- select policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public' and tablename = 'beneficiaries';

-- Expect 0 rows: no beneficiary can be verified until pin_hash is backfilled
-- or the row is re-registered through the Edge Function.
-- select count(*) as unverifiable_rows
-- from public.beneficiaries
-- where pin_hash is null;
