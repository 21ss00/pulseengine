import { EMPTY_BATCH, type WorldBatch, type WorldHeadlineRow } from "../types/world.ts";
import { FX_SYMBOLS, METALS, NEWS_FEEDS } from "./constants.ts";
import {
  goldSilverRatio,
  parseCandles,
  parseCoinGeckoGlobal,
  parseCoinGeckoPrice,
  parseFearGreed,
  parseFrankfurter,
  parseGoldApi,
  parseKalshi,
  parseMempool,
  parsePolymarket,
  parseTreasury,
  parseWorldBank,
  WORLD_BANK_INDICATORS,
  worldBankUrl,
} from "./parsersMarkets.ts";
import { parseHackerNews, parseRss2Json, parseWikiMostRead } from "./parsersNews.ts";
import {
  airQualityUrl,
  parseAirQuality,
  parseEonet,
  parseIss,
  parseKp,
  parseUsgsQuakes,
  parseWeather,
  weatherUrl,
} from "./parsersPlanet.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const HEADLINE_MAX_AGE_MS = 3 * DAY;

export interface FetchContext {
  now: number;
  json: (url: string) => Promise<unknown>;
  text: (url: string) => Promise<string>;
}

export interface WorldSource {
  id: string;
  label: string;
  group: string;
  intervalMs: number;
  run: (ctx: FetchContext) => Promise<WorldBatch>;
}

type Json = Record<string, unknown>;

/**
 * Runs several independent requests; the source only fails if every one does,
 * so a single flaky endpoint does not blank a whole panel.
 */
async function gather<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const settled = await Promise.allSettled(tasks.map((task) => task()));
  const values = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  if (values.length === 0) {
    const first = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    throw first?.reason instanceof Error ? first.reason : new Error("All requests failed");
  }
  return values;
}

