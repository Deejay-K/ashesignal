-- Stage 54: follow-up message log, watchdog state, speculative alert settings (timezone, coin watchlist, custom limits).
-- Run once in the Supabase SQL editor, after stage52.sql and stage53.sql. Safe to run more than once.

-- Every follow-up message (zone, TP1, TP2, TP3, stop, cancelled) per recipient: sent or failed, with the reason.
create table if not exists followup_messages (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  followup_id uuid not null,
  signal_id uuid,
  event text not null,
  recipient text not null,
  status text not null check (status in ('sent','failed')),
  reason text not null
);
create index if not exists followup_messages_recent on followup_messages(created_at desc);
alter table followup_messages enable row level security;
drop trigger if exists followup_messages_append_only on followup_messages;
create trigger followup_messages_append_only before update or delete on followup_messages for each row execute function ledger_append_only();

-- Speculative alert settings per member.
alter table telegram_users add column if not exists utc_offset smallint;          -- hours from UTC, -12 to 14; null = UTC
alter table telegram_users add column if not exists spec_watchlist text[];        -- coin symbols; empty or null = every coin
alter table telegram_users add column if not exists spec_custom jsonb;            -- overrides on top of the preset
alter table telegram_users drop constraint if exists telegram_users_utc_offset_check;
alter table telegram_users add constraint telegram_users_utc_offset_check check (utc_offset is null or utc_offset between -12 and 14);

-- Send claims: a run claims a member for a signal before sending, so two overlapping runs never message the same
-- member twice. Rows are short-lived locks (a temporary failure frees its claim for the next try), so not append-only.
create table if not exists signal_claims (
  signal_id uuid not null references signals(id),
  recipient text not null,
  created_at timestamptz not null default now(),
  primary key (signal_id, recipient)
);
alter table signal_claims enable row level security;

-- At most one lifecycle (follow-up) record per ledger signal, even if two runs open it at the same moment.
create unique index if not exists signal_followups_one_per_signal on signal_followups(signal_id) where signal_id is not null;
