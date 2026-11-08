// Shared by the website and the Telegram bot: where price sits relative to an entry zone, and the pre-trade
// checklist a manual trader should run before pressing Buy. Pure functions; callers fetch the inputs.

import type { SupabaseClient } from "@supabase/supabase-js";
import { marketRegime, regimeAllows } from "./market/regime";
import { globalConditions } from "./market/conditions";
import { heatIfAdded, type OpenTrade } from "./risk/heat";
import { venueListings, venuesFor, VENUE_META, type VenueId } from "./venues";
import { safe } from "./fetch";

export type ZoneState = "in" | "above" | "below" | "unknown";
export interface ZoneStatus { state: ZoneState; pct: number | null; label: string; advice: string; tone: "up" | "down" | "amber" | "muted" }

/**
 * Price vs entry zone. "Above" for a LONG means you would be chasing; "below" for a LONG means the zone was
 * cut through (check the stop). Mirrored for SHORT.
 */
export function zoneStatus(price: number | null | undefined, entry: { low: number; high: number } | null | undefined, side: "LONG" | "SHORT" | null | undefined): ZoneStatus {
  if (!price || !entry || !(entry.high > 0)) return { state: "unknown", pct: null, label: "zone unknown", advice: "", tone: "muted" };
  if (price >= entry.low && price <= entry.high) return { state: "in", pct: 0, label: "price in the entry zone", advice: "A limit order anywhere in the zone works; the stop and targets are measured from here.", tone: "up" };
  const above = price > entry.high;
  const pct = above ? ((price - entry.high) / entry.high) * 100 : ((entry.low - price) / entry.low) * 100;
  const chasing = (side ?? "LONG") === "LONG" ? above : !above;
  if (chasing) return { state: above ? "above" : "below", pct: +pct.toFixed(2), label: `${pct.toFixed(1)}% ${above ? "above" : "below"} the zone`, advice: pct > 3 ? "Do not chase. Set a limit order in the zone and let price come back, or skip it." : "Slightly past the zone: a limit order at the zone edge still keeps the plan intact.", tone: pct > 3 ? "down" : "amber" };
  return { state: above ? "above" : "below", pct: +pct.toFixed(2), label: `${pct.toFixed(1)}% ${above ? "above" : "below"} the zone`, advice: "Price went through the zone the wrong way. Check whether the stop would already be hit before entering.", tone: "amber" };
}

export type CheckLevel = "ok" | "warn" | "fail" | "info";
export interface Check { id: string; level: CheckLevel; label: string; detail: string }
export interface PreTrade { checks: Check[]; verdict: "go" | "careful" | "wait"; summary: string }

export interface PreTradeInput {
  symbol: string; side: "LONG" | "SHORT"; kind: string; price: number | null; entry: { low: number; high: number } | null;
  stop: number | null; venue: VenueId; riskUsd: number | null; confirmGaps?: string[];
  /** Account data when signed in; omit for guests. */
  account?: { open: OpenTrade[]; balance: number | null; limits: { maxHeatPct: number; maxOpen: number } } | null;
}

