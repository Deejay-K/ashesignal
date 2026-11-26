import { NextResponse } from "next/server";
import { broadcastConfirmed, type ConfirmedSignal } from "@/lib/telegram-broadcast";
import { deliverQueued } from "@/lib/delivery";
import type { Setup } from "@/lib/ta/analysis";
import { queueRow } from "@/lib/signal-queue";
import { ensureEngineConfig } from "@/lib/engine-config";
import { cronAuthorized, supabaseAdmin } from "@/lib/supabase/admin";
import { getMarkets } from "@/lib/providers/coingecko";
import { getOhlcv } from "@/lib/market/ohlcv";
import { analyzeTimeframe } from "@/lib/ta/analysis";
import { safe } from "@/lib/fetch";
import type { Timeframe } from "@/lib/types";
import { categorize, detailSnapshot, type EngineRecord } from "@/lib/market/categorize";
import { engineRecord } from "@/lib/ta/backtest";
import { marketRegime, regimeAllows } from "@/lib/market/regime";
import { holdCheck, SCREEN_CANDLES, type FrozenSetup, type HoldResult } from "@/lib/market/signal-state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const TFS: Timeframe[] = ["1h", "4h", "1d"];

/** Keeps coin_metrics fresh for the top 100 Binance-listed coins: 10 coins per call, 10 rotating batches. */
export async function GET(req: Request) {
  const t0 = Date.now();
  await ensureEngineConfig();
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });
  // Stage 56: the coin list comes from the shared CoinGecko cache. If CoinGecko refuses and nothing is saved yet, use
  // the coins the screener already follows, so a rate limit can never stop the screener (candles come from exchanges).
  let top = await safe(getMarkets(1, 150, false));
  let universeNote: string | null = null;
  if (!top.ok) {
    const { data: known } = await sb.from("coin_metrics").select("asset_key, symbol, name, price, market_cap, volume_24h, change_24h_pct").eq("timeframe", "4h").order("market_cap", { ascending: false, nullsFirst: false }).limit(150);
    if (!known?.length) return NextResponse.json({ error: top.error }, { status: 502 });
    universeNote = `CoinGecko unavailable (${top.error}); scanned the ${known.length} coins already followed`;
    console.warn(`[screen] ${universeNote}`);
    top = { ok: true, data: known.map((k: { asset_key: string; symbol: string; name: string | null; price: number | null; market_cap: number | null; volume_24h: number | null; change_24h_pct: number | null }) => ({ id: k.asset_key.replace(/^cg:/, ""), symbol: k.symbol, name: k.name ?? k.symbol, priceUsd: Number(k.price ?? 0), marketCapUsd: k.market_cap != null ? Number(k.market_cap) : null, volume24hUsd: k.volume_24h != null ? Number(k.volume_24h) : null, change24hPct: k.change_24h_pct != null ? Number(k.change_24h_pct) : null })) as unknown as Awaited<ReturnType<typeof getMarkets>> };
  }
  // Exchange-independent universe: top 100 by market cap (stablecoins and wrappers excluded). Candles come from
  // whichever CEX lists the coin (Binance, OKX, Bybit, Kraken, Coinbase in that order); the venue is stored per row.
  const EXCL = /^(USDT|USDC|DAI|FDUSD|TUSD|PYUSD|USDE|USDS|WBTC|WETH|STETH|WSTETH|CBBTC|RETH|WEETH|WBETH|XAUT|PAXG|BSC-USD|USD1|RLUSD)$/i;
  const coins = top.data.filter((c) => !EXCL.test(c.symbol)).slice(0, 100);
  const url = new URL(req.url);
  const BATCH = 10;
  const batches = Math.ceil(coins.length / BATCH);
  const all = url.searchParams.get("all") === "1";
  const batch = all ? -1 : url.searchParams.get("batch") != null ? Number(url.searchParams.get("batch")) % batches : Math.floor(new Date().getMinutes() / 5) % batches;
  const slice = all ? coins : coins.slice(batch * BATCH, batch * BATCH + BATCH);
  const regime = await safe(marketRegime()).then((r) => (r.ok ? r.data : null));
  const rows: Record<string, unknown>[] = [];
  const { data: prevRows } = await sb.from("coin_metrics").select("asset_key, timeframe, category, category_since, detail, setup_kind").in("asset_key", slice.map((c) => `cg:${c.id}`));
  const prev = new Map((prevRows ?? []).map((r) => [`${r.asset_key}|${r.timeframe}`, r]));
  const history: Record<string, unknown>[] = [];
  const promoted: ConfirmedSignal[] = [];
  // Stage 52: every new signal is queued in the signals ledger; the deliver worker sends it and logs each decision.
  const queue: Record<string, unknown>[] = [];
  const hourBucket = new Date().toISOString().slice(0, 13);
  const queued = (c: { id: string; symbol: string; name: string; volume24hUsd?: number | null }, tf: Timeframe, a: { setup: Setup; price: number }, kind: "confirmed" | "speculative", qualifies: string[], rank: number | null, htfAligned: boolean | null) => queueRow({ c, tf, setup: a.setup, price: a.price, kind, qualifies, rank, htfAligned, hourBucket });
  await Promise.all(slice.map(async (c) => {
    const ks = await Promise.all(TFS.map((tf) => safe(getOhlcv({ symbol: c.symbol, coingeckoId: c.id }, tf, SCREEN_CANDLES))));
    const analyses = ks.map((k, i) => (k.ok && k.data.quality === "verified" && k.data.candles.length ? analyzeTimeframe(TFS[i], k.data.candles) : null));
    ks.forEach((k, i) => {
      if (!k.ok || k.data.quality !== "verified" || !k.data.candles.length) return; // CEX candles only; no synthesized data in the screener
      const a = analyses[i];
      if (!a) return;
      const venue = k.data.source;
      // Gates beyond one timeframe: the next-higher timeframe and the engine's own record on this chart
      // (backtest only when the setup would otherwise confirm, to keep the worker inside its time budget).
      const htf = analyses[i + 1] ?? null;
      let record: EngineRecord | null = null;
      if (a.setup?.kind === "confirmed" && !all) record = engineRecord(TFS[i], k.data.candles);
      const reg = a.setup ? regimeAllows(regime, c.symbol, a.setup.side) : null;
      const ctx = { htf, record, regime: reg };
      const strict = categorize(a, ctx);
      const key = `cg:${c.id}|${TFS[i]}`;
      const before = prev.get(key);
      const now = new Date().toISOString();
      // A Confirmed signal keeps its status and its levels until the stop, TP1, a faded score, a flip or old age ends
      // it (holdCheck). Without this a setup sitting on a threshold flipped in and out on every scan.
      const frozen = before?.category === "confirmed" ? ((before.detail as { setup?: FrozenSetup } | null)?.setup ?? null) : null;
      let hold: HoldResult | null = null;
      if (frozen) { const fr = regimeAllows(regime, c.symbol, frozen.side); hold = holdCheck({ a, candles: k.data.candles, setup: frozen, since: before!.category_since ?? now, tf: TFS[i], regimeOk: fr.ok, regimeReason: fr.reason }); }
      const held = !!(frozen && hold?.held);
      const ended = !!(frozen && hold && !hold.held);
      // An ended signal drops to watching (or none) for this scan even if the gates pass again: a fresh signal with
      // fresh levels can only follow on a later scan, which also stops back-to-back repeats.
      const category = held ? "confirmed" : ended && strict.category === "confirmed" ? "watching" : strict.category;
      const reasons = held ? (((before!.detail as { qualifies?: string[] } | null)?.qualifies) ?? strict.reasons) : ended ? [hold!.reason!, ...(strict.category === "confirmed" ? [] : strict.reasons)] : strict.reasons;
      const changed = (before?.category ?? "none") !== category;
      const rank = coins.findIndex((x) => x.id === c.id) + 1 || null;
      const htfAligned = a.setup && htf ? !(a.setup.side === "LONG" ? htf.trend.direction === "down" || htf.score <= -15 : htf.trend.direction === "up" || htf.score >= 15) : null;
      if (changed && category === "confirmed" && a.setup) {
        promoted.push({ coingeckoId: c.id, symbol: c.symbol, name: c.name, timeframe: TFS[i], price: a.price, setup: a.setup, qualifies: strict.qualifies });
        queue.push(queued(c, TFS[i], { setup: a.setup, price: a.price }, "confirmed", strict.qualifies, rank, htfAligned));
      }
      // Speculative setups are logged too (not sent unless a member switched speculative alerts on), so the recap can grade them.
      if (a.setup?.kind === "speculative" && before?.setup_kind !== "speculative") queue.push(queued(c, TFS[i], { setup: a.setup, price: a.price }, "speculative", strict.qualifies, rank, htfAligned));
      if (changed) history.push({ asset_key: `cg:${c.id}`, symbol: c.symbol, timeframe: TFS[i], category, prev_category: before?.category ?? "none", reason: category === "confirmed" ? strict.qualifies.slice(0, 2).join(" ") : ended ? `Signal ended: ${hold!.reason}` : category === "watching" ? strict.reasons.slice(0, 2).join("; ") : "Setup no longer qualifies.", snapshot: a.setup ? { side: a.setup.side, kind: a.setup.kind, confidence: a.setup.confidence, entry: a.setup.entry.mid, tp1: a.setup.takeProfits[0]?.price, sl1: a.setup.stopLosses[0]?.price, score: a.score, price: a.price, ...(ended ? { end: hold!.end } : {}) } : { score: a.score, price: a.price, ...(ended ? { end: hold!.end } : {}) } });
      const snap = detailSnapshot(a, strict, ctx) as Record<string, unknown>;
      const detail = held
        ? { ...snap, setup: frozen, qualifies: reasons, watch: [], signal: { state: "active", since: before!.category_since } }
        : ended
          ? { ...snap, qualifies: [], watch: [{ what: "Was Confirmed, signal ended", why: hold!.reason, needs: "A fresh confirmation on a later scan." }, ...(strict.category === "confirmed" ? [] : strict.watch)], signal: { state: "ended", end: hold!.end, at: now, reason: hold!.reason } }
          : category === "confirmed" ? { ...snap, signal: { state: "active", since: now } } : snap;
      const st = held ? frozen! : a.setup;
      rows.push({ venue, bt_n: record?.n ?? null, bt_winrate: record?.winRate ?? null, bt_expectancy: record?.expectancyR ?? null, category, category_since: changed ? now : before?.category_since ?? now, watch_reasons: reasons, detail, liquidity_note: `${c.volume24hUsd != null && c.marketCapUsd ? ((c.volume24hUsd / c.marketCapUsd) * 100).toFixed(1) + "% of market cap traded in 24h" : ""}`, asset_key: `cg:${c.id}`, symbol: c.symbol, name: c.name, timeframe: TFS[i], price: a.price, market_cap: c.marketCapUsd, volume_24h: c.volume24hUsd, change_24h_pct: c.change24hPct, score: a.score, outlook: a.outlook, opportunity: a.opportunityScore, rsi: a.momentum.rsi, atr_pct: a.volatility.atrPct * 100, vol_ratio: a.volume.ratio, vol_regime: a.volatility.regime, trend: a.trend.direction, macd_cross: a.momentum.macdCross, breakout: a.breakout.type, setup_side: st?.side ?? null, setup_kind: held ? "confirmed" : a.setup?.kind ?? null, setup_rr: held ? frozen!.rr ?? null : a.setup?.riskRewardTp2 ?? null, setup_confidence: st?.confidence ?? null, leverage: held ? frozen!.leverage?.recommended ?? null : a.setup?.leverage.recommended ?? null, patterns: [...a.patterns.confirmed, ...a.patterns.forming].slice(0, 4).map((p) => `${p.name} (${p.status})`), updated_at: now });
    });
  }));
  // A setup that flickers between speculative and not is logged once per coin, timeframe and side every 6 hours.
  if (queue.some((q) => q.kind === "speculative")) {
    const { data: recent } = await sb.from("signals").select("asset_key, timeframe, side").eq("kind", "speculative").in("asset_key", slice.map((c) => `cg:${c.id}`)).gt("created_at", new Date(Date.now() - 6 * 3_600_000).toISOString());
    const seen = new Set((recent ?? []).map((r: { asset_key: string; timeframe: string; side: string }) => `${r.asset_key}|${r.timeframe}|${r.side}`));
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].kind === "speculative" && seen.has(`${queue[i].asset_key}|${queue[i].timeframe}|${queue[i].side}`)) queue.splice(i, 1);
  }
  // Stage 55: the queue is written first. If it cannot be written for any reason (stage52.sql not run, a bad row, a
  // database hiccup), Confirmed Trades are sent the stage 51 way below instead, so Telegram never goes quiet, and the
  // coin status is still saved so the website stays current.
  let queueWarning: string | null = null;
  let directSignals: ConfirmedSignal[] = [];
  if (queue.length) {
    let { error: qe } = await sb.from("signals").upsert(queue, { onConflict: "dedupe_key", ignoreDuplicates: true });
    const missingTable = (e: { message?: string; code?: string } | null) => !!e && (/does not exist|schema cache|Could not find the table/i.test(e.message ?? "") || e.code === "42P01" || e.code === "PGRST205");
    if (qe && !missingTable(qe)) ({ error: qe } = await sb.from("signals").upsert(queue, { onConflict: "dedupe_key", ignoreDuplicates: true })); // one retry
    if (qe) {
      // The write may have landed even though the reply was lost: rows that are in the queue are sent from the queue.
      let inQueue = new Set<string>();
      if (!missingTable(qe)) {
        const { data: there } = await sb.from("signals").select("dedupe_key").in("dedupe_key", queue.map((q) => String(q.dedupe_key)));
        inQueue = new Set((there ?? []).map((t: { dedupe_key: string }) => t.dedupe_key));
      }
      const missingKeys = new Set(queue.filter((q) => q.kind === "confirmed" && !inQueue.has(String(q.dedupe_key))).map((q) => `${q.asset_key}|${q.timeframe}`));
      directSignals = promoted.filter((p) => missingKeys.has(`cg:${p.coingeckoId}|${p.timeframe}`));
      if (directSignals.length || missingTable(qe)) {
        queueWarning = missingTable(qe)
          ? `signals table missing (run supabase/stage52.sql): ${directSignals.length} Confirmed Trade(s) sent directly instead of queued`
          : `signal queue not written (${qe.message}): ${directSignals.length} Confirmed Trade(s) sent directly instead`;
        console.error(`[ledger] ${queueWarning}`);
      }
    }
  }
  if (rows.length) {
    const { error } = await sb.from("coin_metrics").upsert(rows, { onConflict: "asset_key,timeframe" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (history.length) await sb.from("category_history").insert(history);
  await sb.from("category_history").delete().lt("changed_at", new Date(Date.now() - 90 * 86_400_000).toISOString());

  // Send now, in this same request, like stage 51 did. The deliver step in the worker only finishes what is left.
  let telegram: unknown = null;
  if (directSignals.length) {
    try { telegram = { direct: await broadcastConfirmed(sb, directSignals, { maxMessages: 60, deadline: t0 + 52_000 }) }; } catch (e) { telegram = { error: (e as Error).message }; console.error(`[screen] direct send failed: ${(e as Error).message}`); }
  }
  if (queue.length && !queueWarning && Date.now() - t0 < 25_000) {
    try { telegram = { deliver: await deliverQueued(sb, Math.max(5_000, 48_000 - (Date.now() - t0))) }; } catch (e) { telegram = { error: (e as Error).message }; console.error(`[screen] inline deliver failed: ${(e as Error).message}`); }
  }
  return NextResponse.json({ ok: true, batch: `${batch + 1}/${batches}`, coins: slice.map((c) => c.symbol), rows: rows.length, promoted: promoted.map((p) => `${p.symbol} ${p.setup.side} ${p.timeframe}`), queued: queue.length, telegram, ...(universeNote ? { universe: universeNote } : {}), ...(queueWarning ? { warning: queueWarning } : {}), at: new Date().toISOString() });
}
