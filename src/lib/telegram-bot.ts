// The Telegram bot's brain: commands and button callbacks that mirror the app. Every number comes from the
// same engine functions the website uses. Nothing here places orders.

import type { SupabaseClient } from "@supabase/supabase-js";
import { tgSend, tgPhoto, tgEdit, tgAnswerCallback, tgTyping, esc, linkCode, type Keyboard } from "./telegram";
import { answer } from "./ai/assistant";
import { globalConditions, summarize } from "./market/conditions";
import { marketRegime } from "./market/regime";
import { analyzeAsset } from "./market/analyze";
import { search as cgSearch, getMarkets } from "./providers/coingecko";
import { getFearGreed } from "./providers/feargreed";
import { liveTaCategories, liveSpeculative, liveSpot } from "./market/live-opportunities";
import { sizePosition } from "./risk/position";
import { portfolioHeat } from "./risk/heat";
import { venueListings, venuesFor, VENUE_IDS, VENUE_META, isVenueId, type VenueId } from "./venues";
import { fmtUsd, fmtNum } from "./format";
import { safe } from "./fetch";
import type { Timeframe } from "./types";
import type { Opportunity } from "./market/opportunities";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
const link = (path: string) => (SITE() ? `${SITE()}${path}` : undefined);

export interface ChatCtx { sb: SupabaseClient; chatId: string; tgUserId: string; firstName?: string; userId: string | null; venue: VenueId; isGroup: boolean; state: any; messageId?: number }

const MENU: Keyboard = [
  [{ text: "✅ Confirmed trades", callback_data: "cat:confirmed" }, { text: "👀 Watching", callback_data: "cat:watching" }],
  [{ text: "⚠️ Speculative", callback_data: "cat:speculative" }, { text: "🏦 Spot picks", callback_data: "cat:spot" }],
  [{ text: "🌡 Today", callback_data: "today" }, { text: "📊 Screener", callback_data: "screener:score" }],
  [{ text: "👤 My trades", callback_data: "me" }, { text: "🔔 Alerts", callback_data: "alerts" }],
  [{ text: "⚙️ Exchange", callback_data: "exchange" }, { text: "❓ Help", callback_data: "help" }],
];

/**
 * Settings are per Telegram user, not per chat: in a group every member keeps their own exchange, account link
 * and guided flow. Falls back to the legacy profiles.telegram_chat_id link (private chat id = user id).
 */
export async function loadActor(sb: SupabaseClient, tgUserId: string, chatId: string, meta?: { firstName?: string; username?: string; chatTitle?: string }): Promise<{ userId: string | null; venue: VenueId; state: any }> {
  const { data } = await sb.from("telegram_users").select("*").eq("tg_user_id", tgUserId).maybeSingle();
  if (data) return { userId: data.user_id, venue: isVenueId(data.venue) ? data.venue : "binance", state: data.state ?? null };
  const { data: p } = await sb.from("profiles").select("id, preferences").eq("telegram_chat_id", tgUserId).maybeSingle();
  const venue: VenueId = isVenueId(p?.preferences?.venue) ? p!.preferences.venue : "binance";
  await sb.from("telegram_users").upsert({ tg_user_id: tgUserId, user_id: p?.id ?? null, venue, first_name: meta?.firstName ?? null, username: meta?.username ?? null });
  if (chatId !== tgUserId) await sb.from("telegram_chats").upsert({ chat_id: chatId, title: meta?.chatTitle ?? null, updated_at: new Date().toISOString() });
  return { userId: p?.id ?? null, venue, state: null };
}
const setState = (c: ChatCtx, state: any) => c.sb.from("telegram_users").update({ state, updated_at: new Date().toISOString() }).eq("tg_user_id", c.tgUserId);
const who = (c: ChatCtx) => (c.isGroup && c.firstName ? `${esc(c.firstName)}: ` : "");

const pct = (a: number, b: number) => `${(((a - b) / b) * 100) >= 0 ? "+" : ""}${(((a - b) / b) * 100).toFixed(2)}%`;

// ---------- handlers ----------

export async function handleCommand(c: ChatCtx, cmdRaw: string, arg: string, fullText: string) {
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, "");
  switch (cmd) {
    case "/start": case "/menu": return sendMenu(c);
    case "/help": return help(c);
    case "/link": return linkAccount(c, arg);
    case "/unlink": return unlink(c);
    case "/trades": case "/confirmed": return category(c, "confirmed");
    case "/watching": return category(c, "watching");
    case "/spec": case "/speculative": return category(c, "speculative");
    case "/spot": return category(c, "spot");
    case "/today": case "/conditions": return today(c);
    case "/regime": return today(c);
    case "/coin": return coin(c, arg);
    case "/screener": return screener(c, arg || "score");
    case "/size": return size(c, arg);
    case "/alert": return alertCreate(c, arg);
    case "/alerts": return alertsList(c);
    case "/me": return me(c);
    case "/journal": return journal(c);
    case "/take": return takeStart(c, arg);
    case "/exchange": return exchange(c, arg);
    case "/guide": return tgSend(c.chatId, `<b>How to place a trade on ${esc(VENUE_META[c.venue].label)}</b>\nShort version: limit order inside the entry zone, stop loss attached, take-profits in parts (30/30/40), stop to break-even after TP1. The full click-by-click guide with your numbers opens from any setup card.${VENUE_META[c.venue].canShort ? "" : `\n\n${esc(VENUE_META[c.venue].label)} is spot only: SHORT setups cannot be opened there.`}`, { html: true, keyboard: [[{ text: "Open the trade guide", url: link(`/guide?venue=${c.venue}`) ?? "https://t.me" }]] });
    case "/cancel": await setState(c, null); return tgSend(c.chatId, "Cancelled.");
    default: return freeText(c, fullText);
  }
}

export async function handleCallback(c: ChatCtx, data: string, callbackId: string) {
  await tgAnswerCallback(callbackId);
  const [kind, a, b, d] = data.split(":");
  switch (kind) {
    case "menu": return sendMenu(c);
    case "cat": return category(c, a as any, Number(b ?? 0));
    case "today": return today(c);
    case "screener": return screener(c, a ?? "score");
    case "me": return me(c);
    case "alerts": return alertsList(c);
    case "help": return help(c);
    case "exchange": return a ? setExchange(c, a) : exchange(c, "");
    case "coin": return coin(c, a, (b as Timeframe) || undefined);
    case "setup": return setupCard(c, a, (b as Timeframe) || "4h");
    case "copy": return copySetup(c, a, (b as Timeframe) || "4h");
    case "take": return takeStart(c, a, (b as Timeframe) || "4h", d === "paper");
    case "alerttp": return alertFromSetup(c, a, (b as Timeframe) || "4h");
    case "confirmalert": return alertConfirm(c, a);
    case "size": return size(c, `${a} ${b}`);
    default: return sendMenu(c);
  }
}

