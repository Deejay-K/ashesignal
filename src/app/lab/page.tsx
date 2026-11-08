"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Disclaimer, Empty, Section } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import type { VariantAgg } from "@/app/api/lab/route";
import LiveRules from "@/components/LiveRules";

interface ChartRec { assetKey: string; symbol: string; timeframe: string; filled: number; winRate: number | null; expectancyR: number | null; updatedAt: string }
interface Res { variants: VariantAgg[]; best: ChartRec[]; worst: ChartRec[]; coverage: number; updatedAt: number | null; note?: string }

const GROUPS: Record<string, string> = { baseline: "Baseline", band: "Score band", targets: "Target minimums", volume: "Volume gate", filters: "Extra filters" };

export default function LabPage() {
  const [d, setD] = useState<Res | null>(null);
  useEffect(() => { fetch("/api/lab").then((r) => r.json()).then(setD).catch(() => setD({ variants: [], best: [], worst: [], coverage: 0, updatedAt: null, note: "Could not load." })); }, []);
  const prod = d?.variants.find((v) => v.id === "production");
  const verdicts = useMemo(() => {
    if (!d || !prod || prod.filled < 30) return [];
    const out: string[] = [];
    for (const v of d.variants) {
      if (v.id === "production" || v.filled < 30 || v.expectancyR == null || prod.expectancyR == null) continue;
      const dE = v.expectancyR - prod.expectancyR;
      const dW = (v.winRate ?? 0) - (prod.winRate ?? 0);
      if (dE >= 0.08 && v.filled >= prod.filled * 0.4) out.push(`"${v.label}" would add about ${dE.toFixed(2)}R per trade (${dW >= 0 ? "+" : ""}${dW} points of win rate) with ${Math.round((100 * v.filled) / prod.filled)}% of the trade count.`);
      if (dE <= -0.08) out.push(`"${v.label}" is worse: ${dE.toFixed(2)}R per trade versus production.`);
    }
    if (!out.length) out.push("No variant beats production by a meaningful margin yet; the current rules hold up across the tested charts.");
    return out;
  }, [d, prod]);

  const betterIds = useMemo(() => (d && prod && prod.filled >= 30 ? d.variants.filter((v) => v.id !== "production" && v.filled >= 30 && v.expectancyR != null && prod.expectancyR != null && v.expectancyR - prod.expectancyR >= 0.08 && v.filled >= prod.filled * 0.4).map((v) => v.id) : []), [d, prod]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Engine Lab</h1>
        <p className="text-sm text-fg-2">The worker backtests the engine&apos;s own rules in several variants across the top 40 coins on 1h, 4h and 1d (walk-forward, 30/30/40 partial exits, break-even after TP1, fills only when the entry zone was touched). This is how a rule change earns its place: it has to beat production here first.{d?.updatedAt ? ` Updated ${timeAgo(d.updatedAt)}; ${d.coverage} chart${d.coverage === 1 ? "" : "s"} covered.` : ""}</p>
      </div>
      {!d ? <div className="card h-40 animate-pulse" /> : d.note ? <Empty>{d.note}</Empty> : !d.variants.some((v) => v.filled) ? (
        <Empty>No lab results yet. The worker runs the lab every 5 minutes, a few charts per run; the table fills over the first few hours. You can also open <code>/api/cron/lab?secret=…</code> a few times to speed it up.</Empty>
      ) : (
        <>
          <Section title="What the data says">
            <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">{verdicts.length ? verdicts.map((v, i) => <li key={i}>{v}</li>) : <li>Fewer than 30 filled trades for production so far; verdicts appear once there is enough data to mean something.</li>}</ul>
            <p className="mt-2 text-xs text-fg-3">Read these as evidence, not proof: past candles, no fees or slippage, one position at a time per chart. A variant needs a clear edge in expectancy with a decent trade count before it is worth shipping.</p>
          </Section>
          <LiveRules betterVariantIds={betterIds} />
          <Section title="Rule variants (pooled across all charts)">
            <div className="table-scroll">
              <table>
                <thead><tr><th>Variant</th><th className="text-right">Trades</th><th className="text-right">Win rate</th><th className="text-right">Expectancy</th><th className="text-right">Profit factor</th><th className="text-right">1h</th><th className="text-right">4h</th><th className="text-right">1d</th></tr></thead>
                <tbody>
                  {Object.keys(GROUPS).map((g) => (
                    <GroupRows key={g} label={GROUPS[g]} rows={d.variants.filter((v) => v.group === g)} prod={prod} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-fg-3">Win rate counts a trade as won when it reached TP1 before the stop. Expectancy is average R per filled trade including break-even exits and expiries. Per-timeframe cells show win rate / expectancy.</p>
          </Section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Where the engine works best (production rules)">
              <RecTable rows={d.best} />
            </Section>
            <Section title="Where it does not">
              <RecTable rows={d.worst} />
              <p className="mt-2 text-xs text-fg-3">These charts are exactly the ones the engine-record gate keeps out of Confirmed Trades.</p>
            </Section>
          </div>
        </>
      )}
      <Disclaimer />
    </div>
  );
}

function GroupRows({ label, rows, prod }: { label: string; rows: VariantAgg[]; prod?: VariantAgg }) {
  return (
    <>
      <tr><td colSpan={8} className="pt-3 text-[10px] uppercase tracking-wider text-fg-3">{label}</td></tr>
      {rows.map((v) => {
        const better = prod && v.id !== "production" && v.expectancyR != null && prod.expectancyR != null && v.expectancyR - prod.expectancyR >= 0.08 && v.filled >= 30;
        const worse = prod && v.id !== "production" && v.expectancyR != null && prod.expectancyR != null && v.expectancyR - prod.expectancyR <= -0.08 && v.filled >= 30;
        return (
          <tr key={v.id} className={v.id === "production" ? "bg-mint-dim/40" : ""}>
            <td>{v.label}{v.id === "production" ? <span className="pill pill-mint ml-1">live</span> : better ? <span className="pill pill-mint ml-1">better</span> : worse ? <span className="pill pill-red ml-1">worse</span> : null}</td>
            <td className="num text-right">{v.filled}</td>
            <td className="num text-right">{v.winRate != null ? `${v.winRate}%` : "-"}</td>
            <td className={`num text-right ${v.expectancyR != null ? (v.expectancyR > 0 ? "up" : "down") : ""}`}>{v.expectancyR != null ? `${v.expectancyR > 0 ? "+" : ""}${v.expectancyR}R` : "-"}</td>
            <td className="num text-right">{v.profitFactor ?? "-"}</td>
            {["1h", "4h", "1d"].map((tf) => <td key={tf} className="num text-right text-fg-2">{v.byTf[tf]?.filled ? `${v.byTf[tf].winRate}% / ${v.byTf[tf].expectancyR}R` : "-"}</td>)}
          </tr>
        );
      })}
    </>
  );
}

function RecTable({ rows }: { rows: ChartRec[] }) {
  if (!rows.length) return <p className="text-sm text-fg-3">Not enough trades per chart yet.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Chart</th><th className="text-right">Trades</th><th className="text-right">Win rate</th><th className="text-right">Expectancy</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.assetKey}|${r.timeframe}`}>
              <td><Link className="link" href={`/token/${r.assetKey.replace(/^cg:/, "")}?tf=${r.timeframe}`}>{r.symbol}</Link> <span className="text-fg-3">{r.timeframe}</span></td>
              <td className="num text-right">{r.filled}</td>
              <td className="num text-right">{r.winRate != null ? `${r.winRate}%` : "-"}</td>
              <td className={`num text-right ${(r.expectancyR ?? 0) > 0 ? "up" : "down"}`}>{r.expectancyR != null ? `${r.expectancyR > 0 ? "+" : ""}${r.expectancyR}R` : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
