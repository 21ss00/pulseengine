import type { AdviceItem, AdviceSeverity } from "../types/analytics.ts";
import type {
  CrossAssetRow,
  WorldIndex,
  WorldLatestRow,
  WorldSummary,
} from "../types/world.ts";

/**
 * Plain-text observations from the real-world data: what moved, what is
 * unusual, and what the pieces say together. Pure functions of the latest
 * query results so every rule can be tested.
 */

const MIN_MARKET_VOLUME = 500;

const RANK: Record<AdviceSeverity, number> = { critical: 0, warning: 1, watch: 2, info: 3 };

const ASSET_NAMES: Record<string, string> = {
  "daily:BTC": "Bitcoin",
  "daily:ETH": "Ethereum",
  "daily:PAXG": "Gold",
  "fx:DXY": "USD index",
  "fx:EUR": "EUR/USD",
  "fx:JPY": "USD/JPY",
  "fx:GBP": "GBP/USD",
};

function signed(value: number, digits: number, suffix = ""): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

function item(
  id: string,
  severity: AdviceSeverity,
  headline: string,
  detail: string
): AdviceItem {
  return { id: `world-${id}`, severity, stream: "world", headline, detail };
}

function summaryItems(summary: WorldSummary): AdviceItem[] {
  const out: AdviceItem[] = [];

  if (summary.fear_greed !== null) {
    if (summary.fear_greed <= 20) {
      out.push(
        item(
          "fng-fear",
          "watch",
          `Extreme fear in crypto (index ${summary.fear_greed.toFixed(0)})`,
          "Readings this low have often marked capitulation, but they can persist. Watch for stabilising volume before reading it as a turn."
        )
      );
    } else if (summary.fear_greed >= 80) {
      out.push(
        item(
          "fng-greed",
          "watch",
          `Extreme greed in crypto (index ${summary.fear_greed.toFixed(0)})`,
          "Crowded optimism raises the odds of sharp pullbacks. Consider whether risk limits still fit."
        )
      );
    }
  }

  const gold = summary.gold_change_1d_pct;
  if (gold !== null && Math.abs(gold) >= 1.5) {
    out.push(
      item(
        "gold-move",
        "watch",
        `Gold ${gold > 0 ? "up" : "down"} ${Math.abs(gold).toFixed(1)}% today`,
        gold > 0
          ? "A large gold rally usually signals demand for safety or falling real-rate expectations."
          : "A large gold drop usually accompanies a stronger dollar or rising yields."
      )
    );
  }

  if (gold !== null && summary.btc_change_24h_pct !== null && gold >= 1 && summary.btc_change_24h_pct <= -3) {
    out.push(
      item(
        "flight-to-safety",
        "warning",
        "Flight to safety: gold rising while Bitcoin falls",
        `Gold ${signed(gold, 1, "%")} against Bitcoin ${signed(summary.btc_change_24h_pct, 1, "%")} over 24h points to investors trading risk for safety.`
      )
    );
  }

  const usd = summary.dxy_change_30d_pct;
  if (usd !== null && Math.abs(usd) >= 2) {
    out.push(
      item(
        "usd-trend",
        "watch",
        `US dollar ${usd > 0 ? "strengthened" : "weakened"} ${Math.abs(usd).toFixed(1)}% in 30 days`,
        "Large dollar moves tend to ripple into commodities, emerging-market currencies and multinational earnings."
      )
    );
  }

  if (summary.news_tone_24h !== null && summary.news_count_24h >= 10 && summary.news_tone_24h <= -0.35) {
    out.push(
      item(
        "news-negative",
        "watch",
        `News tone is unusually negative (${summary.news_tone_24h.toFixed(2)})`,
        `Across ${summary.news_count_24h} headlines in 24h the wording skews negative, which can weigh on sentiment. The scorer is a word-list heuristic, so read it as a rough gauge.`
      )
    );
  }

  if (summary.max_quake_mag_24h !== null && summary.max_quake_mag_24h >= 6) {
    out.push(
      item(
        "quake",
        "warning",
        `Magnitude ${summary.max_quake_mag_24h.toFixed(1)} earthquake in the last 24h`,
        "Strong quakes can disrupt local supply chains, energy and infrastructure. Check the map for the location."
      )
    );
  }

  if (summary.kp_max_24h !== null && summary.kp_max_24h >= 5) {
    out.push(
      item(
        "geomagnetic",
        summary.kp_max_24h >= 7 ? "critical" : "warning",
        `Geomagnetic storm (Kp ${summary.kp_max_24h.toFixed(1)})`,
        "Elevated solar activity can degrade GPS, radio and satellite links and stress power grids."
      )
    );
  }

  return out;
}

