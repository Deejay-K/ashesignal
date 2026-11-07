"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/opportunities", label: "Trades", icon: "◆" },
  { href: "/discover", label: "Discover", icon: "◎" },
  { href: "/scanner", label: "Scan", icon: "⌕" },
  { href: "/portfolio", label: "Portfolio", icon: "◫" },
  { href: "/account", label: "Account", icon: "●" },
];

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav className="bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-border bg-bg/95 pt-1.5 backdrop-blur md:hidden" aria-label="Primary">
      {TABS.map((t) => {
        const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-0.5 py-1 text-[11px] ${active ? "text-mint" : "text-fg-3"}`}>
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
