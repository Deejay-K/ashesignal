// What's new. The newest entry is announced once to every member (inbox notification on the website, and a Telegram
// message to everyone with Telegram linked) by /api/cron/announce, and is shown on /whats-new and by /whatsnew in the bot.
// Plain sentences, hyphens only.

export interface Release { version: string; date: string; title: string; items: string[] }

export const RELEASES: Release[] = [
  {
    version: "54",
    date: "2026-11-22",
    title: "Health checks, follow-up tracking and your own alert settings",
    items: [
      "Follow-up messages (entry zone, TP1, TP2, TP3, stop, cancelled) now go to exactly the members who received the signal, and every one is logged.",
      "A watchdog warns the admins on Telegram if the worker stops or signals wait too long, and says so again when it recovers.",
      "The Status page shows the signal queue, what reached nobody in the last 24 hours, and any logged problems.",
      "Speculative alerts: pick your own limits on top of a preset (R:R, stop distance, setup score, alerts per day), your own coin list, and your time zone for quiet hours. All with buttons in /specalerts (or the Speculative alerts button on the signals screen).",
      "The dashboard and the Track record now show the same graded numbers as the weekly recap: what members actually received.",
      "Confidence is now called Setup score everywhere: how many checks lined up, out of 100. It is not a win chance.",
    ],
  },
  {
    version: "53",
    date: "2026-11-22",
    title: "Every signal is now tracked from start to finish",
    items: [
      "Confirmed Trades are queued before anything is sent, so a slow or interrupted run can no longer lose one.",
      "Every send is recorded per member: sent, skipped or filtered, each with the reason. Nothing is skipped silently.",
      "Telegram rate limits are respected and temporary failures retry on the next tick.",
      "The weekly recap now separates what members received (the headline) from what nobody received, and shows max drawdown and the longest losing streak.",
      "The Track record page now leads with the graded record of what members actually received. The engine's full log is kept below it.",
      "Speculative alerts (off by default): /specalerts lets you pick Conservative, Balanced or All. Each preset has fixed limits, and any signal a preset skips is logged with the reason.",
      "If a speculative alert never reaches its entry within 24 hours, everyone who got it is told it is cancelled.",
      "Partial exits are counted the way the plan is written: 30 percent at TP1, 30 percent at TP2, 40 percent at TP3, with the stop at break-even after TP1.",
      "Type /whatsnew in the bot at any time to see these notes.",
    ],
  },
];

export const LATEST = RELEASES[0];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Telegram HTML for one or more releases, newest first, always under 4096 characters. */
export function releaseHtml(list: Release | Release[] = LATEST): string {
  const rs = Array.isArray(list) ? list : [list];
  const part = (r: Release) => `✨ <b>AsheSignal update ${esc(r.version)}</b> (${esc(r.date)})\n<b>${esc(r.title)}</b>\n${r.items.map((i) => `• ${esc(i)}`).join("\n")}`;
  const foot = "\n\nFull notes on the website: What's new. In the bot: /whatsnew.";
  let body = "";
  for (const r of rs) {
    const next = body ? `${body}\n\n${part(r)}` : part(r);
    if (next.length + foot.length > 4000) { body += `\n\n(and ${rs.length - rs.indexOf(r)} earlier update${rs.length - rs.indexOf(r) === 1 ? "" : "s"} on the website)`; break; }
    body = next;
  }
  return body + foot;
}

/** Releases newer than the last one fully announced (all of them if none was). Newest first. */
export function unannounced(lastDone: string | null | undefined): Release[] {
  return RELEASES.filter((r) => lastDone == null || Number(r.version) > Number(lastDone));
}

/** Plain text for the inbox notification (newest release, plus a count of the others). */
export function releaseText(list: Release | Release[] = LATEST): string {
  const rs = Array.isArray(list) ? list : [list];
  const r = rs[0];
  return `${r.title}. ${r.items.slice(0, 2).join(" ")}${rs.length > 1 ? ` Plus ${rs.length - 1} more update${rs.length > 2 ? "s" : ""}: see What's new.` : ""}`;
}
