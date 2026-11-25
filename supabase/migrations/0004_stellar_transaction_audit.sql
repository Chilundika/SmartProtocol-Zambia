-- SmartProtocol Zambia — immutable audit records for confirmed Soroban writes
--
-- Apply before deploying the transaction-audit Edge Function. Browser clients
-- cannot access this table directly: the function verifies each hash against
-- Stellar Testnet RPC, then writes with the service role.

begin;

create table if not exists public.stellar_transaction_audit (
  tx_hash text primary key
    check (tx_hash ~ '^[0-9a-fA-F]{64}$'),
  operation text not null
    check (operation in (
      'init_escrow',
      'fund_escrow',
      'submit_proof',
      'release_funds'
    )),
  escrow_id text not null
    check (escrow_id ~ '^[0-9]+$'),
  signer_address text not null
    check (signer_address ~ '^G[A-Z2-7]{55}$'),
  ledger bigint not null check (ledger > 0),
  ledger_status text not null default 'SUCCESS'
    check (ledger_status = 'SUCCESS'),
  verified_at timestamptz not null default now(),
  recorded_at timestamptz not null default now()
);

create index if not exists stellar_transaction_audit_escrow_id_idx
  on public.stellar_transaction_audit (escrow_id, recorded_at desc);

create index if not exists stellar_transaction_audit_signer_address_idx
  on public.stellar_transaction_audit (signer_address, recorded_at desc);

alter table public.stellar_transaction_audit enable row level security;

-- Browser roles stay fully denied. The Edge Function only inserts a
-- verified row and reads it back when the same hash is submitted again.
revoke all on public.stellar_transaction_audit from anon, authenticated;
grant select, insert on public.stellar_transaction_audit to service_role;

commit;

-- Verification (run separately after applying)
-- select policyname, cmd, roles
-- from pg_policies
-- where schemaname = 'public' and tablename = 'stellar_transaction_audit';
--
-- Expect zero rows: no anon/authenticated policies exist.
