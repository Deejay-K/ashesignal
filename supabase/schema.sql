-- AsheSignal — Stage 2+ database schema (Supabase / Postgres)
-- Run in the Supabase SQL editor. All user tables are protected by RLS.

create extension if not exists pgcrypto;

-- 1:1 with auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  trading_balance numeric,
  portfolio_value numeric,
  risk_pct numeric default 1,
  max_exposure_pct numeric default 25,
  default_leverage numeric default 1,
  preferences jsonb default '{}'::jsonb, -- chart overlays, default timeframe, notification prefs
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Favorites',
  position int default 0,
  created_at timestamptz default now()
);

create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  coingecko_id text,            -- for CEX/major coins
  chain text,                   -- for DEX tokens
  address text,
  symbol text not null,
  name text,
  note text,
  created_at timestamptz default now(),
  unique (watchlist_id, coingecko_id, chain, address)
);

-- A setup the user chose to keep (snapshot at save time)
create table if not exists public.saved_setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_key text not null,      -- 'cg:bitcoin' | 'addr:solana:<mint>'
  symbol text not null,
  timeframe text not null,
  side text not null check (side in ('LONG','SHORT')),
  kind text not null check (kind in ('confirmed','speculative')),
  entry_low numeric, entry_high numeric,
  tp1 numeric, tp2 numeric, tp3 numeric,
  sl1 numeric, sl2 numeric,
  rr numeric, confidence int, score int,
  payload jsonb not null,       -- full Setup + reasons for reference
  status text default 'open' check (status in ('open','tp1','tp2','tp3','sl','closed','expired')),
  created_at timestamptz default now(),
  resolved_at timestamptz
);

-- Every setup the engine emits for tracked assets (Stage 3 cron) → performance stats
create table if not exists public.signal_log (
  id uuid primary key default gen_random_uuid(),
  asset_key text not null,
  symbol text not null,
  timeframe text not null,
  side text not null,
  kind text not null,
  entry numeric not null, tp1 numeric, tp2 numeric, tp3 numeric, sl1 numeric,
  score int, confidence int,
  emitted_at timestamptz default now(),
  outcome text check (outcome in ('tp1','tp2','tp3','sl','expired')),
  outcome_at timestamptz,
  max_favorable_pct numeric,    -- MFE/MAE for honest stats
  max_adverse_pct numeric
);
create index if not exists signal_log_asset_tf on public.signal_log(asset_key, timeframe, emitted_at desc);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_key text not null,
  symbol text not null,
  type text not null check (type in ('price_above','price_below','pct_move','rsi_above','rsi_below','macd_cross','pattern','breakout','breakdown','tp','sl','volume_spike','liquidity_change','new_listing','sentiment_zone')),
  timeframe text,
  params jsonb not null default '{}'::jsonb,   -- e.g. {"price": 65000} or {"rsi": 30}
  channels text[] default '{push}',            -- push | email
  active boolean default true,
  last_fired_at timestamptz,
  cooldown_minutes int default 60,
  created_at timestamptz default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz default now()
);

-- Read-only wallet tracking. NEVER store keys or seed phrases: addresses only.
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chain text not null,
  address text not null,
  label text,
  created_at timestamptz default now(),
  unique (user_id, chain, address)
);

create table if not exists public.holdings_snapshots (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  taken_at timestamptz default now(),
  total_usd numeric not null,
  holdings jsonb not null        -- [{chain,address,symbol,amount,price_usd,value_usd}]
);
create index if not exists holdings_wallet_time on public.holdings_snapshots(wallet_id, taken_at desc);

-- RLS
alter table public.profiles enable row level security;
alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.saved_setups enable row level security;
alter table public.alerts enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.wallets enable row level security;
alter table public.holdings_snapshots enable row level security;
alter table public.signal_log enable row level security;

create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own watchlists" on public.watchlists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own watchlist items" on public.watchlist_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own setups" on public.saved_setups for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own alerts" on public.alerts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own push subs" on public.push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own wallets" on public.wallets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own holdings" on public.holdings_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "signal log readable" on public.signal_log for select using (true); -- written by service role only

-- auto-create profile + default watchlist on signup
create or replace function public.handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.watchlists (user_id, name) values (new.id, 'Favorites');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
