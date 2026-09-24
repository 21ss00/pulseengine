import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scoreTone, stripHtml } from "../src/world/tone.ts";
import {
  dollarIndex,
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
} from "../src/world/parsersMarkets.ts";
import {
  newestMastodonId,
  parseHackerNews,
  parseMastodonPosts,
  parseRss2Json,
  parseWikiMostRead,
  shortHash,
} from "../src/world/parsersNews.ts";
import {
  parseAirQuality,
  parseEonet,
  parseIss,
  parseKp,
  parseUsgsQuakes,
  parseWeather,
} from "../src/world/parsersPlanet.ts";
import { CITIES, FX_CURRENCIES } from "../src/world/constants.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

test("tone: sign, negation and squashing", () => {
  assert.ok(scoreTone("Stocks surge to record high on strong growth") > 0.5);
  assert.ok(scoreTone("Markets crash as war fears deepen") < -0.5);
  assert.equal(scoreTone("The committee met on Tuesday"), 0);
  assert.ok(scoreTone("Talks did not fail") > 0, "negation flips the sign");
  assert.ok(scoreTone("No recovery in sight") < 0);
  assert.ok(Math.abs(scoreTone("crash crash crash crash crash crash")) <= 1);
  assert.equal(stripHtml("<p>Fish &amp; chips<br/>tonight&nbsp;now</p>"), "Fish & chips tonight now");
});

test("dollar index matches the ICE formula's constant and exponents", () => {
  const flat = Object.fromEntries(["EUR", "JPY", "GBP", "CAD", "SEK", "CHF"].map((c) => [c, 1]));
  assert.ok(Math.abs(dollarIndex(flat) - 50.14348112) < 1e-9);
  const euroStrong = { ...flat, EUR: 0.5 }; // EUR/USD = 2
  assert.ok(Math.abs(dollarIndex(euroStrong) - 50.14348112 * Math.pow(2, -0.576)) < 1e-9);
  assert.equal(dollarIndex({ EUR: 0.9 }), null, "needs every basket currency");
});

test("frankfurter: time series and latest, with CCY/USD inversion and a dollar index", () => {
  const series = parseFrankfurter(fixture("frankfurter-series"));
  const dates = new Set(series.map((m) => m.timestamp));
  assert.ok(dates.size >= 8);
  assert.equal(series.length, dates.size * (FX_CURRENCIES.length + 1));
  const raw = fixture("frankfurter-series").rates;
  const day = Object.keys(raw)[0];
  const eur = series.find((m) => m.seriesId === "fx:EUR" && m.timestamp === Date.parse(`${day}T00:00:00Z`));
  assert.ok(Math.abs(eur.value - 1 / raw[day].EUR) < 1e-12, "EUR/USD is the inverse of the USD-based rate");
  const jpy = series.find((m) => m.seriesId === "fx:JPY" && m.timestamp === eur.timestamp);
  assert.ok(Math.abs(jpy.value - raw[day].JPY) < 1e-12, "USD/JPY is used as quoted");
  const dxy = series.filter((m) => m.seriesId === "fx:DXY");
  assert.ok(dxy.every((m) => m.value > 60 && m.value < 140), "index in a plausible range");
  const latest = parseFrankfurter(fixture("frankfurter-latest"));
  assert.equal(latest.length, FX_CURRENCIES.length + 1);
  assert.equal(new Set(latest.map((m) => m.timestamp)).size, 1);
});

test("metals: known symbol parses, unknown symbol is ignored, ratio is derived", () => {
  const [xau] = parseGoldApi(fixture("gold-xau"), NOW);
  assert.equal(xau.seriesId, "metal:XAU");
  assert.ok(xau.value > 500 && xau.unit === "USD/oz");
  const [hg] = parseGoldApi(fixture("gold-hg"), NOW);
  assert.equal(hg.unit, "USD/lb");
  assert.deepEqual(parseGoldApi({ symbol: "ZZZ", price: 1 }, NOW), []);
  assert.deepEqual(parseGoldApi({ symbol: "XAU", price: "n/a" }, NOW), []);
  assert.equal(goldSilverRatio(4000, 50, NOW).value, 80);
  assert.equal(goldSilverRatio(4000, 0, NOW), null);
});

