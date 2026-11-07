// Engine self-test on synthetic candles (no network). Run: npx tsx scripts/selftest.ts
import { analyzeTimeframe } from "../src/lib/ta/analysis";
import { detectPatterns } from "../src/lib/ta/patterns";
import { sizePosition } from "../src/lib/risk/position";
import { rsi, macd, bollinger, atr } from "../src/lib/ta/indicators";
import type { Candle } from "../src/lib/types";

function synth(n: number, drift: number, vol: number, seed = 1): Candle[] {
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  let p = 100; const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const o = p; const r = (rnd() - 0.5) * 2 * vol + drift;
    const c = o * (1 + r); const h = Math.max(o, c) * (1 + rnd() * vol * 0.6); const l = Math.min(o, c) * (1 - rnd() * vol * 0.6);
    out.push({ time: 1_700_000_000 + i * 3600, open: o, high: h, low: l, close: c, volume: 1000 + rnd() * 2000 });
    p = c;
  }
  return out;
}

let fails = 0;
const check = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}`, info ?? ""); if (!ok) fails++; };

const up = synth(400, 0.002, 0.02, 7);
const down = synth(400, -0.002, 0.02, 11);
const flat = synth(400, 0, 0.004, 3);

const closes = up.map(c => c.close);
check("rsi in range", rsi(closes).slice(20).every(v => v >= 0 && v <= 100));
check("macd defined at end", Number.isFinite(macd(closes).hist.at(-1)!));
check("bollinger upper>lower", (() => { const b = bollinger(closes); return b.upper.at(-1)! > b.lower.at(-1)!; })());
check("atr positive", atr(up).at(-1)! > 0);

const aUp = analyzeTimeframe("1h", up)!;
const aDown = analyzeTimeframe("1h", down)!;
const aFlat = analyzeTimeframe("1h", flat)!;
check("uptrend scores bullish", aUp.score > 15, { score: aUp.score, outlook: aUp.outlook });
check("downtrend scores bearish", aDown.score < -15, { score: aDown.score, outlook: aDown.outlook });
check("flat is neutral-ish", Math.abs(aFlat.score) < 45, { score: aFlat.score });
check("reasons present", aUp.reasons.length >= 4, aUp.reasons.length);
check("levels found", aUp.levels.length > 0, aUp.levels.length);
check("too few candles → null", analyzeTimeframe("1h", up.slice(0, 30)) === null);

if (aUp.setup) {
  const s = aUp.setup;
  check("LONG setup direction", s.side === "LONG");
  check("TP ordered above entry", s.takeProfits.every((t, i) => t.price > s.entry.mid && (i === 0 || t.price > s.takeProfits[i - 1].price)), s.takeProfits.map(t => t.price.toFixed(2)));
  check("SL below entry & ordered", s.stopLosses[0].price < s.entry.mid && s.stopLosses[1].price < s.stopLosses[0].price, s.stopLosses.map(t => t.price.toFixed(2)));
  check("R:R positive", s.riskRewardTp2 > 0, s.riskRewardTp2);
  check("invalidation present", s.invalidation.length > 0);
  console.log("  setup:", s.kind, s.side, "entry", s.entry.mid.toFixed(2), "sl1", s.stopLosses[0].price.toFixed(2), "tp2", s.takeProfits[1].price.toFixed(2), "rr", s.riskRewardTp2, "conf", s.confidence, s.style, s.holdingPeriod);
} else console.log("  (no long setup):", aUp.setupReason);
if (aDown.setup) {
  const s = aDown.setup;
  check("SHORT setup direction", s.side === "SHORT");
  check("TP ordered below entry", s.takeProfits.every((t, i) => t.price < s.entry.mid && (i === 0 || t.price < s.takeProfits[i - 1].price)));
  check("SL above entry", s.stopLosses[0].price > s.entry.mid);
}

// pattern: build an explicit double bottom
const db: Candle[] = [];
let t = 1_700_000_000;
const seq = [...Array(30).fill(0).map((_, i) => 100 - i * 1.5), ...Array(15).fill(0).map((_, i) => 55 + i * 1.2), ...Array(15).fill(0).map((_, i) => 73 - i * 1.2), ...Array(25).fill(0).map((_, i) => 55 + i * 1.3)];
for (const p of seq) { db.push({ time: t += 3600, open: p, high: p * 1.01, low: p * 0.99, close: p, volume: 1000 }); }
const pats = detectPatterns(db);
check("double bottom detected", pats.some(p => p.name === "Double Bottom"), pats.map(p => `${p.name}/${p.status}`));

// risk
const r = sizePosition({ tradingBalance: 5000, riskPct: 1, maxExposurePct: 25, side: "LONG", entry: 100, stop: 95, takeProfits: [105, 110, 120] });
check("risk ≈ $50", Math.abs(r.riskUsd - 50) < 1, r.riskUsd);
check("position ≤ exposure cap", r.positionValueUsd <= 1250.01, r.positionValueUsd);
check("TP2 ≈ 2R", Math.abs(r.profits[1].rr - 2) < 0.15, r.profits[1].rr);
const bad = sizePosition({ tradingBalance: 5000, riskPct: 1, side: "LONG", entry: 100, stop: 105, takeProfits: [110] });
check("stop on wrong side rejected", !bad.ok, bad.warnings[0]);
const lev = sizePosition({ tradingBalance: 1000, riskPct: 2, leverage: 10, side: "SHORT", entry: 100, stop: 101, takeProfits: [97] });
check("leverage sizing ok", lev.ok && lev.marginUsd <= 1000, { notional: lev.positionValueUsd, margin: lev.marginUsd, capped: lev.capped });

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
