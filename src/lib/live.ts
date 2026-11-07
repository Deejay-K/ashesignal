// Live candle updates from Binance's public WebSocket (data-stream mirror, not geo-blocked).
// Used client-side only: subscribes to <symbol>@kline_<tf> and patches the last candle.

import type { Candle, Timeframe } from "@/lib/types";

export function subscribeKline(symbol: string, tf: Timeframe, onCandle: (c: Candle) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const hosts = ["wss://data-stream.binance.vision/ws", "wss://stream.binance.com:9443/ws"];
  let ws: WebSocket | null = null;
  let closed = false;
  let idx = 0;
  const open = () => {
    if (closed) return;
    try {
      ws = new WebSocket(`${hosts[idx % hosts.length]}/${symbol.toLowerCase()}@kline_${tf}`);
    } catch {
      return;
    }
    ws.onmessage = (ev) => {
      try {
        const k = JSON.parse(ev.data).k;
        onCandle({ time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
      } catch {}
    };
    ws.onclose = () => {
      if (closed) return;
      idx++;
      setTimeout(open, 2000);
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}

/** Merge a live candle into an array (replace last if same open time, else append). */
export function mergeCandle(candles: Candle[], c: Candle): Candle[] {
  if (!candles.length) return [c];
  const last = candles[candles.length - 1];
  if (c.time === last.time) return [...candles.slice(0, -1), c];
  if (c.time > last.time) return [...candles.slice(-999), c];
  return candles;
}