function fresh(rows: WorldHeadlineRow[], now: number): WorldHeadlineRow[] {
  return rows.filter((row) => row.timestamp >= now - HEADLINE_MAX_AGE_MS);
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const CANDLE_SERIES = [
  { product: "BTC-USD", seriesId: "daily:BTC", label: "Bitcoin" },
  { product: "ETH-USD", seriesId: "daily:ETH", label: "Ethereum" },
  { product: "PAXG-USD", seriesId: "daily:PAXG", label: "Gold (PAXG token)" },
];

export const WORLD_SOURCES: WorldSource[] = [
  {
    id: "fx",
    label: "Currencies (ECB via Frankfurter)",
    group: "Markets",
    intervalMs: 30 * MINUTE,
    run: async ({ now, json }) => {
      const url = `https://api.frankfurter.dev/v1/${isoDay(now - 90 * DAY)}..?base=USD&symbols=${FX_SYMBOLS}`;
      return { ...EMPTY_BATCH, metrics: parseFrankfurter((await json(url)) as Json) };
    },
  },
  {
    id: "metals",
    label: "Metals spot (gold-api.com)",
    group: "Markets",
    intervalMs: MINUTE,
    run: async ({ now, json }) => {
      const parts = await gather(
        METALS.map((metal) => async () => parseGoldApi((await json(`https://api.gold-api.com/price/${metal.symbol}`)) as Json, now))
      );
      const metrics = parts.flat();
      const gold = metrics.find((row) => row.seriesId === "metal:XAU");
      const silver = metrics.find((row) => row.seriesId === "metal:XAG");
      const ratio = gold && silver ? goldSilverRatio(gold.value, silver.value, Math.max(gold.timestamp, silver.timestamp)) : null;
      return { ...EMPTY_BATCH, metrics: ratio ? [...metrics, ratio] : metrics };
    },
  },
  {
    id: "daily",
    label: "Daily closes: BTC, ETH, gold token (Coinbase)",
    group: "Markets",
    intervalMs: 30 * MINUTE,
    run: async ({ json }) => {
      const parts = await gather(
        CANDLE_SERIES.map((series) => async () =>
          parseCandles(await json(`https://api.exchange.coinbase.com/products/${series.product}/candles?granularity=86400`), series.seriesId, series.label)
        )
      );
      return { ...EMPTY_BATCH, metrics: parts.flat() };
    },
  },
  {
    id: "crypto",
    label: "Crypto market (CoinGecko)",
    group: "Markets",
    intervalMs: 90_000,
    run: async ({ now, json }) => {
      const parts = await gather([
        async () =>
          parseCoinGeckoPrice(
            (await json("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true")) as Json,
            now
          ),
        async () => parseCoinGeckoGlobal((await json("https://api.coingecko.com/api/v3/global")) as Json, now),
      ]);
      return { ...EMPTY_BATCH, metrics: parts.flat() };
    },
  },
  {
    id: "mempool",
    label: "Bitcoin network (mempool.space)",
    group: "Markets",
    intervalMs: MINUTE,
    run: async ({ now, json, text }) => {
      const [fees, height] = await Promise.all([
        json("https://mempool.space/api/v1/fees/recommended"),
        text("https://mempool.space/api/blocks/tip/height"),
      ]);
      return { ...EMPTY_BATCH, metrics: parseMempool(fees as Json, Number(height), now) };
    },
  },
  {
    id: "feargreed",
    label: "Crypto Fear & Greed (alternative.me)",
    group: "Macro",
    intervalMs: 30 * MINUTE,
    run: async ({ json }) => ({
      ...EMPTY_BATCH,
      metrics: parseFearGreed((await json("https://api.alternative.me/fng/?limit=45")) as Json),
    }),
  },
  {
    id: "treasury",
    label: "US Treasury average rates",
    group: "Macro",
    intervalMs: 6 * HOUR,
    run: async ({ json }) => ({
      ...EMPTY_BATCH,
      metrics: parseTreasury(
        (await json(
          "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?page[size]=30&sort=-record_date&filter=security_desc:in:(Treasury%20Bills,Treasury%20Notes,Treasury%20Bonds)"
        )) as Json
      ),
    }),
  },
  {
    id: "worldbank",
    label: "World Bank: GDP, inflation, unemployment",
    group: "Macro",
    intervalMs: 12 * HOUR,
    run: async ({ json }) => {
      const parts = await gather(
        WORLD_BANK_INDICATORS.map((indicator) => async () =>
          parseWorldBank(await json(worldBankUrl(indicator.code)), indicator.key, indicator.label)
        )
      );
      return { ...EMPTY_BATCH, metrics: parts.flat() };
    },
  },
  {
    id: "polymarket",
    label: "Prediction markets: politics (Polymarket)",
    group: "Politics",
    intervalMs: 2 * MINUTE,
    run: async ({ now, json }) => ({
      ...EMPTY_BATCH,
      metrics: parsePolymarket(
        await json("https://gamma-api.polymarket.com/markets?tag_id=2&closed=false&active=true&order=volume24hr&ascending=false&limit=14"),
        now
      ),
    }),
  },
  {
    id: "kalshi",
    label: "Prediction markets: elections, economy (Kalshi)",
    group: "Politics",
    intervalMs: 10 * MINUTE,
    run: async ({ now, json }) => ({
      ...EMPTY_BATCH,
      metrics: parseKalshi(
        (await json("https://api.elections.kalshi.com/trade-api/v2/events?status=open&with_nested_markets=true&limit=100")) as Json,
        now
      ),
    }),
  },
  {
    id: "news",
    label: "News headlines (BBC, Guardian, NPR, Al Jazeera)",
    group: "News",
    intervalMs: 5 * MINUTE,
    run: async ({ now, json }) => {
      const parts = await gather(
        NEWS_FEEDS.map((feed) => async () =>
          parseRss2Json(
            (await json(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`)) as Json,
            feed.source,
            feed.category,
            now
          )
        )
      );
      return { ...EMPTY_BATCH, headlines: fresh(parts.flat(), now) };
    },
  },
  {
    id: "hn",
    label: "Tech news (Hacker News)",
    group: "News",
    intervalMs: 5 * MINUTE,
    run: async ({ now, json }) => ({
      ...EMPTY_BATCH,
      headlines: fresh(
        parseHackerNews((await json("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20")) as Json, now),
        now
      ),
    }),
  },
  {
    id: "wiki",
    label: "Trending topics (Wikipedia)",
    group: "News",
    intervalMs: 6 * HOUR,
    run: async ({ now, json }) => {
      const path = isoDay(now).replaceAll("-", "/");
      return {
        ...EMPTY_BATCH,
        headlines: fresh(parseWikiMostRead((await json(`https://en.wikipedia.org/api/rest_v1/feed/featured/${path}`)) as Json), now),
      };
    },
  },
  {
    id: "quakes",
    label: "Earthquakes (USGS)",
    group: "Planet",
    intervalMs: 2 * MINUTE,
    run: async ({ json }) => ({
      ...EMPTY_BATCH,
      events: parseUsgsQuakes((await json("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson")) as Json),
    }),
  },
  {
    id: "eonet",
    label: "Storms, fires, volcanoes (NASA EONET)",
    group: "Planet",
    intervalMs: 15 * MINUTE,
    run: async ({ json }) => ({
      ...EMPTY_BATCH,
      events: parseEonet((await json("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=40")) as Json),
    }),
  },
  {
    id: "kp",
    label: "Space weather (NOAA)",
    group: "Planet",
    intervalMs: 10 * MINUTE,
    run: async ({ json }) => ({
      ...EMPTY_BATCH,
      metrics: parseKp(await json("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json")),
    }),
  },
  {
    id: "iss",
    label: "International Space Station position",
    group: "Planet",
    intervalMs: 30_000,
    run: async ({ now, json }) => ({
      ...EMPTY_BATCH,
      metrics: parseIss((await json("https://api.wheretheiss.at/v1/satellites/25544")) as Json, now),
    }),
  },
  {
    id: "weather",
    label: "Weather and air quality (Open-Meteo)",
    group: "Planet",
    intervalMs: 15 * MINUTE,
    run: async ({ now, json }) => {
      const parts = await gather([
        async () => parseWeather(await json(weatherUrl()), now),
        async () => parseAirQuality(await json(airQualityUrl()), now),
      ]);
      return { ...EMPTY_BATCH, metrics: parts.flat() };
    },
  },
];