export async function handleStateReply(c: ChatCtx, text: string): Promise<boolean> {
  const st = c.state;
  if (!st?.flow) return false;
  if (st.flow === "take") return takeStep(c, text);
  return false;
}

// ---------- screens ----------

async function sendMenu(c: ChatCtx) {
  const vm = VENUE_META[c.venue];
  return tgSend(c.chatId, `<b>AsheSignal</b>${c.isGroup && c.firstName ? ` for ${esc(c.firstName)}` : ""}\nYour exchange: <b>${esc(vm.label)}</b>${vm.canShort ? "" : " (spot only, longs)"}${c.userId ? "" : "\nNot linked to an account: /link CODE from the Account page for journal, alerts and digest."}\n\nPick a section:`, { html: true, keyboard: MENU });
}

async function help(c: ChatCtx) {
  const lines = [
    "<b>Commands</b>",
    "/menu - buttons for everything",
    "/trades, /watching, /spec, /spot - the four discovery categories",
    "/today - conditions, regime, Fear & Greed",
    "/coin SOL [1h|4h|1d] - full analysis with setup card",
    "/screener [score|rsi|volume|oversold|overbought] - top coins",
    "/size ENTRY STOP [balance] [risk%] - position size",
    "/alert BTC above 100000 | below 90000 - price alert (linked)",
    "/alerts - your rules and inbox (linked)",
    "/me, /journal - your trades, heat, record (linked)",
    "/take SOL - record a trade you placed (linked), guided",
    "/exchange coinbase - your exchange (each person has their own, also in groups)",
    "/guide - how to place a trade",
    "Or ask anything in plain words.",
    "",
    "Manual trading only. The bot never places orders. Not financial advice.",
  ];
  return tgSend(c.chatId, lines.join("\n"), { html: true, keyboard: [[{ text: "Menu", callback_data: "menu" }]] });
}

async function linkAccount(c: ChatCtx, arg: string) {
  const code = arg.toUpperCase().trim();
  if (!code) return tgSend(c.chatId, "Send /link followed by the 6-character code shown on your Account page (Telegram section).");
  const { data: owner } = await c.sb.from("profiles").select("id, preferences").eq("telegram_link_code", code).maybeSingle();
  if (!owner) return tgSend(c.chatId, "That code is not valid or was already used. Open the Account page, Telegram section, and use the new code.");
  // Deliveries (alerts, digest, review) go to the user's private chat with the bot, never to a group.
  await c.sb.from("profiles").update({ telegram_chat_id: c.tgUserId, telegram_link_code: null }).eq("id", owner.id);
  const venue: VenueId = isVenueId(owner.preferences?.venue) ? owner.preferences.venue : c.venue;
  await c.sb.from("telegram_users").upsert({ tg_user_id: c.tgUserId, user_id: owner.id, venue, first_name: c.firstName ?? null, updated_at: new Date().toISOString() });
  c.userId = owner.id; c.venue = venue;
  await tgSend(c.chatId, `${who(c)}Linked. Exchange set to <b>${esc(VENUE_META[venue].label)}</b> from your account. Alerts, the daily digest and the weekly review arrive in your private chat with me${c.isGroup ? " (open @AsheSignalBot and press Start once so I am allowed to message you)" : ""}.`, { html: true });
  return sendMenu(c);
}
async function unlink(c: ChatCtx) {
  if (c.userId) await c.sb.from("profiles").update({ telegram_chat_id: null, telegram_link_code: linkCode() }).eq("id", c.userId);
  await c.sb.from("telegram_users").update({ user_id: null, state: null }).eq("tg_user_id", c.tgUserId);
  return tgSend(c.chatId, `${who(c)}Disconnected. Public data still works; link again any time.`, { html: true });
}

async function exchange(c: ChatCtx, arg: string): Promise<boolean> {
  if (arg && isVenueId(arg.toLowerCase())) return setExchange(c, arg.toLowerCase());
  return tgSend(c.chatId, `${who(c)}Your exchange: <b>${esc(VENUE_META[c.venue].label)}</b>. Pick another:`, { html: true, keyboard: [VENUE_IDS.slice(0, 3).map((v) => ({ text: (v === c.venue ? "• " : "") + VENUE_META[v].label, callback_data: `exchange:${v}` })), VENUE_IDS.slice(3).map((v) => ({ text: (v === c.venue ? "• " : "") + VENUE_META[v].label, callback_data: `exchange:${v}` }))] });
}
async function setExchange(c: ChatCtx, v: string): Promise<boolean> {
  if (!isVenueId(v)) return exchange(c, "");
  c.venue = v;
  await c.sb.from("telegram_users").upsert({ tg_user_id: c.tgUserId, venue: v, user_id: c.userId, first_name: c.firstName ?? null, updated_at: new Date().toISOString() });
  if (c.userId) { const { data: p } = await c.sb.from("profiles").select("preferences").eq("id", c.userId).maybeSingle(); await c.sb.from("profiles").update({ preferences: { ...(p?.preferences ?? {}), venue: v } }).eq("id", c.userId); }
  return tgSend(c.chatId, `${who(c)}Exchange set to <b>${esc(VENUE_META[v].label)}</b>${VENUE_META[v].canShort ? "" : " (spot only: SHORT setups are shown as sell/reduce signals)"}.${c.userId ? " Synced to your account." : ""}`, { html: true, keyboard: [[{ text: "Confirmed trades", callback_data: "cat:confirmed" }, { text: "Menu", callback_data: "menu" }]] });
}

