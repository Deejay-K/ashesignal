import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

/** Shareable setup card: /api/og?symbol=BTC&tf=4h&side=LONG&kind=confirmed&entry=..&tp1=..&tp2=..&tp3=..&sl1=..&sl2=..&rr=..&lev=..&conf=..&theme=foundry */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const g = (k: string, d = "") => q.get(k) ?? d;
  const side = g("side", "LONG");
  const bull = side === "LONG";
  const themes: Record<string, { bg: string; card: string; fg: string; fg2: string; mint: string; red: string; amber: string }> = {
    foundry: { bg: "#0b0f14", card: "#10161d", fg: "#e6edf3", fg2: "#9fb0c0", mint: "#36bd94", red: "#f0506e", amber: "#f2b544" },
    terminal: { bg: "#000000", card: "#050a05", fg: "#b6ffb6", fg2: "#6fdc6f", mint: "#39ff14", red: "#ff4d4d", amber: "#ffd23f" },
    trader: { bg: "#070707", card: "#101010", fg: "#f3efe6", fg2: "#bdb8ad", mint: "#ffb000", red: "#ff3b3b", amber: "#ffd166" },
    midnight: { bg: "#070b1a", card: "#0d1330", fg: "#e9edff", fg2: "#a9b4e8", mint: "#22d3ee", red: "#fb5c7c", amber: "#fbbf24" },
    ember: { bg: "#120c0a", card: "#1b1310", fg: "#f8ece6", fg2: "#cdb7ad", mint: "#ff7a45", red: "#ff3b5c", amber: "#ffc24b" },
    paper: { bg: "#f4f6f8", card: "#ffffff", fg: "#0f172a", fg2: "#475569", mint: "#0f9d74", red: "#d7263d", amber: "#b7791f" },
  };
  const t = themes[g("theme", "foundry")] ?? themes.foundry;
  const accent = bull ? t.mint : t.red;
  const money = (v: string) => { const n = Number(v); if (!Number.isFinite(n)) return "-"; return n >= 1000 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(4)}`; };
  const row = (label: string, value: string, color = t.fg) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${t.card === t.bg ? "#222" : t.bg}` }}>
      <span style={{ color: t.fg2, fontSize: 24 }}>{label}</span>
      <span style={{ color, fontSize: 26, fontWeight: 700 }}>{value}</span>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", flexDirection: "column", background: t.bg, color: t.fg, padding: 48, fontFamily: "ui-sans-serif, system-ui" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: t.mint }} />
          <div style={{ fontSize: 28, fontWeight: 700 }}>AsheSignal</div>
          <div style={{ marginLeft: "auto", fontSize: 22, color: t.fg2 }}>{`${g("tf")} chart · ${new Date().toISOString().slice(0, 10)}`}</div>
        </div>
        <div style={{ display: "flex", gap: 32, marginTop: 28, flex: 1 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: t.card, borderRadius: 20, padding: 32, borderLeft: `10px solid ${accent}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
              <div style={{ fontSize: 56, fontWeight: 800 }}>{g("symbol")}</div>
              <div style={{ fontSize: 40, fontWeight: 800, color: accent }}>{side}</div>
              <div style={{ fontSize: 22, padding: "4px 12px", borderRadius: 999, border: `2px solid ${g("kind") === "confirmed" ? t.mint : t.amber}`, color: g("kind") === "confirmed" ? t.mint : t.amber }}>{g("kind", "speculative")}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
              {row("Entry", `${money(g("entryLow"))} - ${money(g("entryHigh"))}`)}
              {row("TP1", money(g("tp1")), t.mint)}
              {row("TP2", money(g("tp2")), t.mint)}
              {row("TP3", money(g("tp3")), t.mint)}
              {row("SL1", money(g("sl1")), t.red)}
              {row("SL2", money(g("sl2")), t.red)}
            </div>
          </div>
          <div style={{ width: 360, display: "flex", flexDirection: "column", gap: 16 }}>
            {[["R:R to TP2", `${g("rr")}R`], ["Leverage", `${g("lev", "1")}x rec.`], ["Setup score", `${g("conf")}/100`], ["Style", g("style", "swing")]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", background: t.card, borderRadius: 16, padding: "16px 20px" }}>
                <div style={{ fontSize: 18, color: t.fg2, textTransform: "uppercase", letterSpacing: 2 }}>{k}</div>
                <div style={{ fontSize: 34, fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, fontSize: 18, color: t.fg2 }}>
          <span>Entry at zone touch · stop to break-even after TP1 · invalidated on a close beyond SL1</span>
          <span>Not financial advice</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
