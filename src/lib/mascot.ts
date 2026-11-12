// Stage 46 - SquixiMutation, the AsheSignal mascot. This file is the mascot's voice: what it says about a trade,
// a pattern or a page. Any component can make it speak with squixiSay(); the Mascot component (in the layout)
// listens, pops the character out and shows the speech bubble. Pure and browser-safe: no network, no server code.

import { fmtUsd } from "./format";
import { VENUE_META, type VenueId } from "./venues";

export const SQUIXI = "SquixiMutation";
export const SQUIXI_SHORT = "Squixi";
export const SQUIXI_EVENT = "squixi:say";
export const SQUIXI_ASK_EVENT = "squixi:ask";
export const SQUIXI_TIPS_KEY = "ashesignal.squixi.tips";

export interface SquixiRow { k: string; v: string; tone?: "up" | "down" | "amber" }
export interface SquixiMsg {
  title: string; text?: string; rows?: SquixiRow[]; notes?: string[];
  actions?: { label: string; href: string }[];
  /** tip: a short page hint (leaves by itself quickly, can be turned off). info: something the user asked for. */
  kind?: "tip" | "info";
  holdMs?: number;
}

/** Make the mascot pop out and say something. Safe to call anywhere in the browser. */
export function squixiSay(m: SquixiMsg) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SQUIXI_EVENT, { detail: m }));
}
export function squixiAsk() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SQUIXI_ASK_EVENT));
}

export interface SetupLike {
  side: "LONG" | "SHORT" | string; kind?: string;
  entry: { low: number; high: number; mid?: number };
  takeProfits: { label?: string; price: number; rr?: number }[];
  stopLosses: { label?: string; price: number }[];
  riskRewardTp2?: number; rr?: number | null; confidence?: number | null;
  leverage?: { recommended?: number; maxSafe?: number } | null;
  holdingPeriod?: string; invalidation?: string[];
  quality?: { confirmGaps?: string[]; issues?: string[] }; confirmGaps?: string[]; issues?: string[];
}

const pct = (a: number, b: number) => `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(1)}%`;

