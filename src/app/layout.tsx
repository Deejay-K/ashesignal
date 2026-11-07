import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Nav from "@/components/Nav";


export const metadata: Metadata = {
  title: { default: "AsheSignal — Crypto Trading Intelligence", template: "%s · AsheSignal" },
  description: "Real-market-data crypto analysis: multi-timeframe technicals, long/short setups, risk-first position sizing, contract scanner, Fear & Greed. An Ashe Foundry project.",
};

export const viewport: Viewport = { themeColor: "#0b0f14" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen">
        <Nav />
        <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 pt-4 text-xs text-fg-3">
          Data: Binance, CoinGecko, DexScreener, GeckoTerminal, GoPlus, Alternative.me · AsheSignal by Ashe Foundry · Not financial advice.
        </footer>
      </body>
    </html>
  );
}
