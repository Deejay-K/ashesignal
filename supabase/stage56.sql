-- Stage 56: one shared cache for CoinGecko answers, so the 5-minute worker stays within CoinGecko's free limits.
-- Run once in the Supabase SQL editor. Safe to run more than once. Without it the app still works, but every step
-- calls CoinGecko itself again and the 429 "too many requests" errors come back.
create table if not exists api_cache (
  key text primary key,
  value jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table api_cache enable row level security;

-- Monthly CoinGecko call counter: one atomic increment per real call (the app keeps under its monthly budget).
create or replace function cg_count_call(k text) returns int language sql as $$
  insert into api_cache (key, value, fetched_at) values (k, jsonb_build_object('calls', 1), now())
  on conflict (key) do update set value = jsonb_build_object('calls', coalesce((api_cache.value->>'calls')::int, 0) + 1), fetched_at = now()
  returning (value->>'calls')::int;
$$;