/** Everything about one trade idea, the way a Trading Discovery card lays it out, in the mascot's words. */
export function setupBriefing(o: { symbol: string; id?: string | null; tf: string; price?: number | null; setup?: SetupLike | null; outlook?: string | null; score?: number | null; venue: VenueId; isSignal?: boolean; category?: string | null }): SquixiMsg {
  const vm = VENUE_META[o.venue];
  const s = o.setup;
  const sym = o.symbol.toUpperCase();
  if (!s) {
    return { kind: "info", title: `${sym} on ${o.tf}: no trade right now`, text: `I looked at ${sym} on the ${o.tf} chart and there is no trade plan worth taking yet.${o.outlook ? ` The chart reads ${o.outlook}${o.score != null ? ` (score ${o.score > 0 ? "+" : ""}${o.score})` : ""}.` : ""}`, notes: ["No plan is a fine answer. Try another timeframe, or set a \"when it confirms\" alert and let me come to you."], actions: [{ label: "Set an alert", href: `/alerts?${new URLSearchParams({ symbol: sym, id: o.id ?? "", type: "new_confirmed" })}` }] };
  }
  const long = s.side === "LONG";
  const mid = s.entry.mid ?? (s.entry.low + s.entry.high) / 2;
  const gaps = s.quality?.confirmGaps ?? s.confirmGaps ?? [];
  const issues = s.quality?.issues ?? s.issues ?? [];
  const confirmed = o.isSignal || o.category === "confirmed";
  const status = confirmed ? "Confirmed Trade: every check passed" : s.kind === "confirmed" ? "Passes the chart checks, not sent as a signal yet" : s.kind === "watch" ? "Watch only: not a trade yet" : "Speculative: one or more checks still missing";
  const rr = s.riskRewardTp2 ?? s.rr ?? s.takeProfits[1]?.rr ?? null;
  const rows: SquixiRow[] = [
    { k: "Direction", v: long ? "LONG (buy, aiming up)" : "SHORT (sell, aiming down)", tone: long ? "up" : "down" },
    { k: "Status", v: status, tone: confirmed ? "up" : "amber" },
  ];
  if (o.price) rows.push({ k: "Price now", v: fmtUsd(o.price) });
  rows.push({ k: "Entry zone", v: `${fmtUsd(s.entry.low)} to ${fmtUsd(s.entry.high)}` });
  s.takeProfits.slice(0, 3).forEach((t, i) => rows.push({ k: t.label ?? `TP${i + 1}`, v: `${fmtUsd(t.price)}  (${pct(t.price, mid)}${t.rr != null ? `, ${t.rr}R` : ""})`, tone: "up" }));
  s.stopLosses.slice(0, 2).forEach((t, i) => rows.push({ k: t.label ?? `SL${i + 1}`, v: `${fmtUsd(t.price)}  (${pct(t.price, mid)})`, tone: "down" }));
  if (rr != null) rows.push({ k: "Reward to risk", v: `${rr}R to TP2 (you aim to make ${rr}x what you risk)` });
  if (s.confidence != null) rows.push({ k: "Confidence", v: `${s.confidence}%` });
  rows.push({ k: "Leverage", v: vm.canShort ? `${s.leverage?.recommended ?? 1}x suggested${s.leverage?.maxSafe ? `, never above ${s.leverage.maxSafe}x` : ""}` : `1x (${vm.label} is spot, no leverage)` });
  if (s.holdingPeriod) rows.push({ k: "Hold time", v: s.holdingPeriod });
  const notes: string[] = [];
  if (o.price) {
    if (o.price >= s.entry.low && o.price <= s.entry.high) notes.push("Price is inside the entry zone right now: a limit order in the zone is the plan.");
    else if (long ? o.price > s.entry.high : o.price < s.entry.low) notes.push(`Price already left the zone (${pct(o.price, long ? s.entry.high : s.entry.low)} away). Do not chase it: wait for it to come back, or skip this one.`);
    else notes.push("Price has not reached the entry zone yet. Place a limit order in the zone and let it come to you.");
  }
  notes.push(`How to work it: take about a third off at each target. When TP1 is hit, move your stop to your entry price so the rest cannot lose.`);
  if (!confirmed && gaps[0]) notes.push(`Still missing for a Confirmed Trade: ${gaps[0]}`);
  if (s.kind === "watch" && issues[0]) notes.push(`Why it is only a watch: ${issues[0]}`);
  if (s.invalidation?.[0]) notes.push(`The idea is wrong if: ${s.invalidation[0]}`);
  if (!long && !vm.canShort) notes.push(`${vm.label} cannot open shorts. If you hold ${sym}, read this as a signal to sell or reduce; otherwise skip it.`);
  notes.push("Size it so one stopped trade costs about 1% of your account. I explain, you decide and place it yourself. Not financial advice.");
  const q = new URLSearchParams({ side: String(s.side), entry: String(mid), entryLow: String(s.entry.low), entryHigh: String(s.entry.high), stop: String(s.stopLosses[0]?.price ?? ""), tp1: String(s.takeProfits[0]?.price ?? ""), tp2: String(s.takeProfits[1]?.price ?? ""), tp3: String(s.takeProfits[2]?.price ?? ""), symbol: sym, venue: o.venue });
  const actions = [{ label: "Size it", href: `/risk?${q}` }, { label: "How to place it", href: `/guide?${q}` }];
  if (o.id) actions.push({ label: "Full page", href: `/s/${o.id}/${o.tf}` });
  return { kind: "info", title: `${sym} ${s.side} on ${o.tf}`, text: `Here is the whole plan for ${sym}, top to bottom.`, rows, notes, actions, holdMs: 90_000 };
}

const STATUS_PLAIN: Record<string, string> = {
  forming: "Forming: the shape is building but it has not triggered. It is a heads-up, not a trade.",
  confirmed: "Confirmed: price broke the trigger level, so the pattern is live.",
  completed: "Completed: it already reached its target. The move is done, do not enter late.",
  failed: "Failed: price broke the wrong way. The pattern no longer counts.",
  invalidated: "Invalidated: price crossed the level that cancels it. Ignore it for trading.",
};

