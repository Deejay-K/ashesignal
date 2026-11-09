// Ask AsheSignal: answers grounded in the app's own data. The model (when configured) only writes prose
// over a context the engine assembled; every number comes from the engine, never from the model.
// Without a remote model the local writer answers from templates. Never financial advice; manual trading only.

import { askJson, aiProvider, AI_MODEL } from "./claude";
import { stripDashes } from "./briefing";
import { globalConditions, summarize } from "@/lib/market/conditions";
import { marketRegime } from "@/lib/market/regime";
import { analyzeAsset } from "@/lib/market/analyze";
import { search as cgSearch } from "@/lib/providers/coingecko";
import { liveTaCategories } from "@/lib/market/live-opportunities";
import { portfolioHeat } from "@/lib/risk/heat";
import { venueListings, venuesFor, VENUE_META, type VenueId } from "@/lib/venues";
import { fmtUsd } from "@/lib/format";
import { safe } from "@/lib/fetch";
import { zoneStatus } from "@/lib/trade-check";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AssistantInput {
  question: string; venue: VenueId; userId?: string | null; sb?: SupabaseClient | null; adminSb?: SupabaseClient | null;
  history?: { role: "user" | "assistant"; text: string }[];
  /** Text of the message the user replied to (a bot card, a signal, an earlier answer). */
  quoted?: string | null;
  /** Coin the conversation was last about, for follow-ups like "and its stop?". */
  lastCoin?: { id: string; symbol: string; name: string } | null;
}
export interface AssistantAnswer { text: string; bullets?: string[]; links: { label: string; href: string }[]; intent: string; model: string; context: Record<string, unknown> }

type Intent = "coin" | "today" | "trades_for_me" | "my_trades" | "risk" | "regime" | "howto" | "spot" | "general";

const COIN_STOP = new Set(["TRADE", "TRADES", "TRADING", "NEW", "CONFIRMED", "WATCHING", "PLAN", "HELP", "BEST", "GOOD", "TOP", "HOT", "WHICH", "WHEN", "WHERE", "WHO", "ANY", "ALL", "ARE", "WILL", "YES", "NO", "PNL", "ATH", "ATL", "FOMO", "FUD", "HODL", "NFT", "APR", "APY", "KYC", "CPI", "FOMC", "FED", "GDP", "US", "UK", "EU", "CAD", "EUR", "GBP", "LOL", "OMG", "PLS", "THX", "I", "A", "THE", "AND", "OR", "IS", "ON", "IN", "TO", "MY", "ME", "WHAT", "HOW", "WHY", "SHOULD", "CAN", "DO", "IT", "OF", "FOR", "BUY", "SELL", "LONG", "SHORT", "TODAY", "NOW", "TP", "SL", "RR", "BTC?", "USD", "USDT", "USDC", "OK", "RSI", "MACD", "ATR", "EMA", "SMA", "AI", "ETF", "CEX", "DEX", "COINBASE", "KRAKEN", "BINANCE", "OKX", "BYBIT"]);

function detectIntent(q: string): Intent {
  const s = q.toLowerCase();
  if (/how (do|to)|place|order form|stop.?limit|oco|guide/.test(s)) return "howto";
  if (/my (trades?|journal|positions?|open|heat|risk)|am i|did i|how am i doing|p&l|pnl/.test(s)) return "my_trades";
  if (/position size|how much (should|can) i|size|risk per trade|leverage/.test(s)) return "risk";
  if (/regime|risk.?on|risk.?off|alt season|breadth|market (doing|look)|overall market|bitcoin trend/.test(s)) return "regime";
  if (/spot|long.?term|hold|accumulat|dca/.test(s)) return "spot";
  if (/what (should|can) i trade|trades? (for me|today|right now)|confirmed|setups?|watching|opportunit/.test(s)) return "trades_for_me";
  if (/today|conditions|news|weekend|safe to trade|good time/.test(s)) return "today";
  return "general";
}

