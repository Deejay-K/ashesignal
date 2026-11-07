# AsheSignal - Architecture & Staged Plan

AsheSignal is Ashe Foundry's crypto trading-intelligence platform. This document is the pre-development evaluation the spec asked for (stack, data providers, architecture, database, costs, real-time strategy) and the stage plan. Stage 1 is built and in this repo.

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js 16 (App Router) + TypeScript + Tailwind v4** | Same stack as ToraVault / Ashe Hub → one deploy pipeline (GitHub → Vercel). Server routes keep API keys off the client. |
| Charts | **lightweight-charts v5** (TradingView OSS) | Fast canvas candlesticks, price lines, overlays; 45 KB. |
| Analysis | Pure TypeScript (`src/lib/ta`) | Runs on server *and* client, no Python service needed; unit-testable (`scripts/selftest.ts`). |
| Auth + DB | **Supabase** (Postgres + RLS + Auth) - Stage 2 | Free tier, already in use for ToraVault; magic-link + OAuth; row-level security makes per-user data trivial. |
| Background jobs | **Vercel Cron → `/api/cron/*`** (Stage 3) | Signal tracking, alert evaluation. Vercel Hobby allows 1 cron/day; Pro gives per-minute. A $5 Railway/Fly worker is the fallback for true minute-level alerts. |
| Push notifications | Web Push (VAPID) + email via Resend (Stage 3) | Both free at our scale. |
| Hosting | Vercel | Serverless; `force-dynamic` routes; in-memory cache per lambda instance (acceptable; Upstash Redis is the upgrade if cache hit-rate matters). |

## 2. Data providers (all free tier, no key needed for Stage 1)

| Provider | Used for | Limits | Key? | Cost to upgrade |
|---|---|---|---|---|
| **Binance** public REST | Highest-quality OHLCV (all 10 timeframes), 24h tickers for gainers/losers/unusual volume | 1200 weight/min, no auth for market data | No | Free. (Note: geo-blocked in some regions - US users hit `api.binance.us`; add as alt base URL if needed.) |
| **CoinGecko** `/api/v3` | Global stats, top coins, trending, search, coin detail+tickers, fallback price history | ~30 req/min without key; **Demo key (free)** gives 30/min stable + 10k/month; Analyst $129/mo | Optional `COINGECKO_API_KEY` | Demo key strongly recommended for production. |
| **DexScreener** | DEX pairs by address/search, token profiles & boosts (emerging tokens) | 300 req/min (60/min for profiles/boosts) | No | Free only. |
| **GeckoTerminal** | OHLCV for DEX pools (the only free source), trending & new pools across chains | 30 req/min | No | Via CoinGecko paid plans. |
| **GoPlus Security** | Honeypot, taxes, permissions, holder concentration, LP lock (EVM + Solana) | Public, unpublished cap, be polite | No | Paid tiers exist for volume. |
| **Alternative.me** | Fear & Greed index, full history | Unlimited reasonable use; updates daily | No | Free. |

**Not integrated (and why):** Coinbase/Kraken/OKX/Bybit public candles are available but add little beyond Binance for the same symbols; they are worth adding as *fallback OHLCV sources for geo-blocked users* (Stage 4, each ~80 lines in `src/lib/providers/`). CoinMarketCap overlaps CoinGecko and needs a key. Wallet balances need an indexer (Alchemy/Moralis/Helius - free tiers exist, keys required) → Stage 3.

