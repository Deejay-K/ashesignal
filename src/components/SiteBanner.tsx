import Link from "next/link";
import BrandLogo from "./BrandLogo";

// Chart line in a 0-100 box, stretched to its container (strokes keep their thickness).
const YS = [86, 74, 80, 60, 67, 46, 54, 30, 38, 14];
const PTS = YS.map((y, i) => [+(i * (100 / (YS.length - 1))).toFixed(2), y] as const);
const LINE = "M" + PTS.map(([x, y]) => `${x} ${y}`).join(" L");
const DOT = PTS[7];

/**
 * The animated AsheSignal banner across the very top of every page, above the header. Stage 44: drawn live with
 * HTML, SVG and CSS instead of GIF files, so it uses the active theme's colours and font (any current or future
 * theme), stays sharp at every width, and loops without a seam. Styles: .site-banner in globals.css.
 */
export default function SiteBanner() {
  return (
    <Link href="/" className="site-banner" aria-label="AsheSignal home">
      <span className="sb-grid" aria-hidden="true" />
      <span className="sb-chart" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
          <path className="sb-fill" d={`${LINE} V100 H0Z`} />
          <path className="sb-line" d={LINE} />
        </svg>
        {/* The travelling light: a bright copy of the line seen through a narrow window that slides left to right.
            It starts and ends fully off the edge, so the loop has no visible restart at any screen width. */}
        <svg className="sb-runsvg" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
          <path className="sb-run" d={LINE} />
        </svg>
        <span className="sb-dot" style={{ left: `${DOT[0]}%`, top: `${DOT[1]}%` }} />
      </span>
      <span className="sb-brand">
        <BrandLogo size="100%" className="sb-logo" />
        <span className="sb-text">
          <span className="sb-name">Ashe<span>Signal</span></span>
          <span className="sb-tag">Clear crypto signals. You place the trade.<span className="sb-sub">AN ASHE FOUNDRY APP</span></span>
        </span>
      </span>
    </Link>
  );
}
