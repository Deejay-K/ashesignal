import Link from "next/link";
import { byId } from "@/lib/glossary";

/** Inline glossary hook: dotted underline, tooltip with the short definition, links to the glossary entry. */
export default function Term({ id, children, className = "" }: { id: string; children?: React.ReactNode; className?: string }) {
  const g = byId[id];
  if (!g) return <>{children}</>;
  return (
    <Link href={`/glossary#${g.id}`} title={g.short} className={`term ${className}`}>
      {children ?? g.term}<span className="term-q" aria-hidden>?</span>
    </Link>
  );
}
