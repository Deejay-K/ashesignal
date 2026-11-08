// Trade conditions: should you be trading right now at all?
// Global layer: economic calendar (high-impact USD events), crypto expiries, weekend liquidity.
// Asset layer: volume, volatility regime, liquidity, spread on the selected timeframe.

import { fetchJson, safe } from "@/lib/fetch";
import type { TimeframeAnalysis } from "@/lib/ta/analysis";
import { marketRegime } from "./regime";

export type Severity = "avoid" | "caution" | "info";
export interface Condition {
  severity: Severity;
  code: string;
  title: string; // short, for the banner
  detail: string;
  at?: string; // ISO time of the event, if any
}
export interface ConditionsReport {
  verdict: "avoid" | "caution" | "ok";
  headline: string;
  conditions: Condition[];
  events: CalendarEvent[]; // next 48h high-impact
  generatedAt: number;
  source: string;
}
export interface CalendarEvent {
  title: string;
  country: string;
  impact: "High" | "Medium" | "Low" | "Holiday";
  time: string; // ISO
  forecast?: string;
  previous?: string;
}

const HIGH_RISK_WINDOW_MIN = 90;

/* ---------- economic calendar ---------- */

interface FfEvent { title: string; country: string; date: string; impact: string; forecast?: string; previous?: string }

async function economicCalendar(): Promise<{ events: CalendarEvent[]; source: string }> {
  // ForexFactory public weekly feed (no key). Times are ISO with offset.
  const r = await safe(fetchJson<FfEvent[]>("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { provider: "faireconomy", ttl: 1_800_000 }));
  if (r.ok && Array.isArray(r.data)) {
    const ev = r.data
      .filter((e) => e.country === "USD" && (e.impact === "High" || e.impact === "Medium"))
      .map((e) => ({ title: e.title, country: e.country, impact: e.impact as CalendarEvent["impact"], time: new Date(e.date).toISOString(), forecast: e.forecast, previous: e.previous }))
      .filter((e) => Number.isFinite(Date.parse(e.time)));
    return { events: ev, source: "forexfactory" };
  }
  // Fallback: FOMC statement days (14:00 ET on the second day) for 2026.
  const fomc = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"];
  return { events: fomc.map((d) => ({ title: "FOMC Statement (scheduled)", country: "USD", impact: "High" as const, time: new Date(`${d}T19:00:00Z`).toISOString() })), source: "built-in FOMC schedule (calendar feed unavailable)" };
}

/** Last Friday of the month at 08:00 UTC (Deribit monthly expiry); CME expires the same day. */
function nextMonthlyExpiry(now: Date): Date {
  for (let m = 0; m < 2; m++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m + 1, 0, 8, 0, 0));
    while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1);
    if (d.getTime() > now.getTime() - 3_600_000) return d;
  }
  return now;
}

let globalCache: { at: number; value: Omit<ConditionsReport, "verdict" | "headline" | "generatedAt"> } | null = null;

export async function globalConditions(): Promise<Omit<ConditionsReport, "verdict" | "headline" | "generatedAt">> {
  if (globalCache && Date.now() - globalCache.at < 10 * 60_000) return globalCache.value;
  const now = new Date();
  const conditions: Condition[] = [];
  const { events, source } = await economicCalendar();
  const horizon = events.filter((e) => Date.parse(e.time) > now.getTime() - 2 * 3_600_000 && Date.parse(e.time) < now.getTime() + 48 * 3_600_000).sort((a, b) => a.time.localeCompare(b.time));
  for (const e of horizon) {
    const dtMin = (Date.parse(e.time) - now.getTime()) / 60_000;
    const label = `${e.title}${e.forecast ? ` (forecast ${e.forecast}, prev ${e.previous ?? "?"})` : ""}`;
    if (e.impact === "High" && Math.abs(dtMin) <= HIGH_RISK_WINDOW_MIN) conditions.push({ severity: "avoid", code: "macro_now", title: `${e.title} ${dtMin >= 0 ? "in " + Math.round(dtMin) + " min" : Math.round(-dtMin) + " min ago"}`, detail: `High-impact USD release: ${label}. Volatility spikes and spreads widen around the print; stops get hunted. Avoid new positions until ${HIGH_RISK_WINDOW_MIN} min after.`, at: e.time });
    else if (e.impact === "High" && dtMin > 0 && dtMin <= 24 * 60) conditions.push({ severity: "caution", code: "macro_soon", title: `${e.title} in ${dtMin < 120 ? Math.round(dtMin) + " min" : (dtMin / 60).toFixed(0) + " h"}`, detail: `High-impact USD release approaching: ${label}. Expect volatility; keep size small and avoid holding tight-stop trades through it.`, at: e.time });
    else if (e.impact === "Medium" && dtMin > 0 && dtMin <= 6 * 60) conditions.push({ severity: "info", code: "macro_medium", title: `${e.title} in ${(dtMin / 60).toFixed(1)} h`, detail: `Medium-impact USD data: ${label}.`, at: e.time });
  }
  const exp = nextMonthlyExpiry(now);
  const toExp = (exp.getTime() - now.getTime()) / 3_600_000;
  if (toExp >= -1 && toExp <= 24) conditions.push({ severity: "caution", code: "expiry", title: `Monthly options/futures expiry in ${toExp.toFixed(0)} h`, detail: "Deribit and CME monthly expiry (08:00 UTC last Friday). Price often pins near max-pain into expiry and moves sharply after.", at: exp.toISOString() });
  const day = now.getUTCDay();
  if (day === 0 || day === 6) conditions.push({ severity: "caution", code: "weekend", title: "Weekend session", detail: "Weekend liquidity is thinner: wider spreads, more wicks, and weekend moves often retrace on Monday." });
  const hour = now.getUTCHours();
  if (hour >= 21 || hour < 1) conditions.push({ severity: "info", code: "session_gap", title: "Low-liquidity hours (21:00-01:00 UTC)", detail: "Between the US close and Asia open volume is lowest; breakouts here are less reliable." });
  const reg = await safe(marketRegime());
  if (reg.ok && reg.data) {
    const r = reg.data;
    conditions.push({ severity: r.label === "risk-off" ? "caution" : "info", code: `regime_${r.label}`, title: `Market regime: ${r.label}`, detail: `${r.headline} ${r.advice} BTC ${r.btc.trend} (daily score ${r.btc.score > 0 ? "+" : ""}${r.btc.score}), breadth ${r.breadth.above50}% up over 30 d, alt-season gauge ${r.alts.altSeason}% (${r.alts.label})${r.alts.btcDominance != null ? `, BTC dominance ${r.alts.btcDominance}%` : ""}.` });
  }
  const value = { conditions, events: horizon, source };
  globalCache = { at: Date.now(), value };
  return value;
}

