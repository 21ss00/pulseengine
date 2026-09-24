import type {
  AdviceItem,
  AdviceSeverity,
  AlphaSignalRow,
  CorrelationRow,
  ForecastSnapshot,
  GammaSignalRow,
  BetaSignalRow,
  TrendRow,
} from "../types/analytics";

/**
 * Turns the raw forecasting snapshot into plain-text advice and anomaly
 * warnings. Everything here is a pure function of the snapshot, so the rules
 * are easy to test and tune. Signals are statistical, not investment advice.
 */

const THROTTLE_C = 85;
const MAX_ITEMS = 14;

const SEVERITY_RANK: Record<AdviceSeverity, number> = {
  critical: 0,
  warning: 1,
  watch: 2,
  info: 3,
};

function price(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(3);
  return value.toFixed(5);
}

function signed(value: number, digits: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function trendItems(snapshot: ForecastSnapshot): AdviceItem[] {
  const tNow = (snapshot.generatedAt - snapshot.trendCutoffMs) / 1000;
  const scored = snapshot.trends
    .filter((t) => t.n >= 20 && t.r2 !== null && t.r2 >= 0.6 && t.last_price > 0)
    .map((t) => ({ t, pct: ((t.slope * 60) / t.last_price) * 100 }))
    .filter(({ pct }) => Math.abs(pct) >= 1)
    .sort((a, b) => Math.abs(b.pct) * (b.t.r2 ?? 0) - Math.abs(a.pct) * (a.t.r2 ?? 0))
    .slice(0, 3);

  return scored.map(({ t, pct }) => {
    const projected = t.intercept + t.slope * (tNow + 30);
    const up = pct > 0;
    return {
      id: `trend-${t.symbol}`,
      severity: "watch",
      stream: "alpha",
      headline: `${t.symbol} trending ${up ? "up" : "down"} ${signed(pct, 2)}%/min`,
      detail: `60s regression (R² ${(t.r2 ?? 0).toFixed(2)}, ${t.n} ticks) projects ${price(projected)} in 30s versus ${price(t.last_price)} now. Bias is ${up ? "bullish" : "bearish"}; wait for the SMA crossover and order-book imbalance to agree before acting on it.`,
    };
  });
}

function direction(value: number, threshold: number): number {
  if (value >= threshold) return 1;
  if (value <= -threshold) return -1;
  return 0;
}

function alphaItems(
  rows: AlphaSignalRow[],
  trends: TrendRow[]
): AdviceItem[] {
  const items: AdviceItem[] = [];
  const trendBySymbol = new Map(trends.map((t) => [t.symbol, t]));

  for (const row of rows) {
    const votes: number[] = [];
    const trend = trendBySymbol.get(row.symbol);
    if (trend && trend.r2 !== null && trend.r2 >= 0.6 && trend.n >= 20) {
      votes.push(direction(((trend.slope * 60) / trend.last_price) * 100, 1));
    }
    if (row.obi !== null) votes.push(direction(row.obi, 0.15));
    if (row.sma10 !== null && row.sma60 !== null && row.n_sec >= 60) {
      votes.push(direction(((row.sma10 - row.sma60) / row.price) * 100, 0.05));
    }
    const bullish = votes.filter((v) => v > 0).length;
    const bearish = votes.filter((v) => v < 0).length;
    if (bullish >= 3 || bearish >= 3) {
      const up = bullish >= 3;
      items.push({
        id: `confluence-${row.symbol}`,
        severity: "warning",
        stream: "alpha",
        headline: `${row.symbol} ${up ? "bullish" : "bearish"} confluence`,
        detail: `Regression slope, order-book imbalance and the 10s/60s SMA all point ${up ? "up" : "down"}. Independent signals agreeing is a stronger setup than any one alone; size risk accordingly.`,
      });
    }

    if (row.cross_recent !== 0 && row.n_sec >= 60 && row.sma10 !== null && row.sma60 !== null) {
      const golden = row.cross_recent > 0;
      items.push({
        id: `cross-${row.symbol}`,
        severity: "watch",
        stream: "alpha",
        headline: `${row.symbol} ${golden ? "golden" : "death"} cross`,
        detail: `The 10s SMA (${price(row.sma10)}) crossed ${golden ? "above" : "below"} the 60s SMA (${price(row.sma60)}) within the last 30s, a short-term ${golden ? "bullish" : "bearish"} momentum shift.`,
      });
    }

    if (row.bb_mid !== null && row.bb_sd !== null && row.bb_sd > 0 && row.n_sec >= 20) {
      const z = (row.price - row.bb_mid) / row.bb_sd;
      if (Math.abs(z) >= 2) {
        items.push({
          id: `bollinger-${row.symbol}`,
          severity: "watch",
          stream: "alpha",
          headline: `${row.symbol} outside Bollinger band (z ${signed(z, 1)})`,
          detail: `Price ${price(row.price)} sits ${z > 0 ? "above the upper" : "below the lower"} 20s band (mid ${price(row.bb_mid)}). Stretched moves often mean-revert, so avoid chasing without volume confirmation.`,
        });
      }
    }

    if (row.obi !== null && Math.abs(row.obi) >= 0.3) {
      const bid = row.obi > 0;
      items.push({
        id: `obi-${row.symbol}`,
        severity: "watch",
        stream: "alpha",
        headline: `${row.symbol} order book ${bid ? "bid" : "ask"}-heavy (OBI ${signed(row.obi, 2)})`,
        detail: `Resting size over the last 10s is skewed toward the ${bid ? "buy" : "sell"} side, which tends to precede a short-term move ${bid ? "up" : "down"}.`,
      });
    }
  }
  return items;
}

function betaItems(rows: BetaSignalRow[]): AdviceItem[] {
  const items: AdviceItem[] = [];
  for (const row of rows) {
    const now = row.velocity_now ?? 0;
    const avg = row.velocity_avg ?? 0;
    if (avg >= 1 && now >= 20 && now / avg >= 2.5) {
      items.push({
        id: `surge-${row.topic}`,
        severity: "watch",
        stream: "beta",
        headline: `Social volume surge on ${row.topic} (x${(now / avg).toFixed(1)})`,
        detail: `${now.toFixed(0)} posts/s against a ${avg.toFixed(0)} posts/s 60s baseline, influencer impact ${signed(row.impact ?? 0, 2)}. Expect elevated volatility around ${row.topic} over the next ~30s.`,
      });
    }
    if (row.weighted_sentiment !== null && row.weighted_sentiment <= -0.5) {
      items.push({
        id: `bearish-${row.topic}`,
        severity: "warning",
        stream: "beta",
        headline: `Bearish influencer sentiment on ${row.topic} (${row.weighted_sentiment.toFixed(2)})`,
        detail: `Follower-weighted sentiment is well below the raw average of ${(row.sentiment_avg ?? 0).toFixed(2)}, so large accounts are more negative than the crowd. Review exposure tied to ${row.topic}.`,
      });
    }
  }
  return items;
}

/** Seconds until the exponential thermal fit reaches the throttle point, if it is climbing. */
export function throttleEtaSeconds(row: GammaSignalRow, tNowSeconds: number): number | null {
  if (
    row.temp_growth_k === null ||
    row.temp_intercept === null ||
    row.temp_r2 === null ||
    row.temp_growth_k <= 0.002 ||
    row.temp_r2 < 0.6
  ) {
    return null;
  }
  const eta = (Math.log(THROTTLE_C) - row.temp_intercept) / row.temp_growth_k - tNowSeconds;
  return eta > 0 ? eta : null;
}

/** Minutes until memory hits 100% at the fitted leak rate, if it is leaking. */
export function memoryEtaMinutes(row: GammaSignalRow): number | null {
  if (
    row.leak_rate_per_min === null ||
    row.mem_r2 === null ||
    row.mem_now === null ||
    row.leak_rate_per_min < 1 ||
    row.mem_r2 < 0.6 ||
    row.mem_now >= 100
  ) {
    return null;
  }
  return (100 - row.mem_now) / row.leak_rate_per_min;
}

function gammaItems(rows: GammaSignalRow[], snapshot: ForecastSnapshot): AdviceItem[] {
  const items: AdviceItem[] = [];
  const tNow = (snapshot.generatedAt - snapshot.gammaCutoffMs) / 1000;

  for (const row of rows) {
    if (row.status === "offline") continue;

    if (row.status === "throttled" || (row.temp_now ?? 0) >= THROTTLE_C) {
      items.push({
        id: `throttled-${row.device_id}`,
        severity: "critical",
        stream: "gamma",
        headline: `${row.device_id} is thermally throttling (${(row.temp_now ?? 0).toFixed(1)}°C)`,
        detail: `CPU temperature is at or above the ${THROTTLE_C}°C throttle point. Shed load or fail workloads over to a cooler node and check airflow.`,
      });
      continue;
    }

    const etaSeconds = throttleEtaSeconds(row, tNow);
    if (etaSeconds !== null && etaSeconds <= 300) {
      items.push({
        id: `heat-${row.device_id}`,
        severity: etaSeconds <= 60 ? "critical" : "warning",
        stream: "gamma",
        headline: `${row.device_id} predicted to throttle in ~${Math.round(etaSeconds)}s`,
        detail: `Temperature is growing exponentially at ${((row.temp_growth_k ?? 0) * 100).toFixed(2)}%/s (R² ${(row.temp_r2 ?? 0).toFixed(2)}, now ${(row.temp_now ?? 0).toFixed(1)}°C). Move work off this node or raise cooling before it reaches ${THROTTLE_C}°C.`,
      });
    }

    const etaMinutes = memoryEtaMinutes(row);
    if (etaMinutes !== null && etaMinutes <= 30) {
      items.push({
        id: `leak-${row.device_id}`,
        severity: etaMinutes <= 5 ? "critical" : etaMinutes <= 15 ? "warning" : "watch",
        stream: "gamma",
        headline: `${row.device_id} leaking memory ${(row.leak_rate_per_min ?? 0).toFixed(1)}%/min`,
        detail: `Memory is at ${(row.mem_now ?? 0).toFixed(0)}% and would be exhausted in about ${etaMinutes.toFixed(1)} min at this slope. Schedule a restart or profile the process for the leak.`,
      });
    }
  }
  return items;
}

type Lag = 10 | 30 | 60;
const LAGS: Lag[] = [10, 30, 60];

function corrAt(row: CorrelationRow, kind: "sent" | "vol", lag: Lag): { r: number | null; n: number } {
  const r = row[`${kind}_c${lag}` as keyof CorrelationRow] as number | null;
  const n = row[`n${lag}` as keyof CorrelationRow] as number;
  return { r, n };
}

/** A correlation counts only if it clears an absolute floor and a ~99% sample-size bar. */
export function isSignificant(r: number | null, n: number): boolean {
  if (r === null || n < 12) return false;
  return Math.abs(r) >= Math.max(0.3, 2.6 / Math.sqrt(n));
}

function crossItems(rows: CorrelationRow[]): AdviceItem[] {
  const items: AdviceItem[] = [];
  let sentimentLeaders = 0;

  for (const row of rows) {
    let best: { lag: Lag; r: number; n: number } | null = null;
    for (const lag of LAGS) {
      const { r, n } = corrAt(row, "sent", lag);
      if (r !== null && isSignificant(r, n) && (!best || Math.abs(r) > Math.abs(best.r))) {
        best = { lag, r, n };
      }
    }
    if (best) {
      sentimentLeaders++;
      const positive = best.r > 0;
      items.push({
        id: `lead-sent-${row.symbol}`,
        severity: "watch",
        stream: "cross",
        headline: `Sentiment ${positive ? "leads" : "inversely leads"} ${row.symbol} by ~${best.lag}s (r ${signed(best.r, 2)})`,
        detail: `Across ${best.n} five-second samples, sentiment changes were followed by ${positive ? "price moves in the same direction" : "price moves in the opposite direction"} over ${best.lag}s. Treat as a hint, not a guarantee: correlations drift.`,
      });
    }

    let bestVol: { lag: Lag; r: number; n: number } | null = null;
    for (const lag of LAGS) {
      const { r, n } = corrAt(row, "vol", lag);
      if (r !== null && r > 0 && isSignificant(r, n) && (!bestVol || r > bestVol.r)) {
        bestVol = { lag, r, n };
      }
    }
    if (bestVol) {
      items.push({
        id: `lead-vol-${row.symbol}`,
        severity: "watch",
        stream: "cross",
        headline: `Social volume spikes precede ${row.symbol} volatility by ~${bestVol.lag}s (r ${signed(bestVol.r, 2)})`,
        detail: `Jumps in post volume were followed by larger price swings over ${bestVol.lag}s (${bestVol.n} samples). Consider widening risk limits when volume surges.`,
      });
    }
  }

  if (rows.length > 0) {
    items.push({
      id: "lead-summary",
      severity: sentimentLeaders >= 2 ? "warning" : "info",
      stream: "cross",
      headline:
        sentimentLeaders >= 2
          ? `Social sentiment is acting as a leading indicator (${sentimentLeaders} of ${rows.length} symbols)`
          : "No consistent social lead over price at 10s/30s/60s",
      detail:
        sentimentLeaders >= 2
          ? "Multiple symbols show a statistically significant link between sentiment changes and later price moves. Weight sentiment shifts more heavily in short-horizon decisions."
          : "Correlations between sentiment or volume and forward returns are not significant for enough symbols. Do not treat social signals as predictive yet.",
    });
  }
  return items;
}

export function buildAdvice(snapshot: ForecastSnapshot | null): AdviceItem[] {
  if (!snapshot) {
    return [
      {
        id: "warming-up",
        severity: "info",
        stream: "system",
        headline: "Collecting data for the first forecast",
        detail: "Trend fits need about a minute of ticks and correlations need a few minutes. Signals appear as the buffer fills.",
      },
    ];
  }

  const items = [
    ...gammaItems(snapshot.gamma, snapshot),
    ...alphaItems(snapshot.alpha, snapshot.trends),
    ...trendItems(snapshot),
    ...betaItems(snapshot.beta),
    ...crossItems(snapshot.correlations),
  ];

  const actionable = items.filter((item) => item.id !== "lead-summary");
  if (actionable.length === 0) {
    items.unshift({
      id: "all-clear",
      severity: "info",
      stream: "system",
      headline: "All monitored signals are within normal ranges",
      detail: "No trend, indicator, social or hardware thresholds are currently breached.",
    });
  }

  return items
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, MAX_ITEMS);
}
