// Stage 50 - backgrounds for result cards, shared by the website's card studio, the server-rendered card and the bot.

export interface CardBg { id: string; label: string; from: string; to: string; angle: number; fg: string; fg2: string; panel: string; accent: string; light?: boolean }

export const CARD_BGS: CardBg[] = [
  { id: "foundry", label: "Foundry", from: "#121a22", to: "#0b0f14", angle: 135, fg: "#e6edf3", fg2: "#9fb0c0", panel: "rgba(16,22,29,.82)", accent: "#36bd94" },
  { id: "gold", label: "Gold", from: "#2a2008", to: "#0c0a05", angle: 135, fg: "#fff6d6", fg2: "#cbb88a", panel: "rgba(28,22,8,.82)", accent: "#d4af37" },
  { id: "midnight", label: "Midnight", from: "#0d1330", to: "#05081a", angle: 160, fg: "#e9edff", fg2: "#a9b4e8", panel: "rgba(13,19,48,.82)", accent: "#22d3ee" },
  { id: "ember", label: "Ember", from: "#3a1408", to: "#120c0a", angle: 150, fg: "#f8ece6", fg2: "#cdb7ad", panel: "rgba(27,19,16,.82)", accent: "#ff7a45" },
  { id: "aurora", label: "Aurora", from: "#0b3b34", to: "#1a1140", angle: 125, fg: "#eafff7", fg2: "#b5d6cc", panel: "rgba(8,20,28,.72)", accent: "#5eead4" },
  { id: "sunset", label: "Sunset", from: "#5b1d4a", to: "#1b0f2e", angle: 140, fg: "#fff0f6", fg2: "#e0b8cf", panel: "rgba(30,12,36,.74)", accent: "#fb7185" },
  { id: "terminal", label: "Terminal", from: "#041204", to: "#000000", angle: 180, fg: "#b6ffb6", fg2: "#6fdc6f", panel: "rgba(5,10,5,.85)", accent: "#39ff14" },
  { id: "paper", label: "Paper", from: "#ffffff", to: "#e8edf2", angle: 135, fg: "#0f172a", fg2: "#475569", panel: "rgba(255,255,255,.86)", accent: "#0f9d74", light: true },
];
export const cardBg = (id?: string | null): CardBg => CARD_BGS.find((b) => b.id === id) ?? CARD_BGS[0];

/** The numbers every result card shows, from a trade's raw values. */
export function cardMath(o: { side: string; entry: number; exit: number; sl?: number | null; lev?: number | null }) {
  const long = o.side !== "SHORT";
  const ok = Number.isFinite(o.entry) && Number.isFinite(o.exit) && o.entry > 0;
  const movePct = ok ? ((long ? o.exit - o.entry : o.entry - o.exit) / o.entry) * 100 : 0;
  const risk = o.sl != null && Number.isFinite(o.sl) && o.sl > 0 ? Math.abs(o.entry - o.sl) : 0;
  const r = ok && risk > 0 ? (long ? o.exit - o.entry : o.entry - o.exit) / risk : null;
  const lev = o.lev != null && Number.isFinite(o.lev) && o.lev > 1 ? Math.min(o.lev, 125) : 1;
  return { movePct, r, lev, levPct: movePct * lev, win: movePct >= 0 };
}
export const cardMoney = (n: number) => (!Number.isFinite(n) ? "-" : Math.abs(n) >= 1000 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : Math.abs(n) >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(4)}`);
