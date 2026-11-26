-- Stage 53: backfill the Confirmed signals from before the ledger that nobody has a delivery record for.
-- Run once in the Supabase SQL editor, after stage52.sql. Safe to run twice (conflicts are skipped).
-- They are added as NOT DELIVERED and can not be graded: the levels were not stored in full before the ledger.
-- Signals that have a follow-up row are left out: a follow-up existed, but who received it was never recorded.

insert into signals (dedupe_key, created_at, coingecko_id, asset_key, symbol, timeframe, side, kind,
  entry_low, entry_high, entry_mid, sl1, tp1, confidence, price_at_signal, processed_at)
select
  'legacy|' || h.asset_key || '|' || h.timeframe || '|' || h.changed_at::text,
  h.changed_at, substring(h.asset_key from 4), h.asset_key, h.symbol, h.timeframe,
  h.snapshot->>'side', 'confirmed',
  (h.snapshot->>'entry')::numeric, (h.snapshot->>'entry')::numeric, (h.snapshot->>'entry')::numeric,
  (h.snapshot->>'sl1')::numeric, (h.snapshot->>'tp1')::numeric,
  nullif(h.snapshot->>'confidence', '')::int, (h.snapshot->>'price')::numeric,
  now()
from category_history h
where h.category = 'confirmed'
  and h.changed_at >= '2026-11-07'
  and h.snapshot->>'side' in ('LONG', 'SHORT')
  and h.snapshot->>'entry' is not null and h.snapshot->>'sl1' is not null
  and not exists (
    select 1 from signal_followups f
    where f.asset_key = h.asset_key and f.timeframe = h.timeframe
      and abs(extract(epoch from (f.emitted_at - h.changed_at))) < 900
  )
on conflict (dedupe_key) do nothing;

insert into signal_outcomes (signal_id, outcome, r_multiple, note)
select s.id, 'unknown', null, 'legacy: created before the ledger; full levels and delivery were not recorded'
from signals s
where s.dedupe_key like 'legacy|%'
on conflict (signal_id) do nothing;

-- Check: how many were added
select count(*) as legacy_added from signals where dedupe_key like 'legacy|%';
