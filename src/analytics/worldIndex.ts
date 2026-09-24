import type { WorldIndex, WorldIndexComponent, WorldSummary } from "../types/world.ts";

/**
 * A transparent composite "world mood" score from 0 (stressed) to 100
 * (euphoric). Each component maps one real observation onto the same 0-100
 * scale; missing components are skipped and the weights renormalised, with
 * `coverage` reporting how much of the weight was available.
 */

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function signed(value: number, digits: number, suffix = ""): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

export function labelFor(score: number): WorldIndex["label"] {
  if (score < 25) return "Stressed";
  if (score < 45) return "Cautious";
  if (score < 60) return "Neutral";
  if (score < 75) return "Confident";
  return "Euphoric";
}

export function computeWorldIndex(summary: WorldSummary | null): WorldIndex {
  const components: WorldIndexComponent[] = [];
  if (summary) {
    if (summary.fear_greed !== null) {
      components.push({
        id: "fng",
        label: "Crypto fear & greed",
        score: clamp(summary.fear_greed),
        weight: 0.25,
        detail: `index ${summary.fear_greed.toFixed(0)}`,
      });
    }
    if (summary.gold_change_1d_pct !== null) {
      components.push({
        id: "gold",
        label: "Gold move (safe haven)",
        score: clamp(50 - summary.gold_change_1d_pct * 15),
        weight: 0.15,
        detail: `${signed(summary.gold_change_1d_pct, 2, "%")} today`,
      });
    }
    if (summary.dxy_change_30d_pct !== null) {
      components.push({
        id: "usd",
        label: "US dollar strength",
        score: clamp(50 - summary.dxy_change_30d_pct * 10),
        weight: 0.15,
        detail: `${signed(summary.dxy_change_30d_pct, 2, "%")} over 30d`,
      });
    }
    if (summary.btc_change_24h_pct !== null) {
      components.push({
        id: "btc",
        label: "Bitcoin momentum",
        score: clamp(50 + summary.btc_change_24h_pct * 5),
        weight: 0.15,
        detail: `${signed(summary.btc_change_24h_pct, 2, "%")} 24h`,
      });
    }
    if (summary.news_tone_24h !== null && summary.news_count_24h >= 5) {
      components.push({
        id: "news",
        label: "News tone",
        score: clamp(50 + summary.news_tone_24h * 80),
        weight: 0.15,
        detail: `${signed(summary.news_tone_24h, 2)} over ${summary.news_count_24h} headlines`,
      });
    }
    if (summary.social_tone_1h !== null && summary.social_posts_1h >= 10) {
      components.push({
        id: "social",
        label: "Social tone",
        score: clamp(50 + summary.social_tone_1h * 80),
        weight: 0.05,
        detail: `${signed(summary.social_tone_1h, 2)} over ${summary.social_posts_1h} posts`,
      });
    }
    const penalty =
      12 * summary.quakes_m55_24h +
      ((summary.kp_max_24h ?? 0) >= 5 ? 15 : 0) +
      Math.min(15, summary.open_hazards * 0.5);
    components.push({
      id: "hazards",
      label: "Physical hazards",
      score: clamp(100 - penalty),
      weight: 0.1,
      detail: `${summary.quakes_m55_24h} quakes M5.5+, Kp ${(summary.kp_max_24h ?? 0).toFixed(1)}, ${summary.open_hazards} open events`,
    });
  }

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const score =
    totalWeight > 0
      ? components.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight
      : 50;

  return {
    score: Math.round(score),
    label: labelFor(score),
    components,
    coverage: Number(totalWeight.toFixed(2)),
  };
}
