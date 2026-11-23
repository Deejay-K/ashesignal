// Stage 52 offline tests for the signal ledger rules (no network, no database).
// Run: npx tsc --outDir <scratch> --module commonjs --target es2020 --moduleResolution node scripts/ledger-selftest.ts && node <scratch>/scripts/ledger-selftest.js
import { gradeSignal, statsOf, specCheck, PRESETS, type LedgerSignal } from "../src/lib/ledger";
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
check("zone and stop in the same candle: no_fill (conservative)", g?.outcome === "no_fill", g);
g = run(L, [fill, c(1, 100.1, 100.6, 100.4), c(2, 100.2, 100.8, 101)], { maxCandlesAfterFill: 2 });
check("still open after the candle limit: expired at last close, 1/3 x 1R", g?.outcome === "expired" && g.r === 0.33, g);
check("filled and still running: open (null)", run(L, [fill, c(1, 100, 100.5)]) === null);
const flat = Array.from({ length: 27 }, (_, i) => c(i, 101.2, 102, 101.6)); // stays above the zone (99-101)
check("never entered within 24h (candles cover the window): no_fill", run(L, flat, { now: now(26) })?.outcome === "no_fill", run(L, flat, { now: now(26) }));
check("never entered, but candles stop before the window ends: not decided (null)", run(L, flat.slice(0, 2), { now: now(26) }) === null);
check("never entered, window not yet over: open (null)", run(L, flat.slice(0, 4), { now: now(3) }) === null);
check("TP1 on the wrong side: unknown", gradeSignal({ ...L, tp1: 99 }, [fill], { maxCandlesAfterFill: 36 })?.outcome === "unknown");
check("candle history starts after the signal: unknown", gradeSignal(L, [c(1, 100, 101)], { maxCandlesAfterFill: 36, now: now(3) })?.outcome === "unknown");

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
check("daily cap reached blocks", specCheck(PRESETS.conservative, base, ctx({ sentToday: 2 })).ok === false);
check("cooldown after a stop on the same coin", specCheck(PRESETS.balanced, { ...base, timeframe: "1h" }, ctx({ stoppedAt: new Map([["SOL", Date.parse("2026-11-20T06:00:00Z")]]) })).ok === false);
check("one open trade per coin", specCheck(PRESETS.balanced, { ...base, timeframe: "1h" }, ctx({ openSymbols: new Set(["SOL"]) })).ok === false);
check("open-risk budget full", specCheck(PRESETS.conservative, base, ctx({ openCount: 3 })).ok === false);
check("subscriber timeframe pick narrows the preset", specCheck(PRESETS.balanced, { ...base, timeframe: "1h" }, ctx({ userTfs: ["4h"] })).ok === false);

console.log(fails ? `\n${fails} FAILED` : "\nall ledger checks passed");
process.exit(fails ? 1 : 0);
