import type { WorldMetricRow } from "../types/world.ts";
import {
  DXY_CONSTANT,
  DXY_SERIES_ID,
  DXY_WEIGHTS,
  FX_CURRENCIES,
  METALS,
  WORLD_BANK_COUNTRIES,
} from "./constants.ts";

type Json = Record<string, unknown>;

function num(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function isoDayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function metric(
  row: Omit<WorldMetricRow, "aux" | "url"> & { aux?: number | null; url?: string | null }
): WorldMetricRow {
  return { aux: null, url: null, ...row };
}

// FX -------------------------------------------------------------------

function ratesByDate(json: Json): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  const rates = json.rates as Json | undefined;
  if (!rates) return out;
  if (typeof json.date === "string" && Object.values(rates).every((v) => typeof v === "number")) {
    out.set(json.date, rates as Record<string, number>);
    return out;
  }
  for (const [date, row] of Object.entries(rates)) {
    if (row && typeof row === "object") out.set(date, row as Record<string, number>);
  }
  return out;
}

/** ICE dollar index formula applied to USD-based rates. */
export function dollarIndex(rates: Record<string, number>): number | null {
  let value = DXY_CONSTANT;
  for (const { code, weight, invert } of DXY_WEIGHTS) {
    const rate = rates[code];
    if (typeof rate !== "number" || rate <= 0) return null;
    value *= Math.pow(invert ? 1 / rate : rate, weight);
  }
  return value;
}

/** Handles both `/latest` (single date) and `/{start}..` (time series) responses. */
export function parseFrankfurter(json: Json): WorldMetricRow[] {
  const out: WorldMetricRow[] = [];
  for (const [date, rates] of ratesByDate(json)) {
    const timestamp = isoDayMs(date);
    for (const { code, pair, invert } of FX_CURRENCIES) {
      const rate = rates[code];
      if (typeof rate !== "number" || rate <= 0) continue;
      out.push(
        metric({
          seriesId: `fx:${code}`,
          category: "fx",
          label: pair,
          value: invert ? 1 / rate : rate,
          unit: "rate",
          source: "Frankfurter (ECB)",
          url: "https://frankfurter.dev",
          timestamp,
        })
      );
    }
    const index = dollarIndex(rates);
    if (index !== null) {
      out.push(
        metric({
          seriesId: DXY_SERIES_ID,
          category: "fx",
          label: "USD Index",
          value: index,
          unit: "index",
          source: "Frankfurter (ECB), ICE formula",
          url: "https://frankfurter.dev",
          timestamp,
        })
      );
    }
  }
  return out;
}

// Metals ---------------------------------------------------------------

export function parseGoldApi(json: Json, now: number): WorldMetricRow[] {
  const spec = METALS.find((item) => item.symbol === json.symbol);
  const price = num(json.price);
  if (!spec || price === null) return [];
  const updated = typeof json.updatedAt === "string" ? Date.parse(json.updatedAt) : NaN;
  return [
    metric({
      seriesId: `metal:${spec.symbol}`,
      category: "metals",
      label: spec.label,
      value: price,
      unit: spec.unit,
      source: "gold-api.com",
      url: "https://gold-api.com",
      timestamp: Number.isFinite(updated) ? updated : now,
    }),
  ];
}

/** Gold/silver ratio derived from two spot readings. */
export function goldSilverRatio(gold: number, silver: number, timestamp: number): WorldMetricRow | null {
  if (!(gold > 0) || !(silver > 0)) return null;
  return metric({
    seriesId: "metal:GSR",
    category: "metals",
    label: "Gold / Silver ratio",
    value: gold / silver,
    unit: "ratio",
    source: "derived",
    timestamp,
  });
}

// Daily candles (cross-asset correlation and gold history) ---------------

export function parseCandles(
  json: unknown,
  seriesId: string,
  label: string,
  maxDays = 120
): WorldMetricRow[] {
  if (!Array.isArray(json)) return [];
  const out: WorldMetricRow[] = [];
  for (const candle of json.slice(0, maxDays)) {
    if (!Array.isArray(candle)) continue;
    const time = num(candle[0]);
    const close = num(candle[4]);
    if (time === null || close === null) continue;
    out.push(
      metric({
        seriesId,
        category: "daily",
        label,
        value: close,
        aux: num(candle[5]),
        unit: "USD",
        source: "Coinbase",
        url: "https://exchange.coinbase.com",
        timestamp: time * 1000,
      })
    );
  }
  return out;
}

// Crypto ---------------------------------------------------------------

const GECKO_IDS: Record<string, string> = { bitcoin: "BTC", ethereum: "ETH" };