function latestItems(latest: WorldLatestRow[]): AdviceItem[] {
  const out: AdviceItem[] = [];
  const byId = new Map(latest.map((row) => [row.series_id, row]));

  for (const row of latest) {
    if (row.category === "politics") {
      const base = row.d1 ?? row.prev_value;
      // Thin markets can jump on a single trade, so require some real activity.
      const liquid = row.aux !== null && row.aux >= MIN_MARKET_VOLUME;
      if (liquid && base !== null && Math.abs(row.value - base) >= 8) {
        const move = row.value - base;
        out.push(
          item(
            `market-${row.series_id}`,
            "watch",
            `Prediction market moved ${signed(move, 0, " pts")} to ${row.value.toFixed(0)}%`,
            `"${row.label}" (${row.source}) changed ${signed(move, 1, " points")} since the previous reading. Large repricings usually follow news the market considers decisive.`
          )
        );
      }
    }
    if (row.series_id.startsWith("aq:") && row.value >= 150) {
      out.push(
        item(
          `aqi-${row.series_id}`,
          "info",
          `Unhealthy air in ${row.label.replace(" air quality", "")} (AQI ${row.value.toFixed(0)})`,
          "Air quality above 150 is unhealthy for everyone. Sensitive groups should limit time outdoors."
        )
      );
    }
  }

  const bills = byId.get("macro:TBILL");
  const notes = byId.get("macro:TNOTE");
  if (bills && notes && bills.value > notes.value + 0.1) {
    out.push(
      item(
        "yield-inversion",
        "watch",
        "Short-term Treasury rates are above longer-term rates",
        `Average T-bill rate ${bills.value.toFixed(2)}% versus T-notes ${notes.value.toFixed(2)}%. An inverted curve has historically preceded slowdowns, though the lead time varies widely.`
      )
    );
  }
  return out;
}

function crossItems(cross: CrossAssetRow[]): AdviceItem[] {
  const pairs = cross
    .filter((row) => row.x !== row.y && row.corr !== null && row.n >= 20)
    .map((row) => ({ ...row, corr: row.corr as number }))
    .sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr))
    .slice(0, 2);

  return pairs
    .filter((row) => Math.abs(row.corr) >= 0.4)
    .map((row) => {
      const x = ASSET_NAMES[row.x] ?? row.x;
      const y = ASSET_NAMES[row.y] ?? row.y;
      return item(
        `cross-${row.x}-${row.y}`,
        "info",
        `${x} and ${y} are ${row.corr > 0 ? "moving together" : "moving in opposite directions"} (r ${signed(row.corr, 2)})`,
        `Daily returns over ${row.n} days. ${
          row.corr > 0
            ? "Positions in both carry overlapping risk."
            : "Holding both offers some natural hedging."
        } Correlations shift, so re-check regularly.`
      );
    });
}

export function buildWorldAdvice(input: {
  summary: WorldSummary | null;
  latest: WorldLatestRow[];
  index: WorldIndex;
  cross: CrossAssetRow[];
}): AdviceItem[] {
  const items: AdviceItem[] = [];

  if (input.index.coverage >= 0.4) {
    if (input.index.score < 30) {
      items.push(
        item(
          "index-stressed",
          "warning",
          `World mood index is low (${input.index.score}, ${input.index.label})`,
          "Several independent measures point to stress at once. Prioritise liquidity and review exposure to risk assets."
        )
      );
    } else if (input.index.score >= 78) {
      items.push(
        item(
          "index-euphoric",
          "watch",
          `World mood index is very high (${input.index.score}, ${input.index.label})`,
          "Broad optimism can leave little cushion for bad news. Check that positions are not relying on it continuing."
        )
      );
    }
  }

  if (input.summary) items.push(...summaryItems(input.summary));
  items.push(...latestItems(input.latest));
  items.push(...crossItems(input.cross));

  if (items.length === 0) {
    items.push(
      item(
        "calm",
        "info",
        "No notable world-data signals right now",
        "Markets, news, hazards and prediction markets are all within their usual ranges."
      )
    );
  }

  return items.sort((a, b) => RANK[a.severity] - RANK[b.severity]).slice(0, 12);
}
