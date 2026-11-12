"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { palette } from "@/lib/themes";
import { logoSvg } from "./BrandLogo";

/** Redraws the browser-tab icon in the active theme's colours, on load and whenever the theme changes. */
export default function ThemeFavicon() {
  const path = usePathname();
  useEffect(() => {
    const paint = () => {
      const p = palette();
      const bg2 = getComputedStyle(document.documentElement).getPropertyValue("--bg-2").trim() || p.bg;
      const href = `data:image/svg+xml,${encodeURIComponent(logoSvg({ bg: p.bg, tile: bg2, accent: p.mint }))}`;
      let link = document.querySelector<HTMLLinkElement>('link[data-theme-icon="1"]');
      if (!link) { link = document.createElement("link"); link.rel = "icon"; link.type = "image/svg+xml"; link.dataset.themeIcon = "1"; document.head.appendChild(link); }
      if (link.href !== href) link.href = href;
      // Browsers use the last matching icon; keep ours last and point the stock SVG icon at the same picture.
      document.querySelectorAll<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]:not([data-theme-icon])').forEach((l) => { l.href = href; });
      document.head.appendChild(link);
    };
    paint();
    window.addEventListener("theme-change", paint);
    return () => window.removeEventListener("theme-change", paint);
  }, [path]);
  return null;
}