test("daily candles become close-price observations at day boundaries", () => {
  const rows = parseCandles(fixture("coinbase-candles-paxg"), "daily:PAXG", "Gold token");
  assert.equal(rows.length, 40);
  assert.ok(rows.every((r) => r.seriesId === "daily:PAXG" && r.value > 0));
  assert.ok(rows.every((r) => r.timestamp % DAY === 0));
  assert.equal(parseCandles({ message: "rate limited" }, "x", "x").length, 0);
});

test("crypto: coingecko price, global and mempool", () => {
  const price = parseCoinGeckoPrice(fixture("coingecko-price"), NOW);
  assert.deepEqual(price.map((r) => r.seriesId).sort(), ["crypto:BTC", "crypto:BTC:chg24", "crypto:ETH", "crypto:ETH:chg24"]);
  const global = parseCoinGeckoGlobal(fixture("coingecko-global"), NOW);
  assert.deepEqual(global.map((r) => r.seriesId).sort(), ["crypto:BTCDOM", "crypto:MCAP", "crypto:MCAP_CHG24"]);
  assert.ok(global.find((r) => r.seriesId === "crypto:BTCDOM").value > 20);
  const pool = parseMempool(fixture("mempool-fees"), 900123, NOW);
  assert.equal(pool.find((r) => r.seriesId === "crypto:HEIGHT").value, 900123);
});

test("macro: fear & greed history, treasury rates, world bank scoreboard", () => {
  const fng = parseFearGreed(fixture("fear-greed"));
  assert.ok(fng.length >= 20 && fng.every((r) => r.value >= 0 && r.value <= 100));
  assert.ok(fng.every((r) => r.timestamp % 1000 === 0 && r.timestamp > 1_600_000_000_000));
  const treasury = parseTreasury(fixture("treasury"));
  assert.deepEqual([...new Set(treasury.map((r) => r.seriesId))].sort(), ["macro:TBILL", "macro:TBOND", "macro:TNOTE"]);
  const wb = parseWorldBank(fixture("worldbank-gdp"), "GDP", "GDP growth");
  assert.equal(wb.length, 6);
  assert.ok(wb.every((r) => /^wb:GDP:[A-Z]{3}$/.test(r.seriesId) && r.aux >= 2020));
  assert.deepEqual(parseWorldBank([{ page: 1 }, [{ value: null, date: "2024", countryiso3code: "USA", country: { value: "US" } }]], "CPI", "x"), []);
});

