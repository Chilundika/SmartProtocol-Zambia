-- SmartProtocol Zambia — audit trail for trust-on-first-use PIN backfills
--
-- Scope: adds one new table. Does not alter beneficiaries, vendors, or funders.
--
-- Apply this BEFORE deploying the beneficiary-auth Edge Function. The function
-- treats a failed audit write as fatal and refuses the backfill, so if this
-- table is missing every legacy account login returns server_error.
--
-- Edge Function console logs are the wrong home for this record: they age out
-- and cannot be aggregated. "How many accounts backfilled, and when" needs to
-- be a query.
--
-- Records both successful backfills and refusals. Refusals are the queue for
-- the assisted-reset path: each row is a real user who tried to log in and
-- could not, so ops needs to be able to list them.
--
-- Not applied automatically. Paste into the Supabase SQL editor.

begin;

create table if not exists public.beneficiary_pin_backfills (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key to beneficiaries on purpose. The `delete` action hard-deletes
  -- the beneficiary row, and an audit record that disappears with its subject
  -- is not an audit record.
  nrc text not null,
  -- Values match the wire error strings the Edge Function returns, so a support
  -- ticket quoting an error maps straight onto a row here.
  outcome text not null default 'backfilled'
    check (outcome in (
      'backfilled',
      'account_migration_expired',
      'account_not_eligible_for_migration',
      'account_requires_assisted_setup'
    )),
  -- Copied off the beneficiary row at event time. Lets an assisted reset confirm
  -- the account genuinely predates the migration without trusting the caller,
  -- and survives the beneficiary row being deleted later.
  beneficiary_created_at timestamptz,
  event_at timestamptz not null default now(),
  client_ip text,
  user_agent text
);

create index if not exists beneficiary_pin_backfills_event_at_idx
  on public.beneficiary_pin_backfills (event_at desc);

create index if not exists beneficiary_pin_backfills_nrc_idx
  on public.beneficiary_pin_backfills (nrc);

create index if not exists beneficiary_pin_backfills_outcome_idx
  on public.beneficiary_pin_backfills (outcome, event_at desc);

-- Service role only. RLS is enabled with zero policies, so anon and
-- authenticated are denied every action regardless of grants; the revoke
-- removes Supabase's default table-wide grants as well.
alter table public.beneficiary_pin_backfills enable row level security;

revoke all on public.beneficiary_pin_backfills from anon, authenticated;
grant all on public.beneficiary_pin_backfills to service_role;

commit;

-- ---------------------------------------------------------------------------
-- Audit queries (run separately)
-- ---------------------------------------------------------------------------

-- How many legacy accounts have been backfilled, and over what period.
-- select count(*) as backfilled_accounts,
--        min(event_at) as first_backfill,
--        max(event_at) as last_backfill
-- from public.beneficiary_pin_backfills
-- where outcome = 'backfilled';

-- Backfills per day, to confirm the tail has gone quiet before the cutoff
-- arrives. If this is still busy near the cutoff, extend the window via
-- BENEFICIARY_BACKFILL_CUTOFF_AT rather than stranding users.
-- select date_trunc('day', event_at) as day, count(*)
-- from public.beneficiary_pin_backfills
-- where outcome = 'backfilled'
-- group by 1
-- order by 1 desc;

-- Accounts still exposed to the trust-on-first-use path. Should reach zero, or
-- be a known list handed to assisted reset, before the cutoff.
-- select count(*) as legacy_rows_remaining
-- from public.beneficiaries
-- where pin_hash is null;

-- One IP backfilling many distinct NRCs is the signature of the spray attack,
-- not of real users migrating.
-- select client_ip, count(distinct nrc) as accounts, max(event_at) as last_seen
-- from public.beneficiary_pin_backfills
-- where outcome = 'backfilled'
-- group by client_ip
-- having count(distinct nrc) > 1
-- order by accounts desc;

-- ---------------------------------------------------------------------------
-- Assisted reset queue (run separately)
-- ---------------------------------------------------------------------------

-- Distinct accounts that hit a refusal and still have no pin_hash. This is the
-- work list: each needs identity re-verification out of band, after which you
-- either clear the row or set pin_hash from a supervised PIN entry.
-- select b.nrc,
--        b.created_at,
--        count(*) as refusals,
--        max(f.event_at) as last_attempt,
--        max(f.outcome) as last_reason
-- from public.beneficiary_pin_backfills f
-- join public.beneficiaries b on b.nrc = f.nrc
-- where f.outcome <> 'backfilled'
--   and b.pin_hash is null
-- group by b.nrc, b.created_at
-- order by last_attempt desc;

-- Refusals by reason. A nonzero account_requires_assisted_setup count means the
-- window secrets are unset or invalid somewhere — check the function logs for
-- [BACKFILL_WINDOW] on cold start before assuming these are real legacy users.
-- select outcome, count(*) as events, count(distinct nrc) as accounts
-- from public.beneficiary_pin_backfills
-- where outcome <> 'backfilled'
-- group by outcome
-- order by events desc;

-- Rows that should not exist: no pin_hash but created after the migration went
-- live, which means something wrote to the table outside the Edge Function.
-- Replace the timestamp with your BENEFICIARY_BACKFILL_DEPLOYED_AT value.
-- select nrc, created_at
-- from public.beneficiaries
-- where pin_hash is null
--   and created_at >= '2026-08-30T09:00:00Z'::timestamptz
-- order by created_at desc;

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------

-- Only safe once the Edge Function no longer runs the backfill path, since
-- dropping this table makes every legacy login fail closed.
-- drop table if exists public.beneficiary_pin_backfills;
