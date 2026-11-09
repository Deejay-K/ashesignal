// The morning plan: one object that says what today looks like and what to do, built from the same sources as
// the rest of the app (regime, conditions, discovery, journal, heat). Rendered by /plan and by the bot's /plan.

import type { SupabaseClient } from "@supabase/supabase-js";
import { marketRegime, type Regime } from "./market/regime";
import { globalConditions, summarize } from "./market/conditions";
import { loadDiscovery, tradeableOn } from "./market/discovery";
import { getMarketsByIds } from "./providers/coingecko";
import { portfolioHeat } from "./risk/heat";
import { zoneStatus } from "./trade-check";
import { VENUE_META, type VenueId } from "./venues";
import { fmtUsd } from "./format";
import { safe } from "./fetch";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface PlanTrade { id: string; symbol: string; side: string; timeframe: string; status: string; paper: boolean; fill: number | null; price: number | null; pnlPct: number | null; toTp1Pct: number | null; toSlPct: number | null; action: string; tone: "up" | "down" | "amber" | "muted" }
export interface PlanSetup { symbol: string; coingeckoId: string; side: string; timeframe: string; confidence: number | null; rr: number | null; entry: { low: number; high: number } | null; stop: number | null; tp1: number | null; zone: ReturnType<typeof zoneStatus>; why: string | null }
export interface Plan {
  generatedAt: string; venue: VenueId;
  market: { verdict: string; headline: string; regime: Regime["label"] | null; regimeAdvice: string | null; stance: string };
  events: { title: string; time: string; impact: string }[];
  trades: PlanTrade[];
  setups: PlanSetup[]; watching: PlanSetup[];
  heat: { heatPct: number | null; openCount: number; maxHeatPct: number; maxOpen: number; budgetUsd: number | null; budgetTrades: number; message: string } | null;
  todo: string[];
}

