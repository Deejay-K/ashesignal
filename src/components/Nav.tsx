"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fmtUsd } from "@/lib/format";
import AuthMenu from "./AuthMenu";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/discover", label: "Discover" },
  { href: "/scanner", label: "Scanner" },
  { href: "/risk", label: "Risk" },
  { href: "/sentiment", label: "Sentiment" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/setups", label: "Setups" },
  { href: "/alerts", label: "Alerts" },
  { href: "/performance", label: "Performance" },
];

interface SearchRes {
  isAddress: boolean;
  coins: { id: string; name: string; symbol: string; market_cap_rank: number | null; thumb?: string }[];
  pairs: { chainId: string; pairAddress: string; base: { address: string; symbol: string; name: string }; quote: string; priceUsd: number | null; liquidityUsd: number | null }[];
}

export default function Nav() {
  const path = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchRes | null>(null);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    if (q.trim().length < 2) {
      setRes(null);
      return;
    }
    t.current = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
      if (r.ok) setRes(await r.json());
    }, 300);
  }, [q]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="inline-block h-6 w-6 rounded-md bg-mint" style={{ boxShadow: "0 0 18px rgba(54,189,148,.45)" }} />
          <span>AsheSignal</span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={`rounded-md px-3 py-1.5 text-sm ${path === l.href ? "bg-mint-dim text-mint" : "text-fg-2 hover:text-fg"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="relative ml-auto w-full max-w-md">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && res?.isAddress) go(`/scanner?address=${encodeURIComponent(q.trim())}`);
            }}
            placeholder="Search coin, ticker or paste a contract address…"
            className="text-sm"
          />
          {open && res && (res.coins.length || res.pairs.length || res.isAddress) ? (
            <div className="card absolute left-0 right-0 top-full mt-1 max-h-96 overflow-auto p-1 shadow-xl">
              {res.isAddress ? (
                <button className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-bg-3" onMouseDown={() => go(`/scanner?address=${encodeURIComponent(q.trim())}`)}>
                  🔎 Scan address <span className="num text-fg-3">{q.slice(0, 10)}…</span>
                </button>
              ) : null}
              {res.coins.map((c) => (
                <button key={c.id} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-bg-3" onMouseDown={() => go(`/token/${c.id}`)}>
                  {c.thumb ? <img src={c.thumb} alt="" className="h-5 w-5 rounded-full" /> : <span className="h-5 w-5 rounded-full bg-bg-3" />}
                  <span className="font-medium">{c.name}</span>
                  <span className="text-fg-3">{c.symbol}</span>
                  {c.market_cap_rank ? <span className="ml-auto text-xs text-fg-3">#{c.market_cap_rank}</span> : null}
                </button>
              ))}
              {res.pairs.length ? <div className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-fg-3">DEX pairs</div> : null}
              {res.pairs.map((p) => (
                <button key={p.pairAddress} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-bg-3" onMouseDown={() => go(`/scanner?address=${p.base.address}`)}>
                  <span className="font-medium">{p.base.symbol}/{p.quote}</span>
                  <span className="pill pill-gray">{p.chainId}</span>
                  <span className="num ml-auto text-xs text-fg-2">{fmtUsd(p.priceUsd)} · liq {fmtUsd(p.liquidityUsd, { compact: true })}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <AuthMenu />
        <button className="btn-ghost md:hidden" onClick={() => setMenu((m) => !m)} aria-label="Menu">☰</button>
      </div>
      {menu ? (
        <nav className="flex flex-wrap gap-1 border-t border-border px-4 py-2 md:hidden">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setMenu(false)} className={`rounded-md px-3 py-1.5 text-sm ${path === l.href ? "bg-mint-dim text-mint" : "text-fg-2"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
