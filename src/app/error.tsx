"use client";

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="mx-auto mb-4 h-10 w-10 rounded-lg bg-red-dim" />
      <h1 className="text-xl font-bold">Something broke on this page</h1>
      <p className="mt-2 text-sm text-fg-2">{error.message || "Unexpected error."}{error.digest ? <span className="num block text-xs text-fg-3">ref {error.digest}</span> : null}</p>
      <div className="mt-4 flex justify-center gap-2">
        <button className="btn text-sm" onClick={reset}>Try again</button>
        <Link href="/" className="btn-ghost">Dashboard</Link>
        <Link href="/api/health" className="btn-ghost">Data health</Link>
      </div>
    </div>
  );
}