/* ---------- asset layer ---------- */

export function assetConditions(a: TimeframeAnalysis | null, extra?: { liquidityUsd?: number | null; spreadPct?: number | null; isDex?: boolean }): Condition[] {
  const out: Condition[] = [];
  if (a) {
    if (a.volume.ratio < 0.5) out.push({ severity: "avoid", code: "low_volume", title: `Low volume (${a.volume.ratio.toFixed(2)}x avg) - no trade`, detail: `Volume on ${a.timeframe} is ${a.volume.ratio.toFixed(2)}x its 20-period average. Moves without participation fail more often; wait for volume to return before trading this timeframe.` });
    else if (a.volume.ratio < 0.75) out.push({ severity: "caution", code: "soft_volume", title: `Soft volume (${a.volume.ratio.toFixed(2)}x avg)`, detail: `Participation on ${a.timeframe} is below average; favour confirmed setups only and smaller size.` });
    if (a.volatility.atrPct > 0.12) out.push({ severity: "avoid", code: "extreme_vol", title: `Extreme volatility (ATR ${(a.volatility.atrPct * 100).toFixed(1)}%)`, detail: "ATR above 12% of price per candle: stops cannot be placed sensibly and liquidation risk is severe." });
    else if (a.volatility.regime === "expanded") out.push({ severity: "caution", code: "expanded_vol", title: "Volatility expanded", detail: "Bollinger width is in the top 15% of its range: moves are extended, mean reversion risk is high." });
    if (a.volatility.regime === "squeeze") out.push({ severity: "info", code: "squeeze", title: "Volatility squeeze", detail: "Compression usually precedes a fast expansion; wait for the break rather than guessing direction." });
    if (a.momentum.rsi >= 80) out.push({ severity: "caution", code: "overbought", title: `RSI ${a.momentum.rsi.toFixed(0)} overbought`, detail: "Chasing longs here has poor expectancy; look for pullbacks." });
    if (a.momentum.rsi <= 20) out.push({ severity: "caution", code: "oversold", title: `RSI ${a.momentum.rsi.toFixed(0)} oversold`, detail: "Chasing shorts here has poor expectancy; look for bounces to sell." });
  }
  if (extra?.liquidityUsd != null) {
    if (extra.liquidityUsd < 25_000) out.push({ severity: "avoid", code: "thin_liquidity", title: `Liquidity $${(extra.liquidityUsd / 1000).toFixed(0)}K - no trade`, detail: "Pool liquidity under $25K: slippage and rug risk are severe." });
    else if (extra.liquidityUsd < 150_000) out.push({ severity: "caution", code: "low_liquidity", title: `Thin liquidity $${(extra.liquidityUsd / 1000).toFixed(0)}K`, detail: "Expect slippage on anything but tiny size." });
  }
  if (extra?.spreadPct != null && extra.spreadPct > 0.5) out.push({ severity: "caution", code: "wide_spread", title: `Cross-exchange spread ${extra.spreadPct.toFixed(2)}%`, detail: "Venues disagree on price: one is lagging or thin. Check your venue's price before entering." });
  return out;
}

export function summarize(conditions: Condition[]): { verdict: ConditionsReport["verdict"]; headline: string } {
  const avoid = conditions.filter((c) => c.severity === "avoid");
  const caution = conditions.filter((c) => c.severity === "caution");
  if (avoid.length) return { verdict: "avoid", headline: `Avoid trading (high risk): ${avoid.map((c) => c.title).join("; ")}` };
  if (caution.length) return { verdict: "caution", headline: `Trade with caution: ${caution.map((c) => c.title).join("; ")}` };
  return { verdict: "ok", headline: "No adverse conditions detected" };
}
