import type {
  StreamAlphaTick,
  StreamBetaSentiment,
  StreamGammaDiagnostic,
} from "../types/telemetry";

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
