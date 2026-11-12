// Step-by-step "how to place this trade" for each exchange, with the setup's numbers filled in.
// Pure data: the /guide page renders it, Copy exports it as text. Nothing here talks to an exchange.

import { VENUE_META, type VenueId } from "@/lib/venues";
import { fmtUsd, fmtNum } from "@/lib/format";

export type Market = "spot" | "perp";

export interface GuideSetup {
  symbol: string;
  side: "LONG" | "SHORT";
  entry: number;
  entryLow?: number;
  entryHigh?: number;
  stop: number;
  stop2?: number;
  tps: number[];           // TP1..TP3
  leverage: number;        // 1 = spot
  units?: number;          // from the risk calculator when known
  notional?: number;       // units x entry
  riskUsd?: number;
  balance?: number;
}

export interface GuideStep { title: string; body: string[]; warn?: string; tip?: string }
export interface GuideSection { title: string; steps: GuideStep[] }

export interface Guide {
  venue: VenueId;
  market: Market;
  marketNote: string;
  pair: string;
  sections: GuideSection[];
  glossary: { term: string; meaning: string }[];
}

/** Exchange-specific UI vocabulary. Edit here when an exchange renames a button. */
const UI: Record<VenueId, {
  spotPath: string; perpPath: string; perpName: string;
  marginMode: string; leverageWhere: string;
  limitName: string; sizeField: string;
  spotTpSl: string[]; perpTpSl: string[];
  shortOnSpot: string | null; oco: boolean; notes: string[];
}> = {
  binance: {
    spotPath: "Top menu Trade > Spot, then type the pair in the search box on the right.",
    perpPath: "Top menu Derivatives > USDS-M Futures, then search the pair (it ends in USDT, e.g. BTCUSDT).",
    perpName: "USDS-M Futures (perpetual)",
    marginMode: "Above the order form click the 'Cross' button and change it to 'Isolated'. Isolated means a liquidation can only ever take the margin of this one trade, not your whole futures wallet.",
    leverageWhere: "Next to it click the leverage number (e.g. '20x') and drag the slider down to",
    limitName: "Limit",
    sizeField: "Size (you can switch the unit between the coin and USDT with the small dropdown next to the field)",
    spotTpSl: ["After your buy order fills, open the Sell side of the order form and pick 'OCO' from the order-type dropdown (sometimes under 'Stop-limit' > 'OCO').", "OCO = one order cancels the other: a limit sell at your take-profit and a stop-limit sell at your stop. Whichever hits first cancels the other.", "Fill 'Limit' (or 'Price') with the take-profit price, 'Stop' with the stop price and 'Stop limit' slightly beyond it (0.2% lower), amount = the units for that target."],
    perpTpSl: ["In the order form tick the 'TP/SL' checkbox under the price and size fields.", "Fill 'Take Profit' and 'Stop Loss' with the prices below (choose 'Mark' as the trigger). These are attached to the position and placed when your entry fills.", "To use several take-profits: leave TP empty on the entry, then after the fill open the Positions tab > 'TP/SL' column > 'Add' and create one TP per target with its own quantity."],
    shortOnSpot: null, oco: true,
    notes: ["Binance is not available to residents of Canada, the US and some other countries; use Kraken, Coinbase or OKX there."],
  },
  okx: {
    spotPath: "Top menu Trade > Spot, search the pair (format BTC/USDT).",
    perpPath: "Top menu Trade > Futures (Perpetual), search the pair (format BTC-USDT-SWAP, shown as BTCUSDT Perp).",
    perpName: "Perpetual futures",
    marginMode: "At the top of the order form choose 'Isolated' (not 'Cross').",
    leverageWhere: "Click the leverage button next to it and set it to",
    limitName: "Limit",
    sizeField: "Amount (toggle the unit between the coin and USDT, or use the 25/50/75% slider only if it matches the size below)",
    spotTpSl: ["OKX spot supports attached TP/SL: in the order form open the 'TP/SL' row under the amount field (on some layouts it is a tab named 'TP/SL' in the order-type dropdown).", "Set the TP trigger price and the SL trigger price; order price can stay 'Market' so they execute when triggered."],
    perpTpSl: ["Tick 'TP/SL' under the order form before placing the entry, set 'Take profit' and 'Stop loss' trigger prices (trigger on 'Mark').", "For several take-profits, after the fill open Positions > 'TP/SL' > 'Add' and create one per target with a partial amount."],
    shortOnSpot: "OKX spot has 'Margin' mode (toggle Spot > Margin above the order form) which allows shorting with borrowed coins; the perpetual is simpler for beginners.",
    oco: true,
    notes: [],
  },
  bybit: {
    spotPath: "Top menu Trade > Spot, search the pair (e.g. BTC/USDT).",
    perpPath: "Top menu Trade > Derivatives > USDT Perpetual, search the pair (e.g. BTCUSDT).",
    perpName: "USDT Perpetual",
    marginMode: "Top-left of the order form: click 'Cross' and switch to 'Isolated'.",
    leverageWhere: "Click the leverage value next to it and set it to",
    limitName: "Limit",
    sizeField: "Order by 'Qty' (coin units) or 'Value' (USDT); the dropdown next to the field switches it",
    spotTpSl: ["Bybit spot has a 'TP/SL' order type in the order form (next to Limit and Market) that places a conditional sell; place one for the stop and separate limit sells for the targets.", "Spot orders do not cancel each other, so when a target fills, cancel the matching part of the stop order (or simply reduce it)."],
    perpTpSl: ["Tick 'TP/SL' under the order form, enter 'Take Profit' and 'Stop Loss' prices (trigger by 'Mark Price').", "After the fill, in Positions use 'TP/SL' > 'Full position' or 'Partial' to add the other targets with their quantities."],
    shortOnSpot: "Bybit spot has 'Margin trading' (toggle in the order form) for shorting; most people use the perpetual instead.",
    oco: false,
    notes: [],
  },
  kraken: {
    spotPath: "Open Kraken Pro (pro.kraken.com) > Trade, search the pair (e.g. BTC/USD).",
    perpPath: "Kraken Futures is a separate site (futures.kraken.com) with its own wallet; transfer funds there first, then pick the perpetual (e.g. PF_XBTUSD).",
    perpName: "Kraken Futures perpetual",
    marginMode: "Kraken Futures uses per-position margin by default; in Kraken Pro spot-margin, the leverage selector in the order form sets how much you borrow.",
    leverageWhere: "In the order form set the leverage field to",
    limitName: "Limit",
    sizeField: "Amount (in coin units; the 'Total' field shows the USD value)",
    spotTpSl: ["In the Kraken Pro order form open 'Advanced' (or 'Conditional close') and set the close order: choose 'Stop loss' with the stop price. Kraken attaches ONE conditional close per order.", "Place the take-profits afterwards as separate limit sell orders at each target with the partial amounts.", "Because the stop and the limit sells are independent, cancel or reduce the stop when a target fills."],
    perpTpSl: ["On Kraken Futures the order form has 'Take profit' and 'Stop loss' fields; set them with the prices below (trigger on mark price).", "Add partial take-profits from the open position's menu after the fill."],
    shortOnSpot: "Kraken Pro allows shorting on spot with margin (select a leverage of 2x or more in the order form and choose Sell).",
    oco: false,
    notes: ["Kraken is available in Canada and the US. Use USD pairs; USDT pairs are thinner."],
  },
  coinbase: {
    spotPath: "Coinbase Advanced (coinbase.com/advanced-trade), search the pair (e.g. BTC-USD).",
    perpPath: "Perpetuals are only offered to users outside the US (Coinbase International) and not in Canada; most Coinbase users trade spot only.",
    perpName: "Perpetual (Coinbase International, where available)",
    marginMode: "Not applicable on spot.",
    leverageWhere: "Not applicable on spot; stay at",
    limitName: "Limit",
    sizeField: "Amount (toggle between coin and USD with the small switch)",
    spotTpSl: ["In the Coinbase Advanced order form (Limit tab) tick the 'TP/SL' checkbox under the amount. Two rows appear: 'Take profit' and 'Stop loss', each with a price and a % field and an estimated P&L.", "Enter the stop price in 'Stop loss' and one target in 'Take profit'. This bracket is attached to the buy: it is placed automatically when the buy fills and whichever side hits first cancels the other. The stop executes as a market sell when triggered.", "The bracket exits the whole position at one target. For the 30/30/40 plan, either put TP2 in the bracket and take everything there, or leave 'Take profit' empty and place three separate limit sells after the fill (then reduce the stop as each fills)."],
    perpTpSl: ["Where perpetuals are available, the order form has TP/SL fields; set them with the prices below."],
    shortOnSpot: null,
    oco: true,
    notes: ["Coinbase spot cannot short. A SHORT setup on Coinbase means: if you hold the coin, this is a signal to reduce or exit, not a trade to open."],
  },
};

