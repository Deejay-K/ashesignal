import Link from "next/link";
import type { CoinRow } from "@/lib/types";
import { fmtPct, fmtUsd, pctClass } from "@/lib/format";
import Sparkline from "./Sparkline";
import WatchButton from "./WatchButton";

export default function CoinTable({ coins, compact = false }: { coins: CoinRow[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Asset</th>
            <th className="text-right">Price</th>
            <th className="hidden text-right sm:table-cell">1h</th>
            <th className="text-right">24h</th>
            <th className="text-right">7d</th>
            {!compact ? <th className="hidden text-right md:table-cell">Volume 24h</th> : null}
            {!compact ? <th className="text-right">Market cap</th> : null}
            <th>7d</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {coins.map((c) => (
            <tr key={c.id} className="hover:bg-bg-3">
              <td className="text-fg-3">{c.rank ?? "-"}</td>
              <td>
                <Link href={`/token/${c.id}`} className="flex items-center gap-2">
                  {c.image ? <img src={c.image} alt="" className="h-5 w-5 rounded-full" /> : null}
                  <span className="font-medium">{c.name}</span>
                  <span className="text-fg-3">{c.symbol}</span>
                </Link>
              </td>
              <td className="num text-right">{fmtUsd(c.priceUsd)}</td>
              <td className={`num hidden text-right sm:table-cell ${pctClass(c.change1hPct)}`}>{fmtPct(c.change1hPct, 1)}</td>
              <td className={`num text-right ${pctClass(c.change24hPct)}`}>{fmtPct(c.change24hPct, 1)}</td>
              <td className={`num text-right ${pctClass(c.change7dPct)}`}>{fmtPct(c.change7dPct, 1)}</td>
              {!compact ? <td className="num hidden text-right text-fg-2 md:table-cell">{fmtUsd(c.volume24hUsd, { compact: true })}</td> : null}
              {!compact ? <td className="num text-right text-fg-2">{fmtUsd(c.marketCapUsd, { compact: true })}</td> : null}
              <td>{c.sparkline7d?.length ? <Sparkline data={c.sparkline7d} /> : null}</td>
              <td><WatchButton id={c.id} symbol={c.symbol} name={c.name} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