async function today(c: ChatCtx) {
  await tgTyping(c.chatId);
  const [condR, regR, fngR] = await Promise.all([safe(globalConditions()), safe(marketRegime()), safe(getFearGreed(2))]);
  const cond = condR.ok ? summarize(condR.data.conditions) : null;
  const r = regR.ok ? regR.data : null;
  const f = fngR.ok ? fngR.data[0] : null;
  const lines = [
    `<b>Today</b>`,
    cond ? `${cond.verdict === "avoid" ? "🔴" : cond.verdict === "caution" ? "🟡" : "🟢"} <b>Conditions:</b> ${esc(cond.headline)}` : "Conditions unavailable.",
    r ? `${r.label === "risk-on" ? "🟢" : r.label === "risk-off" ? "🔴" : "🟡"} <b>Regime:</b> ${esc(r.label)}. ${esc(r.headline)}\n${esc(r.advice)}\nBTC ${esc(r.btc.trend)} (score ${r.btc.score > 0 ? "+" : ""}${r.btc.score}), breadth ${r.breadth.above50}% up 30d, alt gauge ${r.alts.altSeason}% (${esc(r.alts.label)})${r.alts.btcDominance != null ? `, BTC dom ${r.alts.btcDominance}%` : ""}` : "Regime unavailable.",
    f ? `😨 <b>Fear & Greed:</b> ${f.value} (${esc(f.label)})` : "",
    condR.ok && condR.data.events?.length ? `\n<b>Next high-impact events:</b>\n${condR.data.events.slice(0, 3).map((e: any) => `- ${esc(e.title)} (${esc(new Date(e.time ?? e.date).toUTCString().slice(0, 22))})`).join("\n")}` : "",
  ].filter(Boolean);
  return tgSend(c.chatId, lines.join("\n"), { html: true, keyboard: [[{ text: "Confirmed trades", callback_data: "cat:confirmed" }, { text: "Watching", callback_data: "cat:watching" }], [{ text: "Open dashboard", url: link("/") ?? "https://t.me" }, { text: "Menu", callback_data: "menu" }]] });
}

async function loadCategory(c: ChatCtx, cat: "confirmed" | "watching" | "speculative" | "spot"): Promise<Opportunity[]> {
  // Prefer worker rows (richer, cover all coins), fall back to live snapshot
  const items: Opportunity[] = [];
  if (cat === "confirmed" || cat === "watching") {
    const { data } = await c.sb.from("coin_metrics").select("asset_key, symbol, name, timeframe, price, market_cap, volume_24h, detail, category, category_since, updated_at, outlook").eq("category", cat).order("updated_at", { ascending: false }).limit(300);
    for (const r of data ?? []) { const s = r.detail?.setup; items.push({ id: `${r.asset_key}|${r.timeframe}`, assetKey: r.asset_key, category: cat, symbol: r.symbol, name: r.name ?? r.symbol, chain: null, price: r.price, marketCap: r.market_cap, volume24h: r.volume_24h, liquidity: r.volume_24h, side: s?.side ?? null, bias: "neutral", risk: "medium", timeframe: r.timeframe, rr: s?.rr ?? null, confidence: s?.confidence ?? null, upsidePct: null, tokenCategories: [], venues: [], firstSeen: r.category_since ?? r.updated_at, updatedAt: r.updated_at, href: "", detail: r.detail, spec: null, spot: null, tier: null, liquidityNote: null }); }
    if (!items.length) { const live = await safe(liveTaCategories(40, c.venue)); if (live.ok) items.push(...live.data.filter((i) => i.category === cat)); }
    const listings = await venueListings();
    for (const i of items) i.venues = venuesFor(i.symbol, listings, c.venue);
    return items.filter((i) => i.venues.includes(c.venue) && (VENUE_META[c.venue].canShort || i.side !== "SHORT")).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  }
  if (cat === "speculative") {
    const { data } = await c.sb.from("spec_opportunities").select("*").order("updated_at", { ascending: false }).limit(30);
    if (data?.length) return data.map((r: any) => ({ id: r.asset_key, assetKey: r.asset_key, category: "speculative", symbol: r.symbol, name: r.name, chain: r.chain, price: r.price, marketCap: r.market_cap ?? r.fdv, volume24h: r.volume_24h, liquidity: r.liquidity_usd, side: r.detail?.targets?.side ?? null, bias: "neutral", risk: r.risk_level, timeframe: null, rr: null, confidence: null, upsidePct: null, tokenCategories: [], venues: [], firstSeen: r.first_seen, updatedAt: r.updated_at, href: `/scanner?address=${r.address}`, detail: null, spec: r.detail, spot: null, tier: null, liquidityNote: null }) as Opportunity);
    const live = await safe(liveSpeculative(4)); return live.ok ? live.data : [];
  }
  const { data } = await c.sb.from("spot_picks").select("*").order("spot_score", { ascending: false }).limit(30);
  if (data?.length) return data.map((r: any) => ({ id: r.asset_key, assetKey: r.asset_key, category: "spot", symbol: r.symbol, name: r.name, chain: null, price: r.price, marketCap: r.market_cap, volume24h: r.volume_24h, liquidity: null, side: null, bias: "neutral", risk: "medium", timeframe: "1w", rr: null, confidence: r.spot_score, upsidePct: null, tokenCategories: [], venues: [], firstSeen: r.updated_at, updatedAt: r.updated_at, href: `/token/${String(r.asset_key).replace(/^cg:/, "")}`, detail: null, spec: null, spot: r.detail, tier: r.tier, liquidityNote: null }) as Opportunity);
  const live = await safe(liveSpot(6)); return live.ok ? live.data : [];
}

