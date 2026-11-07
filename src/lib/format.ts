export function fmtUsd(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return "-";
  if (opts.compact) {
    const a = Math.abs(v);
    if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  }
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  if (v >= 0.0001) return `$${v.toFixed(6)}`;
  return `$${v.toPrecision(3)}`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "-";
  if (Math.abs(v) >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 1) return v.toFixed(digits);
  if (Math.abs(v) >= 0.01) return v.toFixed(4);
  return v.toPrecision(3);
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function pctClass(v: number | null | undefined): string {
  if (v == null) return "text-fg-3";
  return v > 0 ? "up" : v < 0 ? "down" : "text-fg-2";
}

export function timeAgo(ms: number): string {
  const d = Date.now() - ms;
  const s = Math.round(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
