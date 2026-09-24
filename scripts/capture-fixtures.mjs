// Fetches live responses from every world-data API and stores trimmed copies
// under tests/fixtures so the parsers can be tested against real payloads.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { airQualityUrl, weatherUrl } from "../src/world/parsersPlanet.ts";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");
mkdirSync(outDir, { recursive: true });
const enc = encodeURIComponent;
const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

// Real posts belong to strangers, so only the numeric/shape fields are kept and
// the text is replaced with neutral placeholders that still exercise the tone scorer.
const PHRASES = [
  "<p>Prices rally strongly as optimism grows</p>",
  "<p>Markets fall amid fears of a crisis</p>",
  "<p>Nothing notable to report this morning</p>",
  "<p>Growth is not weak, analysts say &amp; agree</p>",
];
const sanitizePosts = (posts) =>
  posts.map((post, i) => ({
    id: post.id,
    created_at: post.created_at,
    language: post.language,
    content: PHRASES[i % PHRASES.length],
    favourites_count: post.favourites_count,
    reblogs_count: post.reblogs_count,
    account: { followers_count: post.account?.followers_count ?? 0 },
  }));

const CURRENCIES = "EUR,GBP,JPY,CHF,CAD,AUD,CNY,INR,MXN,BRL,KRW,SEK";
const sources = {
  "frankfurter-series": { url: `https://api.frankfurter.dev/v1/${day(14)}..?base=USD&symbols=${CURRENCIES}` },
  "frankfurter-latest": { url: `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${CURRENCIES}` },
  "gold-xau": { url: "https://api.gold-api.com/price/XAU" },
  "gold-hg": { url: "https://api.gold-api.com/price/HG" },
  "coinbase-candles-paxg": { url: "https://api.exchange.coinbase.com/products/PAXG-USD/candles?granularity=86400", trim: (j) => j.slice(0, 40) },
  "coingecko-price": { url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true" },
  "coingecko-global": { url: "https://api.coingecko.com/api/v3/global" },
  "fear-greed": { url: "https://api.alternative.me/fng/?limit=30" },
  treasury: { url: "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?page[size]=9&sort=-record_date&filter=security_desc:in:(Treasury%20Bills,Treasury%20Notes,Treasury%20Bonds)" },
  "worldbank-gdp": { url: "https://api.worldbank.org/v2/country/USA;CHN;DEU;JPN;GBR;IND/indicator/NY.GDP.MKTP.KD.ZG?format=json&per_page=60&mrnev=1" },
  "mempool-fees": { url: "https://mempool.space/api/v1/fees/recommended" },
  polymarket: { url: "https://gamma-api.polymarket.com/markets?tag_id=2&closed=false&active=true&order=volume24hr&ascending=false&limit=8" },
  kalshi: { url: "https://api.elections.kalshi.com/trade-api/v2/events?status=open&with_nested_markets=true&limit=200", trim: (j) => ({ events: j.events.filter((e) => ["Politics", "Elections", "World", "Economics"].includes(e.category)).slice(0, 12).map((e) => ({ ...e, markets: e.markets.slice(0, 6).map((m) => ({ ...m, rules_primary: undefined, rules_secondary: undefined, price_ranges: undefined })) })) }) },
  "rss-bbc-world": { url: `https://api.rss2json.com/v1/api.json?rss_url=${enc("https://feeds.bbci.co.uk/news/world/rss.xml")}` },
  "rss-bbc-politics": { url: `https://api.rss2json.com/v1/api.json?rss_url=${enc("https://feeds.bbci.co.uk/news/politics/rss.xml")}` },
  "hn-algolia": { url: "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=15" },
  "wiki-feed": { url: `https://en.wikipedia.org/api/rest_v1/feed/featured/${day(1).replaceAll("-", "/")}`, trim: (j) => ({ mostread: j.mostread }) },
  "usgs-quakes": { url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", trim: (j) => ({ ...j, features: j.features.slice(0, 25) }) },
  eonet: { url: "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=20" },
  "noaa-kp": { url: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", trim: (j) => j.slice(-24) },
  iss: { url: "https://api.wheretheiss.at/v1/satellites/25544" },
  "open-meteo": { url: weatherUrl() },
  "air-quality": { url: airQualityUrl() },
  "mastodon-bitcoin": { url: "https://mastodon.social/api/v1/timelines/tag/bitcoin?limit=20", trim: sanitizePosts },
  "mastodon-politics": { url: "https://mastodon.social/api/v1/timelines/tag/politics?limit=20", trim: sanitizePosts },
};

let failed = 0;
for (const [name, { url, trim }] of Object.entries(sources)) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "pulseengine-fixtures" }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const body = JSON.stringify(trim ? trim(json) : json);
    writeFileSync(join(outDir, `${name}.json`), body);
    console.log(`ok   ${name.padEnd(24)} ${(body.length / 1024).toFixed(1)} KiB`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name.padEnd(24)} ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
