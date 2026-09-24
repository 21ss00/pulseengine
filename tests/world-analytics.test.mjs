import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb, toRows } from "./helpers.mjs";
import {
  buildWorldBatchInsertSql,
  buildWorldEvictionSql,
  buildBetaInsertSql,
} from "../src/analytics/schema.ts";
import {
  crossAssetSql,
  issTrackSql,
  socialTopicsSql,
  worldEventsSql,
  worldHeadlinesSql,
  worldLatestSql,
  worldSeriesSql,
  worldSummarySql,
} from "../src/analytics/worldSql.ts";
import { computeWorldIndex, labelFor } from "../src/analytics/worldIndex.ts";
import { buildWorldAdvice } from "../src/analytics/worldAdvisor.ts";
import {
  parseCandles,
  parseFearGreed,
  parseFrankfurter,
  parsePolymarket,
  parseTreasury,
} from "../src/world/parsersMarkets.ts";
import { parseMastodonPosts, parseRss2Json } from "../src/world/parsersNews.ts";
import { parseIss, parseKp, parseUsgsQuakes } from "../src/world/parsersPlanet.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
const DAY = 86_400_000;
const NOW = Math.floor(Date.now() / DAY) * DAY + 15 * 3_600_000; // 15:00 UTC today

let conn;
const rows = (text) => toRows(conn.query(text));
const load = (batch) => {
  for (const statement of buildWorldBatchInsertSql({ metrics: [], headlines: [], events: [], ...batch })) {
    conn.query(statement);
  }
};
const shift = (list, ms) => list.map((row) => ({ ...row, timestamp: row.timestamp + ms }));
const newest = (list) => Math.max(...list.map((row) => row.timestamp));
const metric = (seriesId, category, value, timestamp, extra = {}) => ({
  seriesId, category, label: seriesId, value, aux: null, unit: "x", source: "test", url: null, timestamp, ...extra,
});

before(async () => {
  conn = await openDb();

  // FX and gold-token candles share the same day shift so their dates line up.
  const fx = parseFrankfurter(fixture("frankfurter-series"));
  const candles = parseCandles(fixture("coinbase-candles-paxg"), "daily:PAXG", "Gold token");
  const dayShift = Math.floor((NOW - DAY - newest(fx)) / DAY) * DAY;
  const candleShift = Math.floor((NOW - newest(candles)) / DAY) * DAY;

  const fng = parseFearGreed(fixture("fear-greed"));
  const fngShift = Math.floor((NOW - newest(fng)) / DAY) * DAY;
  const kp = parseKp(fixture("noaa-kp"));
  const kpShift = NOW - newest(kp) - 3_600_000;
  const quakes = parseUsgsQuakes(fixture("usgs-quakes"));
  const quakeShift = NOW - newest(quakes) - 600_000;
  const rss = parseRss2Json(fixture("rss-bbc-world"), "BBC World", "world", NOW);
  const rssShift = NOW - newest(rss) - 600_000;

  load({
    metrics: [
      ...shift(fx, dayShift),
      ...shift(candles, candleShift),
      ...shift(fng, fngShift),
      ...shift(kp, kpShift),
      ...parseTreasury(fixture("treasury")),
      ...parsePolymarket(fixture("polymarket"), NOW),
      ...parseIss(fixture("iss"), NOW),
    ],
    headlines: shift(rss, rssShift),
    events: shift(quakes, quakeShift),
  });
});

test("inserts are idempotent, including duplicates inside one batch", () => {
  const count = () => rows("SELECT count(*)::INTEGER AS n FROM world_metrics")[0].n;
  const before = count();
  const dup = metric("test:dup", "fx", 1, NOW);
  load({ metrics: [dup, dup, { ...dup, value: 2 }] });
  assert.equal(count(), before + 1, "one row for the duplicated key");
  load({ metrics: [dup] });
  assert.equal(count(), before + 1, "re-inserting is a no-op");
  assert.equal(rows("SELECT value FROM world_metrics WHERE series_id = 'test:dup'")[0].value, 1, "first write wins");
  conn.query("DELETE FROM world_metrics WHERE series_id = 'test:dup'");
});

