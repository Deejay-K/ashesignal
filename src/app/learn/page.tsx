"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LESSONS } from "@/lib/academy";
import { readDone } from "@/lib/academy-progress";


/** Academy: short lessons with a quiz each. Progress is kept in this browser. */
export default function LearnPage() {
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => { setDone(readDone()); }, []);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Academy</h1>
        <p className="text-sm text-fg-2">{LESSONS.length} short lessons, about 3 minutes each, with a quick quiz. Everything you need to use AsheSignal safely. {done.length}/{LESSONS.length} done.</p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-bg-3"><div className="h-full bg-mint transition-all" style={{ width: `${(done.length / LESSONS.length) * 100}%` }} /></div>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2">
        {LESSONS.map((l, i) => (
          <li key={l.id}>
            <Link href={`/learn/${l.id}`} className="card flex h-full items-start gap-3 p-3 hover:border-mint">
              <span className="text-2xl">{l.emoji}</span>
              <span className="min-w-0">
                <span className="block font-semibold">{i + 1}. {l.title} {done.includes(l.id) ? <span className="pill pill-mint ml-1 text-[10px]">done</span> : null}</span>
                <span className="block text-xs text-fg-2">{l.summary}</span>
                <span className="block text-[11px] text-fg-3">{l.minutes} min · {l.quiz.length} questions</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="text-xs text-fg-3">Also in Telegram: tap Tools, then Learn, in @AsheSignalBot.</p>
    </div>
  );
}
