"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SQUIXI, SQUIXI_EVENT, SQUIXI_TIPS_KEY, squixiAsk, tipFor, type SquixiMsg } from "@/lib/mascot";

const SEEN_KEY = "ashesignal.squixi.seen";
const TOUR_KEY = "ashesignal.tour.v1";

/**
 * SquixiMutation, the site mascot. Sits behind the Ask button in the corner and pops out with a speech bubble when
 * there is something to say: a trade explained (the 🦑 buttons), a pattern explained, or a first-visit hint for a
 * page. The bubble stays until its time runs out (paused while the pointer is on it) or the X is pressed.
 * Size follows the device (see .squixi-* in globals.css); it never covers more than a corner.
 */
export default function Mascot() {
  const path = usePathname();
  const [msg, setMsg] = useState<SquixiMsg | null>(null);
  const [out, setOut] = useState(false);   // character visible
  const [peek, setPeek] = useState(false); // quick hello without a bubble
  const [linger, setLinger] = useState(false); // stands around idle for a moment (after talking, or while the Ask button is hovered)
  const [hop, setHop] = useState(0);       // bumps on every new message so the little jump replays
  const lingerT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stay = (ms: number) => { if (lingerT.current) clearTimeout(lingerT.current); setLinger(true); lingerT.current = setTimeout(() => setLinger(false), ms); };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = useRef(false);
  const left = useRef(0);
  const started = useRef(0);

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const close = useCallback(() => { clear(); setOut(false); setTimeout(() => setMsg(null), 260); if (lingerT.current) clearTimeout(lingerT.current); setLinger(true); lingerT.current = setTimeout(() => setLinger(false), 4500); }, []);
  const arm = useCallback((ms: number) => { clear(); left.current = ms; started.current = Date.now(); timer.current = setTimeout(() => { if (!hold.current) close(); }, ms); }, [close]);

  // Anything on the page can make Squixi talk.
  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<SquixiMsg>).detail;
      if (!m?.title) return;
      setPeek(false); setMsg(m); setOut(true); setHop((h) => h + 1);
      arm(m.holdMs ?? (m.kind === "tip" ? 14_000 : 60_000));
    };
    window.addEventListener(SQUIXI_EVENT, on);
    return () => { window.removeEventListener(SQUIXI_EVENT, on); clear(); };
  }, [arm]);

  // First-visit hint for each kind of page, once per device, never during the tour, never when tips are off.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (localStorage.getItem(SQUIXI_TIPS_KEY) === "off" || !localStorage.getItem(TOUR_KEY)) return;
        if (document.querySelector(".tour-back, .ask-backdrop")) return;
        const tip = tipFor(path);
        if (!tip) return;
        const seen: string[] = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
        if (seen.includes(tip.id)) return;
        localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, tip.id]));
        window.dispatchEvent(new CustomEvent(SQUIXI_EVENT, { detail: { kind: "tip", title: tip.title, text: tip.text } }));
      } catch { /* private mode: stay quiet */ }
    }, 2200);
    return () => clearTimeout(t);
  }, [path]);

  // Now and then Squixi pops up for a couple of seconds to say hello, then ducks back down.
  useEffect(() => {
    let alive = true;
    const loop = () => {
      const wait = 50_000 + Math.random() * 60_000;
      return setTimeout(() => {
        if (!alive) return;
        let quiet = false;
        try { quiet = localStorage.getItem(SQUIXI_TIPS_KEY) === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { quiet = true; }
        if (!quiet && !document.hidden && !document.querySelector(".squixi-out, .tour-back, .ask-backdrop")) { setPeek(true); setTimeout(() => alive && setPeek(false), 2600); }
        id = loop();
      }, wait);
    };
    let id = loop();
    return () => { alive = false; clearTimeout(id); };
  }, []);

  useEffect(() => { const on = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on); }, [close]);

  const pause = () => { hold.current = true; if (timer.current) { left.current = Math.max(4000, left.current - (Date.now() - started.current)); clear(); } };
  const resume = () => { hold.current = false; if (msg && !timer.current) arm(left.current || 8000); };
  const muteTips = () => { try { localStorage.setItem(SQUIXI_TIPS_KEY, "off"); } catch { /* ignore */ } close(); };
  const show = out && !!msg;
  // Which animation plays: pointing finger while explaining something, a wave for hints and hellos, the idle
  // loop when just standing there.
  const pose: "point" | "wave" | "idle" = show ? (msg?.kind === "tip" ? "wave" : "point") : peek ? "wave" : "idle";
  const visible = show || peek || linger;
  // The animation files are only fetched once the mascot first appears, so they never slow the page load.
  const [ever, setEver] = useState(false);
  useEffect(() => { if (visible) setEver(true); }, [visible]);

  if (path.startsWith("/login")) return null;
  return (
    <>
      <button className="ask-fab" onClick={() => { close(); squixiAsk(); }} onMouseEnter={() => stay(6000)} onFocus={() => stay(6000)} aria-label={`Ask ${SQUIXI}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/squixi-head.png" alt="" className="ask-fab-face" width={26} height={26} />Ask
      </button>
      <div className={`squixi ${show ? "squixi-out" : ""} ${peek && !show ? "squixi-peek" : ""} ${linger && !show && !peek ? "squixi-idle" : ""}`} data-pose={pose} onMouseEnter={() => { pause(); if (!show) stay(6000); }} onMouseLeave={resume} onTouchStart={pause}>
        {msg ? (
          <div className="squixi-bubble" role="status" aria-live="polite">
            <div className="squixi-head">
              <div className="min-w-0"><div className="squixi-name">{SQUIXI}</div><div className="squixi-title">{msg.title}</div></div>
              <button type="button" className="squixi-x" onClick={close} aria-label="Close">×</button>
            </div>
            <div className="squixi-body">
              {msg.text ? <p>{msg.text}</p> : null}
              {msg.rows?.length ? (
                <dl className="squixi-rows">{msg.rows.map((r, i) => <div key={i}><dt>{r.k}</dt><dd className={r.tone === "up" ? "up" : r.tone === "down" ? "down" : r.tone === "amber" ? "text-amber" : ""}>{r.v}</dd></div>)}</dl>
              ) : null}
              {msg.notes?.length ? <ul className="squixi-notes">{msg.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
            </div>
            <div className="squixi-foot">
              {msg.actions?.map((a) => <Link key={a.href} href={a.href} className="chip" onClick={close}>{a.label}</Link>)}
              <button type="button" className="chip" onClick={() => { close(); squixiAsk(); }}>Ask me more</button>
              {msg.kind === "tip" ? <button type="button" className="squixi-mute" onClick={muteTips}>Stop page tips</button> : null}
            </div>
          </div>
        ) : null}
        <button type="button" className="squixi-char" onClick={() => (show ? close() : squixiAsk())} aria-label={show ? "Close" : `Ask ${SQUIXI}`} tabIndex={visible ? 0 : -1}>
          {/* Three loops of the same character, stacked; only the current pose is shown. They are fetched the first
              time the mascot appears, not with the page. */}
          <span key={hop} className="squixi-poses">
            {ever && (["idle", "point", "wave"] as const).map((k) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={k} src={`/brand/squixi-${k}.webp`} alt={k === "idle" ? SQUIXI : ""} width={130} height={250} decoding="async" data-k={k} />
            ))}
          </span>
        </button>
      </div>
    </>
  );
}
