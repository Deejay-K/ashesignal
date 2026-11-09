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