async function category(c: ChatCtx, cat: "confirmed" | "watching" | "speculative" | "spot", page = 0) {
  await tgTyping(c.chatId);
  const items = await loadCategory(c, cat);
  const vm = VENUE_META[c.venue];
  const title = { confirmed: "✅ Confirmed trades", watching: "👀 Watching", speculative: "⚠️ Speculative opportunities", spot: "🏦 Spot investments" }[cat];
  const per = 6;
  const slice = items.slice(page * per, page * per + per);
  const head = `${who(c)}<b>${title}</b> on ${esc(vm.label)}${cat === "confirmed" && !vm.canShort ? " (longs only)" : ""}: ${items.length}${cat === "confirmed" ? "\nConfirmed means the engine's gates passed; it is not a guarantee." : cat === "speculative" ? "\nHigh risk by definition. Position size: money you can lose entirely." : cat === "spot" ? "\nBuy and hold, no leverage. Zones are where accumulation makes sense." : "\nStructure is building; each one lists what must happen to confirm."}`;
  if (!slice.length) return tgSend(c.chatId, `${head}\n\n${cat === "confirmed" ? "Nothing qualifies right now. That is normal in quiet or risk-off markets; check Watching." : "Nothing here right now."}`, { html: true, keyboard: [[{ text: "Watching", callback_data: "cat:watching" }, { text: "Menu", callback_data: "menu" }]] });
  const lines = slice.map((i, idx) => {
    const n = page * per + idx + 1;
    const s = (i.detail as any)?.setup;
    if (cat === "spot") { const sp = i.spot!; const z = sp.analysis.accumulation; const inZone = i.price != null && i.price >= z.low && i.price <= z.high; return `${n}. <b>${esc(i.symbol)}</b> ${esc(sp.tier)} · score ${sp.score} · ${fmtUsd(i.price)}\n   zone ${fmtUsd(z.low)} to ${fmtUsd(z.high)}${inZone ? " · <b>in zone</b>" : ""}`; }
    if (cat === "speculative") { const sp = i.spec!; return `${n}. <b>${esc(i.symbol)}</b> ${esc(i.chain ?? "")} · ${fmtUsd(i.price)} · liq ${fmtUsd(i.liquidity, { compact: true })} · risk ${esc(i.risk)}\n   ${esc(sp.attention[0] ?? "")}`; }
    if (s) return `${n}. <b>${esc(i.symbol)}</b> ${s.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} ${esc(i.timeframe)} · conf ${s.confidence}% · ${s.rr}R\n   entry ${fmtUsd(s.entry.low)} to ${fmtUsd(s.entry.high)} · SL ${fmtUsd(s.stopLosses[0]?.price)} · TP1 ${fmtUsd(s.takeProfits[0]?.price)}${cat === "watching" && (i.detail as any)?.watch?.[0] ? `\n   watching: ${esc((i.detail as any).watch[0].what)}` : ""}`;
    return `${n}. <b>${esc(i.symbol)}</b> ${esc(i.timeframe ?? "")}`;
  });
  const kb: Keyboard = [];
  for (let k = 0; k < slice.length; k += 3) kb.push(slice.slice(k, k + 3).map((i, j) => ({ text: `${page * per + k + j + 1}. ${i.symbol}`, callback_data: cat === "speculative" ? `menu` : `setup:${i.assetKey.replace(/^cg:/, "")}:${i.timeframe ?? "4h"}` })));
  const nav: Keyboard[number] = [];
  if (page > 0) nav.push({ text: "◀ Prev", callback_data: `cat:${cat}:${page - 1}` });
  if (items.length > (page + 1) * per) nav.push({ text: "Next ▶", callback_data: `cat:${cat}:${page + 1}` });
  nav.push({ text: "Menu", callback_data: "menu" });
  kb.push(nav);
  kb.push([{ text: "Open on the website", url: link(`/opportunities?cat=${cat}`) ?? "https://t.me" }]);
  return tgSend(c.chatId, `${head}\n\n${lines.join("\n\n")}${cat !== "speculative" ? "\n\nTap a coin for the full card." : ""}`, { html: true, keyboard: kb });
}

async function resolveCoin(q: string): Promise<{ id: string; symbol: string; name: string } | null> {
  const t = q.trim().replace(/^\$/, "");
  if (!t) return null;
  const r = await safe(cgSearch(t));
  if (!r.ok || !r.data.length) return null;
  const up = t.toUpperCase();
  const hit = r.data.find((x) => x.symbol.toUpperCase() === up) ?? r.data.find((x) => x.id === t.toLowerCase() || x.name.toUpperCase() === up) ?? r.data[0];
  return { id: hit.id, symbol: hit.symbol.toUpperCase(), name: hit.name };
}

async function coin(c: ChatCtx, arg: string, tfArg?: Timeframe) {
  const parts = arg.trim().split(/\s+/);
  const tf = (tfArg ?? (["1h", "4h", "1d", "15m", "1w"].includes(parts[1]) ? parts[1] : undefined)) as Timeframe | undefined;
  const coinQ = parts[0];
  if (!coinQ) return tgSend(c.chatId, "Which coin? Example: /coin SOL or /coin SOL 1h");
  await tgTyping(c.chatId);
  const cn = await resolveCoin(coinQ);
  if (!cn) return tgSend(c.chatId, `I could not find "${esc(coinQ)}".`, { html: true });
  return setupCard(c, cn.id, tf ?? "4h", cn);
}