/** What the question asks for: a side, timeframes (and ones it rules out), and whether it is about "approaching". */
export interface Request { side: "LONG" | "SHORT" | null; tfs: string[]; excluded: string[]; approaching: boolean }
export function parseRequest(q: string): Request {
  const s = q.toLowerCase();
  const side = /\b(long|longs|buy|buying|bullish|calls?)\b/.test(s) ? "LONG" : /\b(short|shorts|shorting|sell|bearish|puts?)\b/.test(s) ? "SHORT" : null;
  const all = ["15m", "1h", "4h", "1d", "1w"];
  const norm = (t: string) => t.replace(/^(\d+)\s*(m|min|mins|minute|minutes)$/, "$1m").replace(/^(\d+)\s*(h|hr|hrs|hour|hours)$/, "$1h").replace(/^(\d+)\s*(d|day|days|daily)$/, "$1d").replace(/^daily$/, "1d").replace(/^hourly$/, "1h").replace(/^weekly$/, "1w").replace(/^(\d+)\s*(w|week)$/, "$1w");
  const found = [...s.matchAll(/(?:^|[^a-z0-9])(\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week)|daily|hourly|weekly)(?![a-z])/g)].map((m) => norm(m[1].replace(/\s+/g, ""))).filter((t) => all.includes(t));
  const excluded = [...s.matchAll(/(?:not|no|without|except|exclude|ignore|skip)\s+(?:on\s+|the\s+|a\s+|in\s+)*(\d+\s*(?:m|h|d|w|min|hour|day|week)s?|daily|hourly|weekly)/g)].map((m) => norm(m[1].replace(/\s+/g, "").replace(/s$/, ""))).filter((t) => all.includes(t));
  const tfs = [...new Set(found.filter((t) => !excluded.includes(t)))];
  return { side, tfs, excluded, approaching: /approach|close to|near|getting close|about to|soon|coming|nearly|almost/.test(s) };
}

/** The coin a quoted bot message is about: "SOL LONG 4h", "Solana (SOL)", "NEW CONFIRMED: SOL ...". */
async function coinFromQuoted(t: string): Promise<{ id: string; symbol: string; name: string } | null> {
  const m = t.match(/\b([A-Z0-9]{2,10})\s+(?:🟢\s*|🔴\s*)?(?:LONG|SHORT)\b/) ?? t.match(/\(([A-Z0-9]{2,10})\)/) ?? t.match(/CONFIRMED:\s*([A-Z0-9]{2,10})/);
  if (!m) return null;
  return detectCoin(m[1]);
}

/** Well-known coins people write by name in normal sentences. */
const COIN_NAMES: Record<string, string> = { bitcoin: "BTC", ethereum: "ETH", ether: "ETH", solana: "SOL", ripple: "XRP", cardano: "ADA", dogecoin: "DOGE", polkadot: "DOT", chainlink: "LINK", avalanche: "AVAX", litecoin: "LTC", polygon: "POL", tron: "TRX", shiba: "SHIB", toncoin: "TON", stellar: "XLM", cosmos: "ATOM", uniswap: "UNI", aptos: "APT", arbitrum: "ARB", optimism: "OP", sui: "SUI", pepe: "PEPE", near: "NEAR", hedera: "HBAR", injective: "INJ", render: "RENDER", kaspa: "KAS" };

/**
 * Find the coin a question is about. Only an explicit mention counts: a ticker written in CAPITALS ("SOL", "BTC"),
 * a $ticker ("$sol"), or a well-known coin name ("solana", "bitcoin"). Ordinary words such as "trade", "today",
 * "plan" or "coinbase" are never treated as coins, even when a token with that name exists.
 */
