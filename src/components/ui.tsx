import type { ReactNode } from "react";
import type { DataQuality } from "@/lib/types";
import Term from "./Term";

export function QualityBadge({ quality, source, note }: { quality: DataQuality | string; source?: string; note?: string }) {
  const cls = quality === "verified" ? "pill-mint" : quality === "estimated" ? "pill-amber" : "pill-gray";
  const label = quality === "verified" ? "verified" : quality === "estimated" ? "estimated" : "unavailable";
  return (
    <span className={`pill ${cls}`} title={note ?? ""}>
      {label}
      {source ? <span className="opacity-70">· {source}</span> : null}
    </span>
  );
}

export function RiskBadge({ level }: { level: "low" | "medium" | "high" | "extreme" }) {
  const cls = level === "low" ? "pill-mint" : level === "medium" ? "pill-gray" : level === "high" ? "pill-amber" : "pill-red";
  return <span className={`pill ${cls}`}>{level} risk</span>;
}

export function OutlookBadge({ outlook }: { outlook: string }) {
  const cls = outlook.includes("bullish") ? "pill-mint" : outlook.includes("bearish") ? "pill-red" : "pill-gray";
  return <Term id="bullish" className={`pill ${cls}`}>{outlook}</Term>;
}

export function StatCard({ label, value, sub, children }: { label: ReactNode; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wider text-fg-3">{label}</div>
      <div className="num mt-1 truncate text-lg font-semibold sm:text-xl">{value}</div>
      {sub ? <div className="mt-1 text-xs text-fg-2">{sub}</div> : null}
      {children}
    </div>
  );
}

export function Section({ title, right, children, className = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border p-4 text-sm text-fg-3">{children}</div>;
}

export function Disclaimer() {
  return (
    <p className="mt-6 text-[11px] leading-relaxed text-fg-3">
      AsheSignal is analysis software, not financial advice. Every signal is a probabilistic read of historical price data and can be wrong; markets can gap through any stop. Trade only what you can afford to lose.
    </p>
  );
}
