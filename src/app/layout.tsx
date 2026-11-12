import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Nav from "@/components/Nav";
import SiteBanner from "@/components/SiteBanner";
import ThemeFavicon from "@/components/ThemeFavicon";
import BottomNav from "@/components/BottomNav";
import AskDrawer from "@/components/AskDrawer";
import Mascot from "@/components/Mascot";
import { THEME_BOOT } from "@/lib/themes";


export const metadata: Metadata = {
  title: { default: "AsheSignal - Crypto Trading Intelligence", template: "%s · AsheSignal" },
  description: "Real-market-data crypto analysis: multi-timeframe technicals, long/short setups, risk-first position sizing, contract scanner, Fear & Greed. An Ashe Foundry project.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b0f14" };
metadata.manifest = "/manifest.json";
metadata.appleWebApp = { capable: true, statusBarStyle: "black-translucent", title: "AsheSignal" };
metadata.icons = { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/icon-192.png" };
metadata.openGraph = { title: "AsheSignal - Crypto Trading Intelligence", description: "Multi-timeframe technicals, pattern overlays, risk-first setups, trade conditions, portfolio and alerts. Real market data.", siteName: "AsheSignal", type: "website" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-screen">
        <ThemeFavicon />
        <SiteBanner />
        <Nav />
        <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-4 sm:py-5">{children}</main>
        <BottomNav />
        <Mascot />
        <AskDrawer />
        <footer className="mx-auto max-w-7xl px-4 pb-8 pt-4 text-xs text-fg-3">
          Data: Binance, CoinGecko, DexScreener, GeckoTerminal, GoPlus, Alternative.me · <a href="/glossary" className="link">Glossary</a> · AsheSignal by Ashe Foundry · Not financial advice.
        </footer>
      </body>
    </html>
  );
}
