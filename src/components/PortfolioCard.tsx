"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtPct, fmtUsd, pctClass } from "@/lib/format";
import type { Portfolio } from "@/lib/portfolio";

export default function PortfolioCard() {
  const [p, setP] = useState<Portfolio | null | "none">(null);
  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) return setP("none");
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) return setP("none");
      const w = await fetch("/api/me/wallets").then((r) => r.json()).catch(() => null);
      if (!w?.wallets?.length) return setP("none");
      const r = await fetch("/api/me/portfolio").then((r) => r.json()).catch(() => null);
      setP(r?.portfolio ?? "none");
    });
  }, []);
  if (p === "none" || p === null) return null;
  const priced = p.holdings.filter((h) => h.valueUsd != null && h.change24hPct != null);
  const tot = priced.reduce((s, h) => s + h.valueUsd!, 0);
  const chg = tot ? priced.reduce((s, h) => s + (h.change24hPct! * h.valueUsd!) / tot, 0) : null;
  return (
    <Link href="/portfolio" className="card flex items-center gap-4 p-4 hover:border-mint">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-fg-3">Your portfolio</div>
        <div className="num text-xl font-semibold">{fmtUsd(p.totalUsd)}</div>
      </div>
      <div className={`num text-sm ${pctClass(chg)}`}>{fmtPct(chg)} 24h</div>
      <div className="ml-auto flex flex-wrap gap-1 text-xs">
        {p.byAsset.slice(0, 5).map((a) => <span key={a.symbol} className="pill pill-gray">{a.symbol} {a.pct.toFixed(0)}%</span>)}
      </div>
    </Link>
  );
}
