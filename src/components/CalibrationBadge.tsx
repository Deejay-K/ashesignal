"use client";

import { useEffect, useState } from "react";
import type { Calibration } from "@/app/api/calibration/route";

let cache: Promise<Calibration | null> | null = null;
function load() { if (!cache) cache = fetch("/api/calibration").then((r) => (r.ok ? r.json() : null)).catch(() => null); return cache; }

/** "score 71" becomes "score 71 · 58% hit TP1 historically" once enough signals resolved. */
export default function CalibrationBadge({ confidence, kind }: { confidence: number | null; kind?: string | null }) {
  const [cal, setCal] = useState<Calibration | null>(null);
  useEffect(() => { load().then(setCal); }, []);
  if (confidence == null) return null;
  const set = (kind && cal?.byKind[kind]) || cal?.buckets;
  const b = set?.find((x) => confidence >= x.lo && confidence < x.hi);
  const txt = b?.hitRate != null ? `${b.hitRate}% of ${b.n} signals at this confidence reached TP1` : null;
  return <span className="pill pill-gray num" title={txt ?? "Calibration appears once at least 5 signals in this setup score band have resolved."}>score {confidence}{b?.hitRate != null ? <span className="ml-1 text-fg-3">· {b.hitRate}% hit</span> : null}</span>;
}
