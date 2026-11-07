import type { Metadata } from "next";
import { GLOSSARY } from "@/lib/glossary";
import { Disclaimer } from "@/components/ui";

export const metadata: Metadata = { title: "Glossary" };

export default function GlossaryPage() {
  const groups = [...new Set(GLOSSARY.map((g) => g.group))];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Glossary</h1>
        <p className="text-sm text-fg-2">What every label in AsheSignal means and how to act on it. Anywhere you see a word with a small ? next to it, tap it to land here.</p>
      </div>
      <nav className="flex flex-wrap gap-1 text-xs">
        {groups.map((g) => <a key={g} href={`#g-${g}`} className="btn-ghost">{g}</a>)}
      </nav>
      {groups.map((group) => (
        <section key={group} id={`g-${group}`} className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-fg-3">{group}</h2>
          {GLOSSARY.filter((g) => g.group === group).map((g) => (
            <article key={g.id} id={g.id} className="card scroll-mt-20 p-4">
              <h3 className="font-semibold">{g.term}</h3>
              <p className="mt-1 text-sm text-fg">{g.short}</p>
              <p className="mt-1 text-sm text-fg-2">{g.long}</p>
            </article>
          ))}
        </section>
      ))}
      <Disclaimer />
    </div>
  );
}