/** Derivatives trading pages (spot links come from VENUE_META). */
const PERP_URL: Record<VenueId, (base: string, quote: string) => string> = {
  binance: (b, q) => `https://www.binance.com/en/futures/${b}${q}`,
  okx: (b, q) => `https://www.okx.com/trade-swap/${b.toLowerCase()}-${q.toLowerCase()}-swap`,
  bybit: (b, q) => `https://www.bybit.com/trade/usdt/${b}${q}`,
  kraken: (b) => `https://futures.kraken.com/trade/PF_${b === "BTC" ? "XBT" : b}USD`,
  coinbase: (b, q) => `https://www.coinbase.com/advanced-trade/spot/${b}-${q}`,
};

const pct = (a: number, b: number) => `${(((a - b) / b) * 100 >= 0 ? "+" : "")}${(((a - b) / b) * 100).toFixed(2)}%`;

/**
 * A SHORT on a spot-only exchange (Coinbase) cannot be opened. It means "sell (some of) what you hold". After the
 * sell there is no position left, so there is no TP/SL bracket: the short's targets become optional buy-back levels
 * (below price) and its stop becomes the level where the bearish idea fails (above price).
 */
function spotSellGuide(venue: VenueId, s: GuideSetup): Guide {
  const meta = VENUE_META[venue];
  const quote = meta.quotes[0];
  const pair = meta.instrument(s.symbol, quote);
  const zone = s.entryLow && s.entryHigh ? `${fmtUsd(s.entryLow)} to ${fmtUsd(s.entryHigh)}` : fmtUsd(s.entry);
  const steps: GuideSection[] = [
    { title: "What this signal means on " + meta.label, steps: [
      { title: "This is a sell signal, not a short", body: [`${meta.label} spot cannot short. The engine's SHORT setup on ${s.symbol} means it expects price to fall, so if you hold ${s.symbol} this is a reason to sell some or all of it. If you do not hold ${s.symbol}, there is nothing to do: skip it.`, `Selling ${s.symbol} for ${quote === "USD" ? "USD or USDC" : quote} closes that part of your position. After the sell you hold cash, so there is nothing left for a take profit or stop loss to protect.`], warn: `Do NOT tick 'TP/SL' on the sell order. ${meta.label}'s bracket is built for buys: it wants the take profit above and the stop below price, the opposite of a short's levels, which is why the numbers looked broken.` },
      { title: "Decide how much to sell", body: ["All of it if you would not buy it today at this price.", "Half if you want to keep exposure and buy back lower.", "Nothing if your own plan for this coin is long term (spot hold): then just note the warning."] },
    ] },
    { title: `On ${meta.label}`, steps: [
      { title: "Open the pair", body: [UI[venue].spotPath, `Confirm the pair reads ${pair}${quote === "USD" ? ` (or ${s.symbol}-USDC if you sell into USDC; the prices are the same)` : ""}.`], tip: `Direct link: ${meta.tradeUrl(s.symbol, quote)}` },
      { title: "Place the sell as a Limit order", body: [`Choose Sell and the order type 'Limit'.`, `Price: inside the sell zone ${zone}. ${s.entryLow && s.entryHigh ? "If price is already below the zone, either sell at the current price (a Limit at the current bid) or wait for a bounce back into the zone." : ""}`, `Amount: the part of your ${s.symbol} you decided to sell.`, "Leave TP/SL unticked. Review, then confirm."] },
    ] },
    { title: "Optional: buy back lower", steps: [
      { title: "Buy-back levels (the short's targets)", body: ["If you want the coin back cheaper, place Limit BUY orders at the short's targets with the dollars from the sale:", ...s.tps.map((tp, i) => `Buy ${["about a third", "about a third", "the rest"][i] ?? "a part"} at ${fmtUsd(tp)} (${pct(tp, s.entry)} from the sell)`), "Each buy can then get its own TP/SL bracket the normal way (take profit above, stop below)."] },
      { title: "When the bearish idea is wrong", body: [`If price closes above ${fmtUsd(s.stop)}${s.stop2 ? ` (wider: ${fmtUsd(s.stop2)})` : ""}, the sell signal failed. If you still want the coin, that is where you would buy back instead of waiting for lower prices.`, "Set a price alert there in AsheSignal (Alerts, price above) so you do not have to watch."] },
    ] },
    { title: "Rules that save accounts", steps: [
      { title: "Do not", body: ["Use leverage or margin you do not understand to try to short on spot.", "Panic-sell everything on one signal if the coin is a long-term holding.", "Buy back at market in a falling move: use the limit levels."] },
    ] },
  ];
  return { venue, market: "spot", marketNote: `${meta.label} spot: a SHORT setup means sell or reduce what you hold. No bracket on the sell; the short's levels become buy-back and invalidation levels.`, pair, sections: steps, glossary: [
    { term: "Limit order", meaning: "An order that only executes at your price or better." },
    { term: "Buy back", meaning: "Buying the coin again later, ideally lower than you sold." },
    { term: "Invalidation", meaning: "The price where the idea is clearly wrong; for a sell signal it is above the current price." },
  ] };
}

