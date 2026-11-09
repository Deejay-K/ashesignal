"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LESSONS, lessonById } from "@/lib/academy";
import { markDone } from "@/lib/academy-progress";

export default function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const l = lessonById(id);
  const [picked, setPicked] = useState<Record<number, number>>({});
  if (!l) notFound();
  const passed = Object.keys(picked).length === l.quiz.length && l.quiz.filter((q, i) => picked[i] === q.answer).length >= l.quiz.length - 1;
  useEffect(() => { if (passed) markDone(l.id); }, [passed, l.id]);
  const idx = LESSONS.findIndex((x) => x.id === l.id);
  const next = LESSONS[idx + 1];
  const answered = Object.keys(picked).length;
  const correct = l.quiz.filter((q, i) => picked[i] === q.answer).length;
  const finished = answered === l.quiz.length;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/learn" className="link text-xs">← All lessons</Link>
      <h1 className="text-xl font-bold">{l.emoji} {l.title}</h1>
      <p className="text-sm text-fg-2">{l.summary}</p>
      <div className="card space-y-3 p-4 text-sm leading-relaxed">{l.body.map((p, i) => <p key={i}>{p}</p>)}</div>
      <div className="rounded-xl border border-mint/30 bg-mint-dim p-3 text-sm"><b>Remember</b><ul className="mt-1 list-disc pl-5">{l.keyPoints.map((k) => <li key={k}>{k}</li>)}</ul></div>
      <div className="space-y-3">
        <h2 className="font-semibold">Quick quiz</h2>
        {l.quiz.map((q, qi) => (
          <div key={qi} className="card space-y-2 p-3 text-sm">
            <div className="font-medium">{qi + 1}. {q.q}</div>
            <div className="grid gap-1.5">
              {q.options.map((o, oi) => {
                const chosen = picked[qi] === oi, show = picked[qi] != null;
                const cls = show && oi === q.answer ? "!border-mint !text-mint" : chosen ? "!border-red !text-red" : "";
                return <button key={oi} className={`btn-ghost justify-start text-left ${cls}`} disabled={show} onClick={() => setPicked({ ...picked, [qi]: oi })}>{o}</button>;
              })}
            </div>
            {picked[qi] != null ? <p className={`text-xs ${picked[qi] === q.answer ? "text-mint" : "text-amber"}`}>{picked[qi] === q.answer ? "Correct. " : "Not quite. "}{q.why}</p> : null}
          </div>
        ))}
        {finished ? <p className="text-sm">{correct}/{l.quiz.length} correct{correct >= l.quiz.length - 1 ? ": lesson done." : ": reread the key points and try again."}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {l.link ? <Link className="btn-ghost" href={l.link.href}>{l.link.label}</Link> : null}
        {next ? <Link className="btn" href={`/learn/${next.id}`}>Next: {next.title}</Link> : <Link className="btn" href="/plan">Done: open today's plan</Link>}
      </div>
    </div>
  );
}
