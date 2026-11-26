-- Stage 52: signal ledger (delivery + outcomes), speculative alerts. Safe to run more than once.
-- Run this file once in the Supabase SQL editor. Rows are never edited: the only changes allowed are the one-time
-- stamps broadcast_at and processed_at on signals, and both are refused once set.

alter table signal_followups add column if not exists signal_id uuid;
alter table telegram_users add column if not exists spec_preset text not null default 'off';
alter table telegram_users add column if not exists spec_tfs text[];

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  coingecko_id text not null,
  asset_key text not null,
  symbol text not null,
  timeframe text not null,
  side text not null check (side in ('LONG','SHORT')),
  kind text not null check (kind in ('confirmed','speculative')),
  entry_low numeric not null, entry_high numeric not null, entry_mid numeric not null,
  sl1 numeric not null, tp1 numeric, tp2 numeric, tp3 numeric,
  rr_tp2 numeric, confidence int,
  price_at_signal numeric,
  htf_aligned boolean,
  volume_24h numeric,
  market_rank int,
  payload jsonb,
  broadcast_at timestamptz,      -- first successful send. Set once.
  processed_at timestamptz       -- every recipient has a decision. Set once.
);
create index if not exists signals_created on signals(created_at desc);
create index if not exists signals_queue on signals(processed_at, created_at);

create table if not exists signal_deliveries (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  signal_id uuid not null references signals(id),
  recipient text not null,
  channel text not null check (channel in ('confirmed','speculative')),
  status text not null check (status in ('sent','skipped','filtered','failed')),
  reason text not null,
  unique (signal_id, recipient)
);
create index if not exists deliveries_recipient on signal_deliveries(recipient, created_at desc);

create table if not exists signal_outcomes (
  signal_id uuid primary key references signals(id),
  decided_at timestamptz not null default now(),
  outcome text not null check (outcome in ('no_fill','stop','tp1','tp2','tp3','expired','unknown')),
  r_multiple numeric,
  fill_at timestamptz,
  exit_at timestamptz,
  note text
);

create table if not exists signal_issues (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  signal_id uuid references signals(id),
  stage text not null,
  reason text not null
);

-- Append-only tables: no update, no delete, ever.
create or replace function ledger_append_only() returns trigger language plpgsql as $$
begin raise exception 'append-only table %: rows cannot be changed or deleted', tg_table_name; end $$;
drop trigger if exists deliveries_append_only on signal_deliveries;
create trigger deliveries_append_only before update or delete on signal_deliveries for each row execute function ledger_append_only();
drop trigger if exists outcomes_append_only on signal_outcomes;
create trigger outcomes_append_only before update or delete on signal_outcomes for each row execute function ledger_append_only();
drop trigger if exists issues_append_only on signal_issues;
create trigger issues_append_only before update or delete on signal_issues for each row execute function ledger_append_only();

-- Signals: the levels are final; broadcast_at and processed_at can only go from null to a value, once.
create or replace function guard_signals() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'signals are never deleted'; end if;
  if (new.dedupe_key, new.created_at, new.coingecko_id, new.symbol, new.timeframe, new.side, new.kind, new.entry_low, new.entry_high, new.entry_mid, new.sl1, new.tp1, new.tp2, new.tp3, new.payload)
     is distinct from (old.dedupe_key, old.created_at, old.coingecko_id, old.symbol, old.timeframe, old.side, old.kind, old.entry_low, old.entry_high, old.entry_mid, old.sl1, old.tp1, old.tp2, old.tp3, old.payload)
  then raise exception 'signal levels are final'; end if;
  if old.broadcast_at is not null and new.broadcast_at is distinct from old.broadcast_at then raise exception 'broadcast_at is final once set'; end if;
  if old.processed_at is not null and new.processed_at is distinct from old.processed_at then raise exception 'processed_at is final once set'; end if;
  return new;
end $$;
drop trigger if exists signals_guard on signals;
create trigger signals_guard before update or delete on signals for each row execute function guard_signals();

-- Public read of the ledger (no recipient ids here: deliveries stay private to the service role).
alter table signals enable row level security;
alter table signal_outcomes enable row level security;
alter table signal_deliveries enable row level security;
alter table signal_issues enable row level security;
drop policy if exists "signals readable" on signals;
create policy "signals readable" on signals for select using (true);
drop policy if exists "outcomes readable" on signal_outcomes;
create policy "outcomes readable" on signal_outcomes for select using (true);
