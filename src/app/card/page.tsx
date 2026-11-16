"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CARD_BGS, cardBg, cardMath, cardMoney } from "@/lib/card-presets";

// Stage 50 - Result card studio. A trader builds a card for their own trade: their numbers, their background
// (a preset or their own picture), their colours and caption. Everything is drawn in the browser on a canvas, so
// an uploaded picture never leaves the device. The AsheSignal mark is always drawn on top and cannot be removed.

type Format = "wide" | "square" | "story";
const SIZES: Record<Format, { w: number; h: number; label: string }> = {
  wide: { w: 1200, h: 630, label: "Wide (X, Telegram, Root)" },
  square: { w: 1080, h: 1080, label: "Square (Instagram post)" },
  story: { w: 1080, h: 1920, label: "Story (Instagram, TikTok)" },
};
const ACCENTS = ["#36bd94", "#d4af37", "#22d3ee", "#ff7a45", "#fb7185", "#a78bfa", "#39ff14", "#ffffff"];
const RED = "#f0506e";

interface Opts {
  symbol: string; side: "LONG" | "SHORT"; tf: string; entry: string; exit: string; sl: string; lev: string; usd: string;
  showUsd: boolean; showR: boolean; name: string; note: string; bg: string; accent: string | null; dim: number; format: Format; hours: string;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean); const lines: string[] = []; let cur = "";
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } if (lines.length === maxLines) break; }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