test("polymarket: probabilities in percent plus a derived 24h-ago point", () => {
  const rows = parsePolymarket(fixture("polymarket"), NOW);
  assert.ok(rows.length >= 4);
  assert.ok(rows.every((r) => r.category === "politics" && r.value >= 0 && r.value <= 100));
  const now = rows.filter((r) => r.timestamp === NOW);
  const prev = rows.filter((r) => r.timestamp === NOW - DAY);
  assert.ok(now.length >= 4 && prev.length >= 1);
  const market = fixture("polymarket")[0];
  const price = Number(JSON.parse(market.outcomePrices)[0]) * 100;
  const first = now.find((r) => r.seriesId === `poly:${market.id}`);
  assert.ok(Math.abs(first.value - price) < 1e-9);
  assert.equal(first.aux, market.volume24hr);
  assert.match(first.url, /^https:\/\/polymarket\.com\/event\//);
});

test("kalshi: only relevant categories, top market per event, ranked by volume", () => {
  const rows = parseKalshi(fixture("kalshi"), NOW, 6);
  const current = rows.filter((r) => r.timestamp === NOW);
  assert.ok(current.length >= 3 && current.length <= 6);
  assert.ok(rows.every((r) => r.seriesId.startsWith("kalshi:") && r.value >= 0 && r.value <= 100));
  assert.equal(new Set(current.map((r) => r.seriesId)).size, current.length, "one market per event");
  assert.deepEqual(parseKalshi({ events: [{ category: "Sports", title: "x", markets: [{ volume_fp: "9", last_price_dollars: "0.5", ticker: "T" }] }] }, NOW), []);
});

test("rss: headlines with stable ids, UTC timestamps and bounded tone", () => {
  const rows = parseRss2Json(fixture("rss-bbc-world"), "BBC World", "world", NOW);
  assert.ok(rows.length >= 5);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.ok(rows.every((r) => r.tone >= -1 && r.tone <= 1 && /^https?:\/\//.test(r.url)));
  assert.ok(rows.every((r) => r.timestamp > 1_600_000_000_000 && r.timestamp < Date.now() + DAY));
  assert.deepEqual(parseRss2Json({ status: "error" }, "x", "world", NOW), []);
  assert.equal(shortHash("abc"), shortHash("abc"));
  assert.notEqual(shortHash("abc"), shortHash("abd"));
});

test("hacker news and wikipedia trending", () => {
  const hn = parseHackerNews(fixture("hn-algolia"), NOW);
  assert.ok(hn.length >= 10 && hn.every((r) => r.category === "tech" && r.aux >= 0));
  const wiki = parseWikiMostRead(fixture("wiki-feed"), 12);
  assert.ok(wiki.length > 0 && wiki.length <= 12);
  assert.ok(wiki.every((r) => !r.title.startsWith("Main Page") && r.aux > 0 && r.category === "trending"));
  assert.ok(wiki.every((r) => !r.title.includes("_")));
});

test("mastodon: english posts only, numeric ids, engagement and impact from real fields", () => {
  const posts = fixture("mastodon-bitcoin");
  let counter = 0;
  const events = parseMastodonPosts(posts, "$BTC", () => ++counter);
  const english = posts.filter((p) => p.language === "en" || p.language == null);
  assert.ok(events.length > 0 && events.length <= english.length);
  assert.equal(counter, events.length, "ids only consumed for kept posts");
  for (const { stream, payload } of events) {
    assert.equal(stream, "beta");
    assert.equal(payload.platform, "mastodon");
    assert.equal(payload.topic, "$BTC");
    assert.ok(payload.sentimentScore >= -1 && payload.sentimentScore <= 1);
    assert.ok(payload.engagementRate >= 0 && payload.engagementRate <= 100);
    assert.ok(Math.abs(payload.bullishRatio + payload.bearishRatio - 1) < 1e-3);
    assert.ok(payload.timestamp > 1_600_000_000_000);
  }
  const newest = newestMastodonId(posts);
  assert.match(newest, /^\d+$/);
  assert.ok(posts.every((p) => BigInt(p.id) <= BigInt(newest)));
  assert.equal(newestMastodonId({ error: "x" }), null);
  assert.deepEqual(parseMastodonPosts({ error: "x" }, "$BTC", () => 1), []);
});

test("planet: quakes, natural events, kp, iss, weather and air quality", () => {
  const quakes = parseUsgsQuakes(fixture("usgs-quakes"));
  assert.ok(quakes.length >= 10);
  assert.ok(quakes.every((q) => q.kind === "quake" && q.magnitude >= 0 && Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180));
  const eonet = parseEonet(fixture("eonet"));
  assert.ok(eonet.length >= 5);
  const kinds = new Set(["quake", "storm", "wildfire", "volcano", "flood", "other"]);
  assert.ok(eonet.every((e) => kinds.has(e.kind) && Math.abs(e.lat) <= 90));
  const kp = parseKp(fixture("noaa-kp"));
  assert.ok(kp.length >= 10 && kp.every((r) => r.value >= 0 && r.value <= 9));
  const iss = parseIss(fixture("iss"), NOW);
  assert.deepEqual(iss.map((r) => r.seriesId).sort(), ["iss:ALT", "iss:LAT", "iss:LON", "iss:VEL"]);
  const wx = parseWeather(fixture("open-meteo"), NOW);
  assert.equal(wx.length, CITIES.length);
  assert.deepEqual(wx.map((r) => r.seriesId), CITIES.map((c) => `wx:TEMP:${c.name}`));
  assert.ok(wx.every((r) => r.value > -60 && r.value < 60 && r.aux >= 0));
  const aq = parseAirQuality(fixture("air-quality"), NOW);
  assert.equal(aq.length, CITIES.length);
  assert.ok(aq.every((r) => r.value >= 0 && r.value <= 600));
});
