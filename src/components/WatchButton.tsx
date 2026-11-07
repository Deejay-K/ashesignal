"use client";

import { useEffect, useState } from "react";
import { isWatched, toggleWatch, type WatchItem } from "@/lib/watchlist";

export default function WatchButton(item: WatchItem) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(isWatched(item.id)), [item.id]);
  return (
    <button
      aria-label={on ? "Remove from watchlist" : "Add to watchlist"}
      title={on ? "Remove from watchlist" : "Add to watchlist (guest mode: saved in this browser only)"}
      className={`text-base leading-none ${on ? "text-amber" : "text-fg-3 hover:text-fg"}`}
      onClick={() => setOn(toggleWatch(item))}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
