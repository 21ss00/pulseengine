import type {
  StreamAlphaTick,
  StreamBetaSentiment,
  StreamGammaDiagnostic,
} from "../types/telemetry.ts";
import type {
  WorldBatch,
  WorldEventRow,
  WorldHeadlineRow,
  WorldMetricRow,
} from "../types/world.ts";

export const ALPHA_TABLE_NAME = "alpha_ticks";
export const BETA_TABLE_NAME = "beta_sentiment";
export const GAMMA_TABLE_NAME = "gamma_diagnostics";

export type TelemetryTableName =
  | typeof ALPHA_TABLE_NAME
  | typeof BETA_TABLE_NAME
  | typeof GAMMA_TABLE_NAME;

export const TELEMETRY_TABLES: TelemetryTableName[] = [
  ALPHA_TABLE_NAME,
  BETA_TABLE_NAME,
  GAMMA_TABLE_NAME,
];

export const WORLD_METRICS_TABLE = "world_metrics";
export const WORLD_HEADLINES_TABLE = "world_headlines";
export const WORLD_EVENTS_TABLE = "world_events";

export type WorldTableName =
  | typeof WORLD_METRICS_TABLE
  | typeof WORLD_HEADLINES_TABLE
  | typeof WORLD_EVENTS_TABLE;

export const WORLD_TABLES: WorldTableName[] = [
  WORLD_METRICS_TABLE,
  WORLD_HEADLINES_TABLE,
  WORLD_EVENTS_TABLE,
];

export type ExportableTable = TelemetryTableName | WorldTableName;
export const EXPORTABLE_TABLES: ExportableTable[] = [...TELEMETRY_TABLES, ...WORLD_TABLES];

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS ${ALPHA_TABLE_NAME} (
    id BIGINT,
    symbol VARCHAR,
    exchange VARCHAR,
    price DOUBLE,
    previous_close DOUBLE,
    change_percent DOUBLE,
    bid DOUBLE,
    ask DOUBLE,
    bid_size DOUBLE,
    ask_size DOUBLE,
    spread DOUBLE,
    volume DOUBLE,
    volatility DOUBLE,
    event_time TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS ${BETA_TABLE_NAME} (
    id BIGINT,
    platform VARCHAR,
    topic VARCHAR,
    sentiment_score DOUBLE,
    mention_volume DOUBLE,
    engagement_rate DOUBLE,
    bullish_ratio DOUBLE,
    bearish_ratio DOUBLE,
    influencer_followers DOUBLE,
    influencer_impact DOUBLE,
    event_time TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS ${GAMMA_TABLE_NAME} (
    id BIGINT,
    device_id VARCHAR,
    region VARCHAR,
    metric VARCHAR,
    cpu_temperature_celsius DOUBLE,
    cpu_utilization_percent DOUBLE,
    memory_utilization_percent DOUBLE,
    network_latency_ms DOUBLE,
    packet_loss_percent DOUBLE,
    status VARCHAR,
    event_time TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS ${WORLD_METRICS_TABLE} (
    series_id VARCHAR,
    category VARCHAR,
    label VARCHAR,
    value DOUBLE,
    aux DOUBLE,
    unit VARCHAR,
    source VARCHAR,
    url VARCHAR,
    event_time TIMESTAMP,
    PRIMARY KEY (series_id, event_time)
  );`,
  `CREATE TABLE IF NOT EXISTS ${WORLD_HEADLINES_TABLE} (
    id VARCHAR PRIMARY KEY,
    category VARCHAR,
    source VARCHAR,
    title VARCHAR,
    url VARCHAR,
    tone DOUBLE,
    aux DOUBLE,
    event_time TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS ${WORLD_EVENTS_TABLE} (
    id VARCHAR PRIMARY KEY,
    kind VARCHAR,
    title VARCHAR,
    magnitude DOUBLE,
    unit VARCHAR,
    lat DOUBLE,
    lon DOUBLE,
    url VARCHAR,
    event_time TIMESTAMP
  );`,
];

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function lit(value: string): string {
  return `'${escapeSqlString(value)}'`;
}

function num(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Non-finite numeric value in telemetry row: ${value}`);
  }
  return String(value);
}

export function buildAlphaInsertSql(rows: StreamAlphaTick[]): string {
  const values = rows
    .map(
      (r) =>
        `(${num(r.id)}, ${lit(r.symbol)}, ${lit(r.exchange)}, ${num(r.price)}, ${num(r.previousClose)}, ${num(r.changePercent)}, ${num(r.bid)}, ${num(r.ask)}, ${num(r.bidSize)}, ${num(r.askSize)}, ${num(r.spread)}, ${num(r.volume)}, ${num(r.volatility)}, epoch_ms(${num(r.timestamp)}))`
    )
    .join(", ");
  return `INSERT INTO ${ALPHA_TABLE_NAME} (id, symbol, exchange, price, previous_close, change_percent, bid, ask, bid_size, ask_size, spread, volume, volatility, event_time) VALUES ${values};`;
}

export function buildBetaInsertSql(rows: StreamBetaSentiment[]): string {
  const values = rows
    .map(
      (r) =>
        `(${num(r.id)}, ${lit(r.platform)}, ${lit(r.topic)}, ${num(r.sentimentScore)}, ${num(r.mentionVolume)}, ${num(r.engagementRate)}, ${num(r.bullishRatio)}, ${num(r.bearishRatio)}, ${num(r.influencerFollowers)}, ${num(r.influencerImpact)}, epoch_ms(${num(r.timestamp)}))`
    )
    .join(", ");
  return `INSERT INTO ${BETA_TABLE_NAME} (id, platform, topic, sentiment_score, mention_volume, engagement_rate, bullish_ratio, bearish_ratio, influencer_followers, influencer_impact, event_time) VALUES ${values};`;
}

export function buildGammaInsertSql(rows: StreamGammaDiagnostic[]): string {
  const values = rows
    .map(
      (r) =>
        `(${num(r.id)}, ${lit(r.deviceId)}, ${lit(r.region)}, ${lit(r.metric)}, ${num(r.cpuTemperatureCelsius)}, ${num(r.cpuUtilizationPercent)}, ${num(r.memoryUtilizationPercent)}, ${num(r.networkLatencyMs)}, ${num(r.packetLossPercent)}, ${lit(r.status)}, epoch_ms(${num(r.timestamp)}))`
    )
    .join(", ");
  return `INSERT INTO ${GAMMA_TABLE_NAME} (id, device_id, region, metric, cpu_temperature_celsius, cpu_utilization_percent, memory_utilization_percent, network_latency_ms, packet_loss_percent, status, event_time) VALUES ${values};`;
}

/** Keeps the first row for each key, matching ON CONFLICT DO NOTHING across batches. */
function firstByKey<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const row of rows) {
    const k = key(row);
    if (!seen.has(k)) seen.set(k, row);
  }
  return Array.from(seen.values());
}

