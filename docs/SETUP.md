# AsheSignal — Setup (Windows / VS Code / GitHub / Vercel)

AsheSignal is a standalone app: its own folder, its own GitHub repo, its own Vercel project, its own Supabase project. It shares nothing with any other app.

## 1. Run locally (works with zero keys)

1. Unzip into `D:\DEV Stuff\ashesignal` and open the folder in VS Code.
2. Terminal (`Ctrl+``):
   ```
   npm install
   npm run dev
   ```
3. Open http://localhost:3000. Dashboard, token pages, discover, scanner, risk and sentiment all work right away in **guest mode**.

## 2. CoinGecko key (free, recommended — stops rate-limit errors)

Without a key CoinGecko allows ~30 requests/min and will sometimes answer `429`. The free Demo key makes it stable.

1. Go to https://www.coingecko.com/en/developers/dashboard and sign up (free).
2. Click **+ Add New Key** → copy the key (starts with `CG-`).
3. In the project folder, copy `.env.example` to **`.env.local`** (same folder as `package.json`).
4. Set:
   ```
   COINGECKO_API_KEY=CG-xxxxxxxxxxxxxxxxxxxx
   ```
5. Restart `npm run dev`. That's it — the code sends it as `x-cg-demo-api-key` automatically.

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

## 6. Checks

- `npm run build` must pass before pushing (Vercel runs the same build).
- `npx tsx scripts/selftest.ts` runs the analysis-engine regression test.
- If Binance returns errors (some regions/ISPs block `api.binance.com`), charts for CEX coins fall back to CoinGecko (flagged *estimated*). Tell me and I'll add a `BINANCE_BASE_URL` override.

## Guest vs account

| | Guest | Signed in |
|---|---|---|
| Market data, charts, analysis, scanner, discover, risk calc | ✓ | ✓ |
| Watchlist | this browser only | synced (Supabase) |
| Save setups + personal hit-rate (`/setups`) | ✗ | ✓ |
| Risk profile (balance, risk %, exposure, leverage) | this browser only | synced |
