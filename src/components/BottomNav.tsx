"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_GROUPS, groupFor } from "@/lib/nav";
const TABS = [...NAV_GROUPS.map((g) => ({ href: g.href, label: g.label, icon: g.icon, id: g.id })), { href: "/account", label: "Account", icon: "●", id: "account" }];

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav className="bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-border bg-bg/95 pt-1.5 backdrop-blur md:hidden" aria-label="Primary">
      {TABS.map((t) => {
        const g = groupFor(path);
        const active = t.id === "account" ? path.startsWith("/account") : g ? g.id === t.id : false;
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
