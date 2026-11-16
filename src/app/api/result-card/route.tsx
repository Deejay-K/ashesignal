import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

/**
 * Stage 49 - result card posted when a Confirmed Trade reaches a target:
 * /api/result-card?symbol=SOL&tf=4h&side=LONG&entry=84.4&exit=91.2&sl=81.9&level=TP2&hours=31
 * Every text is an HTML div (the renderer has no SVG text), and every multi-child div is a flex box.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const g = (k: string, d = "") => q.get(k) ?? d;
  const side = g("side", "LONG") === "SHORT" ? "SHORT" : "LONG";
  const entry = Number(g("entry")), exit = Number(g("exit")), sl = Number(g("sl"));
  const ok = Number.isFinite(entry) && Number.isFinite(exit) && entry > 0;
  const movePct = ok ? ((side === "LONG" ? exit - entry : entry - exit) / entry) * 100 : 0;
  const risk = Number.isFinite(sl) && sl > 0 ? Math.abs(entry - sl) : 0;
  const r = ok && risk > 0 ? Math.abs(exit - entry) / risk : null;
  const money = (n: number) => (!Number.isFinite(n) ? "-" : n >= 1000 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(4)}`);
  const mint = "#36bd94", bg = "#0b0f14", card = "#10161d", fg = "#e6edf3", fg2 = "#9fb0c0";
  const hours = Number(g("hours"));
  const took = Number.isFinite(hours) && hours > 0 ? (hours >= 48 ? `${Math.round(hours / 24)} days` : `${Math.max(1, Math.round(hours))} h`) : null;
  const stat = (label: string, value: string, color = fg) => (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "18px 22px", background: card, borderRadius: 18, border: "1px solid #1c2733" }}>
      <div style={{ display: "flex", color: fg2, fontSize: 22 }}>{label}</div>
      <div style={{ display: "flex", color, fontSize: 40, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: bg, color: fg, padding: 44, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", width: 44, height: 44, borderRadius: 12, background: card, border: `2px solid ${mint}`, alignItems: "center", justifyContent: "center", color: mint, fontSize: 30, fontWeight: 800 }}>A</div>
            <div style={{ display: "flex", marginLeft: 14, fontSize: 30, fontWeight: 700 }}>Ashe<span style={{ color: mint }}>Signal</span></div>
          </div>
          <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: mint, color: bg, fontSize: 26, fontWeight: 800 }}>{`${g("level", "TARGET")} HIT`}</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: 34 }}>
          <div style={{ display: "flex", fontSize: 92, fontWeight: 800, lineHeight: 1 }}>{g("symbol", "COIN").toUpperCase().slice(0, 10)}</div>
          <div style={{ display: "flex", marginLeft: 20, marginBottom: 12, fontSize: 34, color: side === "LONG" ? mint : "#f0506e", fontWeight: 700 }}>{`${side} ${g("tf", "")}`}</div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 14 }}>
          <div style={{ display: "flex", fontSize: 120, fontWeight: 800, color: mint, lineHeight: 1 }}>{`${movePct >= 0 ? "+" : ""}${movePct.toFixed(1)}%`}</div>
          <div style={{ display: "flex", marginLeft: 24, fontSize: 34, color: fg2 }}>{r != null ? `${r.toFixed(1)}R on the plan, before leverage` : "price move on the plan, before leverage"}</div>
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 34 }}>
          {stat("Entry (zone middle)", money(entry))}
          {stat(g("level", "Target"), money(exit), mint)}
          {stat("Stop was", Number.isFinite(sl) && sl > 0 ? money(sl) : "-", "#f0506e")}
          {took ? stat("Time to target", took) : null}
        </div>
        <div style={{ display: "flex", marginTop: "auto", justifyContent: "space-between", color: fg2, fontSize: 22 }}>
          <div style={{ display: "flex" }}>Result of the published plan. Every signal is graded, losers included.</div>
          <div style={{ display: "flex" }}>Not financial advice</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
