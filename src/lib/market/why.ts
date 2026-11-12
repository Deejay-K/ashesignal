// Stage 42 - "Why are there no Confirmed trades for me?" in plain words: what is blocking the setups being watched,
// which signals exist but cannot be placed on the user's exchange, and which ideas are closest to confirming.
// Built from the same Discovery items every screen uses, so it costs nothing extra.

import type { Opportunity } from "./opportunities";
import { VENUE_META, type VenueId } from "../venues";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface WhyNone {
  headline: string;
  blockers: { key: string; label: string; count: number; plain: string }[];
  closest: { symbol: string; id: string | null; tf: string | null; side: string; missing: string }[];
  hidden: { shorts: number; notListed: number };
  watching: number;
}

const GATES: { key: string; test: RegExp; label: string; plain: string }[] = [
  { key: "trigger", test: /^No (bullish|bearish) trigger/, label: "No trigger yet", plain: "Price has not closed through a key level or finished a pattern. The idea is there, the starting gun is not." },
  { key: "score", test: /^Score /, label: "Score too weak", plain: "Trend, momentum and volume together are not strong enough yet." },
  { key: "volume", test: /^Volume /, label: "Volume too low", plain: "Not enough trading behind the move to trust it." },
  { key: "stretch", test: /^Price is .* ATR/, label: "Price already ran", plain: "The move happened without a pullback. Buying here is chasing." },
  { key: "rsi", test: /^RSI /, label: "RSI extreme", plain: "Momentum is stretched to an extreme; new entries here tend to reverse." },
  { key: "volatility", test: /^Volatility regime/, label: "Too volatile", plain: "Swings are so wide that a sensible stop gets hit by noise." },
  { key: "reward", test: /^TP[12] pays/, label: "Reward too small", plain: "The nearest target does not pay enough for the risk to the stop." },
  { key: "stop", test: /^No structural level/, label: "No solid stop level", plain: "There is no support or resistance to hide the stop behind." },
];

export function explainNoConfirmed(items: Opportunity[], venue: VenueId): WhyNone | null {
  const vm = VENUE_META[venue];
  const onVenue = (i: Opportunity) => i.venues.includes(venue);
  const conf = items.filter((i) => i.category === "confirmed");
  const mine = conf.filter((i) => onVenue(i) && (vm.canShort || i.side !== "SHORT"));
  if (mine.length) return null;
  const hidden = { shorts: conf.filter((i) => onVenue(i) && i.side === "SHORT" && !vm.canShort).length, notListed: conf.filter((i) => !onVenue(i)).length };
  const watch = items.filter((i) => i.category === "watching" && onVenue(i));
  const usable = watch.filter((i) => { const s = (i.detail as any)?.setup; return s && (vm.canShort || s.side === "LONG"); });
  const bearish = watch.filter((i) => (i.detail as any)?.setup?.side === "SHORT").length;
  const tally = new Map<string, number>();
  const bump = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
  const closest: (WhyNone["closest"][number] & { gaps: number; conf: number })[] = [];
  for (const i of usable) {
    const d: any = i.detail ?? {};
    const gaps: string[] = d.setup?.confirmGaps ?? [];
    const seen = new Set<string>();
    for (const g of gaps) { const m = GATES.find((x) => x.test.test(g)); if (m && !seen.has(m.key)) { seen.add(m.key); bump(m.key); } }
    const w: { what: string }[] = d.watch ?? [];
    if (d.regimeGap) bump("regime");
    if (w.some((x) => /against the higher timeframe/.test(x.what))) bump("htf");
    if (w.some((x) => /engine record here does not/.test(x.what))) bump("record");
    if (d.signal?.state === "ended") bump("ended");
    const outer = d.regimeGap ? "The market regime is against it" : w.find((x) => /against the higher timeframe|engine record/.test(x.what))?.what ?? null;
    const missing = gaps[0] ?? outer;
    if (missing && d.setup?.kind !== "watch") closest.push({ symbol: i.symbol, id: i.assetKey.startsWith("cg:") ? i.assetKey.slice(3) : null, tf: i.timeframe, side: d.setup.side, missing, gaps: gaps.length + (outer ? 1 : 0), conf: Number(d.setup.confidence ?? 0) });
  }
  const extra: Record<string, { label: string; plain: string }> = {
    regime: { label: "Market regime is against it", plain: "The overall market (Bitcoin's trend and how many coins are rising) does not support this direction right now." },
    htf: { label: "Bigger timeframe disagrees", plain: "The setup looks fine on its own chart but points against the trend one timeframe up, where most stops get hit." },
    record: { label: "Weak record on this chart", plain: "The engine's recent signals on this coin and timeframe did not pay, so it will not confirm here yet." },
    ended: { label: "Signal already played out", plain: "It was Confirmed earlier and has since reached TP1 or its stop, or faded." },
  };
  const blockers = [...tally.entries()].map(([key, count]) => { const g = GATES.find((x) => x.key === key) ?? { label: extra[key].label, plain: extra[key].plain }; return { key, label: g.label, count, plain: g.plain }; }).sort((a, b) => b.count - a.count).slice(0, 5);
  closest.sort((a, b) => a.gaps - b.gaps || b.conf - a.conf);
  const parts: string[] = [`No Confirmed trades you can place on ${vm.label}${vm.canShort ? "" : " (longs only)"} right now.`];
  if (hidden.shorts) parts.push(`${hidden.shorts} Confirmed signal${hidden.shorts === 1 ? " is a SHORT" : "s are SHORTs"}, which ${vm.label} spot cannot place: the market is leaning down.`);
  if (hidden.notListed) parts.push(hidden.notListed === 1 ? `1 Confirmed signal is for a coin ${vm.label} does not list.` : `${hidden.notListed} Confirmed signals are for coins ${vm.label} does not list.`);
  if (usable.length) parts.push(`${usable.length} ${vm.canShort ? "setup" : "long idea"}${usable.length === 1 ? " is" : "s are"} being watched${blockers[0] ? `; the most common thing missing: ${blockers[0].label.toLowerCase()} (${blockers[0].count})` : ""}.`);
  else if (!vm.canShort && bearish) parts.push(`Nothing on the long side is close: ${bearish} of the watched setups are bearish.`);
  else parts.push("Nothing is close to confirming either. Waiting is the trade.");
  return { headline: parts.join(" "), blockers, closest: closest.slice(0, 4).map(({ symbol, id, tf, side, missing }) => ({ symbol, id, tf, side, missing })), hidden, watching: watch.length };
}
