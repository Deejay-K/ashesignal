// Information architecture: five hubs. Every page belongs to one hub; the header shows the hubs,
// a sub-nav shows the siblings of the current page, the phone bottom bar shows the hubs.

export interface NavItem { href: string; label: string; hint?: string; /** Sub-heading inside the hub's menu; the sub-nav row only shows the current page's section. */ section?: string }
export interface NavGroup { id: string; label: string; icon: string; href: string; items: NavItem[] }

// Stage 45: same five hubs, but each hub's pages are grouped under plain sub-headings so nobody faces a flat list
// of eight or ten links. Ids stay the same (the bottom bar and saved links depend on them).
export const NAV_GROUPS: NavGroup[] = [
  { id: "home", label: "Home", icon: "⌂", href: "/", items: [] },
  {
    id: "trade", label: "Trade", icon: "◆", href: "/opportunities",
    items: [
      { section: "Signals", href: "/plan", label: "Today's plan", hint: "What to do today, in order" },
      { section: "Signals", href: "/opportunities", label: "Trading Discovery", hint: "Confirmed, Watching, Speculative, Spot" },
      { section: "Signals", href: "/movers", label: "Market movers", hint: "Gainers, losers, volume, new confirmations" },
      { section: "Research", href: "/screener", label: "Screener", hint: "Top 100 by any metric" },
      { section: "Research", href: "/scanner", label: "Scanner", hint: "Check any token or contract address" },
      { section: "Research", href: "/discover", label: "Discover", hint: "Trending coins and new pools" },
      { section: "Research", href: "/sentiment", label: "Sentiment", hint: "Fear & Greed, funding" },
    ],
  },
  {
    id: "portfolio", label: "My money", icon: "◫", href: "/portfolio",
    items: [
      { section: "What I hold", href: "/portfolio", label: "Portfolio", hint: "Wallets and exchanges" },
      { section: "What I hold", href: "/radar", label: "Holdings radar", hint: "What the engine says about each coin you hold" },
      { section: "What I hold", href: "/watchlist", label: "Watchlist", hint: "Starred coins" },
      { section: "My trading", href: "/setups", label: "Journal", hint: "Trades you took" },
      { section: "My trading", href: "/review", label: "Weekly review", hint: "Your week, flagged" },
    ],
  },
  {
    id: "alerts", label: "Alerts", icon: "◔", href: "/alerts",
    items: [],
  },
  {
    id: "tools", label: "More", icon: "⚙", href: "/risk",
    items: [
      { section: "Tools", href: "/risk", label: "Position size", hint: "How much to buy for the risk you accept" },
      { section: "Tools", href: "/guide", label: "Trade guide", hint: "Place it on your exchange, step by step" },
      { section: "Tools", href: "/dca", label: "DCA planner", hint: "Spread a spot buy across the zone" },
      { section: "Tools", href: "/card", label: "Result card", hint: "Share your own trade as a picture" },
      { section: "Learn", href: "/learn", label: "Academy", hint: "Short lessons with quizzes" },
      { section: "Learn", href: "/glossary", label: "Glossary", hint: "Every label explained" },
      { section: "Learn", href: "/welcome", label: "Guided setup", hint: "Exchange, risk, notifications, Telegram" },
      { section: "Results", href: "/track-record", label: "Track record", hint: "Every signal, graded, losers included" },
      { section: "Results", href: "/performance", label: "Engine performance", hint: "Signal hit rates" },
      { section: "Results", href: "/simulator", label: "Strategy simulator", hint: "What taking every signal would have done" },
      { section: "Results", href: "/lab", label: "Engine Lab", hint: "Rule variants, backtests" },
      { section: "Results", href: "/status", label: "System status", hint: "Is the worker running? (owner)" },
    ],
  },
];

/** A hub's pages split by sub-heading, in order. */
export function sectionsOf(g: NavGroup): { title: string | null; items: NavItem[] }[] {
  const out: { title: string | null; items: NavItem[] }[] = [];
  for (const i of g.items) { const t = i.section ?? null; const last = out[out.length - 1]; if (last && last.title === t) last.items.push(i); else out.push({ title: t, items: [i] }); }
  return out;
}

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
