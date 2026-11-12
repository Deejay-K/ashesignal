import Link from "next/link";
import type { WhyNone as Why } from "@/lib/market/why";

/** "Why are there no Confirmed trades for me?" - what is blocking, and which ideas are closest. */
export default function WhyNone({ why, compact = false }: { why: Why; compact?: boolean }) {
  return (
    <div className="card border border-amber/30 p-3 text-sm">
      <div className="font-semibold">Why nothing is Confirmed for you right now</div>
      <p className="mt-1 text-fg-2">{why.headline}</p>
      {why.blockers.length ? (
        <ul className="mt-2 space-y-1 text-xs">
          {why.blockers.slice(0, compact ? 3 : 5).map((b) => (
            <li key={b.key}><span className="pill pill-amber mr-1">{b.count}</span><b>{b.label}.</b> <span className="text-fg-2">{b.plain}</span></li>
          ))}
        </ul>
      ) : null}
      {why.closest.length ? (
        <div className="mt-2 text-xs">
          <div className="font-semibold">Closest to confirming</div>
          <ul className="mt-1 space-y-1">
            {why.closest.slice(0, compact ? 2 : 4).map((c) => (
              <li key={`${c.symbol}${c.tf}`}>
                {c.id ? <Link className="link font-medium" href={`/s/${c.id}/${c.tf ?? "4h"}`}>{c.symbol} {c.side} {c.tf}</Link> : <b>{c.symbol} {c.side} {c.tf}</b>}
                <span className="text-fg-2"> needs: {c.missing}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-2 text-xs text-fg-3">No signal is also a signal: the engine only confirms when every check passes. <Link className="link" href="/opportunities?cat=watching">Open Watching</Link> and set a &quot;when it confirms&quot; alert instead of forcing a trade.</p>
    </div>
  );
}
