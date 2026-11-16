# AsheSignal - Setup (Windows / VS Code / GitHub / Vercel)

AsheSignal is a standalone app: its own folder, its own GitHub repo, its own Vercel project, its own Supabase project. It shares nothing with any other app.

## 1. Run locally (works with zero keys)

1. Unzip into `D:\DEV Stuff\ashesignal` and open the folder in VS Code.
2. Terminal (`Ctrl+``):
   ```
   npm install
   npm run dev
   ```
3. Open http://localhost:3000. Dashboard, token pages, discover, scanner, risk and sentiment all work right away in **guest mode**.

## 2. CoinGecko key (free, recommended - stops rate-limit errors)

Without a key CoinGecko allows ~30 requests/min and will sometimes answer `429`. The free Demo key makes it stable.

1. Go to https://www.coingecko.com/en/developers/dashboard and sign up (free).
2. Click **+ Add New Key** → copy the key (starts with `CG-`).
3. In the project folder, copy `.env.example` to **`.env.local`** (same folder as `package.json`).
4. Set:
   ```
   COINGECKO_API_KEY=CG-xxxxxxxxxxxxxxxxxxxx
   ```
5. Restart `npm run dev`. That's it - the code sends it as `x-cg-demo-api-key` automatically.

`.env.local` is git-ignored; the key never reaches GitHub.

## 3. Supabase (accounts, synced watchlist, saved setups, risk profile)

Skip this if you only want guest mode. When you do it:

**a. Create the project**
1. https://supabase.com → **New project** → name `ashesignal`, pick a region close to you (ca-central / us-east), set a DB password (save it somewhere), Free plan.
2. Wait ~1 min for it to provision.

**b. Create the tables**
1. Left sidebar → **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this repo, paste the whole file, **Run**. You should see "Success".

**c. Enable sign-in methods**
1. **Authentication → Providers → Email**: keep it on (magic links work out of the box).
2. Optional Google: **Providers → Google** → enable → you need a Google OAuth client ID/secret from https://console.cloud.google.com (APIs & Services → Credentials → OAuth client → Web). Add `https://<your-project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI in Google, paste the ID/secret into Supabase, save.
3. **Authentication → URL Configuration**:
 - Site URL: `http://localhost:3000` for now (change to your Vercel URL later)
 - Redirect URLs: add `http://localhost:3000/auth/callback` and later `https://ashesignal.vercel.app/auth/callback`

**d. Keys into `.env.local`**
Project **Settings → API**:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...   (the "anon public" key)
```
Restart `npm run dev`. A **Sign in** button appears in the nav. Sign in with a magic link; your guest watchlist is merged into the account automatically.

## 4. GitHub (new private repo)

1. On GitHub: **New repository** → name `ashesignal` → Private → create (no README, it already has one).
2. In VS Code terminal:
   ```
   git remote add origin https://github.com/Deejay-K/ashesignal.git
   git push -u origin main
   ```

## 5. Vercel

1. https://vercel.com → **Add New… → Project** → import `Deejay-K/ashesignal` → framework auto-detects Next.js.
2. **Environment Variables**: add the same keys as `.env.local` (`COINGECKO_API_KEY`, and the two `NEXT_PUBLIC_SUPABASE_*` if you did step 3).
3. **Deploy** → you get `https://ashesignal.vercel.app` (or similar). Every `git push` to `main` redeploys.
4. If you set up Supabase: go back to **Authentication → URL Configuration** and set Site URL to the Vercel URL and add `https://<vercel-url>/auth/callback` to Redirect URLs.

## 5. Stage 3 - the worker (auto-resolve setups, engine performance, alerts)

The worker is three protected endpoints on your deployed app. Something has to call them on a schedule:

**a. Re-run the schema** - Supabase → SQL Editor → paste `supabase/schema.sql` again → Run (it only adds the new columns/tables).

**b. Secrets in Vercel** (Project → Settings → Environment Variables), then redeploy:
```
SUPABASE_SERVICE_ROLE_KEY = your sb_secret_… key
CRON_SECRET               = any long random string (e.g. 32 random characters)
NEXT_PUBLIC_SITE_URL      = https://ashesignal.vercel.app   (your real URL)
```

**c. Scheduling - pick one:**
- *Free, every 5 minutes (recommended):* GitHub → your repo → **Settings → Secrets and variables → Actions** → add `APP_URL` (`https://ashesignal.vercel.app`) and `CRON_SECRET` (same value as Vercel). The workflow `.github/workflows/worker.yml` is already in the repo; GitHub starts running it automatically. Check **Actions** tab for green runs.
- *Vercel Cron:* `vercel.json` already schedules the three endpoints once a day (Hobby plan limit). Vercel Pro allows `*/5 * * * *`.

**d. Verify:** open `https://<your-url>/api/cron/resolve?secret=<CRON_SECRET>` in a browser → you should get `{"ok":true,…}`. Then `/performance` starts filling after the first `/api/cron/signals` run.

## 6. Notifications (optional)

- **Push:** run `npx web-push generate-vapid-keys` once in the terminal, put the two keys in Vercel as `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, plus `VAPID_SUBJECT=mailto:you@example.com`. Redeploy, then on `/account` press **Enable push**. iPhone: add the site to the Home Screen first (Safari → Share → Add to Home Screen), then enable.
- **Email:** sign up at resend.com (free: 3k emails/month), create an API key → `RESEND_API_KEY` in Vercel. Until you verify a domain, mail comes from `onboarding@resend.dev` and can only be sent to your own Resend account email. Tick "Email me" on `/account`.
- Every fired alert always shows in the Inbox on `/alerts`, even with neither configured.

## 8. Stage 4 - wallet & portfolio tracking (two free keys)

1. **Alchemy** (Ethereum, Base, Polygon, Arbitrum, Optimism, BNB): https://dashboard.alchemy.com → sign up → **Create new app** → any name, pick Ethereum Mainnet → open the app → **API key** → copy. One key works for all networks.
2. **Helius** (Solana): https://dashboard.helius.dev → sign up → **API Keys** → copy.
3. Vercel → Environment Variables: `ALCHEMY_API_KEY`, `HELIUS_API_KEY` (both Secret) → Redeploy. Also add them to `.env.local` for local dev.
4. Supabase → SQL Editor → run `supabase/schema.sql` again (adds the `cost_basis` table).
5. On the site: **Portfolio** → add a wallet (chain + public address + label). Holdings, allocation, transactions load live; history builds up from the daily worker snapshot plus every visit.

Cost basis is entered manually per asset (tap "set" in the Holdings table) and drives Unrealized P&L. Never enter a private key or seed phrase anywhere - the app only accepts public addresses and rejects anything that looks like a seed phrase.

## 9. Stage 5 - AI analyst briefings (free by default)

With **no key at all**, briefings are written by the built-in engine writer - same format, every number from the engine, zero cost. Just run `supabase/schema.sql` again (adds `ai_briefings`) and press **Generate briefing** on any token page.

Optional upgrade to a real language model for richer prose - two free options (no card needed):
- **Groq**: https://console.groq.com/keys → create key. Vercel env: `AI_BASE_URL=https://api.groq.com/openai/v1`, `AI_API_KEY=<key>`, `AI_MODEL=llama-3.3-70b-versatile`.
- **Google Gemini**: https://aistudio.google.com/apikey → create key. Vercel env: `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `AI_API_KEY=<key>`, `AI_MODEL=gemini-3.6-flash`.
- (Paid) **Claude**: `ANTHROPIC_API_KEY` from console.anthropic.com; default model `claude-haiku-5-5`.

If a remote model errors or you hit its free quota, the app silently falls back to the engine writer. `/api/health` shows which provider is active. Briefings are cached 15 min per asset (1 h for the market one) and only signed-in users can generate.

## 10. Stage 7 - nothing to configure

Run `supabase/schema.sql` once more (adds notes, pool snapshots, listing watermark, new alert types). The worker starts snapshotting DEX liquidity on its own; the "Significant liquidity changes" list on Discover fills after ~24 h of snapshots. The first new-listing alert run only seeds the watermark (no notification), later runs notify.

## 11. Stage 9 - exchange accounts (realized P&L)

1. Vercel env (and `.env.local`): `EXCHANGE_KEY_SECRET` = any long random string (32+ characters). Exchange keys are encrypted with it; if you change it later, reconnect your exchanges.
2. Supabase -> SQL Editor -> run `supabase/schema.sql` again (adds `exchange_accounts`).
3. Create a READ-ONLY key on the exchange:
   - Kraken: Settings > API > Add key. Tick only "Query Funds" and "Query Closed Orders & Trades".
   - Coinbase: portal.cdp.coinbase.com > API keys > Create API key > permission "View" only. Download the key: the key name goes in "API key name", the private key block (BEGIN EC PRIVATE KEY ...) goes in the PEM box.
   - Binance (not for Canadian residents): API Management > Create > "Enable Reading" only.
4. Portfolio page -> Exchange accounts -> Connect. The app checks the key's permissions first (Coinbase and Binance report them; Kraken does not, so double-check the ticks) and refuses keys that can trade or withdraw.

What you get: exchange balances inside your portfolio, FIFO realized P&L per asset (fees included), fees paid, and automatic cost basis for unrealized P&L on those holdings. Crypto-to-crypto trades (e.g. ETH/BTC) are skipped for now because they need historical pricing.

## 12. Stage 14 - whale tracking, display currency, exports

Run `supabase/schema.sql` again (adds `whale_events` and the whale alert type). Nothing else to configure: the worker starts scanning tracked tokens (watchlists, whale alerts, trending pools, major ERC-20s) for large transfers automatically when Alchemy/Helius keys are present. Display currency lives on the Portfolio and Risk pages (rates from the ECB via frankfurter.app). Crypto-to-crypto trades are now priced in USD at the daily rate of the trade date.

## 13. Stage 15 - screener, backtest, share cards

Run `supabase/schema.sql` again (adds `coin_metrics`). The worker fills the screener within about an hour (10 coins every 5 minutes, rotating through the top 100). Backtests run on demand from any chart (needs 200+ candles on that timeframe). "Share card" on a setup opens a PNG you can save or drag into Discord/X.

## 14. Stage 16 - Trading Discovery (Confirmed / Watching / Speculative / Spot)

1. Supabase -> SQL Editor -> run `supabase/schema.sql` again (adds category columns on `coin_metrics` and the `category_history`, `spec_opportunities`, `spot_picks` tables).
2. Nothing else to configure. The GitHub Actions worker already calls the two new endpoints (`/api/cron/spec`, `/api/cron/spot`); pull the new `worker.yml` with your push. Fill times after the first run: Watching and Confirmed within about an hour (the screener batches), Speculative after 2 or 3 ticks, Spot within about 2.5 hours (5 coins per tick over the top 150).
3. Verify: `https://<your-url>/api/cron/spec?secret=<CRON_SECRET>` and `/api/cron/spot?secret=...` return `{"ok":true,...}`. Then open `/opportunities`.
4. Do not want to wait? Each category falls back to a **live snapshot** when its table is empty: the page computes Confirmed/Watching for the top 40 Binance coins, Speculative for the top trending DEX pools and Spot for the top 12 coins on request (10 to 40 seconds the first time, then cached a few minutes). "Refresh live" on the page recomputes it. To fill the full worker tables now instead of waiting for the rotation, open `/api/cron/screen?secret=<CRON_SECRET>&all=1` once (about 40 s), then reload `/api/cron/spot?secret=<CRON_SECRET>&fill=1` until it answers `"done":true` (about 10 coins per reload, CoinGecko free limit) and `/api/cron/spec?secret=<CRON_SECRET>&fill=1` until `"done":true`. Every call stops at 45 s and saves what it finished, so nothing times out.
5. Optional: if `AI_API_KEY` is set, the spot "why" paragraphs are rewritten by your model (numbers untouched); otherwise the engine writer's text is used.

Confirmed is a rules result, not a promise: a coin leaves the category on the next worker run once its setup stops qualifying, and the move is logged in the category history. Nothing in this section places orders; "Copy Trade Setup" only copies text to the clipboard.

## 15. Stage 17 - multi-exchange

Run `supabase/schema.sql` again (adds `coin_metrics.venue` and allows OKX/Bybit in `exchange_accounts`). Nothing else to configure.

- **Active exchange** (Account page, or the More menu): Binance, OKX, Bybit, Kraken or Coinbase. Charts, analysis, setups, Discover lists, the price board and every "Open on ..." link follow it. Coins the active exchange does not list fall back to the next one and the chart says so. Guests keep it in the browser; signed-in users have it synced.
- **Exchange connections** (Account page or Portfolio): read-only API keys for any of the five. OKX needs the passphrase chosen when the key was created; Bybit keys must be "Read-Only". Keys that can trade or withdraw are refused where the exchange reports permissions (Binance, OKX, Bybit, Coinbase); Kraken does not report them, so double-check the ticks.
- The worker screens the top 100 coins by market cap regardless of exchange; each row records which exchange supplied the candles.

To add another exchange later: one `Venue` (public candles + tickers) in `src/lib/providers/exchanges.ts`, one `VENUE_META` entry in `src/lib/venues.ts`, and optionally one read-only `ExchangeAdapter` in `src/lib/exchanges/`. Nothing else changes.

## 16. Stage 18 - trade guide and simpler risk calculator

Nothing to configure. `/guide` gives click-by-click steps to place a setup on the active exchange (spot or perpetual) with the setup's own numbers; it opens from "How to place it" on every setup card and discovery card, from the risk calculator, and from the More menu. `/risk` has a Simple mode, a 2-minute walkthrough, a "?" on every field and a plain-language answer ("Buy X units; if the stop hits you lose Y").

## 17. Stage 19 - stricter confirmations

Run `supabase/schema.sql` again (adds the engine-record columns on `coin_metrics`). Nothing else to configure. Confirmed now means all of: score beyond ±35, a trigger in the trade direction (a level break or a confirmed pattern; a completed pattern no longer counts), volume at least 0.8x average, not overextended (within 2.5 ATR of the 20 EMA, RSI not extreme), volatility not in the expanded regime, a level-based stop, TP1 at least 1R and TP2 at least 1.5R, the next-higher timeframe not against the trade, and the engine's own walk-forward record on that chart at least 50% winners with positive expectancy (once 8+ signals exist). Confirmed rows older than 10 minutes are re-checked against live candles every time the discovery page loads and demoted the moment they stop qualifying. Expect far fewer Confirmed cards and a much longer Watching list, which now says exactly which gate each one is missing.

## 18. Stage 20 - trade journal and discovery alerts

Run `supabase/schema.sql` again (journal columns on `saved_setups`, engine-version columns on `signal_log`, two new alert types). Nothing else to configure.

- **Journal** (`/setups`, "Journal" in the menu): press **I took this trade** on a setup card or a Confirmed discovery card after placing it on your exchange, enter fill, size, exchange and fees. The worker resolves it against 15-minute candles and notifies you (push/email/inbox) when TP1, TP2, TP3 or the stop is reached; **Close at my exit** records your real exit price and computes P&L in dollars and R. Stats: win rate, realized P&L, average R, money at risk, edge check.
- **New Confirmed Trade alert** (`/alerts`, type "New Confirmed Trade appears"): optional filters for direction, exchange listing (Coinbase implies longs only), timeframe and minimum confidence. The first worker run only seeds the watermark; later entries notify.
- **Performance** now splits the engine's record by engine version (before/after the Stage 19 gates), by higher-timeframe agreement, and kind x version, so the effect of the stricter rules is measurable as data accumulates.
- The Coinbase step in the trade guide now describes the attached TP/SL bracket in Advanced Trade.

## 19. Stage 21 - exchange fill matching, daily digest

Run `supabase/schema.sql` again (digest columns on `profiles`). The GitHub worker gains the hourly `/api/cron/digest` call; pull the new `worker.yml`.

- **Match exchange fills** (Journal page): reads recent trades from your connected read-only exchange keys and proposes the real fill price, size, fees and exit for each open journal trade; you apply or skip each suggestion. Works for Coinbase, Kraken, Binance, OKX and Bybit connections.
- **Daily digest** (Account page > Notifications): one message a day at the hour you pick, with the trade-conditions verdict, the Confirmed trades placeable on your active exchange (longs only on Coinbase), your open journal trades and anything that lost confirmation. Test it once with `/api/cron/digest?secret=<CRON_SECRET>&force=1`.
- **Watchlist** shows the live discovery category of each coin on your list.

## 20. Stage 22 - portfolio heat, onboarding, spot zone alerts

Run `supabase/schema.sql` again (adds the `spot_zone` alert type). Nothing else to configure.

- **Portfolio heat**: total money at risk across open journal trades as a % of the trading balance, open-trade count and a correlation warning (several altcoin longs = one market bet). Shown on the Journal; the "I took this trade" dialog previews the heat the new trade would create. Limits (default 3% total, 3 trades) live on the Account page.
- **Getting started** checklist on the dashboard for new users: exchange, balance and risk, sign in, one alert, digest, first journal trade. Each step is detected automatically; dismissable.
- **Spot zone alert** ("Alert me in the zone" on Spot cards): fires when the coin's price enters its accumulation zone; re-arms after leaving it.

## 21. Stage 23 - Engine Lab

Run `supabase/schema.sql` again (adds `engine_lab`); the pushed `worker.yml` adds the lab call. `/lab` (More menu) shows, per rule variant, pooled trades, win rate, expectancy and profit factor across the top 40 coins on 1h/4h/1d, with "better" / "worse" tags against the production rules, verdict sentences once 30+ trades exist, and the charts where the engine works best and worst. Variants live in `src/lib/ta/lab.ts`; the production thresholds in `DEFAULT_GATES` (`src/lib/ta/analysis.ts`). Change a threshold only after the lab shows it earns its place.

## 22. Stages 24 to 28

Run `supabase/schema.sql` again (engine config tables, Discord column); pull the new `worker.yml` (weekly review job).

- **24 Adopt from the Lab**: set `ADMIN_EMAILS=you@example.com` in Vercel (and `.env.local`) to unlock "Live confirmation rules" on `/lab`: apply custom thresholds, adopt a variant the lab rates better, reset or roll back; every change is logged. Workers and pages pick changes up within 5 minutes, no redeploy.
- **25 Market regime**: dashboard card and conditions banner show risk-on / risk-off / choppy / transition from BTC's daily trend, breadth (share of the top 100 up over 30 d) and the alt-season gauge. In risk-off, confirmed alt longs are held in Watching (and alt shorts in risk-on with alts leading); BTC setups are never gated.
- **26 Weekly review**: `/review` ("Weekly review" in the menu) and a Sunday report (sent with the daily digest, same hour) with flagged mistakes the data can see: oversize vs your risk %, non-confirmed entries, hand-closed losses and early winners, high leverage, missing notes, weekend entries, streaks. Test with `/api/cron/review?secret=<CRON_SECRET>&force=1`.
- **27 Rule tester**: on any chart's Backtest panel, "Rule tester" lets you change the gates and filters and compares the result with production on that chart.
- **28 Discord**: Account > Discord: paste a channel webhook; alerts, digest, weekly review and journal updates post there as embeds. "Send test" verifies it.

## 23. Stage 29 - journal entry points, push fix

No schema change. "I took this trade" is now on every setup card and every discovery card (Confirmed, Watching, Speculative with justified targets, and "I bought (spot)" on Spot picks), with a note when the setup is not confirmed. Card actions are split into a primary row (Details, I took this trade, Copy Trade Setup) and a secondary row (Full analysis, Open on exchange, Size it, How to place it, History). Push notifications: the web-push library is now imported as a namespace; the previous default import was undefined in Vercel's build, which silently broke every push send.

## 24. Stages 30 and 31 - site overhaul, Ask AsheSignal

No schema change. The header now has five hubs (Home, Trade, Portfolio, Alerts, Tools) with menus, a sub-nav row with the sibling pages of the current hub, a grouped phone sheet and a hub bottom bar; the dashboard opens with a Today panel (conditions, regime, confirmed trades on your exchange, your open trades and heat, unread alerts, Fear & Greed). Buttons, inputs, tables and typography were unified.

**Ask AsheSignal** (the floating "Ask" button on every page) answers questions grounded in the engine: a coin ("what does the engine say about SOL"), today's trades on your exchange, your journal and heat (signed in), position sizing, spot picks, market regime, how to place an order. With `AI_API_KEY` set the prose comes from your model over a context the engine assembled (numbers are never invented by the model); without it the built-in writer answers from templates. 20 questions per 10 minutes per address. It never tells you to buy or sell.

## 25. Stage 32 - Telegram bot, paper trading, calibration

Run `supabase/schema.sql` again (Telegram columns on `profiles`, `paper` on `saved_setups`).

- **Telegram bot** (free): in Telegram open @BotFather, send `/newbot`, pick a name and a username, copy the token. Vercel env: `TELEGRAM_BOT_TOKEN=<token>` (optional `TELEGRAM_WEBHOOK_SECRET`, defaults to CRON_SECRET). Redeploy, then open `https://<your-url>/api/telegram/setup?secret=<CRON_SECRET>` once (registers the webhook; the answer shows the bot's username). On the Account page the Telegram section shows `/link CODE`; send that to the bot. From then on alerts, digest and weekly review arrive in Telegram, and the bot answers `/trades`, `/today`, `/me`, `/coin SOL` or plain questions with the same grounded assistant as the in-app Ask.
- **Paper trading**: tick "Paper trade" in the "I took this trade" dialog. Paper trades get their own Journal tab and stats, are graded identically, and are excluded from portfolio heat and the weekly review's real-money numbers.
- **Confidence calibration**: `/api/calibration` buckets resolved signals by confidence band; the Performance page shows the table and cards show "conf 71 · 58% hit" once a band has 5+ resolved signals.
- **Tell me when it confirms** on any setup card creates a per-coin Confirmed alert.

## 7. Checks

- `npm run build` must pass before pushing (Vercel runs the same build).
- `npx tsx scripts/selftest.ts` runs the analysis-engine regression test.
- If Binance returns errors (some regions/ISPs block `api.binance.com`), charts for CEX coins fall back to CoinGecko (flagged *estimated*). Tell me and I'll add a `BINANCE_BASE_URL` override.

## Guest vs account

| | Guest | Signed in |
|---|---|---|
| Market data, charts, analysis, scanner, discover, risk calc | ✓ | ✓ |
| Watchlist | this browser only | synced (Supabase) |
| Save setups, auto-resolved vs live price, personal hit-rate (`/setups`) | ✗ | ✓ |
| Alerts (price, %, RSI, MACD, pattern, breakout, volume, F&G) + push/email/inbox | ✗ | ✓ |
| Wallet / portfolio tracking with history and cost basis | ✗ | ✓ |
| Exchange accounts (read-only), realized P&L | ✗ | ✓ |
| AI briefings | read cached | generate + history |
| Risk profile (balance, risk %, exposure, leverage) | this browser only | synced |

## 26. Stage 32.2 - Telegram bot mirrors the whole app

Run `supabase/schema.sql` again (new `telegram_users` table: each Telegram user keeps their own exchange, account link and guided-flow state, also inside groups; `telegram_chats` only records group titles). Then open `https://<your-url>/api/telegram/setup?secret=<CRON_SECRET>` once more so the command menu is re-registered (it now also allows button taps).

What the bot does now, in private chats and groups:

- `/menu` (or `/start`): one keyboard with every section: Confirmed, Watching, Speculative, Spot, Today, Screener, My trades, Alerts, Exchange, Help.
- `/trades`, `/watching`, `/spec`, `/spot`: the same four categories as the Opportunities page, filtered to the exchange chosen for that chat (spot-only exchanges hide SHORT setups). Pages of 6 with Prev/Next; tap a coin for its full card.
- `/coin SOL [1h|4h|1d]`: full analysis with a share-card image, levels, patterns, the setup (entry, TP1-3, SL1-2, leverage, what is missing for Confirmed) and buttons: Copy setup, Size it, I took it, Paper trade, Alert at TP1 (sets TP1 and SL1 price alerts), When it confirms, How to place it (the per-exchange guide pre-filled), Chart.
- `/today`: conditions verdict, regime with advice, Fear & Greed, next high-impact events.
- `/screener [score|oversold|overbought|volume]`: top 10 from the 4h screener with buttons to open cards.
- `/size ENTRY STOP [balance] [risk%]`: position size from the same calculator as the Risk page (uses the account's balance and risk % when linked).
- `/alert BTC above 100000`, `/alerts`: create price alerts and see rules plus inbox (linked).
- `/me`, `/journal`: open trades with heat, recent record, last 10 journal entries (linked).
- `/take SOL` or the ✍️ / 🧪 buttons: a 3-step guided flow (fill price, size, stop when the engine has none) that records the trade in the journal exactly like the website's "I took this trade". The bot then messages when TP or SL is reached.
- `/exchange coinbase`: your exchange. Settings are per person, not per chat: in a group each member picks their own exchange and links their own account, and the bot prefixes replies with the member's name. Alerts, digest and review always go to the member's private chat with the bot (they must press Start there once).
- Anything else in plain words goes to the grounded assistant.

Groups: the bot answers commands, mentions, replies and button taps only. For plain-text questions in a group, disable privacy mode in @BotFather (`/setprivacy` > Disable) and re-add the bot to the group. Account-bound commands (`/me`, `/journal`, `/take`, `/alerts`) are hidden from the group command menu; link in a private chat.

The bot never places orders, never asks for keys, and labels every setup as not financial advice.

## 27. Stage 33 - pre-trade checklist, entry-zone alerts, watchlist status, bot inline mode

Run `supabase/schema.sql` again (adds the `entry_zone` alert type). Re-open `/api/telegram/setup?secret=...` once to register the new commands and inline mode. Then in @BotFather send `/setinline`, pick AsheSignalBot and give a placeholder such as `coin, e.g. SOL`; that turns on `@AsheSignalBot SOL` in any chat.

Website:
- **Entry-zone status** on every Confirmed and Watching card: "price in the entry zone", "2.1% above the zone" (do not chase), or "below the zone" (check the stop), with a one-click "tell me when it enters the zone" alert.
- **Pre-trade checklist** inside "I took this trade": confirmed or not, listed on your exchange, regime allows the side, price vs zone, stop distance and whether it is already hit, high-impact news within 2 h, portfolio heat after this trade. Verdict GO / CAREFUL / WAIT with each check explained. It never blocks recording.
- **Watchlist**: every starred coin shows its current category, side, timeframe, zone status and a one-tap "alert when it confirms".
- **Search is a command palette**: type a page name ("journal", "risk", "settings") in the search box, or `/` from anywhere.
- `GET /api/pretrade?symbol=SOL&side=LONG&kind=confirmed&price=&entryLow=&entryHigh=&stop=&risk=&venue=` returns the checklist as JSON (signed-in users get the heat check too).

Telegram bot:
- `/top`: the 3 best confirmed setups for your exchange, ranked by confidence, with zone status; when there are none it shows what is closest to confirming and what it needs.
- `/watch SOL`, `/unwatch SOL`, `/watchlist` (synced with the website watchlist) with price, 24 h change, category and zone status. ⭐ Watch button on every coin card.
- Coin cards show "Now: price in the entry zone" and have "🔔 Entering zone" (fires when price comes into the zone) next to "Alert at TP1/SL".
- The guided `/take` flow now runs the pre-trade checklist and asks you to confirm before anything is recorded.
- `/review` (this week's review), `/digest` (today's digest now), `/settings` (exchange, digest on/off and hour with buttons, unlink).
- Inline mode: type `@AsheSignalBot SOL` in any chat, pick the 4h or 1d result, and the setup summary is posted with a link. Settings used are the typing user's.
- A bare ticker message ("SOL", "$btc 1d") opens the coin card directly.
- Alerts created from the bot are delivered to Telegram as well as push and email.

## 28. Stage 33.1 - automatic Telegram message for every new Confirmed trade

Run `supabase/schema.sql` again (adds `broadcast` to `telegram_users` and `telegram_chats`), then re-open `/api/telegram/setup?secret=...` once for the new `/signals` command.

Every time the screener worker moves a coin into Confirmed Trades, the bot sends **one message per trade** to every Telegram user who has started the bot and to every group it is in: the share card image, the full copy-trade block (pair on your exchange, entry zone, TP1-3, SL1-2, R:R, confidence, leverage, sizing rule, order plan; long-press to copy) and buttons: I took it, Paper, Size, TP1/SL alerts, Entering zone, Watch, How to place it, Open on exchange, Full card, Website.

- Per user it is filtered by their exchange: coins not listed there are not sent, and spot-only exchanges (Coinbase) never receive SHORTs. Groups receive everything with the list of exchanges.
- `/signals off` mutes it (per person in private chat, per group in a group); `/signals on` re-enables. Also a toggle in `/settings`. Default is on.
- Capped per worker run (60 messages; 20 when `all=1`) so a full re-screen cannot flood a chat.
- Test the format without waiting: `https://<your-url>/api/telegram/test-signal?secret=<CRON_SECRET>&symbol=SOL&tf=4h` (add `&chat=<your chat id>` to send only to yourself). It uses the coin's live setup and is labelled TEST.
- The worker's JSON now reports `promoted` and `telegram: { sent, recipients, skipped }`.

## 29. Stage 33.2 - the bot covers every chain

`/scan ADDRESS` (or just paste a contract address, or `/coin ADDRESS`) runs the same scanner as the website for any token on any supported chain: Solana, Ethereum, Base, BNB Chain, Polygon, Arbitrum, Avalanche, Optimism, Sui, TON and the other DexScreener chains. The card shows chain, risk verdict, price and changes, liquidity, volume, market cap or FDV, age, GoPlus security summary and flags, TA outlook, speculative TP/SL levels when the engine can justify them, why it has attention, risks and trading flags, the address in a copyable block, and buttons for DexScreener, the explorer, the full scan and a one-tap whale alert (transfers of $10k or more).

Inline mode handles addresses too: `@AsheSignalBot <address>` in any chat posts the scanner summary with a link. Re-open `/api/telegram/setup?secret=...` once so `/scan` appears in the command menu.

## 30. Stage 34 - one source of truth, leverage, bot fixes

No schema change. Re-open `/api/telegram/setup?secret=...` is not needed.

- **Website and bot now agree.** Trading Discovery is loaded by one function (`src/lib/market/discovery.ts`: worker rows, live fallback, live re-verification of Confirmed rows, exchange tagging) used by `/api/opportunities`, the bot's /trades, /watching, /spec, /spot and /top, and the digest. The Opportunities page now defaults to "Only what I can trade on <exchange>" (remembered), with tab counts that match that filter, which is exactly what the bot shows.
- **Leverage is editable** in "I took this trade": set the leverage you used; margin, position value, units, money at risk (as % of margin), TP2 payout and an estimated liquidation price all recompute. The dialog warns when the liquidation would come before your stop and when you exceed the engine's suggested leverage. Spot-only exchanges (Coinbase) lock it at 1x. Leverage is saved on the journal row. The bot's guided /take asks for leverage too (except on spot-only exchanges).
- **Bot buttons fixed.** Telegram rejects any button whose data is over 64 bytes, so cards for coins with long CoinGecko ids (e.g. wrapped or staked tokens) silently failed to send; buttons now use a short reference. Coin lookups by id ("binancecoin") no longer fail. Share-card images are sent with a short caption and the full card follows, so long cards are never cut mid-tag. If a command or button does error, the bot now tells you instead of staying silent.
- In groups, "I took it" hands over to a private chat with one tap (a deep link), so numbers are never typed into the group.

## 31. Stage 34.1 - undo, cancel and close a recorded trade

- Website: right after "Record in journal" the card shows "Recorded in journal · Undo" (one click removes it). In the Journal every open trade has "Close at my exit" (exit price, P&L and R computed), "Didn't take it / cancel" (the order never filled or you changed your mind: the setup goes back to Saved and does not count in your stats) and "✕ Delete" (with confirmation).
- Telegram: the confirmation after /take has an "↩ Undo" button. /me lists each open trade with "🏁 Close SYM" (asks your exit price, computes P&L and R) and "✖ Cancel SYM" (back to Saved, out of the stats).

## 32. Stage 35 - the super update

Run `supabase/schema.sql` again (tables `signal_followups`, `telegram_group_members`, `telegram_group_watch`; columns `saved_setups.pretrade_verdict`, `saved_setups.leverage_used`). Re-open `/api/telegram/setup?secret=...` once for the new commands. Commit the fixed `.github/workflows/worker.yml` (its indentation had been invalid, which can stop GitHub from running the worker at all; check the Actions tab shows green runs every 5 minutes).

1. **Track record** - `/track-record` and bot `/record`: every signal the engine emitted with its outcome, cumulative R curve, by kind / timeframe / side / month, the broadcast Confirmed trades with TP1/TP2/SL/lost counts, and your own record next to it when signed in. Rows are written by the worker only.
2. **Signal lifecycle in Telegram** - new worker `/api/cron/followups` (every 5 min via GitHub Actions): for every Confirmed trade the bot broadcast, one message when price enters the zone, at TP1 (move stop to break-even), TP2 (trail), TP3, stop hit, or when the engine stops confirming it. Same recipients and exchange filter as the original signal.
3. **Chart images** - `/api/chart?symbol&tf&side&entryLow&entryHigh&tp1&tp2&tp3&sl1&sl2&id=` renders a candle chart PNG with the zone, targets and stops drawn on it. Telegram cards and broadcasts now lead with it (the share card stays one tap away); the website has a "Chart" button on cards and "Chart image" in the analysis panel.
4. **Order ticket** - the trade guide now opens with the exact orders to type on your exchange (pair, order type, price, amount, stop-limit stop and limit, TP sells 30/30/40) with your units filled in; passed automatically from "I took this trade" and the risk calculator.
5. **Coinbase fills** - Coinbase Advanced Trade read-only keys were already supported (ECDSA or Ed25519, view-only enforced); "Match exchange fills" in the Journal and the link on the plan page use them.
6. **Today's plan** - `/plan` page (first tile on the dashboard, first item in Trade) and bot `/plan`: stance from conditions and regime, what to do with each open trade (break-even, near stop, near TP1), confirmed setups for your exchange with zone status, closest-to-confirming, high-impact events, heat and risk budget left, as a numbered to-do list.
7. **Notification preferences** - Account > Notifications: per-type toggles (confirmed, trade updates, price/zone, spot, digest, review, other), quiet hours in UTC with an exception for your own trade updates, and "Send a test to all channels". Applies to push, email, Discord and Telegram; the in-app inbox keeps everything.
8. **Journal analytics** - Journal > Stats: by pre-trade verdict (does GO beat CAREFUL for you?), timeframe, coin, weekday, setup kind, leverage, side, exchange, with plain-language insights; real and paper separately. The verdict and leverage are now stored on each recorded trade (website and bot).
9. **Groups** - `/leaderboard` (weekly R and counts per opted-in member, never dollars; `/optin`, `/optout`) and a shared group watchlist (`/watch`, `/unwatch`, `/watchlist` in a group act on the group's list; `/mywatch` adds to your own).
10. **Assistant with buttons** - plain-text questions in the bot now come back with buttons for what they refer to: the coin's 4h and 1d cards and Watch, or Confirmed / Top 3 / Plan / Today / My trades / Review / Spot picks depending on the question.

## 33. Stage 36 - morning plan delivery, shareable setup pages, simulator, wizard, bot additions

Run `supabase/schema.sql` again (profiles: `plan_enabled`, `plan_hour`, `plan_last_sent`). Re-open `/api/telegram/setup?secret=...` once for the new commands.

Included fixes from the previous zips: Vercel cron schedules are daily (Hobby plan), the full dynamic bot menu, discovery tab counts for every category, secondary card actions as buttons.

- **Morning plan delivery**: Account > Notifications > Morning plan (on/off and hour), or the bot's /settings. New worker `/api/cron/plan` (hourly via GitHub Actions; `?force=1`, `?dry=1` like the digest) sends Today's plan by push, email and Telegram. Counts as the "digest" notification type for quiet hours and toggles.
- **Shareable setup page** `/s/<coingecko id>/<tf>`: chart image with levels, outlook, where it is listed, levels with zone status, why and what is missing, guest pre-trade check, actions (I took this trade, copy, size, guide, open on exchange, zone alert, confirm alert) and the order ticket. Re-analysed live on every open. Telegram "Full page" buttons (cards, broadcasts, follow-ups) point here.
- **Strategy simulator** `/simulator` (Portfolio menu) and bot `/simulate [balance] [risk%]`: replays every resolved signal from the log with fixed fractional risk, exchange filter, max open trades, kinds and timeframes; end balance, return, drawdown, profit factor, streaks, equity curve, by month. Past outcomes only, no fees or slippage, clearly labelled.
- **Guided setup** `/welcome` (Tools menu, and "guided setup" on the dashboard checklist): exchange, balance and risk limits, notifications, Telegram link, first look.
- **Bot**: `/compare BTC ETH [tf]` side by side with a verdict; `/events` calendar with time-to-event; `/heat` open risk vs limits and budget left; `/simulate`; morning plan toggle and hour in `/settings`.

## 34. Stage 36.1 - the bot is all buttons

No typed command is required any more:
- A **persistent keyboard under the text box** (Plan, Trades, Watching, Coin, Size, Me, Menu, Watchlist, Alerts) appears on /start (or /keyboard). Tapping a label is the same as the command.
- Every command that needed an argument now has a **guided prompt** when pressed as a button or sent bare: Coin / scan, Size, Price alert (coin, then Above/Below buttons, then price), Record a trade, Add to watchlist, Compare, Link account. Each prompt has a Cancel button.
- The main menu gained Compare, Simulator, Events, Heat, Record a trade, Price alert, Add to watchlist.
- Plain words work too: "menu", "plan", "trades", "me", "heat", "events" and so on.

## 35. Stage 36.2 - organized bot menu

The menu is now a short main menu (Today's plan, Confirmed, Market, My trading, Alerts & list, Tools, Settings, and Group in group chats). Each section opens its own sub-menu in the same message with a Back button, two buttons per row with short labels so every label is readable on a phone. The keyboard under the text box is 2 x 3: Plan, Trades, Coin, Me, Menu, Alerts.

## 36. Stage 36.3 - AI chat in Telegram, share card images fixed

Run `supabase/schema.sql` again (`telegram_users.ai_chat`). Re-open `/api/telegram/setup?secret=...` once (adds /ask to the command menu).

- **AI chat**: "🤖 Ask AI" on the keyboard, "Ask the AI anything" at the top of the menu, or `/ask your question`. In a private chat just type; in a group reply to the bot or mention it. The bot remembers the last few turns per person for 3 hours (so "and its stop?" or "why?" work), and **replying to any card, signal or answer** makes the AI answer about that message. Live facts come only from the engine data; general crypto knowledge is explained in plain words. "🧹 New chat" starts over. Needs the AI provider configured (`AI_BASE_URL` / key, as for the website assistant); without it the bot answers from templates.
- **Images fixed**: the chart image endpoint crashed (the renderer does not support SVG text), so Telegram never received a picture. It now renders, and coin cards and new-confirmed broadcasts send **the share card PNG (same as the website) and the chart with entry zone, TPs and SLs as one album**, uploaded by the server rather than fetched by Telegram. Broadcasts render each image once and reuse it for every recipient.

## 37. Stage 36.4 - AI model retired: automatic fallback and health check

`gemini-2.0-flash` was shut down by Google on 2026-06-01, so every AI call failed and the app quietly used its template writer. Now a retired or missing model makes the app try current models in order (Gemini: `gemini-3.6-flash`, `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-2.5-flash`; Groq: `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`) and remember the one that works. Calls time out after 25 s, and every fallback is logged in Vercel's function logs.

Recommended: set `AI_MODEL=gemini-3.6-flash` in Vercel. Check the setup any time at `https://<your-url>/api/ai/health?secret=<CRON_SECRET>`: it shows the provider, whether a key is set (never the key), the models tried, which one answered, and the exact error if none did.

## 38. Stages 37 to 40 - Holdings Radar, DCA planner, Market Movers, Academy

Run `supabase/schema.sql` again (adds `telegram_users.learn`). Re-open `/api/telegram/setup?secret=...` once for the new commands.

- **Stage 37 Holdings Radar** (`/radar`, Portfolio menu; bot `/holdings`, My trading menu): every coin you hold (latest wallet and read-only exchange snapshot, same coin merged across accounts, stablecoins and dust left out) with the engine's 4h and 1d view, its spot zone, and one plain action: confirmed SHORT means trim or protect on spot, daily bearish means set your exit, near a profit-taking zone, confirmed LONG, in the accumulation zone, trend up, watching, or hold. Flags any coin over 40% of the portfolio. "Refresh holdings" takes a new snapshot.
- **Stage 38 DCA planner** (`/dca`, Tools menu, "DCA plan" on spot cards and radar rows; bot `/dca BTC 200 [orders]` or Tools, DCA plan): splits a spot budget into 2 to 8 limit buys across the coin's accumulation zone (or its daily supports, or your own zone), equal or bigger-lower sizing, average price if all or some fill, a review level where the idea is wrong, and where to take profit later.
- **Stage 39 Market Movers** (`/movers`, Trade menu; bot `/movers`, Market menu): top gainers and losers of the last 24 hours among coins over 50M market cap, breadth (how many up vs down), volume spikes from the screener, what entered Confirmed and what lost it in the last day, each tagged when listed on your exchange.
- **Stage 40 Academy** (`/learn`, Tools menu; bot `/learn`, Tools, Learn): eight 3-minute lessons (stop loss, R multiples, position size and the 1% rule, the four categories, spot on Coinbase, order types, heat and losing streaks, reading a card), each with a 3-question quiz and an explanation per answer. Progress is kept in the browser on the website and per person in the bot.

## 39. Stage 40.1 - signals and patterns on the chart image

The chart PNG (Telegram cards, new-confirmed signals, website "Chart" buttons) now runs the engine on the candles it draws and shows the signals too: EMA 20 and EMA 50, the detected patterns (up to three: confirmed first, then forming, then recently completed) with their trendlines, channels, necklines and pivot points (HH, HL, L, 1, 2...) in green for bullish and red for bearish with a name tag, the breakout or breakdown level, and a bottom strip with the outlook and score, trend, RSI, MACD cross, volume vs average, the setup's side, kind, confidence and R, and the pattern list.

## 40. Stage 40.2 - SHORT setups on spot-only exchanges (Coinbase)

A SHORT cannot be opened on Coinbase spot, and a TP/SL bracket on a sell order expects the opposite levels, which made the guide's numbers look broken (stop above price, target below). On spot-only exchanges the trade guide and the order ticket now treat a SHORT as "sell what you hold": a limit sell in the sell zone with no TP/SL, optional limit buy-backs at the short's targets (each can get a normal bracket), and a price alert at the short's stop where the sell signal fails. The guide also opens on Spot by default for spot-only exchanges.

## 41. Stage 41 - one source of truth for Confirmed signals

Before this stage three parts of the app each decided "Confirmed" on their own. The screener (the hourly scan that sends the Telegram signal) used one exchange's candles; the bot's coin card re-analysed from your own exchange's candles with a different candle count and showed the raw chart verdict; the website re-checked every Confirmed row with the strict entry gates ten minutes later. A setup sitting right on a threshold could be sent as a signal, read "speculative" on the card a minute later, and be removed from the website on the next page load. The AI chat ran yet another live scan of its own.

Now the screener row is the signal, and everything reads it:

- **A Confirmed signal stays Confirmed, with the levels that were sent**, until one of these ends it: the stop is reached, TP1 is reached, the score fades back toward neutral (confirmation band minus 20), the engine flips to the other side, the market regime turns against it, or it gets too old (36 candles on 1h, 30 on 4h, 10 on 1d). The rule is `holdCheck()` in `src/lib/market/signal-state.ts`; the screener, the website re-check, the bot card and the share page all call it.
- **The bot card says where the coin stands in the signal system first**: "CONFIRMED signal, sent 2h ago, still active", or "Was Confirmed, signal ended 40m ago" with the reason, or "passes the chart checks, not a signal yet" when the live chart looks good but the scan has not sent it (the scan also checks the higher timeframe, the engine's record and the market regime).
- `/coin SOL` with no timeframe opens the timeframe that has the Confirmed signal. The card also lists other Confirmed timeframes of the same coin.
- Copy setup, Size it, I took it and the alert buttons use the signal's levels while it is active.
- The share page (`/s/<coin>/<tf>`, the "Full page" button) shows the same status banner and levels.
- The AI chat reads the same list as the website and the Trades button.
- All verdicts use the same candles (default exchange order, 300 candles). Your exchange setting still decides which coins are listed for you and the trading pair names.
- Follow-up messages: "no longer confirms" is only sent for a faded score, a flip or a regime change. A signal that ended at its stop or TP1 gets the stop or TP1 message instead.

No database change and no new environment variables. Signals that are Confirmed at the moment you deploy keep their status and get frozen levels from the next scan on.

## 42. Stage 42 - cleaner lists, plain reasons, track record up front

Driven by an outside review of the homepage. No database change and no new environment variables.

- **One headline at the top of the dashboard**: the market's state in one sentence (regime, Bitcoin trend, BTC dominance, Fear and Greed), how many Confirmed trades you can place on your exchange, and the best move for today. Endpoint: `/api/headline`.
- **Junk filter** (`src/lib/market/junk.ts`): stablecoins, wrapped or staked copies of another coin, and tokenized stocks, funds, treasuries and gold are recognised by ticker and name. The top coins table hides them by default with a "Real coins only" button to show everything again (remembered on the device). Trending, the 4h bullish and bearish picks and recovery candidates skip them too. The filter is a name-based best effort; a brand new token of that kind can slip through until its pattern is added.
- **Gainers, losers and unusual volume** only list real coins that are in the top 250 with at least $20M market cap, so one-buyer micro-caps no longer show up with +300%. Unusual volume ignores turnover above 100% of market cap, which is almost always a stale market cap or wash trading.
- **Coins outside the top 250** now carry a "high" risk badge instead of none.
- **Why nothing is Confirmed** (`src/lib/market/why.ts`): when there is no Confirmed trade you can place, the dashboard, the Confirmed tab and the bot's Trades button say why in plain words: how many signals exist but are SHORTs or not listed on your exchange, what the watched setups are missing most often, and which ideas are closest to confirming.
- **Empty lists explain themselves**: an empty "Top bullish" says how many of the checked coins are bearish and neutral instead of "Nothing qualifies right now".
- **Track record on the dashboard**: finished Confirmed signals, winners vs losers, win rate and average result, with a link to the full page (every signal, losers included). The card stays hidden until the worker has logged signals.
- **No more endless loading tiles**: Conditions, Regime and Fear and Greed say "data unavailable right now" when their source does not answer.
- **Phone**: the top coins table hides the 1h and volume columns on small screens.

## 43. Stage 43 - new logo, animated header logo and site-wide banner

No database change and no new environment variables.

- **Favicon**: `public/favicon.svg` and `src/app/favicon.ico` are the new mint "A" with the signal pulse.
- **App icons**: `public/icon-192.png` and `public/icon-512.png` are the new logo as still PNGs. They keep their names and stay PNG on purpose: phones and browsers only accept still images for the home-screen icon and for notification icons, and an animated GIF there would be shown frozen or rejected.
- **Animated logo in the app**: the header logo on every page is the looping GIF (`public/brand/logo.gif`). A 512 px copy is in `public/brand/logo-512.gif` for sharing.
- **Banner**: `src/components/SiteBanner.tsx` puts the animated banner across the very top of every page, above the header. It is always the full width of the screen and its height follows the width. Three renders of the same loop keep the text readable: `banner-desktop.gif` (1920 x 112, screens 1024 px and wider), `banner-tablet.gif` (1200 x 120, 640 to 1023 px) and `banner-mobile.gif` (780 x 130, phones). The banner scrolls away with the page; the header stays pinned as before. Tapping it goes to the dashboard.
- To change the banner, replace the three GIFs in `public/brand/` with files of the same size and name.
- Brand colour: mint `#36BD94` on `#0B0F14`.

## 44. Stage 44 - logo, banner and tab icon follow the theme

The header logo and the top banner are no longer GIF files. They are drawn live in the page (inline SVG, HTML and CSS animation), and every colour comes from the theme variables: `--bg`, `--bg-2`, `--fg`, `--fg-2`, `--border` and `--mint`. The text uses the page font, so the Terminal theme gets its monospace lettering and its scanlines over the banner like the rest of the app.

- Works for all six themes (Foundry, Terminal, Trader, Midnight, Ember, Paper) and switches instantly when the theme is changed.
- **Future themes need no extra work**: add the theme to `src/lib/themes.ts` (and its variables to `globals.css`) as before, and the logo, banner and tab icon pick up its colours. Nothing in the banner or logo code names a theme.
- **Browser-tab icon**: `ThemeFavicon` redraws the favicon in the active theme's colours on load and on every theme change. `public/favicon.svg` (Foundry colours) is the fallback before the page has loaded.
- The banner is still full width on every page above the header: 64 px tall on phones, 84 px on tablets, 108 px on desktop. It is sharper than the GIFs at any screen size and weighs almost nothing. The loop is seamless, and it holds still for people who have "reduce motion" turned on.
- **What cannot follow the theme**: the home-screen icon and notification icon (`icon-192.png`, `icon-512.png`). The phone stores those once, outside the app, so they stay in Foundry mint.
- Files: `src/components/BrandLogo.tsx`, `SiteBanner.tsx`, `ThemeFavicon.tsx`, styles under "brand mark and banner" in `globals.css`. The banner GIFs from stage 43 were removed; `public/brand/logo-512.gif` stays as a shareable Foundry-coloured logo.

## 45. Stage 45 - usability overhaul: grouped menus, sectioned dashboard, tour, speed

No database change and no new environment variables. The signal engine and its rules are untouched in this stage.

- **Menus grouped under sub-headings** (`src/lib/nav.ts`). Same five hubs, clearer names and order: Home, Trade (Signals, Research), My money (What I hold, My trading), Alerts, More (Tools, Learn, Results). The row under the header now shows only the pages of the section you are in, so it fits a phone. The phone menu uses the same sub-headings and has "Take the tour".
- **Dashboard in sections.** Order is now: today's headline, the check tiles, the signal list with its "why" panel, your setup checklist, then foldable sections: Your account, Market right now, Ideas and movers, Top coins. Tap a section title to fold it; each device remembers what you folded. The old Welcome card is replaced by the tour.
- **First-visit tour** (`src/components/Tour.tsx`): six short cards explaining the headline, the four categories, the trade plan, alerts and the track record. Shown once per device; replay it from the menu or by opening `/?tour=1`.
- **Speed.** The dashboard used to ask the server for the signal list three times and for the regime and conditions twice each. Cards now share one request per page (`src/lib/shared-fetch.ts`), and the server keeps the signal list for 30 seconds per exchange (`loadDiscoveryCached`) and the headline for 60 seconds. "Refresh live" on Trading Discovery still forces a fresh scan.
- **Bot**: the Today message opens with the same one-line headline as the website (`src/lib/headline.ts`).

## 46. Stage 45.1 - banner loop fix

The light that travels along the banner's chart line did not loop cleanly on wide screens: two or three lights showed at once and they jumped back mid-line when the loop restarted. Cause: the dash trick used for it is measured in screen pixels on a stretched line, so it only lined up at one width. The light is now a bright copy of the line seen through a narrow window that slides from off the left edge to off the right edge, so there is exactly one light and no visible restart at any width. The name "Confirmed Trades" is unchanged everywhere and stays that way.

## 47. Stage 45.2 - desktop menus stay open

The Trade, My money and More menus closed while the mouse travelled from the label down to the panel, because of a small empty gap between the two. Now:

- **Hover**: the menu stays open while the mouse is on the label or anywhere on the panel. There is no gap to cross, and leaving closes it only after a third of a second, so a small slip does not shut it.
- **Click**: clicking the label pins the menu open. It stays until you pick a page, click the label again, click anywhere else or press Escape. The hub's main page is the first entry in its menu.

## 48. Stage 46 - SquixiMutation, the mascot

No database change and no new environment variables.

- **The character**: `public/brand/squixi.webp` is the mascot's own 32-frame animation with the white background removed (transparent, so it sits on every theme). `squixi.png` is a still, `squixi-head.png` the face used on the Ask button and in the Ask panel.
- **Where it lives**: bottom-right corner, behind the Ask button. It is hidden until it has something to say, then pops out with a speech bubble and ducks back afterwards. About once a minute or two it pops up for a couple of seconds to wave, without a bubble.
- **Size**: 92 px tall on phones, 116 px on tablets, 140 px on wide desktops, 72 px on very short screens. The bubble is at most 350 px wide and never taller than about half the screen (it scrolls inside).
- **The bubble**: has an X to close. It also leaves by itself: after 14 seconds for a page hint, 60 to 90 seconds for a trade or pattern explanation. The timer pauses while the mouse or a finger is on it. Escape closes it too.
- **Ask**: the Ask button and panel are now "Ask SquixiMutation"; same answers as before, in the mascot's name.
- **🦑 on a chart** (token pages, next to "Set as default"): Squixi explains the trade on the timeframe you are looking at: direction, status, price now, entry zone, TP1 to TP3 with percent and R, SL1 and SL2, reward to risk, confidence, leverage, hold time, whether price is in the zone, what is still missing for a Confirmed Trade, what cancels the idea, and how to work the targets. With buttons to size it, place it and open the full page.
- **🦑 Explain on Trading Discovery cards** (Confirmed Trades and Watching): the same explanation for that card's trade.
- **Patterns**: tapping a pattern chip under the chart still shows or hides it on the chart, and Squixi now explains it: which way it leans, what its status means, the trigger level, target and cancel level, why it got its confidence, and what to do. Each pattern in the list below the chart has its own 🦑 as well.
- **Page hints**: the first time someone opens a kind of page (dashboard, token, Trading Discovery, size calculator, guide, plan, portfolio, alerts, track record, scanner, academy) Squixi gives one short hint. Once per device per page kind, never during the tour. "Stop page tips" in the bubble or "Tips on/off" in the Ask panel turns them, and the waving, off. The 🦑 buttons always work.
- **Adding lines for the mascot**: everything it says is in `src/lib/mascot.ts`. Any component can make it speak with `squixiSay({ title, text, rows, notes, actions })`.

## 49. Stage 47 - animated mascot: idle, pointing, waving

SquixiMutation now has three animations, all 32-frame seamless loops built from the original artwork:

- **Idle** (`public/brand/squixi-idle.webp`): the original loop. Plays when the mascot is just standing there: for about four seconds after a bubble is closed, and while the mouse is on the Ask button or on the mascot.
- **Pointing** (`squixi-point.webp`): one arm raised with the index finger up, wagging gently. Plays while explaining a trade or a pattern.
- **Waving** (`squixi-wave.webp`): raised fist rocking side to side. Plays for page hints and the occasional hello.
- **Reactions** (CSS): a small hop each time a new message starts, a lean toward the bubble for the first seconds of talking, a jump when the mouse touches the mascot.

How the raised arm was made: on every frame the original arm and glove are removed (and the bit of leg they covered is redrawn), then a new rubber-hose arm is drawn from the shoulder and the mascot's own glove is placed at the end of it, with a finger added for pointing. The body keeps its original movement underneath. The script that does this is not part of the app; the three files are simply images. To replace any pose with hand-drawn animation later, drop in a file with the same name and size (130 x 250, transparent).

The three files (about 300 KB each) are fetched the first time the mascot appears, not with the page.

## 50. Stage 48 - cancelled Confirmed Trades are always announced

Before this stage a "no longer confirms" message existed, but it was only sent if the worker happened to run within 15 minutes of the change, and never when a signal ended by a quick wick to its stop or TP1, or by old age. In practice most cancellations were never announced.

Now the follow-up worker (every 5 minutes) does two things for every open signal:

1. **Re-checks it against live candles**, with the same rule the screener uses, so an ended signal is noticed within minutes instead of at the screener's next visit (about once an hour per coin).
2. **Compares it with its screener row.** If that row is no longer the same Confirmed signal, everyone who received the signal gets one message:
   - `🚫 SOL SHORT 1h: Confirmed Trade CANCELLED (momentum faded)` with the engine's reason and what to do: cancel the unfilled limit order if price never reached the zone, tighten or close if you are in, or keep managing from break-even if TP1 was already hit.
   - Reasons covered: momentum faded, the chart flipped side, the market regime turned, the signal got too old, a newer signal replaced it, the coin left the scan list.
   - A stop or TP1 that was touched only by a candle wick between two checks now gets its "stop hit" or "TP1 hit" message too (marked "a candle wick reached it").

Other details: one cancellation message per signal, never repeated. Signals that ended more than 6 hours ago (for example before this version was installed) are closed quietly, so there is no burst of old news after deploying. If price had reached the entry zone, the trade keeps being tracked to TP or stop after the cancellation. People who logged the trade on the website and have no Telegram linked get the cancellation in the app (bell and push).

No database change and no new environment variables. Needs the GitHub Actions worker to be running (Actions tab, "worker" every 5 minutes).

## 51. Stage 49 - signal quality tools, status page, result cards, filters, recap

**One database change:** run `supabase/schema.sql` once (it adds `sig_filters` to `telegram_users` and `telegram_chats`). Everything except the signal filters works without it. No new environment variables. The worker file changed (one new step), so commit `.github/workflows/worker.yml` too.

1. **Signal quality**
   - **Wider stops in the Engine Lab, live rules unchanged.** The stop distances are now settings (`slMinAtr`, `slBufAtr`). Their defaults are the values the engine has always used (0.8 and 0.3 of an average candle), so live signals are exactly as before. Three new Lab variants test 1.2, 1.5 and 2.0, with the minimum-reward rules scaled to match. Give the Lab a day or two, then compare win rate and expectancy with "Production rules" on the Lab page. If one clearly wins, adopt it there; that changes the live rules without a new deploy.
   - **Same-bet warning.** A new Confirmed Trade that points the same way as another one still open says so: "Same bet as ETH 1h (short, still open). These coins move together: split your 1% risk between them, do not stack it."
   - **"Setup score 87/100", not "Confidence 87%".** In signal messages, bot cards and the mascot's explanation, with the note that it counts how many checks lined up and is not a win chance.
   - **Leverage on 1h and shorter is capped at 5x** (was 10x). 4h and 1d are unchanged.
2. **Status page** (`/status`, More menu, admins only: your email must be in `ADMIN_EMAILS`). Shows whether the worker ran recently, whether follow-ups are being checked, when the last signal went out, how many people receive signals, and whether CoinGecko, the exchange candles, Fear and Greed and the AI are answering. Also at `/api/status?secret=CRON_SECRET`.
3. **Result cards.** When a signal reaches TP2 or TP3, the Telegram message comes with a shareable card: coin, direction, percent move and R from the middle of the entry zone, entry, target, stop and time taken. It states that this is the result of the published plan, before leverage. Needs `NEXT_PUBLIC_SITE_URL`.
4. **Per-person signal filters.** In the bot: Signals screen. Each person (or group) picks timeframes (1h, 4h, 1d), longs only or both, and a minimum setup score (any, 60, 70, 80). Follow-ups only come for signals that passed the filters.
5. **Bot.** "🦑 Squixi explains it" on every coin card gives the same walk-through as the website's squid button. New "Signals recap" and "Track record" buttons in the Trading menu, `/recap` command. Ask is "Ask SquixiMutation".
6. **Squixi in more places.** A 🦑 on every journal trade (explains that trade's plan) and on every holdings radar row (explains what the read means for a coin you hold).
7. **Weekly recap.** Every Sunday from 18:00 UTC, once, everyone with signals on gets the week's Confirmed Trades graded: sent, reached TP1 or better, stopped, cancelled, still open, hit rate, best and stopped names, plus a plain block to paste into Root. On demand: `/recap` in the bot, or `/api/cron/recap?secret=CRON_SECRET&force=1` to send it now (`&dry=1` to only see it).

## 52. Stage 50 - traders share their own result cards

No database change and no new environment variables.

- **Card studio** (`/card`, More menu, Tools, "Result card"). A trader builds a picture of their own trade: coin, direction, entry, exit, optional stop (for the R number), leverage, dollar result and hours held. They choose:
  - the shape: wide (X, Telegram, Root), square (Instagram post) or story (Instagram, TikTok);
  - the background: eight presets (Foundry, Gold, Midnight, Ember, Aurora, Sunset, Terminal, Paper) or **their own picture**, with a slider to darken it so the text reads;
  - the accent colour (presets or any colour);
  - whether the dollar amount and the R number are shown, their name or handle, and a caption.
  Then Share (the phone's share sheet), Download PNG or Copy image.
- **The AsheSignal mark is always on the card**, top-left on its own dark plate so it stays readable on any background. It cannot be switched off or covered by the options.
- **Private by design.** The card is drawn on the trader's own device. A picture used as background is never uploaded, and nothing about the card is stored.
- **From the journal:** every closed trade has a "Share result" button that opens the studio with that trade's fill, exit, stop, leverage, result and holding time already filled in.
- **In the bot:** closing a trade now offers "Share result card", and the Journal has "Share my last result". The bot sends the card as a picture, with buttons to step through the backgrounds and to show or hide the dollar amount (hidden by default), plus a link to the studio for an own picture, colours and caption.
- **Honest labelling.** Personal cards say "Personal result shared by <name>" and that the numbers are the trader's own. The cards the bot posts for its own signals at TP2 and TP3 are unchanged and still say they are the result of the published plan.
- Files: `src/app/card/page.tsx`, `src/lib/card-presets.ts`, `src/app/api/result-card/route.tsx` (now also accepts `mine=1`, `bg`, `usd`, `lev`, `name`).

## 53. Stage 51 - members' results ticker and public nicknames

No database change (it uses the existing `display_name` column and the `preferences` field) and no new environment variables.

- **Results strip.** A thin strip under the header on every page scrolls members' latest closed trades, wins and losses alike: nickname, coin, long or short, timeframe and the percent result, with a running count of wins and losses. It pauses under the mouse or a finger, loops without a jump, stands still (scrollable by hand) for people who turned motion off, and hides itself when there is nothing to show. Tapping "Member results" opens the result card page.
- **What it shows and what it never shows.** Shown: nickname, coin, direction, timeframe, percent. Never shown: email, real name, amounts of money, position size, balance. Paper trades are left out. Trades come from members' own journals (closed in the last 30 days, newest first, at most four per member so one person cannot fill the strip).
- **Public nickname** (Account page, "Public nickname"). 3 to 20 characters: letters, numbers, spaces, dots, dashes, underscores. Emails, links, phone-like numbers and names that look like staff ("admin", "AsheSignal", "support" and so on) are refused. Until someone picks a nickname they appear under an automatic alias such as `Trader-7K2Q`, which is made from the account and reveals nothing.
- **Opt out.** The same setting has a checkbox "Show my closed trades on the results strip". It is on by default; unticking it removes that member's trades from the strip within a minute or two.
- **Honest labelling.** These are results members logged themselves. The strip is titled "Member results", not "verified results". The engine's own graded record is still the Track record page.
- Files: `src/lib/nickname.ts`, `src/app/api/ticker/route.ts`, `src/components/ResultsTicker.tsx`, `src/components/NicknameSetting.tsx`.
