import type { WhaleReport } from "@/lib/market/whales";
import { fmtUsd, timeAgo } from "@/lib/format";
import { Empty, Section } from "./ui";

export default function WhalePanel({
  w,
  explorerTx,
}: {
  w: WhaleReport | null;
  explorerTx?: string;
}) {
  if (!w) return null;
  const s = w.summary;
  return (
    <Section
      title="Whale watch · large transfers"
      right={
        w.available && s.count ? (
          <span
            className={`pill ${s.netToExchangesUsd > 0 ? "pill-red" : "pill-mint"}`}
          >
            net {s.netToExchangesUsd > 0 ? "to" : "from"} exchanges{" "}
            {fmtUsd(Math.abs(s.netToExchangesUsd), { compact: true })}
          </span>
        ) : null
      }
    >
      {!w.available ? (
        <Empty>{w.note}</Empty>
      ) : (
        <>
          <p className="mb-2 text-sm text-fg-2">{w.note}</p>
          {s.count ? (
            <>
              <div className="num mb-2 grid grid-cols-2 gap-2 text-xs text-fg-3 sm:grid-cols-4">
                <span>
                  Transfers <b className="text-fg">{s.count}</b>
                </span>
                <span>
                  → exchanges{" "}
                  <b className="down">
                    {fmtUsd(s.inflowUsd, { compact: true })}
                  </b>
                </span>
                <span>
                  ← exchanges{" "}
                  <b className="up">
                    {fmtUsd(s.outflowUsd, { compact: true })}
                  </b>
                </span>
                <span>
                  Largest{" "}
                  <b className="text-fg">
                    {fmtUsd(s.largestUsd, { compact: true })}
                  </b>
                </span>
              </div>
              <div className="max-h-72 overflow-auto">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Type</th>
                      <th>From</th>
                      <th>To</th>
                      <th className="text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.transfers.map((t, i) => (
                      <tr key={t.hash + i}>
                        <td className="text-fg-3">
                          {t.timestamp
                            ? timeAgo(new Date(t.timestamp).getTime())
                            : "-"}
                        </td>
                        <td>
                          <span
                            className={`pill ${t.kind === "exchange_in" ? "pill-red" : t.kind === "exchange_out" ? "pill-mint" : "pill-gray"}`}
                          >
                            {t.kind.replace("_", " ")}
                          </span>
                        </td>
                        <td className="num text-xs">
                          {t.fromLabel ??
                            `${t.from.slice(0, 6)}…${t.from.slice(-4)}`}
                        </td>
                        <td className="num text-xs">
                          {t.toLabel ?? `${t.to.slice(0, 6)}…${t.to.slice(-4)}`}
                        </td>
                        <td className="num text-right">
                          {explorerTx ? (
                            <a
                              className="link"
                              href={`${explorerTx}${t.hash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {fmtUsd(t.valueUsd, { compact: true })}
                            </a>
                          ) : (
                            fmtUsd(t.valueUsd, { compact: true })
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-fg-3">
                Exchange labels cover a short list of well-known hot wallets;
                unlabelled large transfers can still be exchange internal moves.
              </p>
            </>
          ) : null}
        </>
      )}
    </Section>
  );
}
