import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { getOhlcv } from "@/lib/market/ohlcv";
import type { Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Candle chart as a PNG with the setup drawn on it (entry zone, TP1-3, SL1-2). Used by the Telegram messages and
 * the share buttons. /api/chart?symbol=SOL&tf=4h&side=LONG&entryLow=&entryHigh=&tp1=&tp2=&tp3=&sl1=&sl2=&id=solana
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const n = (k: string) => { const v = Number(q.get(k)); return Number.isFinite(v) && v > 0 ? v : null; };
  const symbol = (q.get("symbol") ?? "BTC").toUpperCase();
  const tf = (q.get("tf") ?? "4h") as Timeframe;
  const side = q.get("side") === "SHORT" ? "SHORT" : "LONG";
  const dark = q.get("theme") !== "paper";
  const C = dark ? { bg: "#0b0f14", grid: "#1b2430", fg: "#e6edf3", fg2: "#8da0b3", up: "#36bd94", down: "#f0506e", zone: "rgba(54,189,148,0.18)", zoneS: "rgba(240,80,110,0.18)", tp: "#36bd94", sl: "#f0506e", amber: "#f2b544" } : { bg: "#ffffff", grid: "#e5e9ef", fg: "#0f172a", fg2: "#64748b", up: "#0f9d74", down: "#d7263d", zone: "rgba(15,157,116,0.15)", zoneS: "rgba(215,38,61,0.15)", tp: "#0f9d74", sl: "#d7263d", amber: "#b7791f" };
  let candles: { time: number; open: number; high: number; low: number; close: number }[] = [];
  try { const r = await getOhlcv({ symbol, coingeckoId: q.get("id") ?? undefined }, tf, 120); candles = r.candles.slice(-90); } catch { /* drawn empty below */ }
  const levels = [
    { k: "entryLow", v: n("entryLow") }, { k: "entryHigh", v: n("entryHigh") }, { k: "tp1", v: n("tp1") }, { k: "tp2", v: n("tp2") }, { k: "tp3", v: n("tp3") }, { k: "sl1", v: n("sl1") }, { k: "sl2", v: n("sl2") },
  ].filter((x) => x.v != null) as { k: string; v: number }[];
  const W = 1200, H = 630, padL = 20, padR = 130, padT = 70, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const vals = [...candles.flatMap((c) => [c.high, c.low]), ...levels.map((l) => l.v)];
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals);
  const span = (hi0 - lo0) || 1; const lo = lo0 - span * 0.04, hi = hi0 + span * 0.04;
  const y = (p: number) => padT + ((hi - p) / (hi - lo)) * plotH;
  const cw = candles.length ? plotW / candles.length : 10;
  const money = (v: number) => (v >= 1000 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toPrecision(4)}`);
  const last = candles.at(-1)?.close ?? null;
  const get = (k: string) => levels.find((l) => l.k === k)?.v ?? null;
  const eL = get("entryLow"), eH = get("entryHigh");
  const gridLines = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const lineColor = (k: string) => (k.startsWith("tp") ? C.tp : k.startsWith("sl") ? C.sl : C.amber);
  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, color: C.fg, fontFamily: "sans-serif", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 24px 0 24px", fontSize: 26 }}>
          <span style={{ fontWeight: 800 }}>{symbol}</span>
          <span style={{ color: C.fg2 }}>{tf}</span>
          <span style={{ color: side === "LONG" ? C.up : C.down, fontWeight: 700 }}>{side}</span>
          {last != null ? <span style={{ color: C.fg2 }}>{money(last)}</span> : null}
          <span style={{ marginLeft: "auto", color: C.fg2, fontSize: 18 }}>AsheSignal · manual trading only</span>
        </div>
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
          {gridLines.map((g, i) => <line key={i} x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke={C.grid} strokeWidth={1} />)}
          {gridLines.map((g, i) => <text key={`t${i}`} x={W - padR + 8} y={y(g) + 5} fill={C.fg2} fontSize={16}>{money(g)}</text>)}
          {eL != null && eH != null ? <rect x={padL} y={y(eH)} width={plotW} height={Math.max(2, y(eL) - y(eH))} fill={side === "LONG" ? C.zone : C.zoneS} /> : null}
          {candles.map((c, i) => {
            const x = padL + i * cw + cw * 0.15; const w = Math.max(2, cw * 0.7); const up = c.close >= c.open; const col = up ? C.up : C.down;
            return (<g key={i}><line x1={x + w / 2} x2={x + w / 2} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth={1.5} /><rect x={x} y={y(Math.max(c.open, c.close))} width={w} height={Math.max(1.5, Math.abs(y(c.open) - y(c.close)))} fill={col} /></g>);
          })}
          {levels.filter((l) => l.k !== "entryLow" && l.k !== "entryHigh").map((l) => (
            <g key={l.k}><line x1={padL} x2={W - padR} y1={y(l.v)} y2={y(l.v)} stroke={lineColor(l.k)} strokeWidth={2} strokeDasharray={l.k.startsWith("sl") ? "10 6" : "4 4"} /><rect x={W - padR - 150} y={y(l.v) - 14} width={142} height={26} rx={6} fill={lineColor(l.k)} /><text x={W - padR - 142} y={y(l.v) + 5} fill={C.bg} fontSize={16} fontWeight={700}>{l.k.toUpperCase()} {money(l.v)}</text></g>
          ))}
          {eL != null && eH != null ? <text x={padL + 8} y={y(eH) - 8} fill={C.amber} fontSize={16} fontWeight={700}>ENTRY {money(eL)} to {money(eH)}</text> : null}
          {!candles.length ? <text x={W / 2 - 160} y={H / 2} fill={C.fg2} fontSize={24}>Candles unavailable right now</text> : null}
        </svg>
      </div>
    ),
    { width: W, height: H },
  );
}
