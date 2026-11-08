-- AsheSignal - Stage 2+ database schema (Supabase / Postgres)
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

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "own watchlists" on public.watchlists;
create policy "own watchlists" on public.watchlists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own watchlist items" on public.watchlist_items;
create policy "own watchlist items" on public.watchlist_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own setups" on public.saved_setups;
create policy "own setups" on public.saved_setups for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own alerts" on public.alerts;
create policy "own alerts" on public.alerts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own push subs" on public.push_subscriptions;
create policy "own push subs" on public.push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own wallets" on public.wallets;
create policy "own wallets" on public.wallets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own holdings" on public.holdings_snapshots;
create policy "own holdings" on public.holdings_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "signal log readable" on public.signal_log;
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

-- ---------- Stage 3 additions (safe to re-run) ----------
alter table public.saved_setups add column if not exists last_checked_at timestamptz;
alter table public.saved_setups add column if not exists max_favorable_pct numeric;
alter table public.saved_setups add column if not exists max_adverse_pct numeric;
alter table public.saved_setups add column if not exists outcome_note text;

-- fired-alert history shown in the UI
create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  alert_id uuid references public.alerts(id) on delete set null,
  symbol text not null,
  title text not null,
  body text not null,
  url text,
  fired_at timestamptz default now(),
  read boolean default false
);
create index if not exists alert_events_user_time on public.alert_events(user_id, fired_at desc);
alter table public.alert_events enable row level security;
drop policy if exists "own alert events" on public.alert_events;
create policy "own alert events" on public.alert_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- alerts: allow the cron to store evaluation state
alter table public.alerts add column if not exists state jsonb default '{}'::jsonb;
alter table public.alerts add column if not exists asset_ref jsonb default '{}'::jsonb; -- {symbol,id,network,pool}

-- email in profile for notifications (filled by trigger from auth.users)
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists notify_email boolean default false;
alter table public.profiles add column if not exists notify_push boolean default true;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do update set email = excluded.email;
  insert into public.watchlists (user_id, name) select new.id, 'Favorites' where not exists (select 1 from public.watchlists where user_id = new.id);
  return new;
end $$;
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

-- ---------- Stage 4 additions (safe to re-run) ----------
create table if not exists public.cost_basis (
  user_id uuid not null references auth.users(id) on delete cascade,
  chain text not null,
  address text not null,        -- token contract/mint, or the literal 'native'
  cost_per_unit numeric not null,
  updated_at timestamptz default now(),
  primary key (user_id, chain, address)
);
alter table public.cost_basis enable row level security;
drop policy if exists "own cost basis" on public.cost_basis;
create policy "own cost basis" on public.cost_basis for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Stage 5 additions (safe to re-run) ----------
-- AI briefings per asset: history of analyses, shared across users (no personal data inside).
create table if not exists public.ai_briefings (
  id uuid primary key default gen_random_uuid(),
  asset_key text not null,           -- 'cg:bitcoin' | 'pool:solana:<pool>' | 'market'
  symbol text not null,
  price numeric,
  model text,
  briefing jsonb not null,
  engine jsonb,                      -- consensus snapshot the briefing was written from
  input_tokens int, output_tokens int,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists ai_briefings_asset_time on public.ai_briefings(asset_key, created_at desc);
alter table public.ai_briefings enable row level security;
drop policy if exists "briefings readable" on public.ai_briefings;
create policy "briefings readable" on public.ai_briefings for select using (true);   -- written by service role

-- ---------- Stage 7 additions (safe to re-run) ----------
create table if not exists public.token_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_key text not null,
  symbol text,
  note text not null default '',
  updated_at timestamptz default now(),
  primary key (user_id, asset_key)
);
alter table public.token_notes enable row level security;
drop policy if exists "own notes" on public.token_notes;
create policy "own notes" on public.token_notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- DEX pool liquidity snapshots (worker) for liquidity-change discovery + alerts; shared data
create table if not exists public.pool_snapshots (
  id bigserial primary key,
  chain text not null,
  pool text not null,
  symbol text,
  token_address text,
  liquidity_usd numeric,
  volume24h_usd numeric,
  price_usd numeric,
  taken_at timestamptz default now()
);
create index if not exists pool_snapshots_pool_time on public.pool_snapshots(chain, pool, taken_at desc);
create index if not exists pool_snapshots_time on public.pool_snapshots(taken_at desc);
alter table public.pool_snapshots enable row level security;
drop policy if exists "pool snapshots readable" on public.pool_snapshots;
create policy "pool snapshots readable" on public.pool_snapshots for select using (true);

-- new-listing watermark (what the worker has already seen)
create table if not exists public.seen_listings (
  key text primary key,           -- 'cg:<id>' or 'dex:<chain>:<address>'
  symbol text,
  chain text,
  first_seen timestamptz default now()
);
alter table public.seen_listings enable row level security;
drop policy if exists "seen listings readable" on public.seen_listings;
create policy "seen listings readable" on public.seen_listings for select using (true);