export async function buildPlan(sb: SupabaseClient | null, userId: string | null, venue: VenueId): Promise<Plan> {
  const [regR, condR, disc] = await Promise.all([safe(marketRegime()), safe(globalConditions()), loadDiscovery(sb, { venue, verifyBudgetMs: 12_000 })]);
  const reg = regR.ok ? regR.data : null;
  const cond = condR.ok ? summarize(condR.data.conditions) : null;
  const events = condR.ok ? condR.data.events.filter((e: any) => e.impact === "High" && Date.parse(e.time) > Date.now() - 3_600_000 && Date.parse(e.time) < Date.now() + 36 * 3_600_000).slice(0, 4).map((e: any) => ({ title: e.title, time: e.time, impact: e.impact })) : [];
  const vm = VENUE_META[venue];
  const canTrade = tradeableOn(disc.items, venue);
  const toSetup = (i: any): PlanSetup => { const s = i.detail?.setup; return { symbol: i.symbol, coingeckoId: String(i.assetKey).replace(/^cg:/, ""), side: s?.side ?? i.side ?? "LONG", timeframe: i.timeframe ?? "4h", confidence: s?.confidence ?? i.confidence ?? null, rr: s?.rr ?? i.rr ?? null, entry: s?.entry ?? null, stop: s?.stopLosses?.[0]?.price ?? null, tp1: s?.takeProfits?.[0]?.price ?? null, zone: zoneStatus(i.price, s?.entry, s?.side), why: i.detail?.qualifies?.[0] ?? i.detail?.watch?.[0]?.what ?? null }; };
  const setups = canTrade.filter((i) => i.category === "confirmed").sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, 3).map(toSetup);
  const watching = canTrade.filter((i) => i.category === "watching").sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, 3).map(toSetup);

  let trades: PlanTrade[] = []; let heat: Plan["heat"] = null;
  if (sb && userId) {
    const [{ data: open }, { data: prof }] = await Promise.all([
      sb.from("saved_setups").select("id, symbol, side, timeframe, status, paper, fill_price, entry_low, entry_high, tp1, sl1, risk_usd, asset_key").eq("user_id", userId).eq("taken", true).is("exit_price", null).limit(20),
      sb.from("profiles").select("trading_balance, preferences").eq("id", userId).maybeSingle(),
    ]);
    const ids = [...new Set((open ?? []).map((t) => String(t.asset_key).replace(/^cg:/, "")).filter((x) => !x.startsWith("addr:")))];
    const mk = ids.length ? await safe(getMarketsByIds(ids)) : null;
    const px = new Map<string, number>(); if (mk?.ok) for (const m of mk.data) if (m.priceUsd) px.set(m.id, m.priceUsd);
    trades = (open ?? []).map((t) => {
      const fill = t.fill_price != null ? Number(t.fill_price) : (Number(t.entry_low) + Number(t.entry_high)) / 2;
      const price = px.get(String(t.asset_key).replace(/^cg:/, "")) ?? null;
      const dir = t.side === "LONG" ? 1 : -1;
      const pnl = price && fill ? ((price - fill) / fill) * 100 * dir : null;
      const toTp1 = price && t.tp1 ? ((Number(t.tp1) - price) / price) * 100 * dir : null;
      const toSl = price && t.sl1 ? ((price - Number(t.sl1)) / price) * 100 * dir : null;
      let action = "Hold. Let the plan work; do not move the stop further away."; let tone: PlanTrade["tone"] = "muted";
      if (t.status === "tp1" || t.status === "tp2") { action = `${t.status.toUpperCase()} reached: stop should be at break-even${t.status === "tp2" ? " or trailing" : ""}. If not yet, do it now.`; tone = "up"; }
      else if (t.status === "sl") { action = "Stop was hit. Confirm it filled on the exchange and close it in the journal."; tone = "down"; }
      else if (toSl != null && toSl < 0.6) { action = `Only ${toSl.toFixed(1)}% above the stop. Do nothing clever: either it holds or you are out as planned.`; tone = "amber"; }
      else if (toTp1 != null && toTp1 < 0.8 && toTp1 > 0) { action = `Within ${toTp1.toFixed(1)}% of TP1. Make sure the TP1 sell order is in place (30%).`; tone = "up"; }
      else if (pnl != null && pnl < 0 && pnl > -2) { action = "Slightly under water. Normal. The stop is your decision, already made."; tone = "muted"; }
      return { id: t.id, symbol: t.symbol, side: t.side, timeframe: t.timeframe, status: t.status, paper: !!t.paper, fill, price, pnlPct: pnl == null ? null : +pnl.toFixed(2), toTp1Pct: toTp1 == null ? null : +toTp1.toFixed(2), toSlPct: toSl == null ? null : +toSl.toFixed(2), action, tone };
    });
    const real = (open ?? []).filter((t) => !t.paper);
    const limits = { maxHeatPct: Number(prof?.preferences?.maxHeatPct ?? 3), maxOpen: Number(prof?.preferences?.maxOpen ?? 3) };
    const bal = prof?.trading_balance ? Number(prof.trading_balance) : null;
    const h = portfolioHeat(real.map((t) => ({ symbol: t.symbol, side: t.side, riskUsd: t.risk_usd == null ? null : Number(t.risk_usd) })), bal, limits);
    const budgetUsd = bal != null && h.heatPct != null ? Math.max(0, ((limits.maxHeatPct - h.heatPct) / 100) * bal) : null;
    heat = { heatPct: h.heatPct, openCount: real.length, ...limits, budgetUsd: budgetUsd == null ? null : +budgetUsd.toFixed(2), budgetTrades: Math.max(0, limits.maxOpen - real.length), message: h.messages[0] ?? "" };
  }

  // stance and to-do list in plain words
  const riskOff = reg?.label === "risk-off" || cond?.verdict === "avoid";
  const stance = cond?.verdict === "avoid" ? "Stand aside today: conditions say avoid. Manage open trades, take no new ones." : riskOff ? `Risk-off: ${vm.canShort ? "longs need extra proof; shorts have the wind." : `on ${vm.label} (spot) that means fewer, smaller buys or none.`}` : reg?.label === "risk-on" ? "Risk-on: longs are allowed; still only confirmed setups, still 1% risk." : reg?.label === "choppy" ? "Choppy: expect false breakouts. Half size, take TP1 quickly." : "Mixed: trade only what is confirmed and already in its zone.";
  const todo: string[] = [];
  for (const t of trades.filter((x) => x.tone === "up" || x.tone === "down" || x.tone === "amber")) todo.push(`${t.symbol}: ${t.action}`);
  const inZone = setups.filter((s) => s.zone.state === "in");
  if (inZone.length && !riskOff) todo.push(`${inZone.map((s) => s.symbol).join(", ")} ${inZone.length === 1 ? "is" : "are"} confirmed and in the entry zone: run the pre-trade check, then place with the stop attached.`);
  else if (setups.length && !riskOff) todo.push(`Confirmed but not in zone: ${setups.map((s) => `${s.symbol} (${s.zone.label})`).join(", ")}. Set limit orders in the zone or wait.`);
  if (!setups.length) todo.push(watching.length ? `Nothing confirmed for ${vm.label}. Watching: ${watching.map((w) => w.symbol).join(", ")}. Set "when it confirms" alerts and do something else.` : `Nothing confirmed or close for ${vm.label}. A day off is a valid trading day.`);
  if (heat && heat.budgetTrades === 0) todo.push(`You are at your ${heat.maxOpen}-trade limit. No new positions until one closes.`);
  else if (heat && heat.budgetUsd != null) todo.push(`Risk budget left today: ${fmtUsd(heat.budgetUsd)} (${heat.budgetTrades} more trade${heat.budgetTrades === 1 ? "" : "s"}).`);
  if (events.length) todo.push(`High-impact event${events.length > 1 ? "s" : ""}: ${events.map((e) => `${e.title} at ${new Date(e.time).toUTCString().slice(17, 22)} UTC`).join("; ")}. No entries in the 30 minutes around them.`);

  return { generatedAt: new Date().toISOString(), venue, market: { verdict: cond?.verdict ?? "unknown", headline: cond?.headline ?? "Conditions unavailable.", regime: reg?.label ?? null, regimeAdvice: reg?.advice ?? null, stance }, events, trades, setups, watching, heat, todo };
}
