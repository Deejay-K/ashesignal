"use client";

import Link from "next/link";
import { groupFor } from "@/lib/nav";

/** Second header row: the sibling pages of the current hub, so related tools are one tap away. */
export default function SubNav({ path }: { path: string }) {
  const g = groupFor(path);
  if (!g || g.items.length < 2) return null;
  const isActive = (href: string) => path === href || path.startsWith(href + "/") || (href !== "/" && path.startsWith(href) && (path[href.length] === undefined || path[href.length] === "?"));
  // Only the current page's section (Signals, Research, Tools, ...): a short row that fits a phone without scrolling far.
  const here = g.items.find((i) => isActive(i.href));
  const shown = here?.section ? g.items.filter((i) => i.section === here.section) : g.items;
  if (shown.length < 2) return null;
  return (
    <div className="subnav" role="navigation" aria-label={`${g.label} pages`}>
      <div className="subnav-inner">
        {shown.map((i) => <Link key={i.href} href={i.href} className={`subnav-item ${isActive(i.href) ? "subnav-active" : ""}`}>{i.label}</Link>)}
      </div>
    </div>
  );
}
