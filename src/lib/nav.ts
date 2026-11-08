// Information architecture: five hubs. Every page belongs to one hub; the header shows the hubs,
// a sub-nav shows the siblings of the current page, the phone bottom bar shows the hubs.

export interface NavItem { href: string; label: string; hint?: string }
export interface NavGroup { id: string; label: string; icon: string; href: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  { id: "home", label: "Home", icon: "⌂", href: "/", items: [] },
  {
    id: "trade", label: "Trade", icon: "◆", href: "/opportunities",
    items: [
      { href: "/opportunities", label: "Trading Discovery", hint: "Confirmed, Watching, Speculative, Spot" },
      { href: "/screener", label: "Screener", hint: "Top 100 by any metric" },
      { href: "/scanner", label: "Scanner", hint: "Any token or contract address" },
      { href: "/discover", label: "Discover", hint: "Movers, trending, new pools" },
      { href: "/sentiment", label: "Sentiment", hint: "Fear & Greed, funding" },
    ],
  },
  {
    id: "portfolio", label: "Portfolio", icon: "◫", href: "/portfolio",
    items: [
      { href: "/portfolio", label: "Portfolio", hint: "Wallets and exchanges" },
      { href: "/setups", label: "Journal", hint: "Trades you took" },
      { href: "/review", label: "Weekly review", hint: "Your week, flagged" },
      { href: "/performance", label: "Engine performance", hint: "Signal hit rates" },
      { href: "/watchlist", label: "Watchlist", hint: "Starred coins" },
    ],
  },
  {
    id: "alerts", label: "Alerts", icon: "◔", href: "/alerts",
    items: [],
  },
  {
    id: "tools", label: "Tools", icon: "⚙", href: "/risk",
    items: [
      { href: "/risk", label: "Position size", hint: "Risk calculator" },
      { href: "/guide", label: "Trade guide", hint: "Place it on your exchange" },
      { href: "/lab", label: "Engine Lab", hint: "Rule variants, backtests" },
      { href: "/glossary", label: "Glossary", hint: "Every label explained" },
    ],
  },
];

/** All routes flattened (for the phone sheet and search). */
export const NAV_ALL: (NavItem & { group: string })[] = NAV_GROUPS.flatMap((g) => (g.items.length ? g.items : [{ href: g.href, label: g.label }]).map((i) => ({ ...i, group: g.label })));

export function groupFor(path: string): NavGroup | null {
  if (path === "/") return NAV_GROUPS[0];
  for (const g of NAV_GROUPS) {
    if (g.items.some((i) => path === i.href || path.startsWith(i.href + "/") || path.startsWith(i.href + "?"))) return g;
    if (!g.items.length && (path === g.href || path.startsWith(g.href + "/"))) return g;
  }
  if (path.startsWith("/token") || path.startsWith("/scanner")) return NAV_GROUPS[1];
  if (path.startsWith("/account") || path.startsWith("/login")) return null;
  return null;
}