async function setupCard(c: ChatCtx, id: string, tf: Timeframe, known?: { id: string; symbol: string; name: string }) {
  await tgTyping(c.chatId);
  const cn = known ?? (await resolveCoin(id));
  if (!cn) return tgSend(c.chatId, "Coin not found.");
  const a = await safe(analyzeAsset({ symbol: cn.symbol, coingeckoId: cn.id, venue: c.venue }, ["1h", "4h", "1d"]));
  if (!a.ok) return tgSend(c.chatId, `Could not load ${esc(cn.symbol)}: ${esc(a.error)}`, { html: true });
  const t = a.data.timeframes[tf];
  const listings = await venueListings();
  const vs = venuesFor(cn.symbol, listings, c.venue);
  const where = vs.includes(c.venue) ? `Listed on ${VENUE_META[c.venue].label}` : vs.length ? `Not on ${VENUE_META[c.venue].label}; on ${vs.map((v) => VENUE_META[v].label).join(", ")}` : "DEX only";
  const tfRow: Keyboard[number] = (["1h", "4h", "1d"] as Timeframe[]).map((x) => ({ text: (x === tf ? "• " : "") + x, callback_data: `coin:${cn.id}:${x}` }));
  if (!t || "unavailable" in t) return tgSend(c.chatId, `<b>${esc(cn.name)} (${esc(cn.symbol)})</b> ${tf}: no data. ${esc(a.data.consensus.summary)}`, { html: true, keyboard: [tfRow, [{ text: "Menu", callback_data: "menu" }]] });
  const s = t.setup;
  const head = `<b>${esc(cn.name)} (${esc(cn.symbol)})</b> · ${fmtUsd(t.price)} · ${tf}\n${t.outlook === "strongly bullish" || t.outlook === "bullish" ? "🟢" : t.outlook.includes("bear") ? "🔴" : "🟡"} ${esc(t.outlook)} (score ${t.score > 0 ? "+" : ""}${t.score}) · trend ${esc(t.trend.direction)} · RSI ${t.momentum.rsi.toFixed(0)} · vol ${t.volume.ratio.toFixed(2)}x\n${esc(a.data.consensus.summary)}\n${esc(where)}`;
  const levels = t.levels.slice(0, 4).map((l) => `${l.kind === "support" ? "S" : "R"} ${fmtUsd(l.price)}`).join(" · ");
  const pats = [...t.patterns.confirmed.map((p) => `${p.name} ✓`), ...t.patterns.forming.map((p) => `${p.name} (forming)`)].slice(0, 3).join(", ");
  let body = `\n<b>Levels:</b> ${esc(levels || "none")}${pats ? `\n<b>Patterns:</b> ${esc(pats)}` : ""}`;
  const kb: Keyboard = [tfRow];
  if (s) {
    const tag = s.kind === "confirmed" ? "✅ CONFIRMED" : s.kind === "speculative" ? "⚠️ speculative" : "👀 watch";
    body += `\n\n<b>${s.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} setup · ${tag}</b> · conf ${s.confidence}% · ${s.riskRewardTp2}R · ${esc(s.style)}\nEntry: ${fmtUsd(s.entry.low)} to ${fmtUsd(s.entry.high)}\n${s.takeProfits.slice(0, 3).map((x) => `${x.label}: ${fmtUsd(x.price)} (${x.rr}R)`).join("\n")}\n${s.stopLosses.map((x) => `${x.label}: ${fmtUsd(x.price)}`).join(" · ")}\nLeverage: ${s.leverage.recommended}x recommended (max ${s.leverage.maxSafe}x)`;
    if (s.kind !== "confirmed" && s.quality.confirmGaps.length) body += `\n<b>Missing for Confirmed:</b> ${esc(s.quality.confirmGaps[0])}`;
    if (s.kind === "watch" && s.quality.issues.length) body += `\n<b>Why only watch:</b> ${esc(s.quality.issues[0])}`;
    if (s.invalidation?.length) body += `\n<b>Invalidated if:</b> ${esc(s.invalidation[0])}`;
    if (s.side === "SHORT" && !VENUE_META[c.venue].canShort) body += `\n\n${esc(VENUE_META[c.venue].label)} is spot only: treat this SHORT as a sell/reduce signal if you hold ${esc(cn.symbol)}.`;
    kb.push([{ text: "📋 Copy setup", callback_data: `copy:${cn.id}:${tf}` }, { text: "📐 Size it", callback_data: `size:${s.entry.mid}:${s.stopLosses[0].price}` }]);
    kb.push([{ text: "✍️ I took it", callback_data: `take:${cn.id}:${tf}:real` }, { text: "🧪 Paper trade", callback_data: `take:${cn.id}:${tf}:paper` }]);
    kb.push([{ text: "🔔 Alert at TP1", callback_data: `alerttp:${cn.id}:${tf}` }, ...(s.kind !== "confirmed" ? [{ text: "🔔 When it confirms", callback_data: `confirmalert:${cn.id}` }] : [])]);
    const guide = link(`/guide?${new URLSearchParams({ side: s.side, entry: String(s.entry.mid), entryLow: String(s.entry.low), entryHigh: String(s.entry.high), stop: String(s.stopLosses[0].price), tp1: String(s.takeProfits[0].price), tp2: String(s.takeProfits[1].price), tp3: String(s.takeProfits[2].price), symbol: cn.symbol, leverage: String(s.leverage.recommended), venue: c.venue })}`);
    kb.push([{ text: "📖 How to place it", url: guide ?? "https://t.me" }, { text: "📈 Chart", url: link(`/token/${cn.id}?tf=${tf}`) ?? "https://t.me" }]);
    // share-card image when the site URL is known
    const og = link(`/api/og?${new URLSearchParams({ symbol: cn.symbol, tf, side: s.side, kind: s.kind, entryLow: String(s.entry.low), entryHigh: String(s.entry.high), tp1: String(s.takeProfits[0].price), tp2: String(s.takeProfits[1].price), tp3: String(s.takeProfits[2].price), sl1: String(s.stopLosses[0].price), sl2: String(s.stopLosses[1]?.price ?? s.stopLosses[0].price), rr: String(s.riskRewardTp2), lev: String(s.leverage.recommended), conf: String(s.confidence), style: s.style, theme: "foundry" })}`);
    if (og) { const ok = await tgPhoto(c.chatId, og, head + body, kb); if (ok) return true; }
  } else {
    body += `\n\nNo tradeable setup on ${tf}.`;
    kb.push([{ text: "📈 Chart", url: link(`/token/${cn.id}?tf=${tf}`) ?? "https://t.me" }, { text: "🔔 When it confirms", callback_data: `confirmalert:${cn.id}` }]);
  }
  kb.push([{ text: "Menu", callback_data: "menu" }]);
  return tgSend(c.chatId, head + body, { html: true, keyboard: kb });
}

async function copySetup(c: ChatCtx, id: string, tf: Timeframe) {
  const cn = await resolveCoin(id); if (!cn) return tgSend(c.chatId, "Coin not found.");
  const a = await safe(analyzeAsset({ symbol: cn.symbol, coingeckoId: cn.id, venue: c.venue }, [tf]));
  const t = a.ok ? a.data.timeframes[tf] : null; const s = t && !("unavailable" in t) ? t.setup : null;
  if (!s) return tgSend(c.chatId, "No setup to copy right now.");
  const vm = VENUE_META[c.venue];
  const txt = [`${cn.symbol} ${s.side} ${tf} - ${s.kind} - AsheSignal`, `Pair on ${vm.label}: ${vm.instrument(cn.symbol, vm.quotes[0])}`, `Entry: ${fmtUsd(s.entry.low)} - ${fmtUsd(s.entry.high)}`, ...s.takeProfits.map((x) => `${x.label}: ${fmtUsd(x.price)} (${x.rr}R)`), ...s.stopLosses.map((x) => `${x.label}: ${fmtUsd(x.price)}`), `Leverage: ${s.leverage.recommended}x (max ${s.leverage.maxSafe}x)`, `Sizing: risk 1% of account between entry and SL1`, `Manual trading only. Not financial advice.`].join("\n");
  return tgSend(c.chatId, `<pre>${esc(txt)}</pre>\nLong-press to copy.`, { html: true });
}

