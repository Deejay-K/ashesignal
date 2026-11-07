// Engine self-test on synthetic candles (no network). Run: npx tsx scripts/selftest.ts
import { analyzeTimeframe } from "../src/lib/ta/analysis";
import { detectPatterns } from "../src/lib/ta/patterns";
import { categorize, detailSnapshot } from "../src/lib/market/categorize";
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
  check("leverage advice present and sane", s.leverage.recommended >= 1 && s.leverage.recommended <= s.leverage.maxSafe && s.leverage.conservative <= s.leverage.recommended && s.leverage.aggressive >= s.leverage.recommended && s.leverage.liquidationPctAtRecommended > s.leverage.stopDistancePct * 2, s.leverage);
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
check("double bottom has drawable geometry", (pats.find(p => p.name === "Double Bottom")?.lines.length ?? 0) >= 2 && (pats.find(p => p.name === "Double Bottom")?.points.length ?? 0) === 2);
check("double bottom status is confirmed or completed", ["confirmed", "completed"].includes(pats.find(p => p.name === "Double Bottom")?.status ?? ""));
// targets always present (watch kind when neutral)
{
  const flatA = analyzeTimeframe("1h", flat)!;
  check("flat market still has a full target set", !!flatA.setup && flatA.setup.takeProfits.length >= 3 && flatA.setup.stopLosses.length === 2, flatA.setup ? { kind: flatA.setup.kind, tps: flatA.setup.takeProfits.length, issues: flatA.setup.quality.issues.length } : null);
  check("neutral score is labelled watch, not deleted", flatA.setup?.kind === "watch" || Math.abs(flatA.score) >= 15, { score: flatA.score, kind: flatA.setup?.kind });
  check("every target has a basis + reliability flag", !!flatA.setup && flatA.setup.takeProfits.every(t => t.basis && typeof t.reliable === "boolean"));
  // candlestick + structure detectors run without throwing on all synthetic sets
  for (const [n, set] of [["up", up], ["down", down], ["flat", flat]] as const) {
    const ps = detectPatterns(set);
    check(`patterns run on ${n} (${ps.length})`, Array.isArray(ps) && ps.every(p => ["forming", "confirmed", "completed", "failed", "invalidated"].includes(p.status)));
  }
}

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
if (fails) process.exit(1);

