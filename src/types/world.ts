/**
 * Real-world data layer. Unlike the streaming telemetry tables, these hold
 * slow-moving observations pulled from public APIs: prices, rates, headlines,
 * hazards and weather. Everything is stored in DuckDB and queried with SQL.
 */

export type WorldCategory =
  | "fx"
  | "metals"
  | "crypto"
  | "macro"
  | "politics"
  | "space"
  | "weather"
  | "daily";

/** One observation of a numeric series (a price, a rate, a probability...). */
export interface WorldMetricRow {
  seriesId: string;
  category: WorldCategory;
  label: string;
  value: number;
  /** Secondary number: 24h volume for markets, wind speed for weather, etc. */
  aux: number | null;
  unit: string;
  source: string;
  url: string | null;
  timestamp: number;
}

export type HeadlineCategory =
  | "politics"
  | "world"
  | "business"
  | "tech"
  | "trending";

export interface WorldHeadlineRow {
  id: string;
  category: HeadlineCategory;
  source: string;
  title: string;
  url: string;
  /** Lexicon tone of the headline, -1 (negative) to +1 (positive). */
  tone: number;
  /** Points for tech stories, page views for trending articles. */
  aux: number | null;
  timestamp: number;
}

export type WorldEventKind =
  | "quake"
  | "storm"
  | "wildfire"
  | "volcano"
  | "flood"
  | "other";

/** A located physical event: an earthquake, storm, wildfire and so on. */
export interface WorldEventRow {
  id: string;
  kind: WorldEventKind;
  title: string;
  magnitude: number | null;
  unit: string | null;
  lat: number;
  lon: number;
  url: string | null;
  timestamp: number;
}

export interface WorldBatch {
  metrics: WorldMetricRow[];
  headlines: WorldHeadlineRow[];
  events: WorldEventRow[];
}

export const EMPTY_BATCH: WorldBatch = { metrics: [], headlines: [], events: [] };

export type SourceState = "pending" | "ok" | "error";

export interface SourceStatus {
  id: string;
  label: string;
  group: string;
  state: SourceState;
  lastOkAt: number | null;
  lastError: string | null;
  rows: number;
  intervalMs: number;
}

// Query result shapes ---------------------------------------------------

export interface WorldLatestRow {
  series_id: string;
  category: WorldCategory;
  label: string;
  unit: string;
  source: string;
  url: string | null;
  value: number;
  aux: number | null;
  t: number;
  prev_value: number | null;
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

export interface WorldSeriesPoint {
  series_id: string;
  t: number;
  value: number;
}

export interface WorldSummary {
  fear_greed: number | null;
  fear_greed_prev: number | null;
  gold_change_1d_pct: number | null;
  dxy_change_30d_pct: number | null;
  btc_change_24h_pct: number | null;
  news_tone_24h: number | null;
  news_count_24h: number;
  social_tone_1h: number | null;
  social_posts_1h: number;
  quakes_m55_24h: number;
  max_quake_mag_24h: number | null;
  kp_max_24h: number | null;
  open_hazards: number;
}

export interface CrossAssetRow {
  x: string;
  y: string;
  corr: number | null;
  n: number;
}

export interface SocialTopicRow {
  topic: string;
  posts: number;
  avg_tone: number | null;
  weighted_tone: number | null;
  posts_per_min: number;
  top_followers: number | null;
}

export interface WorldIndexComponent {
  id: string;
  label: string;
  /** 0 (stressed) to 100 (calm / risk-on). */
  score: number;
  weight: number;
  detail: string;
}

export interface WorldIndex {
  score: number;
  label: "Stressed" | "Cautious" | "Neutral" | "Confident" | "Euphoric";
  components: WorldIndexComponent[];
  coverage: number;
}

export interface HeadlineQueryRow {
  id: string;
  category: HeadlineCategory;
  source: string;
  title: string;
  url: string;
  tone: number;
  aux: number | null;
  t: number;
}

export interface EventQueryRow {
  id: string;
  kind: WorldEventKind;
  title: string;
  magnitude: number | null;
  unit: string | null;
  lat: number;
  lon: number;
  url: string | null;
  t: number;
}

export interface IssPoint {
  t: number;
  lat: number;
  lon: number;
}