test("latest: newest reading with previous value and 1d/7d/30d lookbacks", () => {
  const latest = rows(worldLatestSql());
  const eur = latest.find((r) => r.series_id === "fx:EUR");
  assert.equal(eur.label, "EUR/USD");
  assert.ok(eur.value > 0 && eur.prev_value > 0 && eur.d1 > 0 && eur.d7 > 0);
  assert.equal(eur.d30, null, "only two weeks of history exist");
  const ids = latest.map((r) => r.series_id);
  assert.equal(new Set(ids).size, ids.length, "one row per series");
  assert.ok(ids.includes("fx:DXY") && ids.includes("macro:FNG") && ids.includes("space:KP"));
  assert.ok(latest.some((r) => r.category === "politics"));
});

test("series: ascending by time and capped per series", () => {
  const points = rows(worldSeriesSql(["fx:EUR", "fx:JPY"], NOW - 60 * DAY, 5));
  assert.equal(points.length, 10);
  for (const id of ["fx:EUR", "fx:JPY"]) {
    const own = points.filter((p) => p.series_id === id).map((p) => p.t);
    assert.deepEqual(own, [...own].sort((a, b) => a - b));
  }
  assert.throws(() => worldSeriesSql(["x'; DROP TABLE world_metrics; --"], NOW), /Invalid series id/);
  assert.throws(() => worldSeriesSql([], NOW), /At least one/);
});

test("headlines and events come back newest first with limits", () => {
  const headlines = rows(worldHeadlinesSql(3));
  assert.equal(headlines.length, 3);
  assert.ok(headlines[0].t >= headlines[1].t && headlines[1].t >= headlines[2].t);
  const events = rows(worldEventsSql(NOW - DAY, 4));
  assert.equal(events.length, 4);
  assert.ok(events.every((e) => e.kind === "quake" && Math.abs(e.lat) <= 90));
});

test("summary joins every source into headline numbers", () => {
  // Older dollar-index point so the 30-day change can be computed.
  const [latestDxy] = rows("SELECT epoch_ms(max(event_time))::BIGINT AS t, arg_max(value, event_time) AS v FROM world_metrics WHERE series_id = 'fx:DXY'");
  load({ metrics: [metric("fx:DXY", "fx", latestDxy.v / 1.02, latestDxy.t - 35 * DAY)] });
  load({ events: [{ id: "test:big", kind: "quake", title: "M6.4 test", magnitude: 6.4, unit: "M", lat: 10, lon: 20, url: null, timestamp: NOW - 3_600_000 }] });

  const [s] = rows(worldSummarySql(NOW));
  const fng = fixture("fear-greed").data;
  assert.equal(s.fear_greed, Number(fng[0].value), "newest fear & greed reading");
  assert.equal(s.fear_greed_prev, Number(fng[1].value));
  assert.ok(Math.abs(s.dxy_change_30d_pct - 2) < 1e-6, `dxy change ${s.dxy_change_30d_pct}`);
  assert.ok(s.gold_change_1d_pct !== null && Math.abs(s.gold_change_1d_pct) < 25);
  assert.ok(s.news_count_24h >= 5 && s.news_tone_24h >= -1 && s.news_tone_24h <= 1);
  assert.ok(s.quakes_m55_24h >= 1 && s.max_quake_mag_24h >= 6.4);
  assert.ok(s.kp_max_24h >= 0 && s.kp_max_24h <= 9);
  assert.equal(s.social_posts_1h, 0);
  conn.query("DELETE FROM world_events WHERE id = 'test:big'");
});

test("cross-asset correlation: exact on constructed series, weekend-safe", () => {
  // 28 consecutive days from a Monday; FX-style series only on weekdays.
  const start = Date.UTC(2026, 0, 5); // Monday
  const rets = Array.from({ length: 28 }, (_, i) => Math.sin(i * 1.7) * 0.02 + (i % 3) * 0.004);
  const path = (scale) => {
    let value = 100;
    return rets.map((r) => (value *= 1 + scale * r));
  };
  const a = path(1);
  const b = path(2);
  const c = path(-1);
  const metrics = [];
  for (let day = 0; day < 28; day++) {
    const t = start + day * DAY;
    const weekday = new Date(t).getUTCDay();
    metrics.push(metric("t:A", "daily", a[day], t), metric("t:B", "daily", b[day], t), metric("t:C", "daily", c[day], t));
    if (weekday !== 0 && weekday !== 6) metrics.push(metric("fx:DXY", "fx", 100, t));
  }
  load({ metrics });
  const result = rows(crossAssetSql(["t:A", "t:B", "t:C"], 60, start + 30 * DAY));
  const pair = (x, y) => result.find((r) => r.x === x && r.y === y);
  assert.ok(pair("t:A", "t:A").corr > 0.999999);
  assert.ok(pair("t:A", "t:B").corr > 0.99, `A~B ${pair("t:A", "t:B").corr}`);
  assert.ok(pair("t:A", "t:C").corr < -0.99, `A~C ${pair("t:A", "t:C").corr}`);
  assert.equal(pair("t:A", "t:B").n, 19, "20 weekdays minus the first, which has no prior return");
  conn.query("DELETE FROM world_metrics WHERE series_id LIKE 't:%' OR (series_id = 'fx:DXY' AND value = 100)");
});

