import Link from "next/link";

/**
 * Stage 43 - the animated AsheSignal banner across the very top of every page, above the header. Three renders of
 * the same loop so the text stays readable at every width: a thin strip on desktop, a taller one on tablets and
 * phones. Heights follow the width (see .site-banner in globals.css), so nothing jumps while the image loads.
 */
export default function SiteBanner() {
  return (
    <Link href="/" className="site-banner" aria-label="AsheSignal home">
      <picture>
        <source media="(min-width: 1024px)" srcSet="/brand/banner-desktop.gif" width={1920} height={112} />
        <source media="(min-width: 640px)" srcSet="/brand/banner-tablet.gif" width={1200} height={120} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/banner-mobile.gif" alt="AsheSignal - clear crypto signals, you place the trade" width={780} height={130} decoding="async" />
      </picture>
    </Link>
  );
}