async function screener(c: ChatCtx, mode: string) {
  await tgTyping(c.chatId);
  const { data } = await c.sb.from("coin_metrics").select("symbol, name, asset_key, price, score, outlook, rsi, vol_ratio, opportunity, setup_kind, setup_side, change_24h_pct").eq("timeframe", "4h").limit(400);
  let rows = (data ?? []) as any[];
  if (!rows.length) return tgSend(c.chatId, "The screener fills within an hour of the worker's first run.");
  const title = { score: "Top by opportunity score", rsi: "Highest RSI", oversold: "Most oversold (RSI)", overbought: "Most overbought (RSI)", volume: "Highest volume vs average" }[mode] ?? "Top by opportunity score";
  rows = mode === "oversold" ? rows.sort((a, b) => a.rsi - b.rsi) : mode === "overbought" || mode === "rsi" ? rows.sort((a, b) => b.rsi - a.rsi) : mode === "volume" ? rows.sort((a, b) => b.vol_ratio - a.vol_ratio) : rows.sort((a, b) => (b.opportunity ?? 0) - (a.opportunity ?? 0));
  const lines = rows.slice(0, 10).map((r, i) => `${i + 1}. <b>${esc(r.symbol)}</b> ${fmtUsd(r.price)} · ${esc(r.outlook)} ${r.score > 0 ? "+" : ""}${r.score} · RSI ${Number(r.rsi).toFixed(0)} · vol ${Number(r.vol_ratio).toFixed(1)}x${r.setup_kind && r.setup_kind !== "watch" ? ` · ${esc(r.setup_side)} ${esc(r.setup_kind)}` : ""}`);
  return tgSend(c.chatId, `<b>📊 Screener (4h): ${esc(title)}</b>\n\n${lines.join("\n")}`, { html: true, keyboard: [[{ text: "Score", callback_data: "screener:score" }, { text: "Oversold", callback_data: "screener:oversold" }, { text: "Overbought", callback_data: "screener:overbought" }, { text: "Volume", callback_data: "screener:volume" }], ...rows.slice(0, 6).reduce<Keyboard>((acc, r, i) => { if (i % 3 === 0) acc.push([]); acc[acc.length - 1].push({ text: r.symbol, callback_data: `setup:${String(r.asset_key).replace(/^cg:/, "")}:4h` }); return acc; }, []), [{ text: "Full screener", url: link("/screener") ?? "https://t.me" }, { text: "Menu", callback_data: "menu" }]] });
}

async function size(c: ChatCtx, arg: string) {
  const nums = arg.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length < 2) return tgSend(c.chatId, "Usage: /size ENTRY STOP [balance] [risk%]\nExample: /size 0.594 0.583 500 1");
  let [entry, stop, balance, riskPct] = nums;
  if (!balance && c.userId) { const { data: p } = await c.sb.from("profiles").select("trading_balance, risk_pct").eq("id", c.userId).maybeSingle(); balance = Number(p?.trading_balance) || 0; riskPct = riskPct || Number(p?.risk_pct) || 1; }
  if (!balance) return tgSend(c.chatId, "I need a balance: /size ENTRY STOP BALANCE [risk%], or link your account and set it on the Risk page.");
  riskPct = riskPct || 1;
  const side = stop < entry ? "LONG" : "SHORT";
  const r = sizePosition({ tradingBalance: balance, riskPct, side, entry, stop, takeProfits: [], leverage: 1, maxExposurePct: 25 });
  if (!r.ok) return tgSend(c.chatId, `Cannot size: ${esc(r.warnings[0] ?? "check the numbers")}`, { html: true });
  return tgSend(c.chatId, `<b>📐 Position size</b> (${side}, spot)\nBuy/sell <b>${fmtNum(r.positionSizeUnits, 4)} units</b> (about ${fmtUsd(r.positionValueUsd)}).\nIf the stop at ${fmtUsd(stop)} hits you lose <b>${fmtUsd(r.riskUsd)}</b> (${riskPct}% of ${fmtUsd(balance)}${r.capped && r.capped !== "risk" ? `, capped by ${esc(r.capped)}` : ""}).\nStop is ${r.stopDistancePct}% from entry.${r.warnings.length ? `\n${esc(r.warnings[0])}` : ""}`, { html: true, keyboard: [[{ text: "Full calculator", url: link(`/risk?side=${side}&entry=${entry}&stop=${stop}`) ?? "https://t.me" }]] });
}

// ---------- account-bound ----------

function needLink(c: ChatCtx) { return tgSend(c.chatId, "This needs your account: open the website, Account page, Telegram section, and send me the /link CODE shown there.", { keyboard: [[{ text: "Open Account page", url: link("/account") ?? "https://t.me" }]] }); }

async function me(c: ChatCtx) {
  if (!c.userId) return needLink(c);
  await tgTyping(c.chatId);
  const [{ data: open }, { data: prof }, { data: closed }] = await Promise.all([
    c.sb.from("saved_setups").select("symbol, side, timeframe, status, risk_usd, max_favorable_pct, max_adverse_pct, kind, paper, fill_price").eq("user_id", c.userId).eq("taken", true).is("exit_price", null),
    c.sb.from("profiles").select("trading_balance, risk_pct, preferences").eq("id", c.userId).maybeSingle(),
    c.sb.from("saved_setups").select("realized_r, realized_usd").eq("user_id", c.userId).eq("taken", true).eq("paper", false).not("exit_price", "is", null).order("exit_at", { ascending: false }).limit(30),
  ]);
  const real = (open ?? []).filter((t) => !t.paper);
  const heat = portfolioHeat(real.map((t) => ({ symbol: t.symbol, side: t.side, riskUsd: t.risk_usd == null ? null : Number(t.risk_usd) })), prof?.trading_balance ? Number(prof.trading_balance) : null, { maxHeatPct: Number(prof?.preferences?.maxHeatPct ?? 3), maxOpen: Number(prof?.preferences?.maxOpen ?? 3) });
  const wins = (closed ?? []).filter((x) => Number(x.realized_r) > 0).length;
  const pnl = (closed ?? []).reduce((s, x) => s + Number(x.realized_usd ?? 0), 0);
  const lines = [
    `<b>👤 My trades</b>`,
    `${heat.level === "stop" ? "🔴" : heat.level === "caution" ? "🟡" : "🟢"} Heat: ${heat.heatPct != null ? `${heat.heatPct}% of account at risk` : "set your balance on the Risk page"} · ${real.length} open${(open ?? []).length - real.length ? ` (+${(open ?? []).length - real.length} paper)` : ""}`,
    esc(heat.messages[0] ?? ""),
    ...real.map((t) => `- <b>${esc(t.symbol)}</b> ${t.side} ${esc(t.timeframe)}: ${esc(t.status)}${t.max_favorable_pct != null ? `, best +${t.max_favorable_pct}% / worst -${t.max_adverse_pct}%` : ""}${t.risk_usd ? `, ${fmtUsd(Number(t.risk_usd))} at risk` : ""}`),
    closed?.length ? `\nLast ${closed.length} closed: ${Math.round((100 * wins) / closed.length)}% winners, ${pnl >= 0 ? "+" : ""}${fmtUsd(pnl)}` : "\nNo closed trades yet.",
  ];
  return tgSend(c.chatId, lines.join("\n"), { html: true, keyboard: [[{ text: "Journal", url: link("/setups") ?? "https://t.me" }, { text: "Weekly review", url: link("/review") ?? "https://t.me" }], [{ text: "Menu", callback_data: "menu" }]] });
}

