// Theme registry. Each theme overrides the CSS variables declared in globals.css.
export interface Theme { id: string; name: string; blurb: string; vars: Record<string, string>; font?: "sans" | "mono"; scanlines?: boolean; light?: boolean }

export const THEMES: Theme[] = [
  { id: "foundry", name: "Foundry", blurb: "Ashe Foundry default: deep slate with mint.", vars: {} },
  { id: "terminal", name: "Terminal", blurb: "Hacker console: black, phosphor green, monospace, scanlines.", font: "mono", scanlines: true, vars: { "--bg": "#000000", "--bg-2": "#050a05", "--bg-3": "#0a140a", "--border": "#123d12", "--fg": "#b6ffb6", "--fg-2": "#6fdc6f", "--fg-3": "#3f8f3f", "--mint": "#39ff14", "--mint-dim": "rgba(57,255,20,.12)", "--red": "#ff4d4d", "--red-dim": "rgba(255,77,77,.14)", "--amber": "#ffd23f", "--amber-dim": "rgba(255,210,63,.14)", "--blue": "#5cf2ff" } },
  { id: "trader", name: "Trader", blurb: "Trading-desk terminal: near-black, amber accents, dense data.", vars: { "--bg": "#070707", "--bg-2": "#101010", "--bg-3": "#181818", "--border": "#2a2a2a", "--fg": "#f3efe6", "--fg-2": "#bdb8ad", "--fg-3": "#7d786f", "--mint": "#ffb000", "--mint-dim": "rgba(255,176,0,.14)", "--red": "#ff3b3b", "--red-dim": "rgba(255,59,59,.14)", "--amber": "#ffd166", "--amber-dim": "rgba(255,209,102,.14)", "--blue": "#4ea3ff" } },
  { id: "midnight", name: "Midnight", blurb: "Deep navy with electric cyan.", vars: { "--bg": "#070b1a", "--bg-2": "#0d1330", "--bg-3": "#141c42", "--border": "#223065", "--fg": "#e9edff", "--fg-2": "#a9b4e8", "--fg-3": "#6b77ad", "--mint": "#22d3ee", "--mint-dim": "rgba(34,211,238,.14)", "--red": "#fb5c7c", "--red-dim": "rgba(251,92,124,.14)", "--amber": "#fbbf24", "--amber-dim": "rgba(251,191,36,.14)", "--blue": "#818cf8" } },
  { id: "ember", name: "Ember", blurb: "Warm charcoal with orange-red glow.", vars: { "--bg": "#120c0a", "--bg-2": "#1b1310", "--bg-3": "#261b17", "--border": "#3b2a24", "--fg": "#f8ece6", "--fg-2": "#cdb7ad", "--fg-3": "#8c766c", "--mint": "#ff7a45", "--mint-dim": "rgba(255,122,69,.14)", "--red": "#ff3b5c", "--red-dim": "rgba(255,59,92,.14)", "--amber": "#ffc24b", "--amber-dim": "rgba(255,194,75,.14)", "--blue": "#5ab0ff" } },
  { id: "paper", name: "Paper", blurb: "Light mode: white cards, dark text, mint accent.", light: true, vars: { "--bg": "#f4f6f8", "--bg-2": "#ffffff", "--bg-3": "#eef1f4", "--border": "#d9dee5", "--fg": "#0f172a", "--fg-2": "#475569", "--fg-3": "#64748b", "--mint": "#0f9d74", "--mint-dim": "rgba(15,157,116,.12)", "--red": "#d7263d", "--red-dim": "rgba(215,38,61,.12)", "--amber": "#b7791f", "--amber-dim": "rgba(183,121,31,.14)", "--blue": "#2563eb" } },
];

export const THEME_KEY = "ashesignal.theme";
export const DEFAULT_THEME = "foundry";

/** Inline boot script: applies the stored theme before first paint (no flash). */
export const THEME_BOOT = `(function(){try{var q=new URLSearchParams(location.search).get("theme");if(q){localStorage.setItem(${JSON.stringify(THEME_KEY)},q);}var t=localStorage.getItem(${JSON.stringify(THEME_KEY)})||${JSON.stringify(DEFAULT_THEME)};document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export function applyTheme(id: string) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", id);
  try { localStorage.setItem(THEME_KEY, id); } catch {}
  window.dispatchEvent(new Event("theme-change"));
}

export function currentTheme(): string {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return document.documentElement.getAttribute("data-theme") ?? DEFAULT_THEME;
}

/** Read the live palette (for canvases that cannot use CSS variables). */
export function palette() {
  const cs = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const g = (v: string, fb: string) => (cs ? cs.getPropertyValue(v).trim() || fb : fb);
  return { bg: g("--bg", "#0b0f14"), bg3: g("--bg-3", "#161e27"), border: g("--border", "#1f2a35"), fg: g("--fg", "#e6edf3"), fg2: g("--fg-2", "#9fb0c0"), fg3: g("--fg-3", "#6b7a89"), mint: g("--mint", "#36bd94"), red: g("--red", "#f0506e"), amber: g("--amber", "#f2b544"), blue: g("--blue", "#5aa7ff") };
}

export function themeCss(): string {
  return THEMES.filter((t) => Object.keys(t.vars).length).map((t) => `:root[data-theme="${t.id}"]{${Object.entries(t.vars).map(([k, v]) => `${k}:${v}`).join(";")};${t.light ? "color-scheme:light;" : ""}${t.font === "mono" ? "--font-sans:var(--font-geist-mono),ui-monospace,monospace;" : ""}}`).join("\n");
}
