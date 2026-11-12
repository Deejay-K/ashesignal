"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * A dashboard section that can be folded away. Open or closed is remembered on the device, so each person keeps
 * the dashboard as long or as short as they like. Content stays in the page either way (search and links work).
 */
export default function Fold({ id, title, hint, defaultOpen = true, children }: { id: string; title: string; hint?: string; defaultOpen?: boolean; children: ReactNode }) {
  const key = `as_fold_${id}`;
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { try { const v = localStorage.getItem(key); if (v === "0") setOpen(false); else if (v === "1") setOpen(true); } catch { /* private mode */ } }, [key]);
  return (
    <details className="fold" open={open} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== open) { setOpen(o); try { localStorage.setItem(key, o ? "1" : "0"); } catch { /* private mode */ } } }}>
      <summary>
        <span className="fold-title">{title}</span>
        {hint ? <span className="fold-hint truncate">{hint}</span> : null}
        <span className="fold-caret" aria-hidden="true">▾</span>
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