function nullableNum(value: number | null): string {
  return value === null ? "NULL" : num(value);
}

function nullableLit(value: string | null): string {
  return value === null ? "NULL" : lit(value);
}

/** Idempotent: a repeated (series_id, event_time) is skipped instead of failing the batch. */
export function buildWorldMetricsInsertSql(rows: WorldMetricRow[]): string {
  const values = firstByKey(rows, (r) => `${r.seriesId}|${r.timestamp}`)
    .map(
      (r) =>
        `(${lit(r.seriesId)}, ${lit(r.category)}, ${lit(r.label)}, ${num(r.value)}, ${nullableNum(r.aux)}, ${lit(r.unit)}, ${lit(r.source)}, ${nullableLit(r.url)}, epoch_ms(${num(r.timestamp)}))`
    )
    .join(", ");
  return `INSERT INTO ${WORLD_METRICS_TABLE} (series_id, category, label, value, aux, unit, source, url, event_time) VALUES ${values} ON CONFLICT DO NOTHING;`;
}

export function buildWorldHeadlinesInsertSql(rows: WorldHeadlineRow[]): string {
  const values = firstByKey(rows, (r) => r.id)
    .map(
      (r) =>
        `(${lit(r.id)}, ${lit(r.category)}, ${lit(r.source)}, ${lit(r.title)}, ${lit(r.url)}, ${num(r.tone)}, ${nullableNum(r.aux)}, epoch_ms(${num(r.timestamp)}))`
    )
    .join(", ");
  return `INSERT INTO ${WORLD_HEADLINES_TABLE} (id, category, source, title, url, tone, aux, event_time) VALUES ${values} ON CONFLICT DO NOTHING;`;
}

export function buildWorldEventsInsertSql(rows: WorldEventRow[]): string {
  const values = firstByKey(rows, (r) => r.id)
    .map(
      (r) =>
        `(${lit(r.id)}, ${lit(r.kind)}, ${lit(r.title)}, ${nullableNum(r.magnitude)}, ${nullableLit(r.unit)}, ${num(r.lat)}, ${num(r.lon)}, ${nullableLit(r.url)}, epoch_ms(${num(r.timestamp)}))`
    )
    .join(", ");
  return `INSERT INTO ${WORLD_EVENTS_TABLE} (id, kind, title, magnitude, unit, lat, lon, url, event_time) VALUES ${values} ON CONFLICT DO NOTHING;`;
}

/** Every INSERT statement needed to persist a batch (empty arrays are skipped). */
export function buildWorldBatchInsertSql(batch: WorldBatch): string[] {
  const statements: string[] = [];
  if (batch.metrics.length > 0) statements.push(buildWorldMetricsInsertSql(batch.metrics));
  if (batch.headlines.length > 0) statements.push(buildWorldHeadlinesInsertSql(batch.headlines));
  if (batch.events.length > 0) statements.push(buildWorldEventsInsertSql(batch.events));
  return statements;
}

/**
 * Retention for the world tables. Slow macro series (annual, monthly) are never
 * evicted; high-frequency series and transient events are.
 */
export function buildWorldEvictionSql(nowMs: number): string[] {
  const day = 86_400_000;
  const at = (offset: number) => `epoch_ms(${Math.trunc(nowMs - offset)})`;
  return [
    `DELETE FROM ${WORLD_METRICS_TABLE} WHERE category IN ('metals', 'crypto', 'weather', 'space', 'politics') AND event_time < ${at(30 * day)};`,
    `DELETE FROM ${WORLD_METRICS_TABLE} WHERE category IN ('fx', 'daily') AND event_time < ${at(400 * day)};`,
    `DELETE FROM ${WORLD_HEADLINES_TABLE} WHERE event_time < ${at(3 * day)};`,
    `DELETE FROM ${WORLD_EVENTS_TABLE} WHERE (id LIKE 'usgs:%' AND event_time < ${at(3 * day)}) OR event_time < ${at(30 * day)};`,
  ];
}