async function journal(c: ChatCtx) {
  if (!c.userId) return needLink(c);
  const { data } = await c.sb.from("saved_setups").select("symbol, side, timeframe, status, taken_at, fill_price, size_usd, realized_usd, realized_r, exit_reason, paper").eq("user_id", c.userId).eq("taken", true).order("taken_at", { ascending: false }).limit(10);
  if (!data?.length) return tgSend(c.chatId, "No trades recorded yet. Use /take SOL after placing a trade, or the ✍️ button on a setup card.");
  const lines = data.map((t) => `${t.paper ? "🧪" : t.realized_r == null ? "⏳" : Number(t.realized_r) > 0 ? "✅" : "❌"} <b>${esc(t.symbol)}</b> ${t.side} ${esc(t.timeframe)} · ${esc(t.status)}${t.fill_price ? ` · fill ${fmtUsd(Number(t.fill_price))}` : ""}${t.size_usd ? ` · ${fmtUsd(Number(t.size_usd))}` : ""}${t.realized_r != null ? ` · <b>${Number(t.realized_r) > 0 ? "+" : ""}${t.realized_r}R</b> (${Number(t.realized_usd) >= 0 ? "+" : ""}${fmtUsd(Number(t.realized_usd))})` : ""}`);
  return tgSend(c.chatId, `<b>📒 Journal (last ${data.length})</b>\n${lines.join("\n")}`, { html: true, keyboard: [[{ text: "Open journal", url: link("/setups") ?? "https://t.me" }, { text: "Menu", callback_data: "menu" }]] });
}

async function alertsList(c: ChatCtx) {
  if (!c.userId) return needLink(c);
  const [{ data: rules }, { data: events }] = await Promise.all([
    c.sb.from("alerts").select("symbol, type, params, timeframe, active").eq("user_id", c.userId).order("created_at", { ascending: false }).limit(10),
    c.sb.from("alert_events").select("title, fired_at, read").eq("user_id", c.userId).order("fired_at", { ascending: false }).limit(5),
  ]);
  const r = (rules ?? []).map((a) => `${a.active ? "🔔" : "🔕"} ${esc(a.symbol)} ${esc(a.type)}${a.params?.price ? ` ${fmtUsd(Number(a.params.price))}` : ""}${a.params?.rsi ? ` ${a.params.rsi}` : ""} ${esc(a.timeframe ?? "")}`);
  const e = (events ?? []).map((x) => `${x.read ? "·" : "•"} ${esc(x.title)}`);
  return tgSend(c.chatId, `<b>🔔 Alerts</b>\n${r.length ? r.join("\n") : "No rules yet. Try: /alert BTC above 100000"}\n\n<b>Inbox</b>\n${e.length ? e.join("\n") : "Nothing fired yet."}`, { html: true, keyboard: [[{ text: "Manage alerts", url: link("/alerts") ?? "https://t.me" }, { text: "Menu", callback_data: "menu" }]] });
}

async function createAlert(c: ChatCtx, row: Record<string, unknown>) {
  const { error } = await c.sb.from("alerts").insert({ user_id: c.userId, channels: ["push", "email"], cooldown_minutes: 60, timeframe: "1h", params: {}, ...row });
  return !error;
}

async function alertCreate(c: ChatCtx, arg: string) {
  if (!c.userId) return needLink(c);
  const m = arg.match(/^(\S+)\s+(above|below|over|under|>|<)\s+([\d.,]+)/i);
  if (!m) return tgSend(c.chatId, "Usage: /alert BTC above 100000  or  /alert SOL below 150");
  const cn = await resolveCoin(m[1]); if (!cn) return tgSend(c.chatId, `Coin "${esc(m[1])}" not found.`, { html: true });
  const price = Number(m[3].replace(/,/g, ""));
  const above = /above|over|>/i.test(m[2]);
  const ok = await createAlert(c, { asset_key: `cg:${cn.id}`, symbol: cn.symbol, type: above ? "price_above" : "price_below", params: { price }, asset_ref: { symbol: cn.symbol, id: cn.id } });
  return tgSend(c.chatId, ok ? `🔔 Alert set: ${esc(cn.symbol)} ${above ? "above" : "below"} ${fmtUsd(price)}. You will hear from me here when it triggers.` : "Could not save the alert.", { html: true });
}
async function alertFromSetup(c: ChatCtx, id: string, tf: Timeframe) {
  if (!c.userId) return needLink(c);
  const cn = await resolveCoin(id); if (!cn) return tgSend(c.chatId, "Coin not found.");
  const a = await safe(analyzeAsset({ symbol: cn.symbol, coingeckoId: cn.id, venue: c.venue }, [tf]));
  const t = a.ok ? a.data.timeframes[tf] : null; const s = t && !("unavailable" in t) ? t.setup : null;
  if (!s) return tgSend(c.chatId, "No setup to alert on.");
  const okTp = await createAlert(c, { asset_key: `cg:${cn.id}`, symbol: cn.symbol, type: s.side === "LONG" ? "price_above" : "price_below", params: { price: s.takeProfits[0].price }, asset_ref: { symbol: cn.symbol, id: cn.id }, timeframe: tf });
  const okSl = await createAlert(c, { asset_key: `cg:${cn.id}`, symbol: cn.symbol, type: s.side === "LONG" ? "price_below" : "price_above", params: { price: s.stopLosses[0].price }, asset_ref: { symbol: cn.symbol, id: cn.id }, timeframe: tf });
  return tgSend(c.chatId, okTp && okSl ? `🔔 Two alerts set for ${esc(cn.symbol)}: TP1 ${fmtUsd(s.takeProfits[0].price)} and SL1 ${fmtUsd(s.stopLosses[0].price)}.` : "Could not save the alerts.", { html: true });
}
async function alertConfirm(c: ChatCtx, id: string) {
  if (!c.userId) return needLink(c);
  const cn = await resolveCoin(id); if (!cn) return tgSend(c.chatId, "Coin not found.");
  const ok = await createAlert(c, { asset_key: `cg:${cn.id}`, symbol: cn.symbol, type: "new_confirmed", params: {}, asset_ref: { symbol: cn.symbol, id: cn.id } });
  return tgSend(c.chatId, ok ? `🔔 I will tell you when ${esc(cn.symbol)} enters Confirmed Trades on any timeframe.` : "Could not save the alert.", { html: true });
}

// ---------- guided trade recording ----------

