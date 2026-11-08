"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fmtUsd } from "@/lib/format";
import AuthMenu from "./AuthMenu";
import ThemePicker from "./ThemePicker";
import VenuePicker from "./VenuePicker";
import SubNav from "./SubNav";

import { NAV_GROUPS, groupFor } from "@/lib/nav";

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
  const [more, setMore] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "Escape") { setOpen(false); setMenu(false); setMore(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    setMore(null);
  }, [path]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(".nav-group")) setMore(null);
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

        {/* Desktop / tablet: five hubs; hubs with children open a menu on hover/click */}
        <nav className="nav-links" aria-label="Primary">
          {NAV_GROUPS.map((g) => {
            const active = groupFor(path)?.id === g.id;
            if (!g.items.length) return <Link key={g.id} href={g.href} className={`nav-link ${active ? "nav-link-active" : ""}`}>{g.label}</Link>;
            return (
              <div key={g.id} className="nav-group" onMouseEnter={() => setMore(g.id)} onMouseLeave={() => setMore((m) => (m === g.id ? null : m))}>
                <Link href={g.href} className={`nav-link ${active ? "nav-link-active" : ""}`} aria-haspopup="menu" aria-expanded={more === g.id} onClick={(e) => { if (more !== g.id && window.matchMedia("(hover: none)").matches) { e.preventDefault(); setMore(g.id); } }}>{g.label} <span className="nav-caret">▾</span></Link>
                {more === g.id ? (
                  <div className="nav-menu" role="menu">
                    {g.items.map((l) => (
                      <Link key={l.href} href={l.href} role="menuitem" className={`nav-menu-item ${isActive(l.href) ? "nav-link-active" : ""}`}>
                        <span>{l.label}</span>{l.hint ? <span className="nav-menu-hint">{l.hint}</span> : null}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="nav-search">
          <input
            ref={searchRef}
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
            placeholder="Search or paste address  ( / )"
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
          <Link href="/account" className={`nav-link nav-settings ${path.startsWith("/account") ? "nav-link-active" : ""}`} aria-label="Account and settings" title="Account, exchange, theme, notifications">⚙</Link>
          <AuthMenu />
          <button className="nav-burger" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
            <span /><span /><span />
          </button>
        </div>
      </div>

      {menu ? (
        <nav className="nav-sheet" aria-label="All pages">
          {NAV_GROUPS.map((g) => (
            <div key={g.id} className="nav-sheet-group">
              <div className="nav-sheet-title">{g.icon} {g.label}</div>
              {(g.items.length ? g.items : [{ href: g.href, label: g.label, hint: undefined }]).map((l) => (
                <Link key={l.href} href={l.href} className={`nav-sheet-item ${isActive(l.href) ? "nav-link-active" : ""}`}>{l.label}</Link>
              ))}
            </div>
          ))}
          <div className="nav-sheet-group">
            <div className="nav-sheet-title">● Account</div>
            <Link href="/account" className={`nav-sheet-item ${isActive("/account") ? "nav-link-active" : ""}`}>Account & settings</Link>
            <div className="flex items-center gap-2 px-1 pt-1 text-xs text-fg-3">Exchange <VenuePicker compact /></div>
            <div className="flex items-center gap-2 px-1 pt-1 text-xs text-fg-3">Theme <ThemePicker compact /></div>
          </div>
        </nav>
      ) : null}
      <SubNav path={path} />
    </header>
  );
}