/** Runs every check the website and bot show before a trade is recorded. Network inputs are fetched here. */
export async function preTradeChecks(inp: PreTradeInput): Promise<PreTrade> {
  const [reg, cond, listings] = await Promise.all([safe(marketRegime()), safe(globalConditions()), venueListings()]);
  const checks: Check[] = [];
  const vm = VENUE_META[inp.venue];

  checks.push(inp.kind === "confirmed" ? { id: "kind", level: "ok", label: "Confirmed setup", detail: "All engine gates passed (trend, trigger, volume, R:R, higher timeframe, record, regime)." }
    : inp.kind === "spot" ? { id: "kind", level: "info", label: "Spot accumulation", detail: "Buy and hold plan, no leverage. The stop is a review level, not an order." }
    : { id: "kind", level: "warn", label: `Not confirmed (${inp.kind})`, detail: inp.confirmGaps?.[0] ?? "The engine is still missing a condition. You can trade it, but size smaller and expect a lower hit rate." });

  if (inp.side === "SHORT" && !vm.canShort) checks.push({ id: "venue", level: "fail", label: `${vm.label} cannot short`, detail: "Spot-only exchange. Use this as a sell or reduce signal if you hold the coin, or skip it." });
  else checks.push(venuesFor(inp.symbol, listings, inp.venue).includes(inp.venue) ? { id: "venue", level: "ok", label: `Listed on ${vm.label}`, detail: `Pair ${vm.instrument(inp.symbol, vm.quotes[0])}.` } : { id: "venue", level: "fail", label: `Not listed on ${vm.label}`, detail: "Switch exchange or skip. The candles come from another venue, so prices can differ slightly." });

  if (reg.ok && reg.data) { const g = regimeAllows(reg.data, inp.symbol, inp.side); checks.push(g.ok ? { id: "regime", level: "ok", label: `Regime ${reg.data.label} allows ${inp.side.toLowerCase()}s`, detail: reg.data.headline } : { id: "regime", level: "fail", label: `Regime ${reg.data.label} is against this ${inp.side.toLowerCase()}`, detail: g.reason ?? "" }); }
  else checks.push({ id: "regime", level: "info", label: "Regime unavailable", detail: "Could not load BTC trend and breadth right now." });

  const z = zoneStatus(inp.price, inp.entry, inp.side);
  if (z.state === "in") checks.push({ id: "zone", level: "ok", label: "Price in the entry zone", detail: z.advice });
  else if (z.state === "unknown") checks.push({ id: "zone", level: "info", label: "No entry zone", detail: "Enter your own fill and stop; the journal measures risk from them." });
  else checks.push({ id: "zone", level: z.tone === "down" ? "fail" : "warn", label: `Price ${z.label}`, detail: z.advice });

  if (inp.stop && inp.price) { const d = Math.abs(inp.price - inp.stop) / inp.price * 100; const hit = inp.side === "LONG" ? inp.price <= inp.stop : inp.price >= inp.stop; checks.push(hit ? { id: "stop", level: "fail", label: "Stop already hit", detail: `Price ${inp.price} is past the stop ${inp.stop}. The setup is invalid as written.` } : d < 0.4 ? { id: "stop", level: "warn", label: `Stop only ${d.toFixed(2)}% away`, detail: "Normal noise can take you out. Widen the stop (and shrink the size) or wait for a better entry." } : { id: "stop", level: "ok", label: `Stop ${d.toFixed(1)}% from price`, detail: "Place it as an attached stop order right after the entry fills." }); }
  else checks.push({ id: "stop", level: "fail", label: "No stop loss", detail: "Never enter without a stop. The size calculator needs it too." });

  if (cond.ok) {
    const soon = cond.data.events.filter((e) => e.impact === "High" && new Date(e.time).getTime() - Date.now() < 2 * 3_600_000 && new Date(e.time).getTime() > Date.now() - 30 * 60_000);
    checks.push(soon.length ? { id: "news", level: "warn", label: `High-impact event within 2 h: ${soon[0].title}`, detail: "Spreads widen and stops get hunted around releases. Wait until after, or use half size." } : { id: "news", level: "ok", label: "No high-impact event in the next 2 h", detail: cond.data.events[0] ? `Next: ${cond.data.events[0].title} at ${new Date(cond.data.events[0].time).toUTCString().slice(0, 22)}.` : "Calendar clear." });
  }

  if (inp.account) {
    const h = heatIfAdded(inp.account.open, { symbol: inp.symbol, side: inp.side, riskUsd: inp.riskUsd }, inp.account.balance, inp.account.limits);
    checks.push({ id: "heat", level: h.level === "stop" ? "fail" : h.level === "caution" ? "warn" : "ok", label: h.heatPct != null ? `Portfolio heat after this trade: ${h.heatPct}%` : `${h.openCount} trade${h.openCount === 1 ? "" : "s"} open after this one`, detail: h.messages[0] ?? `Limits: ${inp.account.limits.maxHeatPct}% heat, ${inp.account.limits.maxOpen} open.` });
    if (inp.riskUsd == null) checks.push({ id: "size", level: "warn", label: "No size yet", detail: "Enter the size so the money at risk is known before you place it." });
  } else checks.push({ id: "heat", level: "info", label: "Heat not checked", detail: "Sign in (or link the bot) to check this trade against your open risk." });

  const fails = checks.filter((c) => c.level === "fail").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  const verdict = fails ? "wait" : warns ? "careful" : "go";
  const summary = fails ? `${fails} blocker${fails === 1 ? "" : "s"}: ${checks.filter((c) => c.level === "fail").map((c) => c.label).join("; ")}.` : warns ? `${warns} warning${warns === 1 ? "" : "s"}: ${checks.filter((c) => c.level === "warn").map((c) => c.label).join("; ")}.` : "Everything lines up. Place it with the stop attached and let the plan work.";
  return { checks, verdict, summary };
}

/** Load the account part of PreTradeInput for a user (admin or user-scoped client). */
export async function accountForChecks(sb: SupabaseClient, userId: string): Promise<NonNullable<PreTradeInput["account"]>> {
  const [{ data: open }, { data: prof }] = await Promise.all([
    sb.from("saved_setups").select("symbol, side, risk_usd, timeframe").eq("user_id", userId).eq("taken", true).eq("paper", false).is("exit_price", null).eq("status", "open"),
    sb.from("profiles").select("trading_balance, preferences").eq("id", userId).maybeSingle(),
  ]);
  return { open: (open ?? []).map((t) => ({ symbol: t.symbol, side: t.side, riskUsd: t.risk_usd == null ? null : Number(t.risk_usd), timeframe: t.timeframe })), balance: prof?.trading_balance ? Number(prof.trading_balance) : null, limits: { maxHeatPct: Number(prof?.preferences?.maxHeatPct ?? 3), maxOpen: Number(prof?.preferences?.maxOpen ?? 3) } };
}