export function buildGuide(venue: VenueId, market: Market, s: GuideSetup): Guide {
  const ui = UI[venue];
  if (s.side === "SHORT" && market === "spot" && !VENUE_META[venue].canShort && !ui.shortOnSpot) return spotSellGuide(venue, s);
  const meta = VENUE_META[venue];
  const quote = meta.quotes[0];
  const pair = market === "perp" ? (venue === "okx" ? `${s.symbol}-${quote}-SWAP` : venue === "kraken" ? `PF_${s.symbol === "BTC" ? "XBT" : s.symbol}USD` : `${s.symbol}${quote} Perp`) : meta.instrument(s.symbol, quote);
  const isShort = s.side === "SHORT";
  const lev = market === "spot" ? 1 : Math.max(1, s.leverage);
  const split = [0.3, 0.3, 0.4];
  const units = s.units ?? null;
  const u = (f: number) => (units ? fmtNum(units * f, 4) : `${Math.round(f * 100)}% of your size`);
  const entryTxt = s.entryLow && s.entryHigh ? `${fmtUsd(s.entryLow)} to ${fmtUsd(s.entryHigh)} (mid ${fmtUsd(s.entry)})` : fmtUsd(s.entry);
  const marketNote = market === "spot"
    ? (isShort ? (ui.shortOnSpot ? `Spot cannot short by itself. ${ui.shortOnSpot}` : `${meta.label} spot cannot short. Switch to the perpetual tab, or treat this SHORT as a reason to sell what you hold.`) : "Spot: you buy the actual coin with no leverage, so there is no liquidation. Best for beginners.")
    : `${ui.perpName}: a contract that follows the price with leverage. A liquidation is possible, so the stop loss and isolated margin are not optional.`;

  const before: GuideStep[] = [
    { title: "Check the trade conditions banner", body: ["On the token page the banner at the top says whether it is a good moment to trade at all (news within 24 h, weekend liquidity, extreme fear or greed, low volume). If it says avoid or high risk, wait."], tip: "A setup is a plan, not an order to act. Most of the edge is in skipping bad conditions." },
    { title: "Size the position first", body: [s.units ? `The risk calculator sized this at ${fmtNum(s.units, 4)} ${s.symbol} (${fmtUsd(s.notional)} notional)${s.riskUsd ? `, risking ${fmtUsd(s.riskUsd)} if the stop hits` : ""}. Use exactly that size.` : "Open the risk calculator (Size this trade) with your balance and 1% risk. It gives the number of units to buy. Never size by feeling."], warn: lev > 1 ? `At ${lev}x leverage the margin you post is only 1/${lev} of the position; the loss at the stop is the same dollar amount as on spot, but the liquidation is ${(100 / lev).toFixed(1)}% away.` : undefined },
    { title: "Have the numbers ready", body: [`Pair: ${pair} on ${meta.label}`, `Direction: ${s.side}${market === "perp" ? ` at ${lev}x` : " (spot)"}`, `Entry: ${entryTxt}`, `Stop loss: ${fmtUsd(s.stop)} (${pct(s.stop, s.entry)})${s.stop2 ? `, wider alternative ${fmtUsd(s.stop2)}` : ""}`, ...s.tps.map((tp, i) => `TP${i + 1}: ${fmtUsd(tp)} (${pct(tp, s.entry)}) with ${u(split[i] ?? 0.34)} ${s.symbol}`)] },
  ];

  const open: GuideStep[] = [
    { title: `Open the pair`, body: [market === "spot" ? ui.spotPath : ui.perpPath, `Confirm the pair reads ${pair}. Check the price on the chart matches AsheSignal within a fraction of a percent.`], tip: `Direct link: ${market === "spot" ? meta.tradeUrl(s.symbol, quote) : PERP_URL[venue](s.symbol, quote)}` },
  ];
  if (market === "perp") open.push({ title: "Set isolated margin and leverage", body: [ui.marginMode, `${ui.leverageWhere} ${lev}x. Lower is always acceptable; higher is not.`], warn: "Never leave the exchange default (often 10x to 20x). The recommended leverage comes from the stop distance so the liquidation stays far beyond the stop." });
  if (market === "spot" && isShort && ui.shortOnSpot) open.push({ title: "Enable margin for the short", body: [ui.shortOnSpot, `Select Sell. Leverage ${Math.min(lev || 2, 3)}x at most.`] });

  const entry: GuideStep[] = [
    { title: `Place the entry as a ${ui.limitName} order`, body: [`Choose ${isShort ? "Sell / Short" : "Buy / Long"} and the order type '${ui.limitName}' (not Market: a limit order only fills at your price or better).`, `Price: ${s.entryLow && s.entryHigh ? `put it inside the zone, ${fmtUsd(s.entry)} is the middle. Price must come ${isShort ? "up" : "down"} to it; if it runs away without filling, the trade is missed, not chased.` : fmtUsd(s.entry)}`, `${ui.sizeField}: ${units ? `${fmtNum(units, 4)} ${s.symbol} (about ${fmtUsd(s.notional)})` : "the units from the risk calculator"}.`, "Review the order summary, then confirm."], tip: "If the exchange shows a 'Post-only' option, ticking it keeps you on the maker fee and prevents an accidental market fill." },
  ];

  const protect: GuideStep[] = [
    { title: "Attach the stop loss", body: [...(market === "spot" ? ui.spotTpSl : ui.perpTpSl), `Stop loss price: ${fmtUsd(s.stop)}. A stop that is not on the exchange does not exist: do not plan to 'watch it'.`], warn: market === "perp" ? "Trigger on Mark price, not Last price, so a single bad print on the exchange cannot stop you out." : undefined },
    { title: "Place the take-profits (partial exits)", body: [`AsheSignal's default plan is 30% at TP1, 30% at TP2, 40% at TP3:`, ...s.tps.map((tp, i) => `TP${i + 1}: ${isShort ? "buy back" : "sell"} ${u(split[i] ?? 0.34)} ${s.symbol} at ${fmtUsd(tp)}`), ui.oco ? "If you place TP and SL as one OCO per tranche, nothing needs cancelling later." : "On this exchange the stop and the targets are separate orders: when a target fills, reduce the stop to the remaining amount (and when the stop fills, cancel the remaining targets)."] },
  ];

  const manage: GuideStep[] = [
    { title: "After TP1 fills: move the stop to break-even", body: [`Edit the stop loss to ${fmtUsd(s.entry)} (your entry). From here the trade cannot lose money, only the remaining profit.`, "This is what the engine's backtests assume, so it is the fair way to follow a setup."] },
    { title: "Let TP2 and TP3 work", body: ["Do not move targets further away because it 'looks strong'. Do not add to the position.", "If the invalidation condition on the setup card happens (a close through the key level), exit at market even if the stop was not hit."] },
    { title: "Log it", body: ["Save the setup in AsheSignal (Save on the setup card) so it is auto-resolved against the real price and counts in your personal hit-rate.", "Write one line: why you took it and how you felt. Patterns in that log are worth more than any indicator."] },
  ];

  const never: GuideStep[] = [
    { title: "Do not", body: ["Enter with a Market order into a thin book (slippage eats the R:R).", "Trade without the stop on the exchange.", "Use the exchange's default leverage.", "Move the stop further away once in the trade.", "Add to a losing position.", `Risk more than ${s.balance ? fmtUsd(s.balance * 0.01) + " (1% of your balance)" : "1% of your trading balance"} on a single idea.`] },
  ];

  return {
    venue, market, marketNote, pair,
    sections: [
      { title: "Before you place anything", steps: before },
      { title: `On ${meta.label}`, steps: [...open, ...entry, ...protect] },
      { title: "While the trade is open", steps: manage },
      { title: "Rules that save accounts", steps: never },
    ],
    glossary: [
      { term: "Limit order", meaning: "An order that only executes at your price or better. It may not fill if price never reaches it." },
      { term: "Market order", meaning: "Fills immediately at whatever price is available. Fast but can be worse than expected (slippage)." },
      { term: "Stop loss (SL)", meaning: "An order that closes the trade automatically when price reaches a level where the idea is wrong." },
      { term: "Take profit (TP)", meaning: "A limit order that closes part or all of the trade at a target." },
      { term: "OCO", meaning: "One-cancels-the-other: a take-profit and a stop placed together; when one fills the other is cancelled." },
      { term: "Isolated margin", meaning: "Only the margin posted for this position can be lost. Cross margin lets one trade drain the whole wallet." },
      { term: "Leverage", meaning: "Borrowing to control a bigger position. 5x means a 20% move against you wipes the margin (liquidation)." },
      { term: "Mark price", meaning: "The fair price the exchange uses for liquidations and triggers, smoother than the last traded price." },
      { term: "R", meaning: "One R = the money you lose if the stop hits. A 2R target makes twice what the stop loses." },
    ],
  };
}

export function tradePageUrl(venue: VenueId, market: Market, base: string) { const q = VENUE_META[venue].quotes[0]; return market === "spot" ? VENUE_META[venue].tradeUrl(base, q) : PERP_URL[venue](base, q); }

export function guideToText(g: Guide, symbol: string): string {
  const lines: string[] = [`How to place the ${symbol} trade on ${VENUE_META[g.venue].label} (${g.market}) - AsheSignal`, g.marketNote, ""];
  for (const sec of g.sections) {
    lines.push(sec.title.toUpperCase());
    sec.steps.forEach((st, i) => {
      lines.push(`${i + 1}. ${st.title}`);
      for (const b of st.body) lines.push(`   - ${b}`);
      if (st.warn) lines.push(`   ! ${st.warn}`);
      if (st.tip) lines.push(`   tip: ${st.tip}`);
    });
    lines.push("");
  }
  lines.push("Manual trading only. Not financial advice.");
  return lines.join("\n");
}
