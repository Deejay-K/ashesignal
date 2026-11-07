# AsheSignal

Crypto trading-intelligence platform by **Ashe Foundry**: real market data, multi-timeframe technical analysis, LONG/SHORT setups with TP/SL and invalidation, risk-first position sizing, a contract-address scanner with security checks, discovery lists, and the Fear & Greed index.

> **Setup instructions: `docs/SETUP.md`.** Read `docs/ARCHITECTURE.md` — it has the stack decision, provider limits/costs, the setup-generation logic, the DB design and the stage plan.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

No API keys are required for Stage 1. Copy `.env.example` to `.env.local` and add a free CoinGecko Demo key if you hit rate limits.

```bash
npx tsx scripts/selftest.ts   # engine regression test (synthetic candles)
npm run build                 # production build
```

## Deploy (Vercel)

Push to a GitHub repo, import in Vercel, add env vars (optional), deploy. All pages are server-rendered on demand (`force-dynamic`), nothing is pre-baked with stale prices.

## What's in Stage 1

| Page | What it does |
|---|---|
| `/` | Market overview (cap, volume, BTC/ETH dominance), Fear & Greed, top bullish/bearish 4h setups on Binance top-40, trending, gainers/losers, unusual volume, your watchlist, top-50 table with sparklines |
| `/token/[id]` | Any CoinGecko coin: 10 timeframes (1m→1M) with EMA/SMA/BB overlays, S/R + trendlines + setup lines on the chart, multi-timeframe consensus, scored outlook with every reason listed, bullish/bearish scenarios, weakening-momentum & reversal signs, LONG/SHORT setup (entry zone, TP1–3, SL1–2, R:R, confidence, style, holding period, invalidation, exit rules), key levels + Fib, patterns split into completed / forming / potential, exchange markets, contract addresses → scanner |
| `/discover` | 9 lists (bullish, bearish, trending, DEX trending/memecoins, newly launched, unusual volume, gainers, losers, recovering) with chain / market-cap / liquidity / volume / move / risk filters. Micro-caps are flagged. |
| `/scanner` | Paste an EVM or Solana address → chain detection, token identity, liquidity-weighted price across pools, volume, txns, buy/sell ratio, pair age, GoPlus security checks (honeypot, taxes, mint/freeze, proxy, blacklist, holder concentration, LP lock…) with **verified vs unverified** marked, trading-activity red flags, and full TA on the main pool |
| `/risk` | Position-size calculator: balance, risk %, max loss $, max exposure %, leverage, fees → units, notional, margin, max loss, profit at TP1–3 in $ and R, exposure, remaining capital, liquidation estimate, warnings. Prefills from any setup via "Size this trade". |
| `/sentiment` | Fear & Greed gauge, 2-year F&G vs BTC overlay, zone guide, streak stats |
| `/watchlist` | Guest: this browser. Signed in: synced to your Supabase account (guest list merged on first sign-in). |
| `/setups` | Saved setups with manual outcome tracking and personal win-rate (account required) |
| `/login`, `/account` | Magic-link / Google sign-in, account overview, notification settings |
| `/alerts` | 13 alert types (price, % move, RSI, MACD cross, pattern, breakout/breakdown, TP/SL, volume spike, Fear & Greed zone) with push, email and inbox |
| `/portfolio` | Read-only wallet tracking across 6 EVM chains + Solana: holdings, prices, allocation, network split, transactions, value history, manual cost basis → unrealized P&L |
| `/performance` | The engine grading itself: every emitted signal on the top-30 coins logged and resolved against real price — win rate, TP/SL counts, MFE/MAE by timeframe, kind and side |

Every number shows its **source and quality** (verified / estimated / unavailable).

## What is *not* in Stage 1 (and the plan)

LLM narrative layer (Stage 5) and read-only exchange keys for realized P&L. Per-token social sentiment and whale feeds need paid or keyed APIs — see the limitations section in the architecture doc.

Not financial advice. Analysis is probabilistic; use the risk calculator and never trade more than you can lose.
