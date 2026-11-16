import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { cardBg, cardMath, cardMoney } from "@/lib/card-presets";

export const runtime = "edge";

/**
 * Result card image.
 *  - Signal result (posted by the bot at TP2 and TP3):
 *    /api/result-card?symbol=SOL&tf=4h&side=LONG&entry=84.4&exit=91.2&sl=81.9&level=TP2&hours=31
 *  - A trader's own result (Stage 50): add mine=1 and any of usd=123.45, lev=5, name=Ashe, bg=gold, level=CLOSED
 * The AsheSignal mark is always drawn. Every text is an HTML div (the renderer has no SVG text), and every
 * multi-child div is a flex box.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const g = (k: string, d = "") => q.get(k) ?? d;
  const side = g("side", "LONG") === "SHORT" ? "SHORT" : "LONG";
  const entry = Number(g("entry")), exit = Number(g("exit")), sl = Number(g("sl"));
  const mine = g("mine") === "1";
  const t = cardBg(g("bg"));
  const m = cardMath({ side, entry, exit, sl: g("sl") ? sl : null, lev: g("lev") ? Number(g("lev")) : null });
  const usd = g("usd") !== "" && Number.isFinite(Number(g("usd"))) ? Number(g("usd")) : null;
  const name = g("name").replace(/[<>]/g, "").slice(0, 24);
  const red = "#f0506e";
  const tone = m.win ? t.accent : red;
  const hours = Number(g("hours"));
  const took = Number.isFinite(hours) && hours > 0 ? (hours >= 48 ? `${Math.round(hours / 24)} days` : `${Math.max(1, Math.round(hours))} h`) : null;
  const level = g("level", mine ? (m.win ? "WIN" : "LOSS") : "TARGET").toUpperCase().slice(0, 10);
  const badge = mine ? level : `${level} HIT`;
  const big = m.lev > 1 ? m.levPct : m.movePct;
  const sub = m.lev > 1
    ? `with ${m.lev}x leverage (${m.movePct >= 0 ? "+" : ""}${m.movePct.toFixed(1)}% price move)${m.r != null ? `, ${m.r.toFixed(1)}R` : ""}`
    : m.r != null ? `${m.r.toFixed(1)}R${mine ? "" : " on the plan, before leverage"}` : mine ? "price move" : "price move on the plan, before leverage";
  const stat = (label: string, value: string, color = t.fg) => (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "18px 22px", background: t.panel, borderRadius: 18, border: `1px solid ${t.light ? "#d5dde6" : "rgba(255,255,255,.08)"}` }}>
      <div style={{ display: "flex", color: t.fg2, fontSize: 22 }}>{label}</div>
      <div style={{ display: "flex", color, fontSize: 40, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundImage: `linear-gradient(${t.angle}deg, ${t.from}, ${t.to})`, color: t.fg, padding: 44, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "8px 16px 8px 8px", borderRadius: 16, background: "rgba(11,15,20,.78)" }}>
            <div style={{ display: "flex", width: 44, height: 44, borderRadius: 12, background: "#10161d", border: "2px solid #36bd94", alignItems: "center", justifyContent: "center", color: "#36bd94", fontSize: 30, fontWeight: 800 }}>A</div>
            <div style={{ display: "flex", marginLeft: 12, fontSize: 30, fontWeight: 700, color: "#e6edf3" }}>Ashe<span style={{ color: "#36bd94" }}>Signal</span></div>
          </div>
          <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: tone, color: t.light ? "#ffffff" : "#0b0f14", fontSize: 26, fontWeight: 800 }}>{badge}</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: 34 }}>
          <div style={{ display: "flex", fontSize: 92, fontWeight: 800, lineHeight: 1 }}>{g("symbol", "COIN").toUpperCase().slice(0, 10)}</div>
          <div style={{ display: "flex", marginLeft: 20, marginBottom: 12, fontSize: 34, color: side === "LONG" ? t.accent : red, fontWeight: 700 }}>{`${side} ${g("tf", "")}`}</div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 14 }}>
          <div style={{ display: "flex", fontSize: 120, fontWeight: 800, color: tone, lineHeight: 1 }}>{`${big >= 0 ? "+" : ""}${big.toFixed(1)}%`}</div>
          <div style={{ display: "flex", marginLeft: 24, fontSize: 30, color: t.fg2 }}>{sub}</div>
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 34 }}>
          {stat(mine ? "Entry" : "Entry (zone middle)", cardMoney(entry))}
          {stat(mine ? "Exit" : level, cardMoney(exit), tone)}
          {usd != null ? stat("Profit / loss", `${usd >= 0 ? "+" : "-"}${cardMoney(Math.abs(usd))}`, usd >= 0 ? t.accent : red) : g("sl") && Number.isFinite(sl) && sl > 0 ? stat("Stop was", cardMoney(sl), red) : null}
          {took ? stat(mine ? "Held for" : "Time to target", took) : null}
        </div>
        <div style={{ display: "flex", marginTop: "auto", justifyContent: "space-between", color: t.fg2, fontSize: 22 }}>
          <div style={{ display: "flex" }}>{mine ? `Personal result shared by ${name || "an AsheSignal trader"}. Numbers are the trader's own.` : "Result of the published plan. Every signal is graded, losers included."}</div>
          <div style={{ display: "flex", marginLeft: 20 }}>Not financial advice</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
