"use client";

import { useEffect, useState } from "react";
import type { Briefing } from "@/lib/ai/briefing";
import { Empty, Section } from "./ui";
import { fmtUsd, timeAgo } from "@/lib/format";

interface Res {
  briefing: Briefing;
  createdAt: string;
  price: number | null;
  model: string;
  cached: boolean;
  history: {
    id: string;
    createdAt: string;
    price: number | null;
    headline: string;
    bottomLine: string;
    suitability: string;
    confidence: number;
  }[];
  error?: string;
}

export default function AiBriefing({
  id,
  address,
}: {
  id?: string;
  address?: string;
}) {
  const [r, setR] = useState<Res | null>(null);
  const [state, setState] = useState<
    "idle" | "loading" | "ok" | "disabled" | "error"
  >("idle");
  const [err, setErr] = useState<string | null>(null);
  const q = id
    ? `id=${encodeURIComponent(id)}`
    : `address=${encodeURIComponent(address ?? "")}`;

  const load = async (force = false) => {
    setState("loading");
    setErr(null);
    try {
      const res = await fetch(`/api/ai/explain?${q}${force ? "&force=1" : ""}`);
      const j = (await res.json()) as Res;
      if (res.status === 501) return setState("disabled");
      if (!res.ok) {
        setErr(j.error ?? "failed");
        return setState("error");
      }
      setR(j);
      setState("ok");
    } catch (e) {
      setErr(String(e));
      setState("error");
    }
  };
  // show a cached briefing immediately if one exists; don't auto-spend tokens otherwise
  useEffect(() => {
    fetch(`/api/ai/explain?${q}&peek=1`)
      .then(async (res) => {
        if (res.status === 501) return setState("disabled");
        const j = (await res.json()) as Res;
        if (res.ok && j.cached) {
          setR(j);
          setState("ok");
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  if (state === "disabled") return null;
  const b = r?.briefing;
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-mint" />
          AI analyst briefing
        </span>
      }
      right={
        <div className="flex items-center gap-2 text-xs text-fg-3">
          {r ? (
            <span>
              {timeAgo(new Date(r.createdAt).getTime())} ·{" "}
              {r.price != null ? `at ${fmtUsd(r.price)}` : ""} · {r.model}
            </span>
          ) : null}
          <button
            className="btn-ghost"
            disabled={state === "loading"}
            onClick={() => load(!!r)}
          >
            {state === "loading"
              ? "Writing…"
              : r
                ? "Regenerate"
                : "Generate briefing"}
          </button>
        </div>
      }
    >
      {state === "error" ? <p className="text-sm text-red">{err}</p> : null}
      {!b && state !== "loading" ? (
        <Empty>
          Press “Generate briefing” - the analyst reads the engine output above
          (every number it cites comes from there) and writes a plain-language
          read: what the market is doing, why, what happens next, and where the
          setup breaks. Works without any API key (engine writer); plug in a
          free Groq/Gemini key or Claude for richer prose.
        </Empty>
      ) : null}
      {state === "loading" && !b ? (
        <div className="h-40 animate-pulse rounded-lg bg-bg-3" />
      ) : null}
      {b ? (
        <div className={`space-y-4 ${state === "loading" ? "opacity-50" : ""}`}>
          <div>
            <h3 className="text-lg font-bold">{b.headline}</h3>
            <p className="mt-1 text-sm text-fg">{b.bottomLine}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span
                className={`pill ${b.suitability === "avoid" ? "pill-red" : "pill-mint"}`}
              >
                {b.suitability}
              </span>
              <span className="pill pill-gray">confidence {b.confidence}%</span>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Block title="Market now" text={b.marketNow} />
            <Block title="What could happen next" text={b.whatNext} />
            <Block
              title="Bullish scenario"
              text={b.bullishScenario}
              tone="up"
            />
            <Block
              title="Bearish scenario"
              text={b.bearishScenario}
              tone="down"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <ListBlock
              title="Supporting evidence"
              items={b.supportingEvidence}
            />
            <ListBlock
              title="Risk factors"
              items={b.riskFactors}
              tone="amber"
            />
            <ListBlock
              title="Invalidation"
              items={b.invalidation}
              tone="down"
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card-3 p-3">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-fg-3">
                Key levels
              </div>
              <ul className="space-y-1 text-sm">
                {b.keyLevels.map((k, i) => (
                  <li key={i}>
                    <b className="num">{k.level}</b>{" "}
                    <span className="text-fg-2">- {k.why}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Block title="Entry & exit" text={b.entryExit} />
          </div>
          {b.disagreements && b.disagreements !== "None." ? (
            <p className="text-xs text-amber">
              <b>Where the analyst disagrees with the engine:</b>{" "}
              {b.disagreements}
            </p>
          ) : null}
          {r?.history.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-fg-2">
                Previous briefings ({r.history.length})
              </summary>
              <ul className="mt-2 divide-y divide-border">
                {r.history.map((h) => (
                  <li key={h.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
                      <span>{new Date(h.createdAt).toLocaleString()}</span>
                      {h.price != null ? (
                        <span className="num">at {fmtUsd(h.price)}</span>
                      ) : null}
                      <span className="pill pill-gray">{h.suitability}</span>
                      <span>{h.confidence}%</span>
                    </div>
                    <div className="font-medium">{h.headline}</div>
                    <p className="text-fg-2">{h.bottomLine}</p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

function Block({
  title,
  text,
  tone,
}: {
  title: string;
  text: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="card-3 p-3">
      <div
        className={`mb-1 text-[11px] uppercase tracking-wider ${tone === "up" ? "text-mint" : tone === "down" ? "text-red" : "text-fg-3"}`}
      >
        {title}
      </div>
      <p className="text-sm text-fg-2">{text}</p>
    </div>
  );
}
function ListBlock({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone?: "amber" | "down";
}) {
  return (
    <div className="card-3 p-3">
      <div
        className={`mb-1 text-[11px] uppercase tracking-wider ${tone === "amber" ? "text-amber" : tone === "down" ? "text-red" : "text-fg-3"}`}
      >
        {title}
      </div>
      <ul className="list-disc space-y-1 pl-4 text-sm text-fg-2">
        {(items ?? []).map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
