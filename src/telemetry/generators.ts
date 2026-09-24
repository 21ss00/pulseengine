import type {
  AlphaEnvelope,
  BetaEnvelope,
  DiagnosticMetric,
  DiagnosticRegion,
  DiagnosticStatus,
  GammaEnvelope,
  MarketExchange,
  SentimentPlatform,
  StreamAlphaTick,
  StreamBetaSentiment,
  StreamGammaDiagnostic,
} from "../types/telemetry";

interface AlphaSeed {
  symbol: string;
  exchange: MarketExchange;
  basePrice: number;
}

export const SYNTHETIC_ALPHA_SEEDS: AlphaSeed[] = [
  { symbol: "AAPL", exchange: "NASDAQ", basePrice: 189.42 },
  { symbol: "MSFT", exchange: "NASDAQ", basePrice: 421.18 },
  { symbol: "NVDA", exchange: "NASDAQ", basePrice: 118.76 },
  { symbol: "TSLA", exchange: "NASDAQ", basePrice: 246.33 },
  { symbol: "AMZN", exchange: "NASDAQ", basePrice: 187.05 },
  { symbol: "JPM", exchange: "NYSE", basePrice: 213.9 },
];

export const SYNTHETIC_BETA_TOPICS = [
  "$AAPL",
  "$MSFT",
  "$NVDA",
  "$TSLA",
  "$AMZN",
  "$JPM",
  "MarketOutlook",
  "FedPolicy",
];

export const COINBASE_BETA_TOPICS = [
  "$BTC",
  "$ETH",
  "$SOL",
  "$XRP",
  "$DOGE",
  "$LTC",
  "$PAXG",
  "$LINK",
  "MarketOutlook",
  "RegulationNews",
];

const BETA_PLATFORMS: SentimentPlatform[] = [
  "twitter",
  "reddit",
  "stocktwits",
  "news",
  "discord",
];

const GAMMA_REGIONS: DiagnosticRegion[] = [
  "us-east",
  "us-west",
  "eu-central",
  "ap-southeast",
];

const GAMMA_METRICS: DiagnosticMetric[] = ["cpu", "memory", "network", "disk"];

const GAMMA_DEVICE_COUNT = 12;
export const THROTTLE_TEMPERATURE_C = 85;

/** How far behind sentiment the synthetic price response runs. */
const SENTIMENT_PRICE_LAG_MS = 20_000;

export interface GeneratorOptions {
  now?: () => number;
  random?: () => number;
  betaTopics?: string[];
}