/** Draws the whole card. Pure: same inputs, same picture. */
function draw(cv: HTMLCanvasElement, o: Opts, img: HTMLImageElement | null, family: string) {
  const { w: W, h: H } = SIZES[o.format];
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"); if (!ctx) return;
  const t = cardBg(o.bg);
  const accent = o.accent ?? t.accent;
  const onImage = !!img;
  const fg = onImage ? "#ffffff" : t.fg, fg2 = onImage ? "rgba(255,255,255,.78)" : t.fg2;
  const panel = onImage ? "rgba(8,11,15,.62)" : t.panel;
  const font = (px: number, weight = 700) => { ctx.font = `${weight} ${Math.round(px)}px ${family}`; };

  // background
  if (img) {
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight); const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.fillStyle = `rgba(0,0,0,${o.dim / 100})`; ctx.fillRect(0, 0, W, H);
  } else {
    const a = ((t.angle - 90) * Math.PI) / 180, cx = W / 2, cy = H / 2, len = Math.abs(W * Math.cos(a)) + Math.abs(H * Math.sin(a));
    const gr = ctx.createLinearGradient(cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2, cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2);
    gr.addColorStop(0, t.from); gr.addColorStop(1, t.to); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    // faint chart line so a plain background is not empty
    ctx.save(); ctx.globalAlpha = t.light ? 0.16 : 0.2; ctx.strokeStyle = accent; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.beginPath();
    const ys = [0.9, 0.8, 0.85, 0.66, 0.72, 0.52, 0.6, 0.38, 0.45, 0.22];
    ys.forEach((y, i) => { const px = W * 0.42 + (W * 0.58 * i) / (ys.length - 1), py = H * (0.35 + y * 0.6); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke(); ctx.restore();
  }

  const s = o.format === "wide" ? 1 : o.format === "square" ? 1.3 : 1.5;
  const pad = 44 * s;
  const m = cardMath({ side: o.side, entry: Number(o.entry), exit: Number(o.exit), sl: o.sl ? Number(o.sl) : null, lev: o.lev ? Number(o.lev) : null });
  const tone = m.win ? accent : RED;
  const usd = o.showUsd && o.usd !== "" && Number.isFinite(Number(o.usd)) ? Number(o.usd) : null;

  // AsheSignal mark, always on top-left on its own dark plate so it reads on any background
  const mk = 44 * s; const plateH = mk + 16 * s;
  font(30 * s); const wordW = ctx.measureText("AsheSignal").width;
  ctx.fillStyle = "rgba(11,15,20,.82)"; rr(ctx, pad, pad, mk + 12 * s + wordW + 28 * s, plateH, 16 * s); ctx.fill();
  const lx = pad + 8 * s, ly = pad + 8 * s;
  ctx.fillStyle = "#10161d"; rr(ctx, lx, ly, mk, mk, 11 * s); ctx.fill(); ctx.strokeStyle = "rgba(54,189,148,.5)"; ctx.lineWidth = 1.5 * s; ctx.stroke();
  ctx.save(); ctx.translate(lx, ly); ctx.scale(mk / 1024, mk / 1024); ctx.strokeStyle = "#36bd94"; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = 92; ctx.stroke(new Path2D("M262 792 L512 236 L762 792")); ctx.lineWidth = 56; ctx.stroke(new Path2D("M356 640 H446 L498 536 L548 716 L592 640 H668")); ctx.restore();
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; font(30 * s);
  ctx.fillStyle = "#e6edf3"; ctx.fillText("Ashe", lx + mk + 12 * s, pad + plateH / 2 + 1);
  ctx.fillStyle = "#36bd94"; ctx.fillText("Signal", lx + mk + 12 * s + ctx.measureText("Ashe").width, pad + plateH / 2 + 1);

  // badge top-right
  const badge = m.win ? "WIN" : "LOSS"; font(26 * s, 800); const bw = ctx.measureText(badge).width + 36 * s;
  ctx.fillStyle = tone; rr(ctx, W - pad - bw, pad + 6 * s, bw, 46 * s, 23 * s); ctx.fill();
  ctx.fillStyle = tone === "#ffffff" ? "#0b0f14" : t.light && !onImage ? "#ffffff" : "#0b0f14"; ctx.textAlign = "center"; ctx.fillText(badge, W - pad - bw / 2, pad + 6 * s + 23 * s + 1);

  // main block: vertically centred on tall formats
  const cols = o.format === "wide" ? 4 : 2;
  const stats: { k: string; v: string; c?: string }[] = [
    { k: "Entry", v: cardMoney(Number(o.entry)) }, { k: "Exit", v: cardMoney(Number(o.exit)), c: tone },
  ];
  if (usd != null) stats.push({ k: "Profit / loss", v: `${usd >= 0 ? "+" : "-"}${cardMoney(Math.abs(usd))}`, c: usd >= 0 ? accent : RED });
  if (o.showR && m.r != null) stats.push({ k: "Risk multiple", v: `${m.r >= 0 ? "+" : ""}${m.r.toFixed(1)}R`, c: tone });
  if (o.lev && m.lev > 1) stats.push({ k: "Leverage", v: `${m.lev}x` });
  const h = Number(o.hours); if (Number.isFinite(h) && h > 0 && stats.length < 4) stats.push({ k: "Held for", v: h >= 48 ? `${Math.round(h / 24)} days` : `${Math.max(1, Math.round(h))} h` });
  const shown = stats.slice(0, 4);
  const rows = Math.ceil(shown.length / cols);
  const boxH = 104 * s, gap = 16 * s;
  const symPx = 92 * s, bigPx = (o.format === "wide" ? 120 : 150) * s, subPx = 28 * s;
  font(24 * s, 500);
  const noteLines = o.note.trim() ? wrap(ctx, o.note.trim(), W - pad * 2, 2) : [];
  const blockH = symPx + 18 * s + bigPx + 12 * s + subPx + 30 * s + rows * boxH + (rows - 1) * gap + (noteLines.length ? 24 * s + noteLines.length * 32 * s : 0);
  const top = pad + plateH + 26 * s, bottom = H - pad - 44 * s;
  let y = o.format === "wide" ? top : Math.max(top, top + (bottom - top - blockH) / 2);

  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  font(symPx, 800); ctx.fillStyle = fg; const sym = (o.symbol || "COIN").toUpperCase().slice(0, 10); ctx.fillText(sym, pad, y + symPx * 0.82);
  const symW = ctx.measureText(sym).width; font(34 * s); ctx.fillStyle = o.side === "LONG" ? accent : RED; ctx.fillText(`${o.side} ${o.tf}`.trim(), pad + symW + 20 * s, y + symPx * 0.8);
  y += symPx + 18 * s;
  const big = m.lev > 1 ? m.levPct : m.movePct;
  font(bigPx, 800); ctx.fillStyle = tone; ctx.fillText(`${big >= 0 ? "+" : ""}${big.toFixed(1)}%`, pad, y + bigPx * 0.82);
  y += bigPx + 12 * s;
  font(subPx, 500); ctx.fillStyle = fg2;
  ctx.fillText(m.lev > 1 ? `with ${m.lev}x leverage (${m.movePct >= 0 ? "+" : ""}${m.movePct.toFixed(1)}% price move)` : "price move, entry to exit", pad, y + subPx * 0.8);
  y += subPx + 30 * s;
  const bwid = (W - pad * 2 - gap * (cols - 1)) / cols;
  shown.forEach((st, i) => {
    const bx = pad + (i % cols) * (bwid + gap), by = y + Math.floor(i / cols) * (boxH + gap);
    ctx.fillStyle = panel; rr(ctx, bx, by, bwid, boxH, 18 * s); ctx.fill();
    font(21 * s, 500); ctx.fillStyle = fg2; ctx.fillText(st.k, bx + 20 * s, by + 36 * s);
    font(38 * s); ctx.fillStyle = st.c ?? fg; ctx.fillText(st.v, bx + 20 * s, by + 82 * s);
  });
  y += rows * boxH + (rows - 1) * gap;
  if (noteLines.length) { y += 24 * s; font(24 * s, 500); ctx.fillStyle = fg; noteLines.forEach((l, i) => ctx.fillText(l, pad, y + 24 * s + i * 32 * s)); }

  // footer
  font(20 * s, 500); ctx.fillStyle = fg2; ctx.textBaseline = "alphabetic";
  const who = o.name.trim().slice(0, 24);
  const foot = `Personal result shared by ${who || "an AsheSignal trader"}. Not financial advice.`;
  const fl = wrap(ctx, foot, W - pad * 2, 2);
  fl.forEach((l, i) => ctx.fillText(l, pad, H - pad - (fl.length - 1 - i) * 26 * s));
}

function Studio() {
  const q = useSearchParams();
  const init = useMemo<Opts>(() => ({
    symbol: q.get("symbol") ?? "SOL", side: q.get("side") === "SHORT" ? "SHORT" : "LONG", tf: q.get("tf") ?? "4h",
    entry: q.get("entry") ?? "84.40", exit: q.get("exit") ?? "91.20", sl: q.get("sl") ?? "", lev: q.get("lev") ?? "", usd: q.get("usd") ?? "",
    showUsd: false, showR: true, name: "", note: "", bg: q.get("bg") ?? "foundry", accent: null, dim: 45, format: "wide", hours: q.get("hours") ?? "",
  }), [q]);
  const [o, setO] = useState<Opts>(init);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const set = <K extends keyof Opts>(k: K, v: Opts[K]) => setO((p) => ({ ...p, [k]: v }));

  useEffect(() => { try { const n = localStorage.getItem("as_card_name"); if (n) setO((p) => ({ ...p, name: n })); } catch { /* private mode */ } }, []);
  useEffect(() => { try { localStorage.setItem("as_card_name", o.name); } catch { /* private mode */ } }, [o.name]);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const family = getComputedStyle(document.body).fontFamily || "sans-serif";
    const run = () => draw(c, o, img, family);
    run(); document.fonts?.ready.then(run).catch(() => {});
  }, [o, img]);

  const onFile = (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setMsg("That file is not a picture."); return; }
    const url = URL.createObjectURL(f); const im = new Image();
    im.onload = () => { setImg(im); setMsg(null); }; im.onerror = () => setMsg("Could not read that picture."); im.src = url;
  };
  const blob = useCallback(() => new Promise<Blob | null>((res) => cv.current?.toBlob((b) => res(b), "image/png") ?? res(null)), []);
  const fileName = `ashesignal-${(o.symbol || "trade").toLowerCase()}-${o.side.toLowerCase()}.png`;
  const download = async () => { const b = await blob(); if (!b) return; const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); setMsg("Saved to your downloads."); };
  const share = async () => {
    const b = await blob(); if (!b) return;
    const file = new File([b], fileName, { type: "image/png" });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `${o.symbol} ${o.side}`, text: "My trade, tracked with AsheSignal" }); return; } } catch { return; /* cancelled */ }
    setMsg("This browser cannot share pictures directly. Use Download or Copy instead.");
  };
  const copy = async () => {
    const b = await blob(); if (!b) return;
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]); setMsg("Copied. Paste it into any chat."); } catch { setMsg("Copy is blocked in this browser. Use Download instead."); }
  };
  const num = (k: "entry" | "exit" | "sl" | "lev" | "usd" | "hours", label: string, ph = "") => (
    <label className="block text-xs text-fg-3">{label}<input className="mt-1 w-full" inputMode="decimal" value={o[k]} placeholder={ph} onChange={(e) => set(k, e.target.value.replace(",", "."))} /></label>
  );
  const sz = SIZES[o.format];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Result card</h1>
        <p className="text-sm text-fg-2">Make a card for your own trade and share it anywhere. Pick a background or use your own picture. The AsheSignal mark always stays on the card.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <div className="card overflow-hidden p-2">
            <canvas ref={cv} className="mx-auto block h-auto w-full rounded-lg" style={{ maxWidth: o.format === "story" ? 360 : o.format === "square" ? 520 : 900, aspectRatio: `${sz.w} / ${sz.h}` }} aria-label="Preview of your result card" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={share}>Share</button>
            <button type="button" className="btn-ghost" onClick={download}>Download PNG</button>
            <button type="button" className="btn-ghost" onClick={copy}>Copy image</button>
            <Link href="/setups" className="btn-ghost ml-auto">Back to journal</Link>
          </div>
          {msg ? <p className="text-xs text-fg-2">{msg}</p> : null}
          <p className="text-[11px] text-fg-3">The card is made on your device. A picture you add as background is never uploaded. The numbers are yours: only share results you really had.</p>
        </div>
        <div className="space-y-3">
          <div className="card space-y-2 p-3">
            <div className="text-sm font-semibold">Your trade</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-fg-3">Coin<input className="mt-1 w-full" value={o.symbol} maxLength={10} onChange={(e) => set("symbol", e.target.value.toUpperCase())} /></label>
              <label className="block text-xs text-fg-3">Timeframe<input className="mt-1 w-full" value={o.tf} maxLength={4} onChange={(e) => set("tf", e.target.value)} /></label>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1 !py-1 text-xs" data-active={o.side === "LONG"} onClick={() => set("side", "LONG")}>LONG</button>
              <button type="button" className="btn-ghost flex-1 !py-1 text-xs" data-active={o.side === "SHORT"} onClick={() => set("side", "SHORT")}>SHORT</button>
            </div>
            <div className="grid grid-cols-2 gap-2">{num("entry", "Entry price")}{num("exit", "Exit price")}{num("sl", "Stop (optional)", "for the R number")}{num("lev", "Leverage (optional)", "1 = spot")}</div>
            <div className="grid grid-cols-2 gap-2">{num("usd", "Profit or loss in $", "optional")}{num("hours", "Hours held", "optional")}</div>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="!w-auto shrink-0" checked={o.showUsd} onChange={(e) => set("showUsd", e.target.checked)} /> Show the dollar amount on the card</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="!w-auto shrink-0" checked={o.showR} onChange={(e) => set("showR", e.target.checked)} /> Show the risk multiple (R)</label>
          </div>
          <div className="card space-y-2 p-3">
            <div className="text-sm font-semibold">Look</div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(SIZES) as Format[]).map((f) => <button key={f} type="button" className="btn-ghost !py-1 !text-[11px]" data-active={o.format === f} onClick={() => set("format", f)}>{SIZES[f].label}</button>)}
            </div>
            <div className="text-xs text-fg-3">Background</div>
            <div className="grid grid-cols-4 gap-1.5">
              {CARD_BGS.map((b) => (
                <button key={b.id} type="button" title={b.label} aria-label={`${b.label} background`} onClick={() => { setImg(null); set("bg", b.id); }}
                  className="h-10 rounded-md border text-[10px] font-semibold" style={{ backgroundImage: `linear-gradient(${b.angle}deg, ${b.from}, ${b.to})`, color: b.fg, borderColor: !img && o.bg === b.id ? "var(--mint)" : "var(--border)", borderWidth: !img && o.bg === b.id ? 2 : 1 }}>{b.label}</button>
              ))}
            </div>
            <label className="btn-ghost block cursor-pointer text-center text-xs">{img ? "Change my picture" : "Use my own picture"}<input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} /></label>
            {img ? (
              <>
                <label className="block text-xs text-fg-3">Darken the picture so the text reads: {o.dim}%<input type="range" min={0} max={85} value={o.dim} onChange={(e) => set("dim", Number(e.target.value))} className="mt-1 w-full" /></label>
                <button type="button" className="text-xs text-fg-3 underline" onClick={() => setImg(null)}>Remove my picture</button>
              </>
            ) : null}
            <div className="text-xs text-fg-3">Accent colour</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className="btn-ghost !py-1 !text-[11px]" data-active={o.accent == null} onClick={() => set("accent", null)}>Auto</button>
              {ACCENTS.map((c) => <button key={c} type="button" aria-label={`Accent ${c}`} onClick={() => set("accent", c)} className="h-7 w-7 rounded-full border" style={{ background: c, borderColor: o.accent === c ? "var(--fg)" : "var(--border)", borderWidth: o.accent === c ? 2 : 1 }} />)}
              <input type="color" aria-label="Custom accent colour" value={o.accent ?? cardBg(o.bg).accent} onChange={(e) => set("accent", e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0" />
            </div>
          </div>
          <div className="card space-y-2 p-3">
            <div className="text-sm font-semibold">Your words</div>
            <label className="block text-xs text-fg-3">Your name or handle<input className="mt-1 w-full" value={o.name} maxLength={24} placeholder="shown in the footer" onChange={(e) => set("name", e.target.value)} /></label>
            <label className="block text-xs text-fg-3">Caption (optional)<input className="mt-1 w-full" value={o.note} maxLength={110} placeholder="Waited for the retest, took 30% at TP1" onChange={(e) => set("note", e.target.value)} /></label>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CardPage() {
  return <Suspense fallback={<div className="card h-64 animate-pulse" />}><Studio /></Suspense>;
}
