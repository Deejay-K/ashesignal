-- Stage 56: one shared cache for CoinGecko answers, so the 5-minute worker stays within CoinGecko's free limits.
-- Run once in the Supabase SQL editor. Safe to run more than once. Without it the app still works, but every step
-- calls CoinGecko itself again and the 429 "too many requests" errors come back.
create table if not exists api_cache (
  key text primary key,
  value jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table api_cache enable row level security;
