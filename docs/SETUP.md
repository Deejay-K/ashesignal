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
- **Google Gemini**: https://aistudio.google.com/apikey → create key. Vercel env: `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `AI_API_KEY=<key>`, `AI_MODEL=gemini-2.0-flash`.
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