export function parseCoinGeckoPrice(json: Json, now: number): WorldMetricRow[] {
  const out: WorldMetricRow[] = [];
  for (const [id, symbol] of Object.entries(GECKO_IDS)) {
    const row = json[id] as Json | undefined;
    const price = num(row?.usd);
    if (price === null) continue;
    const updated = num(row?.last_updated_at);
    const timestamp = updated !== null ? updated * 1000 : now;
    out.push(
      metric({
        seriesId: `crypto:${symbol}`,
        category: "crypto",
        label: `${symbol} price`,
        value: price,
        unit: "USD",
        source: "CoinGecko",
        url: "https://www.coingecko.com",
        timestamp,
      })
    );
    const change = num(row?.usd_24h_change);
    if (change !== null) {
      out.push(
        metric({
          seriesId: `crypto:${symbol}:chg24`,
          category: "crypto",
          label: `${symbol} 24h change`,
          value: change,
          unit: "%",
          source: "CoinGecko",
          timestamp,
        })
      );
    }
  }
  return out;
}

export function parseCoinGeckoGlobal(json: Json, now: number): WorldMetricRow[] {
  const data = json.data as Json | undefined;
  if (!data) return [];
  const mcap = num((data.total_market_cap as Json | undefined)?.usd);
  const change = num(data.market_cap_change_percentage_24h_usd);
  const dominance = num((data.market_cap_percentage as Json | undefined)?.btc);
  const rows: [string, string, number | null, string][] = [
    ["crypto:MCAP", "Crypto market cap", mcap, "USD"],
    ["crypto:MCAP_CHG24", "Crypto cap 24h change", change, "%"],
    ["crypto:BTCDOM", "BTC dominance", dominance, "%"],
  ];
  return rows
    .filter((row): row is [string, string, number, string] => row[2] !== null)
    .map(([seriesId, label, value, unit]) =>
      metric({ seriesId, category: "crypto", label, value, unit, source: "CoinGecko", timestamp: now })
    );
}

export function parseMempool(fees: Json, height: unknown, now: number): WorldMetricRow[] {
  const out: WorldMetricRow[] = [];
  const fast = num(fees.fastestFee);
  if (fast !== null) {
    out.push(
      metric({
        seriesId: "crypto:FEE_FAST",
        category: "crypto",
        label: "Bitcoin fastest fee",
        value: fast,
        unit: "sat/vB",
        source: "mempool.space",
        url: "https://mempool.space",
        timestamp: now,
      })
    );
  }
  const tip = num(height);
  if (tip !== null) {
    out.push(
      metric({
        seriesId: "crypto:HEIGHT",
        category: "crypto",
        label: "Bitcoin block height",
        value: tip,
        unit: "blocks",
        source: "mempool.space",
        timestamp: now,
      })
    );
  }
  return out;
}

// Macro ----------------------------------------------------------------

export function parseFearGreed(json: Json): WorldMetricRow[] {
  const data = json.data;
  if (!Array.isArray(data)) return [];
  const out: WorldMetricRow[] = [];
  for (const item of data as Json[]) {
    const value = num(item.value);
    const seconds = num(item.timestamp);
    if (value === null || seconds === null) continue;
    out.push(
      metric({
        seriesId: "macro:FNG",
        category: "macro",
        label: "Crypto Fear & Greed",
        value,
        unit: "index",
        source: "alternative.me",
        url: "https://alternative.me/crypto/fear-and-greed-index/",
        timestamp: seconds * 1000,
      })
    );
  }
  return out;
}

const TREASURY_SERIES: Record<string, { id: string; label: string }> = {
  "Treasury Bills": { id: "macro:TBILL", label: "US T-Bill avg rate" },
  "Treasury Notes": { id: "macro:TNOTE", label: "US T-Note avg rate" },
  "Treasury Bonds": { id: "macro:TBOND", label: "US T-Bond avg rate" },
};

export function parseTreasury(json: Json): WorldMetricRow[] {
  const data = json.data;
  if (!Array.isArray(data)) return [];
  const out: WorldMetricRow[] = [];
  for (const row of data as Json[]) {
    const spec = TREASURY_SERIES[String(row.security_desc)];
    const rate = num(row.avg_interest_rate_amt);
    if (!spec || rate === null || typeof row.record_date !== "string") continue;
    out.push(
      metric({
        seriesId: spec.id,
        category: "macro",
        label: spec.label,
        value: rate,
        unit: "%",
        source: "US Treasury",
        url: "https://fiscaldata.treasury.gov",
        timestamp: isoDayMs(row.record_date),
      })
    );
  }
  return out;
}

export const WORLD_BANK_INDICATORS = [
  { key: "GDP", code: "NY.GDP.MKTP.KD.ZG", label: "GDP growth" },
  { key: "CPI", code: "FP.CPI.TOTL.ZG", label: "Inflation" },
  { key: "UNEMP", code: "SL.UEM.TOTL.ZS", label: "Unemployment" },
] as const;