-- allow the two new alert types
alter table public.alerts drop constraint if exists alerts_type_check;
alter table public.alerts add constraint alerts_type_check check (type in ('price_above','price_below','pct_move','rsi_above','rsi_below','macd_cross','pattern','breakout','breakdown','tp','sl','volume_spike','liquidity_change','new_listing','sentiment_zone'));

-- ---------- Stage 9 additions (safe to re-run) ----------
-- Read-only exchange API keys, encrypted with EXCHANGE_KEY_SECRET before they reach the database.
create table if not exists public.exchange_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exchange text not null check (exchange in ('kraken','coinbase','binance')),
  label text,
  enc_key text not null,
  enc_secret text not null,
  enc_passphrase text,
  permissions text[],
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz default now()
);
alter table public.exchange_accounts enable row level security;
drop policy if exists "own exchange accounts" on public.exchange_accounts;
create policy "own exchange accounts" on public.exchange_accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter table public.holdings_snapshots alter column wallet_id drop not null;
alter table public.saved_setups add column if not exists leverage numeric;
alter table public.alerts drop constraint if exists alerts_type_check;
alter table public.alerts add constraint alerts_type_check check (type in ('price_above','price_below','pct_move','rsi_above','rsi_below','macd_cross','pattern','breakout','breakdown','tp','sl','volume_spike','liquidity_change','new_listing','sentiment_zone','macro_event'));

-- ---------- Stage 14 additions (safe to re-run) ----------
-- Market-wide large transfers logged by the worker (watched DEX tokens + top ERC20 + trending)
create table if not exists public.whale_events (
  id bigserial primary key,
  chain text not null,
  token_address text not null,
  symbol text,
  tx_hash text not null,
  from_addr text, to_addr text,
  from_label text, to_label text,
  kind text check (kind in ('exchange_in','exchange_out','wallet_to_wallet')),
  amount numeric, value_usd numeric,
  occurred_at timestamptz,
  seen_at timestamptz default now(),
  unique (chain, tx_hash, token_address, from_addr, to_addr)
);
create index if not exists whale_events_time on public.whale_events(occurred_at desc);
alter table public.whale_events enable row level security;
drop policy if exists "whale events readable" on public.whale_events;
create policy "whale events readable" on public.whale_events for select using (true);

alter table public.alerts drop constraint if exists alerts_type_check;
alter table public.alerts add constraint alerts_type_check check (type in ('price_above','price_below','pct_move','rsi_above','rsi_below','macd_cross','pattern','breakout','breakdown','tp','sl','volume_spike','liquidity_change','new_listing','sentiment_zone','macro_event','whale_transfer'));

-- ---------- Stage 15 additions (safe to re-run) ----------
create table if not exists public.coin_metrics (
  asset_key text not null,
  symbol text not null,
  name text,
  timeframe text not null,
  price numeric, market_cap numeric, volume_24h numeric, change_24h_pct numeric,
  score int, outlook text, opportunity int,
  rsi numeric, atr_pct numeric, vol_ratio numeric, vol_regime text, trend text,
  macd_cross text, breakout text,
  setup_side text, setup_kind text, setup_rr numeric, setup_confidence int, leverage numeric,
  patterns text[],
  updated_at timestamptz default now(),
  primary key (asset_key, timeframe)
);
alter table public.coin_metrics enable row level security;
drop policy if exists "metrics readable" on public.coin_metrics;
create policy "metrics readable" on public.coin_metrics for select using (true);

-- ---------- Stage 16: trading discovery categories ----------
alter table public.coin_metrics add column if not exists category text;          -- confirmed | watching | none
alter table public.coin_metrics add column if not exists category_since timestamptz;
alter table public.coin_metrics add column if not exists watch_reasons text[];
alter table public.coin_metrics add column if not exists detail jsonb;            -- compact setup + evidence snapshot
alter table public.coin_metrics add column if not exists liquidity_note text;

create table if not exists public.category_history (
  id bigserial primary key,
  asset_key text not null,
  symbol text,
  timeframe text,
  category text not null,          -- confirmed | watching | speculative | spot | none
  prev_category text,
  reason text,
  snapshot jsonb,
  changed_at timestamptz default now()
);
create index if not exists category_history_asset on public.category_history(asset_key, changed_at desc);
create index if not exists category_history_time on public.category_history(changed_at desc);
alter table public.category_history enable row level security;
drop policy if exists "category history readable" on public.category_history;
create policy "category history readable" on public.category_history for select using (true);

