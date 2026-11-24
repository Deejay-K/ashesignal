/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 52 offline tests for the signal ledger rules (no network, no database).
// Run: npx esbuild scripts/ledger-selftest.ts --bundle --platform=node --outfile=/tmp/ledger-test.cjs && node /tmp/ledger-test.cjs
import { gradeSignal, statsOf, specCheck, PRESETS, withCustom, cleanCustom, cleanWatchlist, cleanOffset, type LedgerSignal } from "../src/lib/ledger";
import { alertPlan } from "../src/lib/watchdog";
import { RELEASES, releaseHtml, releaseText, unannounced } from "../src/lib/changelog";
import { decideConfirmed, decideSpec, localDayStart, type Recipient } from "../src/lib/delivery";
import { isPermanentFailure, isBotRejected } from "../src/lib/telegram";
import type { Candle } from "../src/lib/types";

let fails = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${info !== undefined ? " " + JSON.stringify(info) : ""}`); if (!ok) fails++; };

const T0 = Date.parse("2026-11-20T10:00:00Z") / 1000; // signal created here
const H = 3600;
// Long 1h signal: entry zone 99-101 (mid 100), stop 97 (risk 3), TP1 103 (1R), TP2 106 (2R), TP3 109 (3R)
const L: LedgerSignal = { side: "LONG", timeframe: "1h", created_at: new Date(T0 * 1000).toISOString(), entry_low: 99, entry_high: 101, entry_mid: 100, sl1: 97, tp1: 103, tp2: 106, tp3: 109 };
const c = (i: number, low: number, high: number, close = (low + high) / 2): Candle => ({ time: T0 + i * H, open: close, high, low, close, volume: 1 });
const fill = c(0, 99.5, 99.9); // touches the zone, no levels
const now = (i: number) => (T0 + i * H) * 1000;
const run = (sig: LedgerSignal, candles: Candle[], o: { now?: number; maxCandlesAfterFill?: number } = {}) => gradeSignal(sig, candles, { now: o.now ?? now(candles.length + 1), maxCandlesAfterFill: o.maxCandlesAfterFill ?? 36 });

// Grading
let g = run(L, [fill, c(1, 100, 103.5), c(2, 99.8, 100.5)]);
check("TP1 then stop at break-even: 0.3R", g?.outcome === "tp1" && g.r === 0.3, g);
g = run(L, [fill, c(1, 96.5, 99.5)]);
check("stop before TP1: -1R", g?.outcome === "stop" && g.r === -1, g);
g = run(L, [fill, c(1, 100, 103.5), c(2, 103, 106.5), c(3, 106, 109.5)]);
check("all three targets: 0.3+0.6+1.2 = 2.1R", g?.outcome === "tp3" && g.r === 2.1, g);
g = run(L, [fill, c(1, 100, 103.5), c(2, 103, 106.5), c(3, 99, 100.5)]);
check("TP2 then break-even stop: 0.9R", g?.outcome === "tp2" && g.r === 0.9, g);
g = run(L, [c(0, 96, 98.5), c(1, 99.5, 100.5)]);
check("stop reached before entry: no_fill", g?.outcome === "no_fill", g);
g = run(L, [c(0, 96.5, 101.5), c(1, 100, 100.5)]);
check("zone and stop in the same candle: counted as a loss (-1R), against the trade", g?.outcome === "stop" && g.r === -1, g);
g = run(L, [{ time: T0, open: 102, high: 102.5, low: 96.5, close: 97, volume: 1 }]);
check("candle opens above the zone and falls to the stop: went through the zone, -1R", g?.outcome === "stop" && g.r === -1, g);
g = run(L, [{ time: T0, open: 98, high: 98.2, low: 96.5, close: 97, volume: 1 }]);
check("candle already below the zone (gap) falls to the stop: never entered", g?.outcome === "no_fill", g);
g = run(L, [fill, c(1, 100.1, 100.6, 100.4), c(2, 100.2, 100.8, 101)], { maxCandlesAfterFill: 2 });
check("still open after the candle limit: expired at last close, 1/3 x 1R", g?.outcome === "expired" && g.r === 0.33, g);
check("filled and still running: open (null)", run(L, [fill, c(1, 100, 100.5)]) === null);
const flat = Array.from({ length: 27 }, (_, i) => c(i, 101.2, 102, 101.6)); // stays above the zone (99-101)
check("never entered within 24h (candles cover the window): no_fill", run(L, flat, { now: now(26) })?.outcome === "no_fill", run(L, flat, { now: now(26) }));
check("never entered, but candles stop before the window ends: not decided (null)", run(L, flat.slice(0, 2), { now: now(26) }) === null);
check("never entered, window not yet over: open (null)", run(L, flat.slice(0, 4), { now: now(3) }) === null);
check("TP1 on the wrong side: unknown", gradeSignal({ ...L, tp1: 99 }, [fill], { maxCandlesAfterFill: 36 })?.outcome === "unknown");
check("candle history starts after the signal: unknown", gradeSignal(L, [c(1, 100, 101)], { maxCandlesAfterFill: 36, now: now(3) })?.outcome === "unknown");

// The fill window is enforced inside the candle loop: a touch on day 2 does not count.
const late = [...Array.from({ length: 25 }, (_, i) => c(i, 101.2, 102, 101.6)), c(25, 99.5, 100.5)];
check("a zone touch after the 24h window is not a fill", run(L, late)?.outcome === "no_fill", run(L, late));
// Daily signal graded on hourly candles: expiry is 10 daily candles after the fill, not 10 hourly ones.
const D: LedgerSignal = { ...L, timeframe: "1d" };
const hourly = [fill, ...Array.from({ length: 245 }, (_, i) => c(i + 1, 100.2, 100.8, 100.6))];
check("1d on 1h candles: still open after 100 hours", gradeSignal(D, hourly.slice(0, 101), { maxCandlesAfterFill: 10, candleSeconds: 3600, now: now(101) }) === null);
const dExp = gradeSignal(D, hourly, { maxCandlesAfterFill: 10, candleSeconds: 3600, now: now(246) });
check("1d on 1h candles: expires 240 hours after the fill", dExp?.outcome === "expired" && dExp.exit_at === new Date((T0 + 240 * H) * 1000).toISOString(), dExp);
// Force close when a signal is about to leave the grading window
check("force close: a filled open trade closes at the last price", gradeSignal(L, [fill, c(1, 100.5, 101, 101)], { maxCandlesAfterFill: 36, forceClose: true, now: now(2) })?.outcome === "expired");
check("force close: an unfilled signal is never entered", gradeSignal(L, [c(0, 101.2, 102)], { maxCandlesAfterFill: 36, forceClose: true, now: now(1) })?.outcome === "no_fill");

// Short side mirrors the long: entry 100, stop 103, TP1 97 (1R), TP2 94 (2R)
const S: LedgerSignal = { side: "SHORT", timeframe: "1h", created_at: new Date(T0 * 1000).toISOString(), entry_low: 99, entry_high: 101, entry_mid: 100, sl1: 103, tp1: 97, tp2: 94, tp3: null };
g = run(S, [fill, c(1, 96.5, 99.5), c(2, 99.5, 100.5)]);
check("short: TP1 then break-even stop: 0.3R", g?.outcome === "tp1" && g.r === 0.3, g);
g = run(S, [fill, c(1, 99.5, 103.5)]);
check("short: stop before TP1: -1R", g?.outcome === "stop" && g.r === -1, g);

// Recap arithmetic
const rows = [
  { kind: "confirmed", timeframe: "1h", outcome: "tp1", r: 0.3, exit_at: "2026-11-20T11:00:00Z" },
  { kind: "confirmed", timeframe: "1h", outcome: "stop", r: -1, exit_at: "2026-11-20T12:00:00Z" },
  { kind: "confirmed", timeframe: "4h", outcome: "tp3", r: 2.1, exit_at: "2026-11-20T13:00:00Z" },
  { kind: "confirmed", timeframe: "4h", outcome: "stop", r: -1, exit_at: "2026-11-20T14:00:00Z" },
  { kind: "confirmed", timeframe: "4h", outcome: "expired", r: 0.33, exit_at: "2026-11-20T15:00:00Z" },
  { kind: "confirmed", timeframe: "4h", outcome: "no_fill", r: null, exit_at: null },
  { kind: "confirmed", timeframe: "4h", outcome: null, r: null, exit_at: null },
];
const st = statsOf(rows);
check("stats: wins and stops", st.wins === 2 && st.stops === 2, st);
check("stats: win rate excludes expired, no-fill and open", st.winRate === 50, st.winRate);
check("stats: total R", st.totalR === 0.73, st.totalR);
check("stats: max drawdown in R", st.maxDrawdownR === -1, st.maxDrawdownR);
check("stats: longest losing streak", st.longestLosing === 1, st.longestLosing);
check("stats: open and never-entered counted apart", st.open === 1 && st.noFill === 1, st);

// Speculative presets
const base = { symbol: "SOL", timeframe: "4h", side: "LONG" as const, entry_mid: 100, sl1: 97, rr_tp2: 2.5, confidence: 70, htf_aligned: true, market_rank: 10, volume_24h: 100_000_000 };
const ctx = (over: Partial<Parameters<typeof specCheck>[2]> = {}) => ({ nowMs: Date.parse("2026-11-20T12:00:00Z"), livePrice: 100.5, userTfs: null, sentToday: 0, openSymbols: new Set<string>(), stoppedAt: new Map<string, number>(), openCount: 0, ...over });
check("conservative: a clean signal passes", specCheck(PRESETS.conservative, base, ctx()).ok === true);
check("conservative: 1h is not in its timeframes", specCheck(PRESETS.conservative, { ...base, timeframe: "1h" }, ctx()).ok === false);
check("conservative: quiet hours at 23:30 UTC", specCheck(PRESETS.conservative, base, ctx({ nowMs: Date.parse("2026-11-20T23:30:00Z") })).ok === false);
check("balanced: passes at 12:00 UTC with a 0.5% move", specCheck(PRESETS.balanced, { ...base, timeframe: "1h" }, ctx()).ok === true);
check("balanced: 3am UTC is quiet", specCheck(PRESETS.balanced, base, ctx({ nowMs: Date.parse("2026-11-20T03:00:00Z") })).ok === false);
check("conservative: price 2% from entry is too far", specCheck(PRESETS.conservative, base, ctx({ livePrice: 102 })).ok === false);
check("all: no limits but a live price is still needed", specCheck(PRESETS.all, { ...base, rr_tp2: 0.5 }, ctx()).ok === true && specCheck(PRESETS.all, base, ctx({ livePrice: null })).ok === false);
// Freshness: movement since the signal, not distance from the entry (a pullback entry sits away from price by design)
const pullback = { ...base, entry_mid: 97, sl1: 94.5, price_at_signal: 100, tp1: 103 };
check("pullback LONG 3% below price passes Conservative when price has not run", specCheck(PRESETS.conservative, pullback, ctx({ livePrice: 100.4 })).ok === true);
check("pullback LONG: price ran 1.5% up since the signal is stale for Conservative", specCheck(PRESETS.conservative, pullback, ctx({ livePrice: 101.5 })).ok === false);
check("pullback LONG: price fell toward the entry is still fresh", specCheck(PRESETS.conservative, pullback, ctx({ livePrice: 98 })).ok === true);
check("TP1 already reached is stale", (specCheck(PRESETS.all, pullback, ctx({ livePrice: 103.2 })) as any).reason === "price already reached TP1");
check("price already past the stop is stale", (specCheck(PRESETS.all, pullback, ctx({ livePrice: 94 })) as any).reason === "price is already past the stop");
const shortPb = { ...base, side: "SHORT" as const, entry_mid: 103, sl1: 105.5, price_at_signal: 100, tp1: 97 };
check("pullback SHORT above price passes when price has not run down", specCheck(PRESETS.conservative, shortPb, ctx({ livePrice: 99.8 })).ok === true);
check("pullback SHORT: price dropped 2% since the signal is stale", specCheck(PRESETS.conservative, shortPb, ctx({ livePrice: 98 })).ok === false);
check("daily cap reached blocks", specCheck(PRESETS.conservative, base, ctx({ sentToday: 2 })).ok === false);
check("cooldown after a stop on the same coin", specCheck(PRESETS.balanced, { ...base, timeframe: "1h" }, ctx({ stoppedAt: new Map([["SOL", Date.parse("2026-11-20T06:00:00Z")]]) })).ok === false);
check("one open trade per coin", specCheck(PRESETS.balanced, { ...base, timeframe: "1h" }, ctx({ openSymbols: new Set(["SOL"]) })).ok === false);
check("open-risk budget full", specCheck(PRESETS.conservative, base, ctx({ openCount: 3 })).ok === false);
check("subscriber timeframe pick narrows the preset", specCheck(PRESETS.balanced, { ...base, timeframe: "1h" }, ctx({ userTfs: ["4h"] })).ok === false);


// Stage 54: coin list, member timezone, custom limits
check("coin list: a coin not on the list is skipped", specCheck(PRESETS.balanced, { ...base, timeframe: "1h" }, ctx({ watchlist: ["BTC", "ETH"] })).ok === false);
check("coin list: a coin on the list passes", specCheck(PRESETS.balanced, { ...base, timeframe: "1h" }, ctx({ watchlist: ["SOL"] })).ok === true);
check("timezone: 12:00 UTC is 03:00 at UTC-9, quiet for Balanced", specCheck(PRESETS.balanced, { ...base, timeframe: "1h" }, ctx({ utcOffset: -9 })).ok === false);
check("timezone: 03:00 UTC is 22:00 at UTC-5, not quiet for Balanced", specCheck(PRESETS.balanced, { ...base, timeframe: "1h" }, ctx({ nowMs: Date.parse("2026-11-20T03:00:00Z"), utcOffset: -5 })).ok === true);
check("timezone: wraps past midnight (+14 at 12:00 UTC is 02:00, quiet)", specCheck(PRESETS.balanced, { ...base, timeframe: "1h" }, ctx({ utcOffset: 14 })).ok === false);
const strict = withCustom(PRESETS.balanced, { minRr: 3 });
check("custom: a stricter R:R blocks a 2.5R setup", specCheck(strict, { ...base, timeframe: "1h" }, ctx()).ok === false);
check("custom: the fixed preset itself is not changed", PRESETS.balanced.minRr === 1.5 && strict.minRr === 3);
check("custom: values outside the button choices are ignored", JSON.stringify(cleanCustom({ minRr: 0.1, maxStopPct: 4, dailyCap: 999, junk: 1 })) === JSON.stringify({ maxStopPct: 4 }), cleanCustom({ minRr: 0.1, maxStopPct: 4, dailyCap: 999 }));
check("custom: empty means the preset as is", withCustom(PRESETS.all, {}) === PRESETS.all);
check("coin list cleaning: upper-case, unique, letters and digits", JSON.stringify(cleanWatchlist(["sol", "SOL", "e th", "<b>", 5])) === JSON.stringify(["SOL", "ETH", "B", "5"]), cleanWatchlist(["sol", "SOL", "e th", "<b>", 5]));
check("timezone cleaning: range -12 to 14, whole hours", cleanOffset("-5") === -5 && cleanOffset(15) === null && cleanOffset(1.5) === null && cleanOffset("") === null && cleanOffset(null) === null);

// Watchdog alert plan
const T = Date.parse("2026-11-22T12:00:00Z");
check("watchdog: first problem alerts", alertPlan({ state: "ok" }, "down", T) === "down");
check("watchdog: still down 1h after an alert stays quiet", alertPlan({ state: "down", alertedAt: new Date(T - 3_600_000).toISOString() }, "down", T) === "none");
check("watchdog: still down 7h after an alert reminds", alertPlan({ state: "down", alertedAt: new Date(T - 7 * 3_600_000).toISOString() }, "down", T) === "remind");
check("watchdog: recovery after an alert says so once", alertPlan({ state: "down", alertedAt: new Date(T - 600_000).toISOString() }, "ok", T) === "recovered");
check("watchdog: all good stays quiet", alertPlan({ state: "ok" }, "ok", T) === "none" && alertPlan({}, "ok", T) === "none");

// Sender decisions (Confirmed Trades and speculative alerts)
const coinbase: Recipient = { id: "1", group: false, venue: "coinbase", spec: "off", specTfs: null };
const binance: Recipient = { id: "2", group: false, venue: "binance", spec: "off", specTfs: null };
const group: Recipient = { id: "-3", group: true, venue: "binance", spec: "off", specTfs: null };
const shortSig = { timeframe: "4h", side: "SHORT", confidence: 70 };
check("confirmed: a SHORT on Coinbase is skipped with the reason", decideConfirmed(coinbase, shortSig, ["coinbase", "binance"])?.reason === "SHORT on Coinbase, which is spot only", decideConfirmed(coinbase, shortSig, ["coinbase", "binance"]));
check("confirmed: a coin not listed on the member's exchange is skipped", decideConfirmed(binance, { ...shortSig, side: "LONG" }, ["coinbase"])?.status === "skipped");
check("confirmed: an eligible member gets it (null = send)", decideConfirmed(binance, shortSig, ["binance"]) === null);
check("confirmed: a member filter is logged as filtered", decideConfirmed({ ...binance, filters: { longsOnly: true } }, shortSig, ["binance"])?.status === "filtered");
check("confirmed: a group gets it when any exchange lists the coin", decideConfirmed(group, shortSig, ["okx"]) === null && decideConfirmed(group, shortSig, [])?.status === "skipped");
const specRec: Recipient = { id: "4", group: false, venue: "binance", spec: "balanced", specTfs: null, watchlist: ["ETH"] };
const specSig = { symbol: "SOL", timeframe: "1h", side: "LONG", entry_mid: 100, sl1: 97, rr_tp2: 2.5, confidence: 70, htf_aligned: true, market_rank: 10, volume_24h: 1e8, coingecko_id: "solana" };
const noon = Date.parse("2026-11-20T12:00:00Z");
check("speculative: the member's coin list applies", decideSpec(specRec, specSig, ["binance"], new Map([["solana", 100.5]]), undefined, noon)?.reason === "Balanced preset: SOL is not on your coin list", decideSpec(specRec, specSig, ["binance"], new Map([["solana", 100.5]]), undefined, noon));
check("speculative: custom limits show in the reason", (decideSpec({ ...specRec, watchlist: [], custom: { minRr: 3 } }, specSig, ["binance"], new Map([["solana", 100.5]]), undefined, noon)?.reason ?? "").startsWith("Balanced (your limits) preset"));
check("speculative: passes when everything fits", decideSpec({ ...specRec, watchlist: [] }, specSig, ["binance"], new Map([["solana", 100.5]]), undefined, noon) === null);

// Member's own day (daily cap) and Telegram failure classes
check("local day: 03:00 UTC is still the previous day at UTC-5", localDayStart(Date.parse("2026-11-20T03:00:00Z"), -5) === Date.parse("2026-11-19T05:00:00Z"));
check("local day: UTC when no offset is set", localDayStart(Date.parse("2026-11-20T03:00:00Z"), null) === Date.parse("2026-11-20T00:00:00Z"));
check("telegram: 403 blocked is permanent", isPermanentFailure({ ok: false, code: 403, error: "Forbidden: bot was blocked by the user" }));
check("telegram: 400 bad request is permanent", isPermanentFailure({ ok: false, code: 400, error: "Bad Request: chat not found" }));
check("telegram: 429 rate limit is temporary", !isPermanentFailure({ ok: false, code: 429, retryAfter: 3 }));
check("telegram: network error (no code) is temporary", !isPermanentFailure({ ok: false, error: "fetch failed" }));
check("telegram: 401 wrong token is not blamed on the member", !isPermanentFailure({ ok: false, code: 401, error: "Unauthorized" }) && isBotRejected({ ok: false, code: 401 }));
check("telegram: 404 (token path not found) stops the run too", isBotRejected({ ok: false, code: 404, error: "Not Found" }) && !isBotRejected({ ok: false, code: 403 }));

// Release announcements
check("releases: nothing announced yet means all of them, newest first", unannounced(null).length === RELEASES.length && unannounced(null)[0].version === RELEASES[0].version);
check("releases: after 53 was announced only newer ones remain", unannounced("53").every((r) => Number(r.version) > 53) && unannounced(RELEASES[0].version).length === 0);
check("releases: the combined Telegram message stays under 4096 characters", releaseHtml(RELEASES).length < 4096, releaseHtml(RELEASES).length);
check("releases: a very long list still fits (truncated with a note)", releaseHtml(Array.from({ length: 30 }, () => RELEASES[0])).length < 4096);
check("releases: the inbox text mentions the extra updates", releaseText(RELEASES).includes("more update") === RELEASES.length > 1);
check("releases: no em or en dashes in the notes", !/[\u2013\u2014]/.test(JSON.stringify(RELEASES)));

console.log(fails ? `\n${fails} FAILED` : "\nall ledger checks passed");
process.exit(fails ? 1 : 0);
