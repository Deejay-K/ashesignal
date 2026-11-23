// What's new. The newest entry is announced once to every member (inbox notification on the website, and a Telegram
// message to everyone with Telegram linked) by /api/cron/announce, and is shown on /whats-new and by /whatsnew in the bot.
// Plain sentences, hyphens only.

export interface Release { version: string; date: string; title: string; items: string[] }

export const RELEASES: Release[] = [
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
      "Speculative alerts (off by default): /speculative lets you pick Conservative, Balanced or All. Each preset has fixed limits, and any signal a preset skips is logged with the reason.",
      "If a speculative alert never reaches its entry within 24 hours, everyone who got it is told it is cancelled.",
      "Partial exits are counted the way the plan is written: 30 percent at TP1, 30 percent at TP2, 40 percent at TP3, with the stop at break-even after TP1.",
      "Type /whatsnew in the bot at any time to see these notes.",
    ],
  },
];

export const LATEST = RELEASES[0];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Telegram HTML for a release (under 4096 characters). */
export function releaseHtml(r: Release = LATEST): string {
  const body = `✨ <b>AsheSignal update ${esc(r.version)}</b> (${esc(r.date)})\n<b>${esc(r.title)}</b>\n\n${r.items.map((i) => `• ${esc(i)}`).join("\n")}\n\nSee the full notes on the website: What's new.`;
  return body.length > 4000 ? body.slice(0, 3990) + "…" : body;
}

/** Plain text for the inbox notification. */
export function releaseText(r: Release = LATEST): string {
  return `${r.title}. ${r.items.slice(0, 3).join(" ")}`;
}
