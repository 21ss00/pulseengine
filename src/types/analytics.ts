/**
 * Shapes for the analytics layer: chart rows, the forecasting snapshot the
 * DuckDB worker computes, and the advice/alert output derived from it.
 */

export type RangeId = "1m" | "5m" | "15m" | "live";

export interface RangeConfig {
  id: RangeId;
  label: string;
  windowMs: number;
  bucketSeconds: number;
  pollMs: number;
}

export const RANGES: RangeConfig[] = [
  { id: "1m", label: "1m", windowMs: 60_000, bucketSeconds: 2, pollMs: 1000 },
  { id: "5m", label: "5m", windowMs: 300_000, bucketSeconds: 10, pollMs: 1000 },
  { id: "15m", label: "15m", windowMs: 900_000, bucketSeconds: 30, pollMs: 2000 },
  { id: "live", label: "Live", windowMs: 30_000, bucketSeconds: 1, pollMs: 500 },
];

/** Long enough to serve the widest selectable range. */
export const RETENTION_WINDOW_MS = 15 * 60 * 1000;

export interface QueryContext {
  nowMs: number;
  /** Minutes to add to UTC to get the viewer's local wall-clock time. */
  tzOffsetMinutes: number;
}

export interface CandleRow {
  symbol: string;
  label: string;
  bucket_ms: number;
  open: number;
  close: number;
  low: number;
  high: number;
  volume: number;
  obi: number | null;
  sma10: number | null;
  sma60: number | null;
  bb_mid: number | null;
  bb_sd: number | null;
  cross_dir: number | null;
}

export interface SentimentRow {
  label: string;
  avg_sentiment: number | null;
  weighted_sentiment: number | null;
  velocity: number | null;
  impact: number | null;
}

export interface DiagnosticsRow {
  label: string;
  avg_latency: number | null;
  avg_cpu_temp: number | null;
  max_cpu_temp: number | null;
  avg_memory: number | null;
}

export interface StatusRow {
  status: string;
  cnt: number;
}

export interface KpiSnapshot {
  active_symbols: number | null;
  prev_active_symbols: number | null;
  avg_sentiment: number | null;
  prev_avg_sentiment: number | null;
  peak_cpu_temp: number | null;
  prev_peak_cpu_temp: number | null;
  health_pct: number | null;
  prev_health_pct: number | null;
  device_count: number | null;
  prev_device_count: number | null;
  post_velocity: number | null;
  prev_post_velocity: number | null;
  alert_min_sentiment: number | null;
  alert_min_topic: string | null;
  alert_peak_cpu: number | null;
  alert_peak_device: string | null;
}

export interface TrendRow {
  symbol: string;
  slope: number;
  intercept: number;
  r2: number | null;
  n: number;
  last_price: number;
}

export interface AlphaSignalRow {
  symbol: string;
  price: number;
  sma10: number | null;
  sma60: number | null;
  bb_mid: number | null;
  bb_sd: number | null;
  cross_recent: number;
  n_sec: number;
  obi: number | null;
}

export interface BetaSignalRow {
  topic: string;
  velocity_now: number | null;
  velocity_avg: number | null;
  impact: number | null;
  sentiment_now: number | null;
  sentiment_avg: number | null;
  weighted_sentiment: number | null;
}

export interface GammaSignalRow {
  device_id: string;
  status: string;
  n: number;
  mem_now: number | null;
  leak_rate_per_min: number | null;
  mem_r2: number | null;
  temp_now: number | null;
  temp_growth_k: number | null;
  temp_intercept: number | null;
  temp_r2: number | null;
}

export interface CorrelationRow {
  symbol: string;
  sent_c10: number | null;
  sent_c30: number | null;
  sent_c60: number | null;
  vol_c10: number | null;
  vol_c30: number | null;
  vol_c60: number | null;
  n10: number;
  n30: number;
  n60: number;
}

export interface ForecastSnapshot {
  generatedAt: number;
  trendCutoffMs: number;
  gammaCutoffMs: number;
  trends: TrendRow[];
  alpha: AlphaSignalRow[];
  beta: BetaSignalRow[];
  gamma: GammaSignalRow[];
  correlations: CorrelationRow[];
}

export type AdviceSeverity = "info" | "watch" | "warning" | "critical";

export interface AdviceItem {
  id: string;
  severity: AdviceSeverity;
  stream: "alpha" | "beta" | "gamma" | "cross" | "system" | "world";
  headline: string;
  detail: string;
}

export interface ThresholdAlert {
  id: "sentiment" | "cpu";
  message: string;
}

export interface TrendTag {
  text: string;
  direction: "up" | "down" | "flat";
  tone: "good" | "bad" | "neutral";
}
