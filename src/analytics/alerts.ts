import type { KpiSnapshot, ThresholdAlert, TrendTag } from "../types/analytics";

export const SENTIMENT_ALERT_THRESHOLD = -0.5;
export const CPU_ALERT_THRESHOLD_C = 85;

/** Threshold checks run on the last 15s of data, independent of the chart range. */
export function evaluateAlerts(kpi: KpiSnapshot | null): ThresholdAlert[] {
  if (!kpi) return [];
  const alerts: ThresholdAlert[] = [];

  if (kpi.alert_min_sentiment !== null && kpi.alert_min_sentiment < SENTIMENT_ALERT_THRESHOLD) {
    alerts.push({
      id: "sentiment",
      message: `Sentiment on ${kpi.alert_min_topic ?? "a topic"} fell to ${kpi.alert_min_sentiment.toFixed(2)} (below ${SENTIMENT_ALERT_THRESHOLD})`,
    });
  }
  if (kpi.alert_peak_cpu !== null && kpi.alert_peak_cpu > CPU_ALERT_THRESHOLD_C) {
    alerts.push({
      id: "cpu",
      message: `${kpi.alert_peak_device ?? "A device"} CPU at ${kpi.alert_peak_cpu.toFixed(1)}°C (above ${CPU_ALERT_THRESHOLD_C}°C)`,
    });
  }
  return alerts;
}

/**
 * Builds the change tag shown on a KPI card. `percent` compares relative to
 * the previous value; `absolute` suits values that hover around zero.
 */
export function trendTag(
  current: number | null,
  previous: number | null,
  mode: "percent" | "absolute",
  upIsGood: boolean
): TrendTag | null {
  if (current === null || previous === null) return null;

  let change: number;
  let text: (magnitude: number) => string;
  if (mode === "percent") {
    if (previous === 0) return null;
    change = ((current - previous) / Math.abs(previous)) * 100;
    text = (magnitude) => `${magnitude.toFixed(1)}%`;
  } else {
    change = current - previous;
    text = (magnitude) => magnitude.toFixed(2);
  }

  const flatBelow = mode === "percent" ? 0.05 : 0.005;
  if (Math.abs(change) < flatBelow) {
    return { text: `${text(0)} ▬`, direction: "flat", tone: "neutral" };
  }

  const up = change > 0;
  const sign = up ? "+" : "-";
  return {
    text: `${sign}${text(Math.abs(change))} ${up ? "▲" : "▼"}`,
    direction: up ? "up" : "down",
    tone: up === upIsGood ? "good" : "bad",
  };
}
