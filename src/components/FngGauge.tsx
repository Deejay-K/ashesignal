import type { FearGreedPoint } from "@/lib/types";
import Term from "./Term";

const color = (v: number) => (v <= 24 ? "#f0506e" : v <= 44 ? "#f2a444" : v <= 55 ? "#9fb0c0" : v <= 75 ? "#7fd4b0" : "#36bd94");

export default function FngGauge({ history, compact = false }: { history: FearGreedPoint[]; compact?: boolean }) {
  const now = history[history.length - 1];
  const prev = history[history.length - 2];
  const week = history[history.length - 8];
  const month = history[history.length - 31];
  const r = 44;
  const ang = Math.PI * (1 - now.value / 100);
  const x = 50 + r * Math.cos(ang);
  const y = 50 - r * Math.sin(ang);
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 56" className={compact ? "h-16 w-28 shrink-0" : "h-28 w-48 shrink-0"}>
        <defs>
          <linearGradient id="fng" x1="0" x2="1">
            <stop offset="0" stopColor="#f0506e" /><stop offset="0.5" stopColor="#f2b544" /><stop offset="1" stopColor="#36bd94" />
          </linearGradient>
        </defs>
        <path d="M6 50 A44 44 0 0 1 94 50" fill="none" stroke="url(#fng)" strokeWidth="8" strokeLinecap="round" opacity="0.5" />
        <circle cx={x} cy={y} r="5" fill={color(now.value)} stroke="#0b0f14" strokeWidth="2" />
        <text x="50" y="48" textAnchor="middle" fontSize="20" fontWeight="700" fill="#e6edf3" fontFamily="ui-monospace, monospace">{now.value}</text>
      </svg>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-fg-3"><Term id="fng">Fear &amp; Greed</Term></div>
        <div className="font-semibold" style={{ color: color(now.value) }}>{now.label}</div>
        <div className="num mt-1 text-xs text-fg-3">
          {prev ? <>yday {prev.value} · </> : null}{week ? <>week {week.value} · </> : null}{month ? <>month {month.value}</> : null}
        </div>
      </div>
    </div>
  );
}
