"use client";

import { useEffect, useState } from "react";
import { Section } from "@/components/ui";

interface Cfg { defaults: Record<string, number>; live: Record<string, number>; history: { id: number; value: Record<string, number>; note: string | null; changed_at: string; changed_by: string | null }[]; canEdit: boolean; adminConfigured: boolean; variants: { id: string; label: string; gates: Record<string, number>; htfFilter: boolean }[] }
const LABELS: Record<string, string> = { band: "Score band (±)", volMin: "Min volume ratio", stretchMax: "Max ATR from 20 EMA", tp1Min: "Min TP1 (R)", tp2Min: "Min TP2 (R)" };

/** Shows the live confirmation thresholds and lets the deployment owner adopt a lab variant or custom values. */
export default function LiveRules({ betterVariantIds }: { betterVariantIds: string[] }) {
  const [c, setC] = useState<Cfg | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => fetch("/api/engine-config").then((r) => r.json()).then((j) => { setC(j); setDraft(Object.fromEntries(Object.entries(j.live as Record<string, number>).map(([k, v]) => [k, String(v)]))); });
  useEffect(() => { load(); }, []);
  if (!c) return null;
  const changed = Object.keys(c.defaults).filter((k) => c.live[k] !== c.defaults[k]);
  const post = async (body: Record<string, unknown>) => { const r = await fetch("/api/engine-config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); setMsg(r.ok ? "Applied. Workers and pages pick it up within 5 minutes." : j.error ?? "Failed"); load(); };
  return (
    <Section title="Live confirmation rules" right={changed.length ? <span className="pill pill-amber">{changed.length} changed from defaults</span> : <span className="pill pill-gray">defaults</span>}>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
        {Object.keys(c.defaults).map((k) => (
          <label key={k} className="text-fg-3">{LABELS[k] ?? k}
            <input className="num" value={draft[k] ?? ""} disabled={!c.canEdit} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
            <span className="block text-[10px]">default {c.defaults[k]}{c.live[k] !== c.defaults[k] ? ` · live ${c.live[k]}` : ""}</span>
          </label>
        ))}
      </div>
      {c.canEdit ? (
        <div className="mt-2 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <input className="flex-1" placeholder="Why (goes into the history)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn" onClick={() => post({ gates: Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v)])), note })}>Apply custom values</button>
            <button className="btn-ghost" onClick={() => post({ reset: true })}>Reset to defaults</button>
          </div>
          {betterVariantIds.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-fg-3">Adopt a variant the lab rates better:</span>
              {c.variants.filter((v) => betterVariantIds.includes(v.id) && Object.keys(v.gates).length).map((v) => <button key={v.id} className="btn-ghost" onClick={() => post({ gates: { ...c.live, ...v.gates }, note: `Adopted lab variant: ${v.label}` })}>{v.label}</button>)}
              {c.variants.some((v) => betterVariantIds.includes(v.id) && v.htfFilter) ? <span className="text-fg-3">(the higher-timeframe filter is already enforced by the category gates)</span> : null}
            </div>
          ) : null}
          {msg ? <p className="text-fg-2">{msg}</p> : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-fg-3">{c.adminConfigured ? "Only the deployment owner can change these (ADMIN_EMAILS)." : "To allow changes from here, set ADMIN_EMAILS=your@email in Vercel and redeploy. Until then the defaults apply."}</p>
      )}
      {c.history.length ? (
        <details className="mt-2 text-xs"><summary className="cursor-pointer text-fg-3">Change history ({c.history.length})</summary>
          <ul className="mt-1 space-y-1">{c.history.map((h) => <li key={h.id} className="flex flex-wrap gap-2 text-fg-2"><span className="num text-fg-3">{new Date(h.changed_at).toLocaleString()}</span><span className="num">{Object.keys(h.value).length ? Object.entries(h.value).map(([k, v]) => `${k}=${v}`).join(" ") : "defaults"}</span><span className="text-fg-3">{h.note}{h.changed_by ? ` · ${h.changed_by}` : ""}</span>{c.canEdit ? <button className="link" onClick={() => post({ gates: h.value, note: `Rollback to ${new Date(h.changed_at).toLocaleDateString()}` })}>roll back to this</button> : null}</li>)}</ul>
        </details>
      ) : null}
    </Section>
  );
}
