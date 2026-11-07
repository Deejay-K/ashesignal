import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="num text-5xl font-bold text-fg-3">404</div>
      <h1 className="mt-2 text-xl font-bold">Nothing at this address</h1>
      <p className="mt-2 text-sm text-fg-2">If you were looking for a token, try the search bar: a name, a ticker, or a contract address all work.</p>
      <div className="mt-4 flex justify-center gap-2">
        <Link href="/" className="btn text-sm">Dashboard</Link>
        <Link href="/discover" className="btn-ghost">Discover</Link>
      </div>
    </div>
  );
}