create table if not exists public.spec_opportunities (
  asset_key text primary key,      -- addr:<chain>:<address>
  chain text, address text, symbol text, name text,
  price numeric, liquidity_usd numeric, volume_24h numeric, market_cap numeric, fdv numeric,
  age_hours numeric, change_1h numeric, change_24h numeric, buy_sell_ratio numeric, txns_24h int,
  risk_level text, security_score int, source_tag text,
  detail jsonb,
  first_seen timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.spec_opportunities enable row level security;
drop policy if exists "spec readable" on public.spec_opportunities;
create policy "spec readable" on public.spec_opportunities for select using (true);

create table if not exists public.spot_picks (
  asset_key text primary key,      -- cg:<id>
  symbol text, name text, tier text,   -- established | emerging | speculative
  rank int, price numeric, market_cap numeric, volume_24h numeric,
  spot_score int,
  detail jsonb,
  updated_at timestamptz default now()
);
alter table public.spot_picks enable row level security;
drop policy if exists "spot readable" on public.spot_picks;
create policy "spot readable" on public.spot_picks for select using (true);

-- ---------- Stage 17: multi-exchange ----------
alter table public.coin_metrics add column if not exists venue text;   -- binance | okx | bybit | kraken | coinbase
alter table public.exchange_accounts drop constraint if exists exchange_accounts_exchange_check;
alter table public.exchange_accounts add constraint exchange_accounts_exchange_check check (exchange in ('kraken','coinbase','binance','okx','bybit'));

-- ---------- Stage 19: engine quality gates ----------
alter table public.coin_metrics add column if not exists bt_n int;             -- engine record on this chart (walk-forward backtest)
alter table public.coin_metrics add column if not exists bt_winrate numeric;
alter table public.coin_metrics add column if not exists bt_expectancy numeric;

-- ---------- Stage 20: trade journal, discovery alerts, engine versioning ----------
alter table public.saved_setups add column if not exists taken boolean default false;
alter table public.saved_setups add column if not exists taken_at timestamptz;
alter table public.saved_setups add column if not exists exchange text;
alter table public.saved_setups add column if not exists fill_price numeric;
alter table public.saved_setups add column if not exists size_units numeric;
alter table public.saved_setups add column if not exists size_usd numeric;
alter table public.saved_setups add column if not exists risk_usd numeric;
alter table public.saved_setups add column if not exists exit_price numeric;
alter table public.saved_setups add column if not exists exit_at timestamptz;
alter table public.saved_setups add column if not exists exit_reason text;      -- tp1 | tp2 | tp3 | sl | manual | invalidated
alter table public.saved_setups add column if not exists realized_usd numeric;
alter table public.saved_setups add column if not exists realized_r numeric;
alter table public.saved_setups add column if not exists fees_usd numeric;
alter table public.saved_setups add column if not exists notes text;
alter table public.saved_setups add column if not exists notified_status text;  -- last status the user was notified about

alter table public.signal_log add column if not exists engine_version int default 1;   -- 2 = stage 19 gates
alter table public.signal_log add column if not exists htf_aligned boolean;
alter table public.signal_log add column if not exists venue text;

-- new alert types: new_confirmed (global, filtered), trade_update (per taken setup; created automatically)
alter table public.alerts drop constraint if exists alerts_type_check;
alter table public.alerts add constraint alerts_type_check check (type in ('price_above','price_below','pct_move','rsi_above','rsi_below','macd_cross','pattern','breakout','breakdown','tp','sl','volume_spike','sentiment_zone','liquidity_change','new_listing','macro_event','whale_transfer','new_confirmed','trade_update','spot_zone'));

-- ---------- Stage 21: daily digest ----------
alter table public.profiles add column if not exists digest_enabled boolean default false;
alter table public.profiles add column if not exists digest_hour int default 13;        -- UTC hour (13 = 8 am Toronto in winter)
alter table public.profiles add column if not exists digest_last_sent date;

-- ---------- Stage 23: engine lab ----------
create table if not exists public.engine_lab (
  asset_key text not null, symbol text, timeframe text not null, variant text not null,
  candles int, signals int, filled int, wins int, losses int, expired int,
  win_rate numeric, expectancy_r numeric, profit_factor numeric, max_dd_r numeric,
  updated_at timestamptz default now(),
  primary key (asset_key, timeframe, variant)
);
alter table public.engine_lab enable row level security;
drop policy if exists "lab readable" on public.engine_lab;
create policy "lab readable" on public.engine_lab for select using (true);

-- ---------- Stage 24: live engine config ----------
create table if not exists public.engine_config (
  key text primary key,
  value jsonb not null,
  note text,
  updated_at timestamptz default now(),
  updated_by text
);
create table if not exists public.engine_config_history (
  id bigserial primary key,
  key text not null,
  value jsonb not null,
  note text,
  changed_at timestamptz default now(),
  changed_by text
);
alter table public.engine_config enable row level security;
alter table public.engine_config_history enable row level security;
drop policy if exists "config readable" on public.engine_config;
create policy "config readable" on public.engine_config for select using (true);
drop policy if exists "config history readable" on public.engine_config_history;
create policy "config history readable" on public.engine_config_history for select using (true);

-- ---------- Stage 28: Discord delivery ----------
alter table public.profiles add column if not exists discord_webhook text;

-- ---------- Stage 32: Telegram, paper trading ----------
alter table public.profiles add column if not exists telegram_chat_id text;
alter table public.profiles add column if not exists telegram_link_code text;
alter table public.saved_setups add column if not exists paper boolean default false;
create index if not exists profiles_telegram_chat on public.profiles(telegram_chat_id);
