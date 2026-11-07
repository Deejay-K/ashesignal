# AsheSignal

Crypto trading-intelligence platform by **Ashe Foundry**: real market data, multi-timeframe technical analysis, LONG/SHORT setups with TP/SL and invalidation, risk-first position sizing, a contract-address scanner with security checks, discovery lists, and the Fear & Greed index.

> **Setup instructions: `docs/SETUP.md`.** Read `docs/ARCHITECTURE.md` - it has the stack decision, provider limits/costs, the setup-generation logic, the DB design and the stage plan.

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
| `/token/[id]` | Any CoinGecko coin: 10 timeframes (1m→1M) with EMA/SMA/BB overlays, S/R + trendlines + setup lines on the chart, multi-timeframe consensus, scored outlook with every reason listed, bullish/bearish scenarios, weakening-momentum & reversal signs, LONG/SHORT setup (entry zone, TP1-3, SL1-2, R:R, confidence, style, holding period, invalidation, exit rules), key levels + Fib, patterns split into completed / forming / potential, exchange markets, contract addresses → scanner |
| `/discover` | 9 lists (bullish, bearish, trending, DEX trending/memecoins, newly launched, unusual volume, gainers, losers, recovering) with chain / market-cap / liquidity / volume / move / risk filters. Micro-caps are flagged. |
| `/scanner` | Paste an EVM or Solana address → chain detection, token identity, liquidity-weighted price across pools, volume, txns, buy/sell ratio, pair age, GoPlus security checks (honeypot, taxes, mint/freeze, proxy, blacklist, holder concentration, LP lock…) with **verified vs unverified** marked, trading-activity red flags, and full TA on the main pool |
| `/risk` | Position-size calculator: balance, risk %, max loss $, max exposure %, leverage, fees → units, notional, margin, max loss, profit at TP1-3 in $ and R, exposure, remaining capital, liquidation estimate, warnings. Prefills from any setup via "Size this trade". |
| `/sentiment` | Fear & Greed gauge, 2-year F&G vs BTC overlay, zone guide, streak stats |
| `/watchlist` | Guest: one list in this browser. Signed in: multiple synced lists, move items between them. |
| `/setups` | Saved setups with manual outcome tracking and personal win-rate (account required) |
| `/login`, `/account` | Magic-link / Google sign-in, account overview, notification settings |
| `/alerts` | 17 alert types (per-alert push/email choice) (incl. DEX liquidity change and new listings) (price, % move, RSI, MACD cross, pattern, breakout/breakdown, TP/SL, volume spike, Fear & Greed zone) with push, email and inbox |
| `/portfolio` | Read-only wallet tracking across 6 EVM chains + Solana: holdings, prices, allocation, network split, transactions, value history, manual cost basis → unrealized P&L |
| Exchange accounts (on `/portfolio`) | Read-only Kraken / Coinbase / Binance keys, encrypted at rest: balances, trade history, FIFO realized P&L and fees |
| `/screener` | Top 100 coins with live engine metrics on 1h/4h/1d: presets (confirmed longs, oversold bounce, breakouts, squeezes...) and filters on score, RSI, volume, ATR, R:R |
| Backtest (on every chart) | Replays the engine over the chart history: win rate, expectancy, profit factor, drawdown, equity curve, trade list |
| Share card | Themed PNG card of any setup for Discord / X / stream overlays |
| `/glossary` | Every label in the app explained (risk-on/off, score, confirmed/speculative/watch, TP/SL, R, leverage, pattern statuses, Fear & Greed zones, indicators, DEX terms, P&L). Labels across the app carry a small ? that links to the entry. |
| `/performance` | The engine grading itself: every emitted signal on the top-30 coins logged and resolved against real price - win rate, TP/SL counts, MFE/MAE by timeframe, kind and side |

Display currency (CAD, EUR, GBP, ...) on money pages, CSV exports, PNG chart export, per-coin engine track record. Six themes (Foundry, Terminal, Trader, Midnight, Ember, Paper light mode) switchable from Account or the menu; charts follow the theme. Press / anywhere to search; every setup has a Copy button.

A trade-conditions banner on the dashboard and every chart says whether to trade at all right now (macro events within 24 h, expiry, weekend liquidity, low volume, extreme volatility, thin liquidity, wide spreads). Each setup carries risk-derived leverage advice.

AI analyst briefings (Stage 5) sit under every analysis: a Claude model writes the plain-language read strictly from the engine's numbers, keeps a history per asset, and the dashboard carries an hourly market briefing.

Token pages carry a live cross-exchange price board (Binance, OKX, Bybit, Kraken, Coinbase) with aggregate and spread; the scanner shows whale transfers with exchange-flow direction.

Every number shows its **source and quality** (verified / estimated / unavailable).

## What is *not* in Stage 1 (and the plan)

Crypto-to-crypto trade pricing for realized P&L (currently USD-quoted trades only). Per-token social sentiment and whale feeds need paid or keyed APIs - see the limitations section in the architecture doc.

Formatting rule for this project: no em dashes or en dashes anywhere (UI, docs, AI output). `scripts/selftest.ts` fails the build check if one appears, and model output is filtered.

Not financial advice. Analysis is probabilistic; use the risk calculator and never trade more than you can lose.
