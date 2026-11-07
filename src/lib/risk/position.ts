// Position sizing: risk-first. The size is derived from the distance to the
// stop and the money the user is willing to lose - never from a "feeling".

export interface RiskInputs {
  tradingBalance: number; // capital allocated to trading (USD)
  portfolioValue?: number; // total portfolio, for exposure %
  riskPct: number; // % of trading balance risked per trade (e.g. 1)
  maxLossUsd?: number; // optional hard cap on $ loss per trade
  maxExposurePct?: number; // max % of trading balance in one position (e.g. 25)
  leverage?: number; // 1 = spot
  side: "LONG" | "SHORT";
  entry: number;
  stop: number;
  takeProfits: number[]; // TP1..TPn
  feePct?: number; // round-trip fee estimate, default 0.2%
}

export interface RiskOutput {
  ok: boolean;
  warnings: string[];
  riskUsd: number; // $ at risk if stop hits
  stopDistancePct: number;
  positionSizeUnits: number; // token units
  positionValueUsd: number; // notional
  marginUsd: number; // capital tied up (notional / leverage)
  exposurePctOfTrading: number;
  exposurePctOfPortfolio: number | null;
  remainingCapital: number;
  profits: { label: string; price: number; profitUsd: number; rr: number; pct: number }[];
  liquidationEstimate: number | null;
  capped: "risk" | "exposure" | "balance" | null;
}

export function sizePosition(i: RiskInputs): RiskOutput {
  const warnings: string[] = [];
  const lev = Math.max(1, i.leverage ?? 1);
  const fee = (i.feePct ?? 0.2) / 100;
  if (!(i.entry > 0) || !(i.stop > 0) || !(i.tradingBalance > 0)) {
    return empty(["Entry, stop and trading balance must be positive numbers."]);
  }
  const dir = i.side === "LONG" ? 1 : -1;
  const stopDist = (i.entry - i.stop) * dir; // positive when stop is on the correct side
  if (stopDist <= 0) return empty([`For a ${i.side}, the stop must be ${i.side === "LONG" ? "below" : "above"} the entry.`]);
  const stopDistancePct = stopDist / i.entry;

  // 1) risk budget
  let riskUsd = (i.tradingBalance * i.riskPct) / 100;
  if (i.maxLossUsd && i.maxLossUsd < riskUsd) riskUsd = i.maxLossUsd;
  if (i.riskPct > 3) warnings.push("Risking more than 3% per trade is aggressive; a short losing streak can compound into a large drawdown.");

  // 2) units from risk / stop distance (fees eat into the budget)
  let units = riskUsd / (stopDist + i.entry * fee);
  let notional = units * i.entry;
  let capped: RiskOutput["capped"] = "risk";

  // 3) exposure cap
  const maxExposure = i.maxExposurePct ? (i.tradingBalance * i.maxExposurePct) / 100 : Infinity;
  if (notional > maxExposure) {
    notional = maxExposure;
    units = notional / i.entry;
    capped = "exposure";
    warnings.push(`Position capped by your max exposure (${i.maxExposurePct}% of trading balance). Actual risk is below your budget.`);
  }
  // 4) balance cap (notional / leverage must fit)
  const maxNotional = i.tradingBalance * lev;
  if (notional > maxNotional) {
    notional = maxNotional;
    units = notional / i.entry;
    capped = "balance";
    warnings.push(`Position capped by available balance${lev > 1 ? ` × ${lev}x leverage` : ""}. The stop is too close to risk your full budget without more capital.`);
  }
  const actualRisk = units * stopDist + notional * fee;
  const margin = notional / lev;
  const profits = i.takeProfits
    .filter((p) => p > 0)
    .map((price, idx) => {
      const gross = units * (price - i.entry) * dir;
      const net = gross - notional * fee;
      return { label: `TP${idx + 1}`, price, profitUsd: round2(net), rr: round2(actualRisk > 0 ? net / actualRisk : 0), pct: round2(((price - i.entry) * dir * 100) / i.entry) };
    });
  if (profits.length && profits[0].rr < 1) warnings.push("TP1 pays less than 1R - the first target does not cover the risk.");
  if (lev > 1) warnings.push(`At ${lev}x leverage a ${(100 / lev).toFixed(1)}% adverse move wipes the margin; your stop (${(stopDistancePct * 100).toFixed(2)}%) must be well inside that.`);

  const liq = lev > 1 ? i.entry * (1 - (dir * 0.95) / lev) : null; // rough: 95% of maintenance margin
  if (liq != null && ((i.side === "LONG" && i.stop <= liq) || (i.side === "SHORT" && i.stop >= liq))) warnings.push("Your stop is beyond the estimated liquidation price - reduce leverage.");

  return {
    ok: true,
    warnings,
    riskUsd: round2(actualRisk),
    stopDistancePct: round2(stopDistancePct * 100),
    positionSizeUnits: units,
    positionValueUsd: round2(notional),
    marginUsd: round2(margin),
    exposurePctOfTrading: round2((notional / i.tradingBalance) * 100),
    exposurePctOfPortfolio: i.portfolioValue ? round2((notional / i.portfolioValue) * 100) : null,
    remainingCapital: round2(i.tradingBalance - margin),
    profits,
    liquidationEstimate: liq,
    capped,
  };
}

function empty(warnings: string[]): RiskOutput {
  return { ok: false, warnings, riskUsd: 0, stopDistancePct: 0, positionSizeUnits: 0, positionValueUsd: 0, marginUsd: 0, exposurePctOfTrading: 0, exposurePctOfPortfolio: null, remainingCapital: 0, profits: [], liquidationEstimate: null, capped: null };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