export interface TelemetryGenerators {
  nextId: () => number;
  alpha: () => AlphaEnvelope;
  beta: () => BetaEnvelope;
  gamma: () => GammaEnvelope;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

interface AlphaState {
  price: number;
  previousClose: number;
  regimeDrift: number;
}

interface SentimentSample {
  t: number;
  score: number;
}

type DeviceProfile = "stable" | "heater" | "leaker" | "flaky";

interface DeviceState {
  id: string;
  region: DiagnosticRegion;
  profile: DeviceProfile;
  cycleStart: number;
  baseTemp: number;
  growthPerSecond: number;
  leakPerMinute: number;
  baseMemory: number;
  temperature: number;
  cpuUtilization: number;
  memory: number;
  latency: number;
  offlineUntil: number;
}

export function createTelemetryGenerators(
  options: GeneratorOptions = {}
): TelemetryGenerators {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const betaTopics = options.betaTopics ?? SYNTHETIC_BETA_TOPICS;

  const between = (min: number, max: number) => random() * (max - min) + min;
  const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)];

  let counter = 0;
  const nextId = () => {
    counter += 1;
    return counter;
  };

  const sentimentLevel = new Map<string, number>(
    betaTopics.map((topic) => [topic, between(-0.2, 0.2)])
  );
  const sentimentHistory = new Map<string, SentimentSample[]>();
  const burstUntil = new Map<string, number>();

  function laggedSentiment(topic: string, lagMs: number): number {
    const history = sentimentHistory.get(topic);
    if (!history || history.length === 0) return 0;
    const target = now() - lagMs;
    let found = 0;
    for (const sample of history) {
      if (sample.t <= target) found = sample.score;
      else break;
    }
    return found;
  }

  const alphaState = new Map<string, AlphaState>(
    SYNTHETIC_ALPHA_SEEDS.map((seed) => [
      seed.symbol,
      { price: seed.basePrice, previousClose: seed.basePrice, regimeDrift: 0 },
    ])
  );

  const alpha = (): AlphaEnvelope => {
    const seed = pick(SYNTHETIC_ALPHA_SEEDS);
    const state = alphaState.get(seed.symbol)!;
    const unit = seed.basePrice * 0.001;

    const volatilityBoost =
      (burstUntil.get(`$${seed.symbol}`) ?? 0) + 12_000 > now() ? 2.5 : 1;
    const noise = between(-1.2, 1.2) * unit * volatilityBoost;
    const sentimentPush =
      laggedSentiment(`$${seed.symbol}`, SENTIMENT_PRICE_LAG_MS) * 0.6 * unit;
    state.regimeDrift =
      0.995 * state.regimeDrift + between(-0.01, 0.01) * unit;
    const reversion = -0.001 * (state.price - seed.basePrice);

    const nextPrice = clamp(
      state.price + noise + sentimentPush + state.regimeDrift + reversion,
      seed.basePrice * 0.85,
      seed.basePrice * 1.15
    );
    state.price = nextPrice;

    const imbalance = clamp(
      Math.tanh((state.regimeDrift / unit) * 1.5) + between(-0.35, 0.35),
      -0.9,
      0.9
    );
    const baseSize = between(2, 40);
    const spread = between(0.01, 0.12) * (seed.basePrice / 200);

    const payload: StreamAlphaTick = {
      id: nextId(),
      symbol: seed.symbol,
      exchange: seed.exchange,
      price: round(nextPrice, 4),
      previousClose: round(state.previousClose, 4),
      changePercent: round(
        ((nextPrice - state.previousClose) / state.previousClose) * 100,
        4
      ),
      bid: round(nextPrice - spread / 2, 4),
      ask: round(nextPrice + spread / 2, 4),
      bidSize: round(baseSize * (1 + imbalance) + 0.1, 3),
      askSize: round(baseSize * (1 - imbalance) + 0.1, 3),
      spread: round(spread, 4),
      volume: Math.round(between(50, 5000)),
      volatility: round(between(0.05, 2.5), 4),
      timestamp: now(),
    };
    return { stream: "alpha", payload };
  };

  const beta = (): BetaEnvelope => {
    const t = now();
    const topic = pick(betaTopics);
    let level = sentimentLevel.get(topic) ?? 0;
    level = clamp(0.985 * level + between(-0.07, 0.07), -1, 1);

    if (random() < 0.012) {
      const direction = random() < 0.5 ? -1 : 1;
      level = clamp(level + direction * between(0.35, 0.7), -1, 1);
      burstUntil.set(topic, t + 8000);
    }
    sentimentLevel.set(topic, level);

    const history = sentimentHistory.get(topic) ?? [];
    history.push({ t, score: level });
    while (history.length > 0 && history[0].t < t - 90_000) history.shift();
    sentimentHistory.set(topic, history);

    const bursting = (burstUntil.get(topic) ?? 0) > t;
    const followers = Math.round(
      Math.exp(between(Math.log(100), Math.log(5_000_000)))
    );
    const engagementRate = between(0.5, 12);
    const bullishRatio = clamp((level + 1) / 2 + between(-0.05, 0.05), 0, 1);

    const payload: StreamBetaSentiment = {
      id: nextId(),
      platform: pick(BETA_PLATFORMS),
      topic,
      sentimentScore: round(level, 4),
      mentionVolume: Math.round(between(1, 40) * (bursting ? 6 : 1)),
      engagementRate: round(engagementRate, 4),
      bullishRatio: round(bullishRatio, 4),
      bearishRatio: round(1 - bullishRatio, 4),
      influencerFollowers: followers,
      influencerImpact: round(
        level * Math.log10(followers + 1) * (engagementRate / 10),
        4
      ),
      timestamp: t,
    };
    return { stream: "beta", payload };
  };

  const profiles: DeviceProfile[] = ["stable", "heater", "leaker", "flaky"];
  const devices: DeviceState[] = Array.from(
    { length: GAMMA_DEVICE_COUNT },
    (_, index) => {
      const profile = profiles[index % profiles.length];
      const start = now() - between(0, 60_000);
      return {
        id: `edge-node-${String(index + 1).padStart(2, "0")}`,
        region: GAMMA_REGIONS[index % GAMMA_REGIONS.length],
        profile,
        cycleStart: start,
        baseTemp: between(40, 46),
        growthPerSecond: between(0.0085, 0.0115),
        leakPerMinute: between(4, 10),
        baseMemory: between(25, 40),
        temperature: between(48, 58),
        cpuUtilization: between(20, 50),
        memory: between(30, 55),
        latency: between(5, 40),
        offlineUntil: 0,
      };
    }
  );

  const gamma = (): GammaEnvelope => {
    const t = now();
    const device = pick(devices);

    if (device.profile === "heater") {
      const elapsedSeconds = (t - device.cycleStart) / 1000;
      device.temperature =
        device.baseTemp * Math.exp(device.growthPerSecond * elapsedSeconds) +
        between(-0.6, 0.6);
      if (device.temperature > 97) {
        device.cycleStart = t;
        device.baseTemp = between(40, 46);
        device.temperature = device.baseTemp;
      }
    } else {
      device.temperature = clamp(
        device.temperature + (52 - device.temperature) * 0.05 + between(-1.2, 1.2),
        38,
        70
      );
    }

    if (device.profile === "leaker") {
      const elapsedMinutes = (t - device.cycleStart) / 60_000;
      device.memory = device.baseMemory + device.leakPerMinute * elapsedMinutes + between(-0.3, 0.3);
      if (device.memory >= 99) {
        device.cycleStart = t;
        device.baseMemory = between(25, 40);
        device.memory = device.baseMemory;
      }
    } else {
      device.memory = clamp(device.memory + (45 - device.memory) * 0.03 + between(-2, 2), 10, 75);
    }

    device.cpuUtilization = clamp(device.cpuUtilization + between(-4, 4), 5, 100);
    device.latency = clamp(device.latency + between(-3, 3), 1, 300);

    if (device.profile === "flaky" && t >= device.offlineUntil && random() < 0.02) {
      device.offlineUntil = t + between(8_000, 20_000);
    }

    const packetLoss = clamp(
      between(0, 0.5) + (device.latency > 150 ? 1.5 : 0),
      0,
      8
    );

    let status: DiagnosticStatus = "nominal";
    if (device.temperature >= THROTTLE_TEMPERATURE_C) {
      status = "throttled";
    } else if (
      device.temperature > 72 ||
      device.memory > 88 ||
      device.latency > 120 ||
      packetLoss > 4
    ) {
      status = "warning";
    }
    if (t < device.offlineUntil) status = "offline";

    const payload: StreamGammaDiagnostic = {
      id: nextId(),
      deviceId: device.id,
      region: device.region,
      metric: pick(GAMMA_METRICS),
      cpuTemperatureCelsius: round(device.temperature, 2),
      cpuUtilizationPercent: round(device.cpuUtilization, 2),
      memoryUtilizationPercent: round(device.memory, 2),
      networkLatencyMs: round(device.latency, 2),
      packetLossPercent: round(packetLoss, 3),
      status,
      timestamp: t,
    };
    return { stream: "gamma", payload };
  };

  return { nextId, alpha, beta, gamma };
}