async function takeStart(c: ChatCtx, arg: string, tf: Timeframe = "4h", paper = false) {
  if (!c.userId) return needLink(c);
  const q = arg.trim().split(/\s+/)[0];
  if (!q) return tgSend(c.chatId, "Which coin? /take SOL (or tap ✍️ on a setup card).");
  const cn = await resolveCoin(q); if (!cn) return tgSend(c.chatId, `Coin "${esc(q)}" not found.`, { html: true });
  const a = await safe(analyzeAsset({ symbol: cn.symbol, coingeckoId: cn.id, venue: c.venue }, [tf]));
  const t = a.ok ? a.data.timeframes[tf] : null; const s = t && !("unavailable" in t) ? t.setup : null;
  const state = { flow: "take", step: "fill", coin: cn, tf, paper, setup: s ? { side: s.side, kind: s.kind, entry: s.entry, takeProfits: s.takeProfits.map((x) => ({ price: x.price })), stopLosses: s.stopLosses.map((x) => ({ price: x.price })), rr: s.riskRewardTp2, confidence: s.confidence, leverage: s.leverage } : null, price: t && !("unavailable" in t) ? t.price : null };
  await setState(c, state);
  return tgSend(c.chatId, `${paper ? "🧪 <b>Paper trade</b>" : "✍️ <b>Record trade</b>"}: ${esc(cn.symbol)} ${s ? `${s.side} ${tf} (${esc(s.kind)}, SL ${fmtUsd(s.stopLosses[0].price)}, TP1 ${fmtUsd(s.takeProfits[0].price)})` : tf}\n\nStep 1 of 3: what was your <b>fill price</b>?${state.price ? ` (current ${fmtUsd(state.price)}; send "." to use it)` : ""}\nSend /cancel to stop.`, { html: true });
}

async function takeStep(c: ChatCtx, text: string): Promise<boolean> {
  const st = c.state;
  const num = (v: string) => { const n = Number(String(v).replace(",", ".").replace(/[$,]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
  if (st.step === "fill") {
    const fill = text.trim() === "." ? st.price : num(text);
    if (!fill) { await tgSend(c.chatId, "Send the fill price as a number (or . for the current price)."); return true; }
    st.fill = fill;
    if (!st.setup) { st.step = "stop"; await setState(c, st); await tgSend(c.chatId, `Step 2 of 3: your <b>stop loss</b> price? (no engine setup for this coin, so I need yours)`, { html: true }); return true; }
    st.step = "size"; await setState(c, st); await tgSend(c.chatId, `Step 2 of 3: <b>size in USD</b>? (e.g. 50)${st.paper ? " Pretend size is fine." : ""}`, { html: true }); return true;
  }
  if (st.step === "stop") {
    const stop = num(text); if (!stop) { await tgSend(c.chatId, "Send the stop price as a number."); return true; }
    st.setup = { side: stop < st.fill ? "LONG" : "SHORT", kind: "speculative", entry: { low: st.fill, high: st.fill, mid: st.fill }, takeProfits: [], stopLosses: [{ price: stop }], rr: 0, confidence: 0, leverage: null };
    st.step = "size"; await setState(c, st); await tgSend(c.chatId, `Step 3 of 3: <b>size in USD</b>?`, { html: true }); return true;
  }
  if (st.step === "size") {
    const usd = num(text); if (!usd) { await tgSend(c.chatId, "Send the size in USD as a number."); return true; }
    const units = usd / st.fill;
    const sl = st.setup.stopLosses[0]?.price;
    const riskUsd = sl ? Math.abs(st.fill - sl) * units : null;
    const row = { user_id: c.userId, asset_key: `cg:${st.coin.id}`, symbol: st.coin.symbol, timeframe: st.tf, side: st.setup.side, kind: st.setup.kind, entry_low: st.setup.entry.low, entry_high: st.setup.entry.high, tp1: st.setup.takeProfits[0]?.price ?? null, tp2: st.setup.takeProfits[1]?.price ?? null, tp3: st.setup.takeProfits[2]?.price ?? null, sl1: sl ?? null, sl2: st.setup.stopLosses[1]?.price ?? null, rr: st.setup.rr ?? null, leverage: st.setup.leverage?.recommended ?? null, confidence: st.setup.confidence ?? null, payload: st.setup, taken: true, paper: !!st.paper, taken_at: new Date().toISOString(), exchange: st.paper ? "paper" : c.venue, fill_price: st.fill, size_units: units, size_usd: usd, risk_usd: riskUsd, notes: "Recorded via Telegram" };
    const { error } = await c.sb.from("saved_setups").insert(row);
    await setState(c, null);
    if (error) { await tgSend(c.chatId, `Could not save: ${esc(error.message)}`, { html: true }); return true; }
    await tgSend(c.chatId, `${st.paper ? "🧪 Paper trade" : "✅ Trade"} recorded: ${esc(st.coin.symbol)} ${st.setup.side} ${esc(st.tf)}, fill ${fmtUsd(st.fill)}, ${fmtNum(units, 4)} units (${fmtUsd(usd)})${riskUsd != null ? `, ${fmtUsd(riskUsd)} at risk if the stop hits` : ""}.\nI will message you when it reaches a target or the stop.`, { html: true, keyboard: [[{ text: "My trades", callback_data: "me" }, { text: "Journal", url: link("/setups") ?? "https://t.me" }]] });
    return true;
  }
  return false;
}

// ---------- free text ----------

async function freeText(c: ChatCtx, text: string) {
  await tgTyping(c.chatId);
  try {
    const a = await answer({ question: text, venue: c.venue, userId: c.userId, sb: c.userId ? c.sb : null, adminSb: c.sb });
    const body = [esc(a.text), ...(a.bullets?.length ? ["", ...a.bullets.map((b) => `• ${esc(b)}`)] : [])].join("\n");
    const kb: Keyboard = [];
    if (a.context?.coin && (a.context.coin as any).id) kb.push([{ text: `${(a.context.coin as any).symbol} setup card`, callback_data: `setup:${(a.context.coin as any).id}:4h` }]);
    if (a.links[0] && link(a.links[0].href)) kb.push([{ text: a.links[0].label, url: link(a.links[0].href)! }, { text: "Menu", callback_data: "menu" }]);
    return tgSend(c.chatId, body + "\n\n<i>Not financial advice. Manual trading only.</i>", { html: true, keyboard: kb });
  } catch (e) {
    return tgSend(c.chatId, `Could not answer right now: ${esc((e as Error).message)}`, { html: true });
  }
}