export function worldBankUrl(code: string): string {
  return `https://api.worldbank.org/v2/country/${WORLD_BANK_COUNTRIES}/indicator/${code}?format=json&per_page=60&mrnev=1`;
}

/** Most-recent-non-empty values for several countries (`mrnev=1`). */
export function parseWorldBank(json: unknown, key: string, label: string): WorldMetricRow[] {
  if (!Array.isArray(json) || !Array.isArray(json[1])) return [];
  const out: WorldMetricRow[] = [];
  for (const row of json[1] as Json[]) {
    const value = num(row.value);
    const year = num(row.date);
    const iso = row.countryiso3code;
    const country = (row.country as Json | undefined)?.value;
    if (value === null || year === null || typeof iso !== "string" || typeof country !== "string") continue;
    out.push(
      metric({
        seriesId: `wb:${key}:${iso}`,
        category: "macro",
        label: `${country} ${label.toLowerCase()}`,
        value,
        aux: year,
        unit: "%",
        source: "World Bank",
        url: "https://data.worldbank.org",
        timestamp: Date.UTC(year, 0, 1),
      })
    );
  }
  return out;
}

// Politics: prediction markets --------------------------------------------

function parseJsonArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function shorten(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const DAY_MS = 86_400_000;

export function parsePolymarket(json: unknown, now: number): WorldMetricRow[] {
  if (!Array.isArray(json)) return [];
  const out: WorldMetricRow[] = [];
  for (const market of json as Json[]) {
    const prices = parseJsonArray(market.outcomePrices);
    const outcomes = parseJsonArray(market.outcomes);
    const price = prices ? num(prices[0]) : null;
    if (price === null || typeof market.question !== "string") continue;

    const event = (market.events as Json[] | undefined)?.[0];
    const groupItem = typeof market.groupItemTitle === "string" && market.groupItemTitle ? market.groupItemTitle : null;
    const eventTitle = typeof event?.title === "string" ? event.title : null;
    const label = shorten(groupItem && eventTitle ? `${eventTitle}: ${groupItem}` : market.question);
    const outcome = outcomes && typeof outcomes[0] === "string" ? outcomes[0] : "Yes";
    const slug = typeof event?.slug === "string" ? event.slug : String(market.slug ?? "");
    const seriesId = `poly:${market.id}`;
    const base = {
      seriesId,
      category: "politics" as const,
      label: outcome === "Yes" ? label : `${label} (${outcome})`,
      unit: "%",
      source: "Polymarket",
      url: slug ? `https://polymarket.com/event/${slug}` : null,
    };

    out.push(metric({ ...base, value: price * 100, aux: num(market.volume24hr), timestamp: now }));
    const dayChange = num(market.oneDayPriceChange);
    if (dayChange !== null) {
      out.push(metric({ ...base, value: (price - dayChange) * 100, timestamp: now - DAY_MS }));
    }
  }
  return out;
}

const KALSHI_CATEGORIES = new Set(["Politics", "Elections", "World", "Economics"]);

/** The most-traded market of each Politics/Elections/World/Economics event. */
export function parseKalshi(json: Json, now: number, limit = 14): WorldMetricRow[] {
  const events = json.events;
  if (!Array.isArray(events)) return [];

  const candidates: { row: WorldMetricRow; prev: WorldMetricRow | null; volume: number }[] = [];
  for (const event of events as Json[]) {
    if (!KALSHI_CATEGORIES.has(String(event.category))) continue;
    const markets = (event.markets as Json[] | undefined) ?? [];
    let best: Json | null = null;
    let bestVolume = 0;
    for (const market of markets) {
      const volume = num(market.volume_fp) ?? 0;
      if (volume > bestVolume) {
        best = market;
        bestVolume = volume;
      }
    }
    if (!best) continue;
    const price = num(best.last_price_dollars);
    if (price === null || typeof event.title !== "string") continue;

    const sub = typeof best.yes_sub_title === "string" && best.yes_sub_title ? best.yes_sub_title : null;
    const seriesId = `kalshi:${best.ticker}`;
    const base = {
      seriesId,
      category: "politics" as const,
      label: shorten(sub ? `${event.title}: ${sub}` : event.title),
      unit: "%",
      source: "Kalshi",
      url: typeof event.series_ticker === "string" ? `https://kalshi.com/markets/${event.series_ticker}` : null,
    };
    const previous = num(best.previous_price_dollars);
    candidates.push({
      row: metric({ ...base, value: price * 100, aux: num(best.volume_24h_fp), timestamp: now }),
      prev: previous !== null ? metric({ ...base, value: previous * 100, timestamp: now - DAY_MS }) : null,
      volume: bestVolume,
    });
  }

  candidates.sort((a, b) => b.volume - a.volume);
  return candidates
    .slice(0, limit)
    .flatMap(({ row, prev }) => (prev ? [row, prev] : [row]));
}
