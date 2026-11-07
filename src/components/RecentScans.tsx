"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "ashesignal.recent-scans";
export interface RecentScan { address: string; symbol?: string; chain?: string; at: number }

export function rememberScan(s: Omit<RecentScan, "at">) {
  try {
    const list = (JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentScan[]).filter((x) => x.address !== s.address);
    list.unshift({ ...s, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 12)));
  } catch {}
}

export default function RecentScans() {
  const [list, setList] = useState<RecentScan[]>([]);
  useEffect(() => { try { setList(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch {} }, []);
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-fg-3">Recent:</span>
      {list.map((s) => (
        <Link key={s.address} href={`/scanner?address=${s.address}`} className="btn-ghost !py-1">
          {s.symbol ?? `${s.address.slice(0, 6)}...`}{s.chain ? <span className="ml-1 text-fg-3">{s.chain}</span> : null}
        </Link>
      ))}
    </div>
  );
}