/** Plain-language explanation of one detected chart pattern. */
export function patternBriefing(p: { name: string; bias: string; status: string; confidence: number; family?: string; description: string; criteria?: string[]; keyLevel?: number; target?: number; invalidation?: number }, tf: string, shownOnChart?: boolean): SquixiMsg {
  const bull = p.bias === "bullish";
  const rows: SquixiRow[] = [
    { k: "Leans", v: bull ? "Bullish (favours price going up)" : "Bearish (favours price going down)", tone: bull ? "up" : "down" },
    { k: "Status", v: p.status, tone: p.status === "confirmed" ? "up" : p.status === "forming" ? "amber" : undefined },
    { k: "Confidence", v: `${Math.round(p.confidence * 100)}%` },
  ];
  if (p.keyLevel != null) rows.push({ k: "Trigger level", v: `${fmtUsd(p.keyLevel)} (a candle close ${bull ? "above" : "below"} it confirms the pattern)` });
  if (p.target != null) rows.push({ k: "Measured target", v: fmtUsd(p.target), tone: "up" });
  if (p.invalidation != null) rows.push({ k: "Cancelled at", v: fmtUsd(p.invalidation), tone: "down" });
  const notes = [STATUS_PLAIN[p.status] ?? ""].filter(Boolean);
  if (p.criteria?.length) notes.push(`Why I rate it ${Math.round(p.confidence * 100)}%: ${p.criteria.slice(0, 3).join("; ")}.`);
  notes.push(p.status === "confirmed" ? "A pattern alone is not a trade. Check the setup card for the entry zone, targets and stop, and whether it is a Confirmed Trade." : p.status === "forming" ? "What to do: nothing yet. Watch the trigger level, or set an alert there." : "What to do: nothing. It is shown so you know the chart's history.");
  if (shownOnChart != null) notes.push(shownOnChart ? "I switched it on, so its lines are drawn on the chart now." : "I hid its lines from the chart. Tap it again to bring them back.");
  return { kind: "info", title: `${p.name} on ${tf}`, text: p.description, rows, notes, actions: [{ label: "Learn patterns", href: "/learn" }, { label: "Glossary", href: "/glossary#pattern-status" }], holdMs: 75_000 };
}

/** One short hint the first time someone lands on a kind of page. Keyed by path prefix; longest match wins. */
export const PAGE_TIPS: { prefix: string; id: string; title: string; text: string }[] = [
  { prefix: "/token", id: "token", title: "Want this chart explained?", text: "Tap the 🦑 button above the chart and I will walk you through the whole trade: entry, every target, the stop and what to do. Tap any pattern name and I explain that pattern." },
  { prefix: "/opportunities", id: "opps", title: "This is Trading Discovery", text: "Confirmed Trades passed every check. Watching is close. Tap 🦑 on any card and I explain that trade from entry to stop." },
  { prefix: "/risk", id: "risk", title: "Sizing a trade", text: "Type your account size and how much you accept to lose on one trade (1% is the classic). I work out how much to buy so a stopped trade costs exactly that." },
  { prefix: "/guide", id: "guide", title: "Placing the order", text: "This page turns a setup into the exact steps for your exchange. Follow it top to bottom; the numbers are already filled in." },
  { prefix: "/plan", id: "plan", title: "Today's plan", text: "Read this once a day: the stance, what to do with each open trade, and which setups are in their entry zone." },
  { prefix: "/portfolio", id: "portfolio", title: "Your holdings", text: "Connect a wallet or a read-only exchange key and I can tell you what the engine thinks of each coin you hold. I can never trade or withdraw." },
  { prefix: "/alerts", id: "alerts", title: "Alerts", text: "Set one \"new Confirmed Trade on my exchange\" alert and you can stop refreshing. I will ping you." },
  { prefix: "/track-record", id: "record", title: "The record", text: "Every signal is graded here, losers included. Check it before you trust anything I say." },
  { prefix: "/scanner", id: "scanner", title: "Scanner", text: "Paste any token or contract address and I check liquidity, holders and common rug-pull flags before you touch it." },
  { prefix: "/learn", id: "learn", title: "Academy", text: "Short lessons with quizzes. Ten minutes here saves a lot of expensive mistakes." },
  { prefix: "/", id: "home", title: `Hi, I am ${SQUIXI}`, text: "I live in this corner. Tap 🦑 next to a chart or a trade and I explain it, or press Ask to ask me anything about the market." },
];
export function tipFor(path: string) {
  return PAGE_TIPS.filter((t) => (t.prefix === "/" ? path === "/" : path === t.prefix || path.startsWith(t.prefix + "/") || path.startsWith(t.prefix + "?"))).sort((a, b) => b.prefix.length - a.prefix.length)[0] ?? null;
}
