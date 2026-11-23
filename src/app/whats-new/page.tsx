import { RELEASES } from "@/lib/changelog";
import { Section } from "@/components/ui";

export const metadata = { title: "What's new - AsheSignal" };

/** Release notes, newest first. The same notes go to members in the bell and on Telegram. */
export default function WhatsNewPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">What&apos;s new</h1>
        <p className="text-sm text-fg-2">Every update, newest first. Members get each one in the bell and on Telegram.</p>
      </div>
      {RELEASES.map((r) => (
        <Section key={r.version} title={`Update ${r.version}: ${r.title}`} right={<span className="text-xs text-fg-3">{r.date}</span>}>
          <ul className="list-disc space-y-2 pl-5 text-sm text-fg-2">
            {r.items.map((i) => <li key={i}>{i}</li>)}
          </ul>
        </Section>
      ))}
    </div>
  );
}
