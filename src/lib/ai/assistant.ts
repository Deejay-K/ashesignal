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
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AssistantInput { question: string; venue: VenueId; userId?: string | null; sb?: SupabaseClient | null; adminSb?: SupabaseClient | null; history?: { role: "user" | "assistant"; text: string }[] }
export interface AssistantAnswer { text: string; bullets?: string[]; links: { label: string; href: string }[]; intent: string; model: string; context: Record<string, unknown> }

type Intent = "coin" | "today" | "trades_for_me" | "my_trades" | "risk" | "regime" | "howto" | "spot" | "general";

const COIN_STOP = new Set(["I", "A", "THE", "AND", "OR", "IS", "ON", "IN", "TO", "MY", "ME", "WHAT", "HOW", "WHY", "SHOULD", "CAN", "DO", "IT", "OF", "FOR", "BUY", "SELL", "LONG", "SHORT", "TODAY", "NOW", "TP", "SL", "RR", "BTC?", "USD", "USDT", "USDC", "OK", "RSI", "MACD", "ATR", "EMA", "SMA", "AI", "ETF", "CEX", "DEX", "COINBASE", "KRAKEN", "BINANCE", "OKX", "BYBIT"]);

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

/** Try to find a coin ticker or name in the question. */
async function detectCoin(q: string): Promise<{ id: string; symbol: string; name: string } | null> {
  const words = q.replace(/[^\w$ ]/g, " ").split(/\s+/).filter(Boolean);
  const cands = words.map((w) => w.replace(/^\$/, "").toUpperCase()).filter((w) => w.length >= 2 && w.length <= 10 && !COIN_STOP.has(w) && /^[A-Z0-9]+$/.test(w));
  for (const c of cands.slice(0, 4)) {
    const r = await safe(cgSearch(c));
    if (!r.ok || !r.data.length) continue;
    const exact = r.data.find((x) => x.symbol.toUpperCase() === c) ?? r.data.find((x) => x.name.toUpperCase() === c);
    if (exact) return { id: exact.id, symbol: exact.symbol.toUpperCase(), name: exact.name };
  }
  // names like "solana", "bitcoin"
  for (const w of words.filter((w) => w.length >= 4 && /^[A-Za-z]+$/.test(w)).slice(0, 6)) {
    const r = await safe(cgSearch(w));
    if (r.ok && r.data[0] && r.data[0].name.toLowerCase() === w.toLowerCase()) return { id: r.data[0].id, symbol: r.data[0].symbol.toUpperCase(), name: r.data[0].name };
  }
  return null;
}

export async function answer(input: AssistantInput): Promise<AssistantAnswer> {
  const q = input.question.trim().slice(0, 500);
  const venue = input.venue;
  const vm = VENUE_META[venue];
  let intent = detectIntent(q);
  const coin = intent !== "my_trades" && intent !== "risk" ? await detectCoin(q) : null;
  if (coin && (intent === "general" || intent === "today" || intent === "trades_for_me")) intent = "coin";

  const ctx: Record<string, unknown> = { venue: vm.label, canShort: vm.canShort };
  const links: { label: string; href: string }[] = [];

  // Always: conditions + regime (cheap, cached)
  const [condR, regR] = await Promise.all([safe(globalConditions()), safe(marketRegime())]);
  const cond = condR.ok ? summarize(condR.data.conditions) : null;
  const regime = regR.ok ? regR.data : null;
  ctx.conditions = cond;
  ctx.regime = regime ? { label: regime.label, headline: regime.headline, advice: regime.advice, breadth: regime.breadth.above50, altSeason: regime.alts.altSeason, btcTrend: regime.btc.trend } : null;

  if (intent === "coin" && coin) {
    const a = await safe(analyzeAsset({ symbol: coin.symbol, coingeckoId: coin.id, venue }, ["1h", "4h", "1d"]));
    const listings = await venueListings();
    const vs = venuesFor(coin.symbol, listings, venue);
    if (a.ok) {
      const tfs = Object.entries(a.data.timeframes).filter(([, t]) => !("unavailable" in t)).map(([tf, t]) => {
        const x = t as Exclude<typeof t, { unavailable: true }>;
        return { tf, outlook: x.outlook, score: x.score, trend: x.trend.direction, rsi: +x.momentum.rsi.toFixed(0), setup: x.setup ? { side: x.setup.side, kind: x.setup.kind, entry: `${fmtUsd(x.setup.entry.low)} to ${fmtUsd(x.setup.entry.high)}`, tp1: fmtUsd(x.setup.takeProfits[0]?.price), tp2: fmtUsd(x.setup.takeProfits[1]?.price), sl1: fmtUsd(x.setup.stopLosses[0]?.price), rr: x.setup.riskRewardTp2, confidence: x.setup.confidence, gaps: x.setup.quality.confirmGaps.slice(0, 3), issues: x.setup.quality.issues.slice(0, 2) } : null, levels: x.levels.slice(0, 4).map((l) => `${l.kind} ${fmtUsd(l.price)}`), patterns: [...x.patterns.confirmed.map((p) => `${p.name} (confirmed)`), ...x.patterns.forming.map((p) => `${p.name} (forming)`)].slice(0, 4) };
      });
      ctx.coin = { ...coin, price: tfs[0] ? fmtUsd((a.data.timeframes[tfs[0].tf] as { price: number }).price) : null, consensus: a.data.consensus.summary, alignment: a.data.consensus.alignment, timeframes: tfs, listedOn: vs.map((v) => VENUE_META[v].label), tradeable: vs.includes(venue) };
    } else ctx.coin = { ...coin, error: a.error };
    links.push({ label: `${coin.symbol} full analysis`, href: `/token/${coin.id}` });
  }
  if (intent === "trades_for_me" || intent === "today" || intent === "general") {
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
    const sys = `You are the assistant inside AsheSignal, a crypto analysis app. Answer the user's question using ONLY the JSON context provided (it comes from the app's engine). Never invent prices, levels or statistics; if the context lacks something, say so and point to the linked page. Be concrete and short: 2 to 5 sentences, then optional bullets (max 5). Plain language for a beginner. Never give financial advice or tell the user to buy or sell; describe what the engine shows and what the app's rules say. The user trades manually on ${vm.label}${vm.canShort ? "" : ", which is spot only (no shorts)"}. Never use em dashes or en dashes; use plain hyphens or commas. Return JSON: {"text": string, "bullets": string[]}.`;
    const r = await askJson<{ text: string; bullets?: string[] }>(sys, `Question: ${q}\n\nIntent: ${intent}\n\nContext JSON:\n${JSON.stringify(ctx).slice(0, 12000)}${input.history?.length ? `\n\nRecent conversation:\n${input.history.slice(-4).map((h) => `${h.role}: ${h.text}`).join("\n")}` : ""}`, 700);
    const d = stripDashes(r.data);
    if (d && typeof d.text === "string" && d.text.length > 10) return { text: d.text, bullets: Array.isArray(d.bullets) ? d.bullets.slice(0, 5) : undefined, links, intent, model: r.model || AI_MODEL(), context: ctx };
  } catch { /* fall back */ }
  return { ...local, links, intent, model: "engine-writer", context: ctx };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function localAnswer(intent: Intent, q: string, ctx: any): { text: string; bullets?: string[] } {
  const cond = ctx.conditions ? `Conditions: ${ctx.conditions.headline}.` : "";
  const reg = ctx.regime ? ` Regime: ${ctx.regime.label} (${ctx.regime.advice})` : "";
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