export async function detectCoin(q: string): Promise<{ id: string; symbol: string; name: string } | null> {
  const words = q.replace(/[^\w$ ]/g, " ").split(/\s+/).filter(Boolean);
  const cands: string[] = [];
  for (const w of words) {
    const bare = w.replace(/^\$/, "");
    if (bare.length < 2 || bare.length > 10 || !/^[A-Za-z0-9]+$/.test(bare)) continue;
    const explicit = w.startsWith("$") || (bare === bare.toUpperCase() && /[A-Z]/.test(bare));
    const named = COIN_NAMES[bare.toLowerCase()];
    if (named) cands.push(named);
    else if (explicit && !COIN_STOP.has(bare.toUpperCase())) cands.push(bare.toUpperCase());
  }
  for (const c of cands.slice(0, 4)) {
    const r = await safe(cgSearch(c));
    if (!r.ok || !r.data.length) continue;
    const exact = r.data.find((x) => x.symbol.toUpperCase() === c);
    if (exact) return { id: exact.id, symbol: exact.symbol.toUpperCase(), name: exact.name };
  }
  return null;
}

export async function answer(input: AssistantInput): Promise<AssistantAnswer> {
  const q = input.question.trim().slice(0, 800);
  const venue = input.venue;
  const vm = VENUE_META[venue];
  let intent = detectIntent(q);
  let coin = intent !== "my_trades" && intent !== "risk" ? await detectCoin(q) : null;
  // Follow-ups: a reply to a card or signal is about that coin; otherwise keep talking about the last coin.
  if (!coin && input.quoted && intent !== "my_trades") coin = await coinFromQuoted(input.quoted);
  if (!coin && input.lastCoin && (intent === "general" || intent === "risk" || intent === "howto") && /\b(it|its|it's|this|that|the (stop|entry|target|trade|setup|coin)|stop|entry|target|tp\d?|sl|leverage|zone|hold|buy|sell|now|still|why)\b/i.test(q)) coin = input.lastCoin;
  if (coin && (intent === "general" || intent === "today" || intent === "trades_for_me")) intent = "coin";

  const ctx: Record<string, unknown> = { venue: vm.label, canShort: vm.canShort };
  const links: { label: string; href: string }[] = [];

  // Always: conditions + regime (cheap, cached)
  const [condR, regR] = await Promise.all([safe(globalConditions()), safe(marketRegime())]);
  const cond = condR.ok ? summarize(condR.data.conditions) : null;
  const regime = regR.ok ? regR.data : null;
  ctx.conditions = cond;
  ctx.regime = regime ? { label: regime.label, headline: regime.headline, advice: regime.advice, breadth: regime.breadth.above50, altSeason: regime.alts.altSeason, btcTrend: regime.btc.trend } : null;

  const req = parseRequest(q);
  ctx.request = req;
  if (intent === "coin" && coin) {
    const tfsWanted = (req.tfs.length ? req.tfs : ["1h", "4h", "1d"].filter((t) => !req.excluded.includes(t))) as ("15m" | "1h" | "4h" | "1d" | "1w")[];
    const a = await safe(analyzeAsset({ symbol: coin.symbol, coingeckoId: coin.id, venue }, tfsWanted.length ? tfsWanted : ["1h", "4h"]));
    const listings = await venueListings();
    const vs = venuesFor(coin.symbol, listings, venue);
    if (a.ok) {
      const tfs = Object.entries(a.data.timeframes).filter(([, t]) => !("unavailable" in t)).map(([tf, t]) => {
        const x = t as Exclude<typeof t, { unavailable: true }>;
        const above = x.levels.filter((l) => l.price > x.price).sort((p, r) => p.price - r.price)[0];
        const below = x.levels.filter((l) => l.price < x.price).sort((p, r) => r.price - p.price)[0];
        const z = x.setup ? zoneStatus(x.price, x.setup.entry, x.setup.side) : null;
        return { tf, priceNum: x.price, outlook: x.outlook, score: x.score, trend: x.trend.direction, rsi: +x.momentum.rsi.toFixed(0),
          nearestResistance: above ? { price: fmtUsd(above.price), pct: +(((above.price - x.price) / x.price) * 100).toFixed(2) } : null,
          nearestSupport: below ? { price: fmtUsd(below.price), pct: +(((x.price - below.price) / x.price) * 100).toFixed(2) } : null,
          zone: z ? { state: z.state, label: z.label, pct: z.pct } : null,
          setup: x.setup ? { side: x.setup.side, kind: x.setup.kind, entry: `${fmtUsd(x.setup.entry.low)} to ${fmtUsd(x.setup.entry.high)}`, tp1: fmtUsd(x.setup.takeProfits[0]?.price), tp2: fmtUsd(x.setup.takeProfits[1]?.price), sl1: fmtUsd(x.setup.stopLosses[0]?.price), rr: x.setup.riskRewardTp2, confidence: x.setup.confidence, gaps: x.setup.quality.confirmGaps.slice(0, 3), issues: x.setup.quality.issues.slice(0, 2) } : null, levels: x.levels.slice(0, 4).map((l) => `${l.kind} ${fmtUsd(l.price)}`), patterns: [...x.patterns.confirmed.map((p) => `${p.name} (confirmed)`), ...x.patterns.forming.map((p) => `${p.name} (forming)`)].slice(0, 4) };
      });
      ctx.coin = { ...coin, price: tfs[0] ? fmtUsd((a.data.timeframes[tfs[0].tf] as { price: number }).price) : null, consensus: a.data.consensus.summary, alignment: a.data.consensus.alignment, timeframes: tfs, listedOn: vs.map((v) => VENUE_META[v].label), tradeable: vs.includes(venue) };
    } else ctx.coin = { ...coin, error: a.error };
    links.push({ label: `${coin.symbol} full analysis`, href: `/token/${coin.id}` });
  }
  if (intent === "trades_for_me" || intent === "today" || (intent === "general" && !coin)) {
    const live = await safe(liveTaCategories(40, venue));
    const listings = await venueListings();
    const items = live.ok ? live.data : [];
    const mine = items.filter((i) => i.category === "confirmed" && venuesFor(i.symbol, listings, venue).includes(venue) && (vm.canShort || i.side === "LONG"));
    const watching = items.filter((i) => i.category === "watching" && venuesFor(i.symbol, listings, venue).includes(venue));
    ctx.confirmed = mine.slice(0, 5).map((i) => { const s = (i.detail as { setup?: { entry: { low: number; high: number }; takeProfits: { price: number }[]; stopLosses: { price: number }[]; rr: number; confidence: number } }).setup; return { symbol: i.symbol, side: i.side, tf: i.timeframe, entry: s ? `${fmtUsd(s.entry.low)} to ${fmtUsd(s.entry.high)}` : null, tp1: s ? fmtUsd(s.takeProfits[0]?.price) : null, sl1: s ? fmtUsd(s.stopLosses[0]?.price) : null, rr: s?.rr, confidence: s?.confidence }; });
    ctx.confirmedCount = mine.length;
    ctx.watchingCount = watching.length;
    ctx.watchingTop = watching.slice(0, 5).map((i) => ({ symbol: i.symbol, tf: i.timeframe, what: (i.detail as { watch?: { what: string }[] }).watch?.[0]?.what }));
    links.push({ label: "Trading Discovery", href: "/opportunities?cat=confirmed" });
  }
  if (intent === "my_trades" || intent === "risk") {
    if (input.userId && input.sb) {
      const [{ data: open }, { data: prof }, { data: closed }] = await Promise.all([
        input.sb.from("saved_setups").select("symbol, side, timeframe, status, risk_usd, size_usd, fill_price, max_favorable_pct, max_adverse_pct, kind").eq("user_id", input.userId).eq("taken", true).is("exit_price", null),
        input.sb.from("profiles").select("trading_balance, risk_pct, preferences").eq("id", input.userId).maybeSingle(),
        input.sb.from("saved_setups").select("realized_r, realized_usd, exit_at").eq("user_id", input.userId).eq("taken", true).not("exit_price", "is", null).order("exit_at", { ascending: false }).limit(30),
      ]);
      const heat = portfolioHeat((open ?? []).map((t) => ({ symbol: t.symbol, side: t.side, riskUsd: t.risk_usd == null ? null : Number(t.risk_usd) })), prof?.trading_balance ? Number(prof.trading_balance) : null, { maxHeatPct: Number(prof?.preferences?.maxHeatPct ?? 3), maxOpen: Number(prof?.preferences?.maxOpen ?? 3) });
      const wins = (closed ?? []).filter((c) => Number(c.realized_r) > 0).length;
      ctx.me = { balance: prof?.trading_balance ? fmtUsd(Number(prof.trading_balance)) : null, riskPct: prof?.risk_pct ?? null, open: (open ?? []).map((t) => ({ symbol: t.symbol, side: t.side, tf: t.timeframe, status: t.status, kind: t.kind, riskUsd: t.risk_usd, best: t.max_favorable_pct, worst: t.max_adverse_pct })), heat: { level: heat.level, heatPct: heat.heatPct, messages: heat.messages }, closedLast30: (closed ?? []).length, winRateLast30: closed?.length ? Math.round((100 * wins) / closed.length) : null, avgRLast30: closed?.length ? +((closed ?? []).reduce((s, c) => s + Number(c.realized_r ?? 0), 0) / closed.length).toFixed(2) : null };
      links.push({ label: "Journal", href: "/setups" }, { label: "Risk calculator", href: "/risk" });
    } else ctx.me = { signedIn: false };
  }
  if (intent === "spot" && input.adminSb) {
    const { data: picks } = await input.adminSb.from("spot_picks").select("symbol, name, tier, spot_score, price, detail").order("spot_score", { ascending: false }).limit(8);
    ctx.spot = (picks ?? []).map((p) => ({ symbol: p.symbol, tier: p.tier, score: p.spot_score, price: fmtUsd(Number(p.price)), zone: p.detail?.analysis?.accumulation ? `${fmtUsd(p.detail.analysis.accumulation.low)} to ${fmtUsd(p.detail.analysis.accumulation.high)}` : null, inZone: p.detail?.analysis?.accumulation ? Number(p.price) >= p.detail.analysis.accumulation.low && Number(p.price) <= p.detail.analysis.accumulation.high : null }));
    links.push({ label: "Spot Investments", href: "/opportunities?cat=spot" });
  }
  if (intent === "howto") links.push({ label: "Trade guide", href: "/guide" }, { label: "Glossary", href: "/glossary" });
  if (intent === "regime") links.push({ label: "Market regime", href: "/glossary#market-regime" });

  // ---- write the answer ----
  const local = localAnswer(intent, q, ctx);
  if (aiProvider() === "local") return { ...local, links, intent, model: "engine-writer", context: ctx };
  try {
    const sys = `You are AsheSignal's chat assistant, talking with a trader in a chat (website or Telegram). Hold a natural conversation: answer what they actually asked, use the recent conversation and any quoted message to understand follow-ups ("and its stop?", "why?", "what about ETH?"), and you may ask one short clarifying question when the request is ambiguous.
Facts about the market right now (prices, levels, setups, categories, regime, the user's trades) must come ONLY from the JSON context, which is the app's live engine data; never invent or estimate them, and say so when the context lacks something. General crypto and trading knowledge (what a stop-limit is, how staking works, what RSI means, risk management) you may explain from your own knowledge.
Be concrete and short: 1 to 5 sentences, then optional bullets (max 5). Plain language for a beginner. Never tell the user to buy or sell and never promise outcomes; describe what the engine shows and what the app's rules say. The user trades manually on ${vm.label}${vm.canShort ? "" : ", which is spot only (no shorts)"}. Never use em dashes or en dashes; use plain hyphens or commas. Answer exactly what was asked: context.request holds the side (LONG/SHORT) and timeframes the user wants and the ones they ruled out; talk only about those, and for "anything approaching?" use each timeframe's zone and nearest support/resistance distances. Write coin tickers in capitals (SOL, BTC). A coin only counts as mentioned when the user writes its ticker in capitals, a $ticker, or its well-known name; ordinary words like "trade" or "today" are never coins, so never answer as if they were. Return JSON: {"text": string, "bullets": string[]}.`;
    const convo = input.history?.length ? `\n\nRecent conversation (oldest first):\n${input.history.slice(-8).map((h) => `${h.role}: ${h.text.slice(0, 600)}`).join("\n")}` : "";
    const quoted = input.quoted ? `\n\nThe user is replying to this message you sent earlier:\n"""${input.quoted.slice(0, 1500)}"""` : "";
    const r = await askJson<{ text: string; bullets?: string[] }>(sys, `${convo}${quoted}\n\nUser: ${q}\n\nIntent guess: ${intent}\n\nContext JSON:\n${JSON.stringify(ctx).slice(0, 12000)}`, 800);
    const d = stripDashes(r.data);
    if (d && typeof d.text === "string" && d.text.length > 10) return { text: d.text, bullets: Array.isArray(d.bullets) ? d.bullets.slice(0, 5) : undefined, links, intent, model: r.model || AI_MODEL(), context: ctx };
  } catch (e) { console.error("[ai] assistant fell back to the template writer:", (e as Error).message); }
  return { ...local, links, intent, model: "engine-writer", context: ctx };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Answer a specific coin question ("longs on INJ 1h/4h, anything approaching?") timeframe by timeframe. */
/** Engine gap messages in plain words, without a trailing period. */
function plainGap(g: string | undefined): string {
  if (!g) return "";
  const m = g.match(/Score ([+-]?\d+) is inside the .(\d+) confirmation band/i);
  if (m) return `stronger momentum: the signal score is ${m[1]} and must reach ${Number(m[1]) >= 0 ? "+" : "-"}${m[2]} to confirm`;
  return g.replace(/\.\s*$/, "").replace(/^./, (x) => x.toLowerCase());
}
export function requestAnswer(c: any, req: Request, ctx: any): { text: string; bullets?: string[] } {
  const side = req.side;
  const tfs: any[] = c.timeframes ?? [];
  const label = tfs.map((t) => t.tf).join(" and ");
  const bullets = tfs.map((t) => {
    const st = t.setup;
    if (st && (!side || st.side === side)) {
      const where = t.zone ? (t.zone.state === "in" ? "price is IN the entry zone" : t.zone.label) : "";
      return `${t.tf}: ${st.side} setup is ${st.kind} (confidence ${st.confidence}%), entry ${st.entry}, stop ${st.sl1}, TP1 ${st.tp1}, ${st.rr}R. ${where ? `Now ${where}.` : ""}${st.kind !== "confirmed" && st.gaps?.length ? ` To confirm it needs ${plainGap(st.gaps[0])}.` : ""}`;
    }
    const lean = `${t.outlook} (score ${t.score > 0 ? "+" : ""}${t.score}), trend ${t.trend}, RSI ${t.rsi}`;
    if (side === "LONG") return `${t.tf}: no long setup. ${lean}.${t.nearestResistance ? ` A long would need a break above ${t.nearestResistance.price} (${t.nearestResistance.pct}% above).` : ""}${t.nearestSupport ? ` Support ${t.nearestSupport.price} (${t.nearestSupport.pct}% below) is where a pullback long could form.` : ""}${st ? ` The engine sees a ${st.side} ${st.kind} instead.` : ""}`;
    if (side === "SHORT") return `${t.tf}: no short setup. ${lean}.${t.nearestSupport ? ` A short would need a break below ${t.nearestSupport.price} (${t.nearestSupport.pct}% below).` : ""}${t.nearestResistance ? ` Resistance ${t.nearestResistance.price} (${t.nearestResistance.pct}% above) is where a rejection short could form.` : ""}${st ? ` The engine sees a ${st.side} ${st.kind} instead.` : ""}`;
    return `${t.tf}: ${lean}, no setup.`;
  });
  const matching = tfs.filter((t) => t.setup && (!side || t.setup.side === side));
  const confirmed = matching.filter((t) => t.setup.kind === "confirmed");
  const close = matching.filter((t) => t.zone && (t.zone.state === "in" || (t.zone.pct != null && t.zone.pct <= 2)));
  const sideWord = side ? side.toLowerCase() : "";
  let text: string;
  if (confirmed.length) text = `Yes: ${c.symbol} has a confirmed ${sideWord} setup on ${confirmed.map((t) => t.tf).join(" and ")}${close.length ? `, and price is ${close[0].zone.state === "in" ? "inside" : "close to"} the entry zone` : ""}.`;
  else if (matching.length) text = `Nothing confirmed yet for ${c.symbol} ${sideWord}s on ${label}. Closest: the ${matching[0].tf} ${matching[0].setup.side} setup, still ${matching[0].setup.kind}${matching[0].zone ? `, price ${matching[0].zone.state === "in" ? "in" : matching[0].zone.label.replace("the zone", "its entry zone")}` : ""}${matching[0].setup.gaps?.[0] ? `; to confirm it needs ${plainGap(matching[0].setup.gaps[0])}` : ""}.`;
  else text = `No ${sideWord ? `${sideWord} ` : ""}setup on ${c.symbol} ${label} right now; nothing is approaching a ${sideWord || "trade"} entry yet. The levels to watch are below.`;
  if (req.excluded.length) text += ` (Left out ${req.excluded.join(", ")} as you asked.)`;
  if (c.tradeable === false) text += ` Note: ${c.symbol} is not listed on ${ctx.venue}${c.listedOn?.length ? `; it trades on ${c.listedOn.join(", ")}` : ""}.`;
  if (ctx.conditions?.verdict && ctx.conditions.verdict !== "ok") text += ` Conditions: ${ctx.conditions.headline}.`;
  bullets.push(`Tip: tap "When it confirms" on the ${c.symbol} card to be told the moment a setup turns Confirmed.`);
  return { text, bullets };
}

function localAnswer(intent: Intent, q: string, ctx: any): { text: string; bullets?: string[] } {
  const cond = ctx.conditions ? `Conditions: ${ctx.conditions.headline}.` : "";
  const reg = ctx.regime ? ` Regime: ${ctx.regime.label} (${ctx.regime.advice})` : "";
  if (intent === "coin" && ctx.coin && !ctx.coin.error && (ctx.request?.side || ctx.request?.tfs?.length || ctx.request?.approaching)) {
    return requestAnswer(ctx.coin, ctx.request, ctx);
  }
  if (intent === "coin" && ctx.coin) {
    const c = ctx.coin;
    if (c.error) return { text: `I could not load ${c.symbol} right now (${c.error}). Open its page for the chart.` };
    const best = (c.timeframes as any[]).find((t) => t.setup?.kind === "confirmed") ?? (c.timeframes as any[]).find((t) => t.setup);
    const bullets = (c.timeframes as any[]).map((t) => `${t.tf}: ${t.outlook} (score ${t.score > 0 ? "+" : ""}${t.score}), trend ${t.trend}, RSI ${t.rsi}${t.setup ? `, ${t.setup.kind} ${t.setup.side} setup ${t.setup.rr}R` : ", no setup"}`);
    const trade = best?.setup ? ` The ${best.tf} ${best.setup.side} setup is ${best.setup.kind}: entry ${best.setup.entry}, stop ${best.setup.sl1}, TP1 ${best.setup.tp1}, TP2 ${best.setup.tp2} (${best.setup.rr}R, confidence ${best.setup.confidence}%).${best.setup.kind !== "confirmed" && best.setup.gaps?.length ? ` Still missing for Confirmed: ${best.setup.gaps[0]}` : ""}` : " No tradeable setup on 1h, 4h or 1d right now.";
    const where = c.tradeable ? ` It is listed on ${ctx.venue}.` : c.listedOn?.length ? ` Not listed on ${ctx.venue}; available on ${c.listedOn.join(", ")}.` : " Not on any supported exchange (DEX only).";
    return { text: `${c.name} (${c.symbol}) at ${c.price}: ${c.consensus}${trade}${where} ${cond}`, bullets };
  }
  if (intent === "trades_for_me" || intent === "today" || intent === "general") {
    const n = ctx.confirmedCount ?? 0;
    const list = (ctx.confirmed ?? []) as any[];
    const text = `${cond}${reg} Confirmed trades you can place on ${ctx.venue}${ctx.canShort ? "" : " (longs only)"}: ${n}.${n === 0 ? ` ${ctx.watchingCount ?? 0} coins are in Watching; the engine confirms only when its gates pass, and in weak conditions that can be zero for hours.` : ""}`;
    const bullets = list.length ? list.map((i) => `${i.symbol} ${i.side} ${i.tf}: entry ${i.entry}, stop ${i.sl1}, TP1 ${i.tp1}, ${i.rr}R, confidence ${i.confidence}%`) : ((ctx.watchingTop ?? []) as any[]).map((w) => `Watching ${w.symbol} ${w.tf}: ${w.what ?? "structure building"}`);
    return { text, bullets };
  }
  if (intent === "my_trades" || intent === "risk") {
    if (!ctx.me || ctx.me.signedIn === false) return { text: "Sign in to let me read your journal, balance and risk settings. Guest mode has nothing to look at." };
    const m = ctx.me;
    const text = `You have ${m.open.length} open trade${m.open.length === 1 ? "" : "s"}; heat ${m.heat.level}${m.heat.heatPct != null ? ` (${m.heat.heatPct}% of your account at risk)` : ""}. ${m.heat.messages[0] ?? ""} Last 30 closed: ${m.closedLast30}${m.winRateLast30 != null ? `, ${m.winRateLast30}% winners, ${m.avgRLast30}R per trade` : ""}.${m.balance ? ` Balance ${m.balance}, risk ${m.riskPct}% per trade.` : " Set your balance and risk on the Risk page so I can size trades."}`;
    return { text, bullets: (m.open as any[]).map((t) => `${t.symbol} ${t.side} ${t.tf}: ${t.status}${t.best != null ? `, best +${t.best}% / worst -${t.worst}%` : ""}${t.riskUsd ? `, ${fmtUsd(Number(t.riskUsd))} at risk` : ""}`) };
  }
  if (intent === "spot") {
    const picks = (ctx.spot ?? []) as any[];
    return { text: picks.length ? `Top Spot Investment picks by score (buy-and-hold, no leverage). ${picks.filter((p) => p.inZone).length} of them are inside their accumulation zone right now. ${cond}` : "No spot picks are stored yet; the worker fills them within a few hours of its first run.", bullets: picks.map((p) => `${p.symbol} (${p.tier}, score ${p.score}): ${p.price}, zone ${p.zone}${p.inZone ? ", in zone" : ""}`) };
  }
  if (intent === "regime") return { text: ctx.regime ? `${ctx.regime.headline} ${ctx.regime.advice} Breadth: ${ctx.regime.breadth}% of the top 100 are up over 30 days; alt-season gauge ${ctx.regime.altSeason}%. ${cond}` : "Regime data is not available right now." };
  if (intent === "howto") return { text: `The Trade guide walks through placing a setup on ${ctx.venue} step by step, with your numbers filled in: open it from any setup card ("How to place it"). Short version: limit order at the entry zone, stop loss attached, take-profits in parts (30/30/40), stop to break-even after TP1.${ctx.canShort ? "" : ` ${ctx.venue} is spot only, so SHORT setups cannot be opened there.`}` };
  return { text: `${cond}${reg} Ask me about a coin ("what does the engine say about SOL"), today's trades ("what can I trade on ${ctx.venue}"), your journal ("how am I doing"), position size, spot picks, or how to place an order. Question received: "${q.slice(0, 80)}".` };
}