### Modular aggregation
Every provider lives in `src/lib/providers/<name>.ts` and only exposes typed functions. `src/lib/fetch.ts` wraps all HTTP with: TTL cache, in-flight de-duplication, per-host sliding-window rate limiter (tuned under each provider's cap), retry with backoff on 429/5xx, 12 s timeout, structured `ProviderError`. `safe()` degrades any failure to `{ok:false,error}` so a dead provider never blanks the page - the UI shows "unavailable" badges instead.

`src/lib/market/ohlcv.ts` is the resolver: Binance → GeckoTerminal pool → CoinGecko synthesized candles (flagged **estimated**). Every chart carries its source and quality badge; the token page tells you when wicks are approximate.

## 3. Application architecture

```
src/
  app/                    Next.js routes (pages + /api handlers)
    page.tsx              Dashboard (overview, F&G, bull/bear picks, gainers/losers, unusual volume, top-50)
    token/[id]            Full token analysis (CoinGecko id)
    discover              9 discovery lists with chain/cap/liquidity/volume/move/risk filters
    scanner               Contract address → report (chain, pairs, security, activity flags, TA)
    risk                  Position-size calculator (prefilled from any setup)
    sentiment             F&G gauge, 2-year F&G vs BTC chart, zone guide
    watchlist             Guest watchlist (localStorage) - Supabase sync in Stage 2
    api/                  overview, coins, discover, fng, ohlcv, analyze, scan, search, risk
  lib/
    fetch.ts              HTTP layer (cache / rate-limit / retry)
    providers/            binance, coingecko, dexscreener, geckoterminal, goplus, feargreed, chains
    ta/                   indicators (SMA/EMA/RSI/MACD/BB/ATR/VWAP/Fib/VolumeProfile),
                          levels (pivots, S/R clustering, trendlines),
                          patterns (17 patterns with completed/forming/potential status),
                          analysis (scored outlook + reasons + scenarios + LONG/SHORT setup)
    market/               ohlcv resolver, multi-timeframe consensus, discovery scan, address scanner
    risk/position.ts      Risk-first sizing with exposure/balance/leverage caps
  components/             Nav+search, PriceChart (lightweight-charts), AnalysisPanel, tables, gauges
supabase/schema.sql       Stage-2 database (accounts, watchlists, saved setups, signal history, alerts, wallets)
scripts/selftest.ts       Engine regression test (synthetic candles) - `npx tsx scripts/selftest.ts`
```

### Pattern engine (per timeframe)
`src/lib/ta/patterns.ts` runs on one timeframe's candles at a time, so a 15m pattern never leaks into the daily read. 30+ detectors across six families: candlestick (engulfing, harami, morning/evening star, three soldiers/crows, hammer, shooting star), structure (HH/HL, LH/LL, higher lows, lower highs), reversal (double/triple top and bottom, head and shoulders + inverse, falling/rising wedge, rounding bottom), continuation (bull/bear flag and pennant, ascending/descending/symmetrical triangle, bullish/bearish rectangle, rising/falling channel, cup and handle), RSI divergence (bullish/bearish), harmonic XABCD (Gartley, Bat, Butterfly, Crab). Every pattern carries drawable geometry (trendlines, necklines, boundaries, arcs, labelled pivots, trigger, target, invalidation) in candle coordinates, a status (forming, confirmed, completed, failed, invalidated) resolved against real closes, and a confidence built from measurable criteria (touch count, symmetry, line fit R2, volume). The chart draws them directly over the candles with per-pattern toggles.

### How a setup is produced (and why it is never "arbitrary")
1. Candles → indicators → swing pivots → clustered S/R levels (touch count + recency = strength).
2. ~20 weighted "reasons" (trend alignment, 200 SMA, RSI zone, MACD cross/histogram, volume ratio & trend, BB squeeze, VWAP side, level breaks, patterns) sum to a **score −100…+100**. Targets (entry, TP1-TP3 (+TP4 when a fourth level exists), SL1-SL2) are ALWAYS computed from structure; inside ±15 or with TP1 < 0.8R the setup is labelled **watch** with the issues listed, never deleted. Each target says whether it rests on a structural level or is an ATR estimate.
3. Entry = retest of a broken level, or pullback into nearest support/resistance, or market with a tight stop. SL1 = structural (beyond nearest level + 0.3 ATR) if within 2.5 ATR, else 1.5 ATR. SL2 = next level. TP1-3 = next levels ≥ 1 ATR away, else ATR multiples / swing extreme. If TP1 < 0.8 R → *no setup*.
4. `confirmed` only when |score| ≥ 35 **and** a confirmed pattern or level break exists; `speculative` otherwise; `watch` when the quality checks fail.
5. Confidence, style (scalp/day/swing/position from timeframe), holding period (bars-to-TP2 from ATR), invalidation, early-exit and profit-taking rules are attached.
6. Multi-timeframe consensus (15m/1h vs 4h/1d) flags *conflicting* when short and long term disagree.

## 4. Database (Stage 2+) - see `supabase/schema.sql`
- `profiles` (1:1 auth.users) - risk profile defaults, preferences
- `watchlists`, `watchlist_items` - coins by coingecko id or `(chain,address)`
- `saved_setups` - snapshot of a setup (entry/TP/SL/score/tf) at save time
- `signal_log` - every setup the engine emits for tracked assets, later resolved as tp1/tp2/tp3/sl/expired → **historical signal performance**
- `alerts` - type (price / rsi / macd_cross / pattern / breakout / tp / sl / volume / liquidity / listing / sentiment), params JSON, channel, last_fired
- `wallets` - read-only addresses per chain; `holdings_snapshots` for portfolio history
All tables have RLS: `auth.uid() = user_id`.

## 5. Real-time strategy
- Candles: polled per timeframe (1m every 15 s … 4h+ every 2 min) from the client; server cache TTL matches (10-60 s). Binance WebSocket streams are the upgrade for sub-second ticks (client-side `wss://stream.binance.com`), planned for Stage 4 - REST is enough for analysis that is recomputed per candle close.
- Discovery: 2-minute client refresh; server caches each source 30-120 s.
- Fear & Greed: 30-minute cache (updates daily).
- Signal tracking / alerts: cron worker evaluates tracked assets each minute (Stage 3).

## 6. Known limitations (honest list)
- **No per-token social sentiment** (LunarCrush/Santiment are paid). Token pages show CoinGecko community votes.
- **Whale activity** needs on-chain indexing (Whale Alert API is paid; free route = watch large transfers via Alchemy/Helius webhooks) → Stage 3.
- **Pattern detection is heuristic.** Flags/pennants/wedges are classified from pivot slopes; expect occasional false positives. Everything unconfirmed is labelled *forming*/*potential* and never counted as a confirmed trigger.
- **CoinGecko without a key rate-limits at ~30/min** - the dashboard makes 3 calls, token page 2, discover 3. Heavy use → add the free demo key.
- **Binance is geo-blocked in some countries** (US). Add `BINANCE_BASE_URL=https://api.binance.us` support if needed (symbols differ slightly).
- **Serverless cache is per-instance** on Vercel; cold starts refetch. Fine at personal scale.
- **Chart data is estimated** (flagged) for coins with no Binance pair and no DEX pool (rare mid-caps).

## 7. Stages
| Stage | Scope | Status |
|---|---|---|
| **1 - Functional core** | Data layer, 10-TF charts with overlays, full TA + pattern engine, LONG/SHORT setups, multi-TF consensus, discovery, address scanner + security, risk calculator, F&G, guest watchlist, responsive UI | ✅ built |
| **2 - Accounts** | Supabase auth (magic link/Google), synced watchlist with guest-merge on sign-in, saved setups with manual outcome + personal win-rate (`/setups`), risk profile sync. App runs fully in guest mode when Supabase is not configured. | ✅ built |
| **3 - Tracking & alerts** | Worker endpoints (`/api/cron/resolve`, `/alerts`, `/signals`) driven by GitHub Actions every 5 min (or Vercel Cron); saved setups auto-resolved on 15m candles (first-touch TP/SL, MFE/MAE); engine self-grading on top-30 × 1h/4h/1d → `/performance`; 13 edge-triggered alert types with cooldown; Web Push (VAPID) + Resend email + in-app inbox; `/account` page. Whale watch deferred to Stage 4 (needs indexer keys). | ✅ built |
| **4 - Portfolio & live** | Read-only wallets (6 EVM chains via Alchemy, Solana via Helius), holdings priced via CoinGecko contract prices → DexScreener fallback, allocation by asset/network, transactions, daily history snapshots (worker), manual cost basis → unrealized P&L, dashboard portfolio card; live Binance WebSocket ticks on charts (data-stream mirror) with in-place bar updates; Binance REST host fallback for US geo-block; `/api/health` diagnostics. Realized P&L deferred (needs CEX trade history). | ✅ built |
| **6 - Multi-exchange & whales** | OKX, Bybit, Kraken, Coinbase public candles as fallbacks after Binance (resampled where a venue lacks a timeframe); live cross-exchange price board with volume-weighted aggregate and spread on token pages; whale watch on the scanner (large transfers ≥ max($10k, 0.5% of recent flow), exchange hot-wallet labelling, net exchange flow flag). | ✅ built |
| **7 - Personalization & completeness** | Multiple synced watchlists (create/rename/delete/move), private per-token notes, default chart timeframe + overlays saved to the account, DEX liquidity snapshots by the worker → "Significant liquidity changes" Discover list (±25%/24h, rug flag) and `liquidity_change` alerts, `new_listing` alerts (CoinGecko recently-added + DexScreener profiles, watermark-diffed, optional chain filter). | ✅ built |
| **9 - Exchange accounts** | Read-only Kraken (HMAC-SHA512), Coinbase Advanced Trade (CDP ES256 JWT) and Binance (HMAC-SHA256) adapters; keys AES-256-GCM encrypted with `EXCHANGE_KEY_SECRET`; permission check on connect (refuses trade/withdraw where reported); balances merged into the portfolio; FIFO realized P&L per asset with fees; FIFO average cost feeds unrealized P&L automatically; daily snapshots include exchange balances. | ✅ built |
| **10 - Leverage & trade conditions** | Risk-derived leverage advice per setup (max safe from stop geometry with liquidation cushion, capped by quality/volatility/timeframe/confidence). Trade-conditions gate: ForexFactory high-impact USD calendar (FOMC fallback), monthly expiry, weekend/session liquidity, plus per-asset low volume, extreme/expanded volatility, squeeze, RSI extremes, thin DEX liquidity, wide spread -> avoid / caution / ok banner on dashboard and every chart; low volume and extreme ATR force setups to watch; macro-event alert type. | ✅ built |
| **5 - AI layer** | Three-tier analyst: built-in engine writer (free, default), any OpenAI-compatible free model (Groq, Gemini), or Claude - all over the engine's structured output (Messages API, JSON-forced): headline, bottom line, market-now, evidence, scenarios, key levels, entry/exit, risks, invalidation, suitability, confidence, and explicit disagreements with the engine. Hard rule: only numbers present in the engine data. Per-asset briefing history (`ai_briefings`), 15-min cache, hourly dashboard market briefing via worker, sign-in required to generate. | ✅ built |
