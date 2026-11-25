-- SmartProtocol Zambia — Supabase schema
-- Run this in the Supabase SQL editor, then apply migrations 0001, 0002, and
-- 0003 in order. Do not treat this file as the finished access model.
--
-- Beneficiaries access is governed by migrations 0001–0003, not by this file.
-- 0001 drops any blanket anon policy, revokes table-wide grants, and leaves
-- anon SELECT on (nrc, public_key, created_at) only, via
-- beneficiaries_anon_read_public. 0002 adds beneficiary_pin_backfills for
-- service_role only. 0003 adds the pending backfill columns, which inherit
-- no anon grant. This file must not recreate beneficiaries_anon_all.
--
-- The vendors_anon_all and funders_anon_all policies below are legacy and
-- still open: anon can read and write every column, including encrypted_key
-- and encrypted_verifier. No migration has replaced them.

create table if not exists public.beneficiaries (
  nrc text primary key,
  public_key text not null,
  encrypted_key text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.vendors (
  vendor_id text primary key,
  full_name text not null,
  tpin text not null unique,
  public_key text not null,
  stellar_address text not null,
  encrypted_key text not null,
  business_name text not null,
  pacra_number text not null,
  document_notes text not null default '',
  document jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  watched_escrow_ids jsonb not null default '[]'::jsonb
);

create table if not exists public.funders (
  email text primary key,
  organization_name text not null,
  public_key text not null,
  encrypted_verifier text not null,
  created_at timestamptz not null default now()
);

alter table public.beneficiaries enable row level security;
alter table public.vendors enable row level security;
alter table public.funders enable row level security;

-- Legacy open policies. Vendors and funders only. Beneficiaries are
-- intentionally left with RLS enabled and no policy here; 0001 installs
-- beneficiaries_anon_read_public. Do not add beneficiaries_anon_all back.

drop policy if exists "vendors_anon_all" on public.vendors;
create policy "vendors_anon_all"
  on public.vendors for all
  to anon
  using (true)
  with check (true);

drop policy if exists "funders_anon_all" on public.funders;
create policy "funders_anon_all"
  on public.funders for all
  to anon
  using (true)
  with check (true);

alter table public.vendors replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'vendors'
  ) then
    execute 'alter publication supabase_realtime add table public.vendors';
  end if;
end $$;
