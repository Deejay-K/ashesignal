// Alternative.me Crypto Fear & Greed Index. Free, updates once a day.

import { fetchJson } from "@/lib/fetch";
import type { FearGreedPoint } from "@/lib/types";

export function fngLabel(v: number): FearGreedPoint["label"] {
  if (v <= 24) return "Extreme Fear";
  if (v <= 44) return "Fear";
  if (v <= 55) return "Neutral";
  if (v <= 75) return "Greed";
  return "Extreme Greed";
}

export async function getFearGreed(limit = 365): Promise<FearGreedPoint[]> {
  const r = await fetchJson<{ data: { value: string; timestamp: string }[] }>(
    `https://api.alternative.me/fng/?limit=${limit}&format=json`,
    { provider: "alternative.me", ttl: 1_800_000 },
  );
  return r.data
    .map((d) => {
      const value = Number(d.value);
      return { value, label: fngLabel(value), timestamp: Number(d.timestamp) };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}