test("social topics and the ISS track read the right tables", () => {
  const posts = parseMastodonPosts(fixture("mastodon-bitcoin"), "$BTC", (() => { let i = 0; return () => ++i; })())
    .map((e) => ({ ...e.payload, timestamp: NOW - 120_000 }));
  conn.query(buildBetaInsertSql(posts));
  const topics = rows(socialTopicsSql(NOW, 600_000));
  assert.equal(topics.length, 1);
  assert.equal(topics[0].topic, "$BTC");
  assert.equal(topics[0].posts, posts.length);
  assert.ok(Math.abs(topics[0].posts_per_min - posts.length / 10) < 1e-9);
  const track = rows(issTrackSql(NOW - DAY));
  assert.equal(track.length, 1);
  assert.ok(Math.abs(track[0].lat) <= 52 && Math.abs(track[0].lon) <= 180, "ISS stays within its orbital latitude");
});

test("eviction keeps slow macro series and drops stale fast data", () => {
  load({
    metrics: [
      metric("old:metal", "metals", 1, NOW - 40 * DAY),
      metric("old:fx", "fx", 1, NOW - 200 * DAY),
      metric("old:macro", "macro", 1, NOW - 900 * DAY),
      metric("new:metal", "metals", 1, NOW - DAY),
    ],
    headlines: [{ id: "old:h", category: "world", source: "t", title: "t", url: "u", tone: 0, aux: null, timestamp: NOW - 5 * DAY }],
    events: [
      { id: "usgs:old", kind: "quake", title: "t", magnitude: 3, unit: "M", lat: 0, lon: 0, url: null, timestamp: NOW - 5 * DAY },
      { id: "eonet:old-fire", kind: "wildfire", title: "t", magnitude: null, unit: null, lat: 0, lon: 0, url: null, timestamp: NOW - 5 * DAY },
    ],
  });
  for (const statement of buildWorldEvictionSql(NOW)) conn.query(statement);
  const left = (table, where) => rows(`SELECT count(*)::INTEGER AS n FROM ${table} WHERE ${where}`)[0].n;
  assert.equal(left("world_metrics", "series_id = 'old:metal'"), 0);
  assert.equal(left("world_metrics", "series_id = 'old:fx'"), 1);
  assert.equal(left("world_metrics", "series_id = 'old:macro'"), 1, "macro is never evicted");
  assert.equal(left("world_metrics", "series_id = 'new:metal'"), 1);
  assert.equal(left("world_headlines", "id = 'old:h'"), 0);
  assert.equal(left("world_events", "id = 'usgs:old'"), 0);
  assert.equal(left("world_events", "id = 'eonet:old-fire'"), 1, "long-lived natural events are kept for 30 days");
});

const baseSummary = {
  fear_greed: 50, fear_greed_prev: 50, gold_change_1d_pct: 0, dxy_change_30d_pct: 0, btc_change_24h_pct: 0,
  news_tone_24h: 0, news_count_24h: 20, social_tone_1h: 0, social_posts_1h: 50,
  quakes_m55_24h: 0, max_quake_mag_24h: 4, kp_max_24h: 2, open_hazards: 0,
};

test("world index: neutral inputs sit at 50 and labels follow the score", () => {
  const neutral = computeWorldIndex(baseSummary);
  assert.ok(Math.abs(neutral.score - 55) <= 6, `neutral-ish score ${neutral.score}`);
  assert.equal(neutral.components.length, 7);
  assert.equal(neutral.coverage, 1);
  assert.deepEqual([10, 30, 50, 65, 90].map(labelFor), ["Stressed", "Cautious", "Neutral", "Confident", "Euphoric"]);
});

