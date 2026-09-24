/**
 * PulseEngine telemetry contract.
 *
 * Three independent streams feed the DuckDB-backed pipeline:
 *   Alpha - market financial ticks
 *   Beta  - social sentiment tracking
 *   Gamma - IoT system diagnostics
 */

export type TelemetryStreamId = "alpha" | "beta" | "gamma";

export type MarketExchange = "NASDAQ" | "NYSE" | "ARCA" | "BATS" | "COINBASE";

export type SentimentPlatform =
  | "twitter"
  | "reddit"
  | "stocktwits"
  | "news"
  | "discord";

export type DiagnosticRegion =
  | "us-east"
  | "us-west"
  | "eu-central"
  | "ap-southeast";

export type DiagnosticMetric = "cpu" | "memory" | "network" | "disk";

export type DiagnosticStatus = "nominal" | "warning" | "throttled" | "offline";

/**
 * Stream Alpha - a single market financial tick for a tracked symbol.
 */
export interface StreamAlphaTick {
  id: number;
  symbol: string;
  exchange: MarketExchange;
  price: number;
  previousClose: number;
  changePercent: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  spread: number;
  volume: number;
  volatility: number;
  timestamp: number;
}

/**
 * Stream Beta - a single social sentiment sample for a tracked topic.
 */
export interface StreamBetaSentiment {
  id: number;
  platform: SentimentPlatform;
  topic: string;
  sentimentScore: number;
  mentionVolume: number;
  engagementRate: number;
  bullishRatio: number;
  bearishRatio: number;
  influencerFollowers: number;
  influencerImpact: number;
  timestamp: number;
}

/**
 * Stream Gamma - a single IoT system diagnostic reading for a tracked device.
 */
export interface StreamGammaDiagnostic {
  id: number;
  deviceId: string;
  region: DiagnosticRegion;
  metric: DiagnosticMetric;
  cpuTemperatureCelsius: number;
  cpuUtilizationPercent: number;
  memoryUtilizationPercent: number;
  networkLatencyMs: number;
  packetLossPercent: number;
  status: DiagnosticStatus;
  timestamp: number;
}

export interface TelemetryEnvelope<
  TStream extends TelemetryStreamId,
  TPayload
> {
  stream: TStream;
  payload: TPayload;
}

export type AlphaEnvelope = TelemetryEnvelope<"alpha", StreamAlphaTick>;
export type BetaEnvelope = TelemetryEnvelope<"beta", StreamBetaSentiment>;
export type GammaEnvelope = TelemetryEnvelope<"gamma", StreamGammaDiagnostic>;

/**
 * A single event emitted by the synthetic traffic generator, tagged by
 * its origin stream so downstream consumers can discriminate on `stream`.
 */
export type TelemetryEvent = AlphaEnvelope | BetaEnvelope | GammaEnvelope;

export interface TelemetryIngestCounters {
  alpha: number;
  beta: number;
  gamma: number;
}

export {
  ALPHA_TABLE_NAME,
  BETA_TABLE_NAME,
  GAMMA_TABLE_NAME,
} from "../analytics/schema";
export type { TelemetryTableName } from "../analytics/schema";