// ---- Stage 3: setup resolver ----
import { resolveAgainst } from "../src/lib/alerts/resolve";
{
  const mk = (seq: [number, number][]): Candle[] => seq.map(([h, l], i) => ({ time: 1_800_000_000 + i * 900, open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: 1 }));
  const created = new Date(1_800_000_000 * 1000).toISOString();
  const base = { id: "x", side: "LONG" as const, entry: 100, tp1: 105, tp2: 110, tp3: 120, sl1: 95, createdAt: created };
  let f2 = 0;
  const c2 = (n: string, ok: boolean, info?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"} ${n}`, info ?? ""); if (!ok) f2++; };
  c2("open while inside range", resolveAgainst(mk([[102, 99], [103, 98]]), base).status === "open");
  c2("tp1 then running", resolveAgainst(mk([[106, 99]]), base).status === "tp1");
  c2("sl first in same candle", resolveAgainst(mk([[106, 94]]), base).status === "sl");
  c2("tp2 then stopped keeps tp2", resolveAgainst(mk([[111, 99], [100, 94]]), base).status === "tp2");
  c2("tp3 terminal", resolveAgainst(mk([[121, 99]]), base).status === "tp3");
  const sh = { ...base, side: "SHORT" as const, tp1: 95, tp2: 90, tp3: 80, sl1: 105 };
  c2("short tp1", resolveAgainst(mk([[101, 94]]), sh).status === "tp1");
  c2("short sl", resolveAgainst(mk([[106, 99]]), sh).status === "sl");
  const r = resolveAgainst(mk([[108, 97]]), base);
  c2("mfe/mae recorded", r.maxFavorablePct === 8 && r.maxAdversePct === 3, r);
  console.log(f2 ? `\n${f2} RESOLVER FAILED` : "RESOLVER PASS");
  if (f2) process.exit(1);
}

// ---- Stage 16: category logic ----
{
  let f3 = 0;
  const c3 = (n: string, ok: boolean, info?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"} ${n}`, info ?? ""); if (!ok) f3++; };
  for (const a of [aUp, aDown, aFlat]) {
    const cat = categorize(a);
    c3(`category consistent with setup kind (${a.setup?.kind ?? "none"} -> ${cat.category})`, a.setup?.kind === "confirmed" ? cat.category === "confirmed" : cat.category !== "confirmed");
    if (cat.category === "confirmed") c3("confirmed has qualifies text", cat.qualifies.length >= 2);
    if (cat.category === "watching") c3("watching items have what/why/needs", cat.watch.every((w) => w.what && w.why && w.needs));
    const snap = detailSnapshot(a, cat);
    c3("snapshot serialisable and compact", JSON.stringify(snap).length < 12000 && snap.price === a.price);
  }
  console.log(f3 ? `\n${f3} CATEGORY FAILED` : "CATEGORY PASS");
  if (f3) process.exit(1);
}

// ---- Formatting rule: no em/en dashes anywhere in the project ----
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
{
  const bad: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (f === "node_modules" || f === ".next" || f === ".git") continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|css|md|sql|yml|js|json)$/.test(f) && /[\u2014\u2013]/.test(readFileSync(p, "utf8"))) bad.push(p);
    }
  };
  for (const d of ["src", "docs", "scripts", "supabase", "public"]) walk(d);
  if (/[\u2014\u2013]/.test(readFileSync("README.md", "utf8"))) bad.push("README.md");
  console.log(bad.length ? `FAIL em/en dashes found in: ${bad.join(", ")}` : "PASS no em/en dashes in project");
  if (bad.length) process.exit(1);
}

// ---- Stage 9: FIFO realized P&L + key encryption ----
import { realizedPnl } from "../src/lib/exchanges";
import { encrypt, decrypt } from "../src/lib/exchanges/crypto";
{
  let f9 = 0;
  const c9 = (n: string, ok: boolean, info?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"} ${n}`, info ?? ""); if (!ok) f9++; };
  const fills = [
    { id: "1", time: "2026-01-01T00:00:00Z", pair: "BTC/USD", base: "BTC", quote: "USD", side: "buy" as const, price: 100, amount: 1, fee: 1, feeAsset: "USD" },
    { id: "2", time: "2026-01-02T00:00:00Z", pair: "BTC/USD", base: "BTC", quote: "USD", side: "buy" as const, price: 200, amount: 1, fee: 1, feeAsset: "USD" },
    { id: "3", time: "2026-01-03T00:00:00Z", pair: "BTC/USD", base: "BTC", quote: "USD", side: "sell" as const, price: 300, amount: 1.5, fee: 1, feeAsset: "USD" },
  ];
  const r = realizedPnl(fills);
  // FIFO: sell 1 @300 from lot 100 (+200), 0.5 @300 from lot 200 (+50) = 250, minus fees 3 => 247; remaining 0.5 @ 200
  c9("FIFO realized", Math.abs(r.totalRealizedUsd - 247) < 1e-9, r.totalRealizedUsd);
  c9("remaining lot + avg cost", r.perAsset[0].remaining === 0.5 && r.perAsset[0].avgCost === 200, r.perAsset[0]);
  c9("non-USD quotes skipped", realizedPnl([{ ...fills[0], quote: "ETH" }]).unpricedQuotes.includes("ETH"));
  process.env.EXCHANGE_KEY_SECRET = "test-secret-for-selftest-0123456789";
  const blob = encrypt("hello-key");
  c9("encrypt/decrypt roundtrip", decrypt(blob) === "hello-key" && !blob.includes("hello"));
  console.log(f9 ? `\n${f9} EXCHANGE FAILED` : "EXCHANGE PASS");
  if (f9) process.exit(1);
}
