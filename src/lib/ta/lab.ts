// Engine Lab: the rule variants the worker backtests side by side. "production" is what the app ships.
import type { BacktestOpts } from "./backtest";

export interface LabVariant { id: string; label: string; opts: BacktestOpts; group: "baseline" | "band" | "targets" | "volume" | "filters" }

export const LAB_VARIANTS: LabVariant[] = [
  { id: "production", label: "Production rules (confirmed only)", group: "baseline", opts: { onlyConfirmed: true } },
  { id: "all_tradeable", label: "Confirmed + speculative (old behaviour)", group: "baseline", opts: { onlyConfirmed: false } },
  { id: "band30", label: "Score band ±30", group: "band", opts: { onlyConfirmed: true, gates: { band: 30 } } },
  { id: "band45", label: "Score band ±45", group: "band", opts: { onlyConfirmed: true, gates: { band: 45 } } },
  { id: "tp1_15", label: "TP1 at least 1.5R", group: "targets", opts: { onlyConfirmed: true, gates: { tp1Min: 1.5 } } },
  { id: "tp1_08", label: "TP1 at least 0.8R (looser)", group: "targets", opts: { onlyConfirmed: true, gates: { tp1Min: 0.8, tp2Min: 1.2 } } },
  { id: "vol12", label: "Volume at least 1.2x", group: "volume", opts: { onlyConfirmed: true, gates: { volMin: 1.2 } } },
  { id: "stretch15", label: "Max 1.5 ATR from 20 EMA", group: "filters", opts: { onlyConfirmed: true, gates: { stretchMax: 1.5 } } },
  // Stage 49: wider stops, with the reward gates scaled down by the same factor so the same price targets qualify.
  // Compare win rate AND expectancy with production: a wider stop wins more often but each win is fewer R.
  { id: "stops12", label: "Wider stops: 1.2 ATR past the zone", group: "filters", opts: { onlyConfirmed: true, gates: { slMinAtr: 1.2, slBufAtr: 0.4, tp1Min: 0.8, tp2Min: 1.2 } } },
  { id: "stops15", label: "Wider stops: 1.5 ATR past the zone", group: "filters", opts: { onlyConfirmed: true, gates: { slMinAtr: 1.5, slBufAtr: 0.5, tp1Min: 0.6, tp2Min: 0.9 } } },
  { id: "stops20", label: "Wider stops: 2.0 ATR past the zone", group: "filters", opts: { onlyConfirmed: true, gates: { slMinAtr: 2.0, slBufAtr: 0.6, tp1Min: 0.5, tp2Min: 0.75 } } },
  { id: "htf", label: "Plus higher-timeframe agreement", group: "filters", opts: { onlyConfirmed: true, htfFilter: true } },
  { id: "strict", label: "Strict: band 45 + vol 1.2 + HTF", group: "filters", opts: { onlyConfirmed: true, htfFilter: true, gates: { band: 45, volMin: 1.2 } } },
];
