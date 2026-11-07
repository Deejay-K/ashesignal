export default function Sparkline({ data, w = 96, h = 28 }: { data: number[]; w?: number; h?: number }) {
  const pts = data.filter(Number.isFinite);
  if (pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const d = pts.map((v, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * (h - 2) - 1).toFixed(1)}`).join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline fill="none" stroke={up ? "#36bd94" : "#f0506e"} strokeWidth="1.5" points={d} />
    </svg>
  );
}