test("world index: stress pulls it down, calm pushes it up, gaps renormalise", () => {
  const stressed = computeWorldIndex({
    ...baseSummary, fear_greed: 10, gold_change_1d_pct: 3, dxy_change_30d_pct: 4, btc_change_24h_pct: -8,
    news_tone_24h: -0.4, quakes_m55_24h: 2, kp_max_24h: 6, open_hazards: 20,
  });
  const calm = computeWorldIndex({ ...baseSummary, fear_greed: 85, btc_change_24h_pct: 6, news_tone_24h: 0.2 });
  assert.ok(stressed.score < 25 && stressed.label === "Stressed", `stressed ${stressed.score}`);
  assert.ok(calm.score > stressed.score + 40);
  const sparse = computeWorldIndex({ ...baseSummary, fear_greed: null, gold_change_1d_pct: null, news_count_24h: 0, social_posts_1h: 0 });
  assert.ok(sparse.coverage < 1 && sparse.components.every((c) => c.id !== "fng" && c.id !== "news"));
  assert.equal(computeWorldIndex(null).components.length, 0);
  assert.equal(computeWorldIndex(null).score, 50);
  assert.ok(stressed.components.every((c) => c.score >= 0 && c.score <= 100));
});

test("world advisor: each rule fires on its trigger and stays quiet otherwise", () => {
  const index = computeWorldIndex(baseSummary);
  const calm = buildWorldAdvice({ summary: baseSummary, latest: [], index, cross: [] });
  assert.equal(calm.length, 1);
  assert.equal(calm[0].id, "world-calm");

  const summary = {
    ...baseSummary, fear_greed: 12, gold_change_1d_pct: 2.1, btc_change_24h_pct: -5, dxy_change_30d_pct: -3,
    news_tone_24h: -0.5, max_quake_mag_24h: 6.8, kp_max_24h: 7.3,
  };
  const latest = [
    { series_id: "poly:1", category: "politics", label: "Will X win?", unit: "%", source: "Polymarket", url: null, value: 63, aux: 25_000, t: NOW, prev_value: 50, d1: 51, d7: null, d30: null },
    { series_id: "poly:3", category: "politics", label: "Thin market", unit: "%", source: "Kalshi", url: null, value: 60, aux: 12, t: NOW, prev_value: 20, d1: 20, d7: null, d30: null },
    { series_id: "poly:2", category: "politics", label: "Small move", unit: "%", source: "Polymarket", url: null, value: 40, aux: 1, t: NOW, prev_value: 39, d1: 39, d7: null, d30: null },
    { series_id: "aq:Delhi", category: "weather", label: "Delhi air quality", unit: "AQI", source: "o", url: null, value: 210, aux: 90, t: NOW, prev_value: null, d1: null, d7: null, d30: null },
    { series_id: "macro:TBILL", category: "macro", label: "b", unit: "%", source: "t", url: null, value: 3.8, aux: null, t: NOW, prev_value: null, d1: null, d7: null, d30: null },
    { series_id: "macro:TNOTE", category: "macro", label: "n", unit: "%", source: "t", url: null, value: 3.3, aux: null, t: NOW, prev_value: null, d1: null, d7: null, d30: null },
  ];
  const cross = [
    { x: "daily:PAXG", y: "fx:DXY", corr: -0.62, n: 40 },
    { x: "daily:BTC", y: "daily:ETH", corr: 0.9, n: 40 },
    { x: "daily:BTC", y: "daily:BTC", corr: 1, n: 40 },
    { x: "daily:BTC", y: "fx:JPY", corr: 0.9, n: 5 },
  ];
  const advice = buildWorldAdvice({ summary, latest, index: computeWorldIndex(summary), cross });
  const ids = advice.map((a) => a.id);
  for (const id of ["world-fng-fear", "world-gold-move", "world-flight-to-safety", "world-usd-trend", "world-news-negative", "world-quake", "world-geomagnetic", "world-market-poly:1", "world-aqi-aq:Delhi", "world-yield-inversion"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  assert.ok(!ids.includes("world-market-poly:2"), "a 1-point move is not news");
  assert.ok(!ids.includes("world-market-poly:3"), "a 40-point move on a thin market is ignored");
  assert.equal(advice.find((a) => a.id === "world-geomagnetic").severity, "critical", "Kp 7+ is critical");
  assert.equal(advice[0].severity, "critical", "sorted by severity");
  assert.ok(advice.every((a) => a.stream === "world"));
  assert.ok(advice.length <= 12);
  const crossIds = ids.filter((id) => id.startsWith("world-cross-"));
  assert.ok(crossIds.every((id) => !id.includes("daily:BTC-daily:BTC")), "self-correlation is ignored");
  assert.ok(!ids.some((id) => id.includes("fx:JPY")), "correlations from fewer than 20 days are ignored");
});
