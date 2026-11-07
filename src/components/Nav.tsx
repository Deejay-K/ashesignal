"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fmtUsd } from "@/lib/format";
import AuthMenu from "./AuthMenu";

export const NAV_LINKS = [
  { href: "/", label: "Dashboard", primary: 1 },
  { href: "/discover", label: "Discover", primary: 1 },
  { href: "/scanner", label: "Scanner", primary: 1 },
  { href: "/portfolio", label: "Portfolio", primary: 2 },
  { href: "/alerts", label: "Alerts", primary: 2 },
  { href: "/risk", label: "Risk", primary: 2 },
  { href: "/watchlist", label: "Watchlist", primary: 3 },
  { href: "/setups", label: "Setups", primary: 3 },
  { href: "/performance", label: "Performance", primary: 3 },
  { href: "/sentiment", label: "Sentiment", primary: 3 },
  { href: "/account", label: "Account", primary: 3 },
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
  const [more, setMore] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    setMenu(false);
    setMore(false);
  }, [path]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMore(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const linkCls = (href: string) => `nav-link ${isActive(href) ? "nav-link-active" : ""}`;

  return (
    <header className="nav-header">
      <div className="nav-inner">
        <Link href="/" className="nav-brand" aria-label="AsheSignal home">
          <span className="nav-logo" />
          <span className="nav-brand-text">AsheSignal</span>
        </Link>

        {/* Desktop / tablet links: tier 1 always (md+), tier 2 from lg, tier 3 in the More menu */}
        <nav className="nav-links" aria-label="Primary">
          {NAV_LINKS.filter((l) => l.primary <= 2).map((l) => (
            <Link key={l.href} href={l.href} className={`${linkCls(l.href)} ${l.primary === 2 ? "nav-tier2" : ""}`}>
              {l.label}
            </Link>
          ))}
          <div className="relative" ref={moreRef}>
            <button className={`nav-link ${more ? "nav-link-active" : ""}`} onClick={() => setMore((m) => !m)} aria-haspopup="menu" aria-expanded={more}>
              More ▾
            </button>
            {more ? (
              <div className="nav-menu" role="menu">
                {NAV_LINKS.filter((l) => l.primary >= 2).map((l) => (
                  <Link key={l.href} href={l.href} role="menuitem" className={`nav-menu-item ${l.primary === 2 ? "nav-tier2-menu" : ""} ${isActive(l.href) ? "nav-link-active" : ""}`}>
                    {l.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </nav>

        <div className="nav-search">
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
            placeholder="Search or paste address"
            aria-label="Search"
          />
          {open && res && (res.coins.length || res.pairs.length || res.isAddress) ? (
            <div className="card nav-results">
              {res.isAddress ? (
                <button className="nav-result" onMouseDown={() => go(`/scanner?address=${encodeURIComponent(q.trim())}`)}>
                  Scan address <span className="num text-fg-3">{q.slice(0, 10)}...</span>
                </button>
              ) : null}
              {res.coins.map((c) => (
                <button key={c.id} className="nav-result" onMouseDown={() => go(`/token/${c.id}`)}>
                  {c.thumb ? <img src={c.thumb} alt="" className="h-5 w-5 rounded-full" /> : <span className="h-5 w-5 rounded-full bg-bg-3" />}
                  <span className="font-medium">{c.name}</span>
                  <span className="text-fg-3">{c.symbol}</span>
                  {c.market_cap_rank ? <span className="ml-auto text-xs text-fg-3">#{c.market_cap_rank}</span> : null}
                </button>
              ))}
              {res.pairs.length ? <div className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-fg-3">DEX pairs</div> : null}
              {res.pairs.map((p) => (
                <button key={p.pairAddress} className="nav-result" onMouseDown={() => go(`/scanner?address=${p.base.address}`)}>
                  <span className="font-medium">{p.base.symbol}/{p.quote}</span>
                  <span className="pill pill-gray">{p.chainId}</span>
                  <span className="num ml-auto text-xs text-fg-2">{fmtUsd(p.priceUsd)} · liq {fmtUsd(p.liquidityUsd, { compact: true })}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="nav-right">
          <AuthMenu />
          <button className="nav-burger" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
            <span /><span /><span />
          </button>
        </div>
      </div>

      {menu ? (
        <nav className="nav-sheet" aria-label="All pages">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={`nav-sheet-item ${isActive(l.href) ? "nav-link-active" : ""}`}>
              {l.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
