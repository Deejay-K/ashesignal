/**
 * Stage 44 - the AsheSignal mark drawn live (inline SVG) instead of a GIF. Every colour comes from the theme's CSS
 * variables (--mint, --bg, --bg-2), so the logo matches whatever theme is active, including themes added later,
 * with no new image files. The signal pulse loops with a CSS animation (see .brand-* in globals.css).
 */
export default function BrandLogo({ size = 28, className = "" }: { size?: number | string; className?: string }) {
  const pulse = "M356 640 H446 L498 536 L548 716 L592 640 H668";
  return (
    <svg className={`brand-logo ${className}`} width={size} height={size} viewBox="0 0 1024 1024" role="img" aria-label="AsheSignal" focusable="false">
      <rect className="brand-tile" width="1024" height="1024" rx="224" />
      <rect className="brand-ring" x="14" y="14" width="996" height="996" rx="212" fill="none" strokeWidth="10" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path className="brand-a" d="M262 792 L512 236 L762 792" strokeWidth="92" />
        <path className="brand-a" d={pulse} strokeWidth="56" />
        <path className="brand-run" d={pulse} strokeWidth="44" pathLength={100} />
      </g>
    </svg>
  );
}

/** The same mark as a standalone SVG string with fixed colours (favicon, share images). */
export function logoSvg(c: { bg: string; tile: string; accent: string }): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="224" fill="${c.tile}"/><rect x="14" y="14" width="996" height="996" rx="212" fill="none" stroke="${c.accent}" stroke-opacity=".35" stroke-width="10"/><g fill="none" stroke="${c.accent}" stroke-linecap="round" stroke-linejoin="round"><path d="M262 792 L512 236 L762 792" stroke-width="92"/><path d="M356 640 H446 L498 536 L548 716 L592 640 H668" stroke-width="56"/></g></svg>`;
}
