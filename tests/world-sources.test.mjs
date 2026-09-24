import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb, toRows } from "./helpers.mjs";
import { buildWorldBatchInsertSql } from "../src/analytics/schema.ts";
import { worldLatestSql } from "../src/analytics/worldSql.ts";
import { WORLD_SOURCES } from "../src/world/sources.ts";
import { startWorldScheduler } from "../src/world/scheduler.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));

/** Maps each real request URL to the captured response it would have returned. */
function fixtureFetch() {
  const routes = [
    ["api.frankfurter.dev", "frankfurter-series"],
    ["api.exchange.coinbase.com", "coinbase-candles-paxg"],
    ["simple/price", "coingecko-price"],
    ["coingecko.com/api/v3/global", "coingecko-global"],
    ["mempool.space/api/v1/fees", "mempool-fees"],
    ["alternative.me", "fear-greed"],
    ["fiscaldata.treasury.gov", "treasury"],
    ["api.worldbank.org", "worldbank-gdp"],
    ["gamma-api.polymarket.com", "polymarket"],
    ["api.elections.kalshi.com", "kalshi"],
    ["api.rss2json.com", "rss-bbc-world"],
    ["hn.algolia.com", "hn-algolia"],
    ["en.wikipedia.org", "wiki-feed"],
    ["earthquake.usgs.gov", "usgs-quakes"],
    ["eonet.gsfc.nasa.gov", "eonet"],
    ["services.swpc.noaa.gov", "noaa-kp"],
    ["api.wheretheiss.at", "iss"],
    ["air-quality-api.open-meteo.com", "air-quality"],
    ["api.open-meteo.com", "open-meteo"],
  ];
  const calls = [];
  return {
    calls,
    json: async (url) => {
      calls.push(url);
      const gold = /gold-api\.com\/price\/([A-Z]+)/.exec(url);
      if (gold) {
        const base = fixture("gold-xau");
        const price = { XAU: base.price, XAG: base.price / 70 }[gold[1]] ?? base.price / 100;
        return { ...base, symbol: gold[1], price };
      }
      const route = routes.find(([needle]) => url.includes(needle));
      if (!route) throw new Error(`no fixture for ${url}`);
      return fixture(route[1]);
    },
    text: async (url) => {
      calls.push(url);
      if (url.includes("tip/height")) return "900123";
      throw new Error(`no text fixture for ${url}`);
    },
  };
}

test("source catalogue: unique ids, sane intervals, every group named", () => {
  const ids = WORLD_SOURCES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(WORLD_SOURCES.length >= 15);
  for (const source of WORLD_SOURCES) {
    assert.ok(source.intervalMs >= 30_000 && source.intervalMs <= 12 * 3_600_000, `${source.id} interval`);
    assert.ok(source.label && source.group);
  }
  const fastest = Math.min(...WORLD_SOURCES.map((s) => s.intervalMs));
  assert.ok(fastest >= 30_000, "no source polls faster than every 30s");
});

test("every source turns its real response shape into rows, and they all load into DuckDB", async () => {
  const conn = await openDb();
  const fetcher = fixtureFetch();
  const now = Date.now();
  const perSource = {};
  for (const source of WORLD_SOURCES) {
    const batch = await source.run({ now, json: fetcher.json, text: fetcher.text });
    const rows = batch.metrics.length + batch.headlines.length + batch.events.length;
    perSource[source.id] = rows;
    for (const statement of buildWorldBatchInsertSql(batch)) conn.query(statement);
  }
  for (const [id, rows] of Object.entries(perSource)) {
    if (id === "wiki") continue; // fixture is dated, so freshness filtering may legitimately drop it
    assert.ok(rows > 0, `${id} produced no rows`);
  }
  assert.ok(perSource.fx > 100, "90-day history is many rows");
  const latest = toRows(conn.query(worldLatestSql()));
  const categories = new Set(latest.map((r) => r.category));
  for (const category of ["fx", "metals", "crypto", "macro", "politics", "space", "weather", "daily"]) {
    assert.ok(categories.has(category), `no ${category} series after loading`);
  }
  assert.ok(latest.some((r) => r.series_id === "metal:GSR"), "gold/silver ratio is derived when both spots exist");
  assert.ok(fetcher.calls.some((u) => u.includes("PAXG-USD")) && fetcher.calls.some((u) => u.includes("ETH-USD")));
  assert.ok(fetcher.calls.filter((u) => u.includes("rss2json")).length === 6, "one request per news feed");
});

test("a source with one failing request still returns the rest; all failing throws", async () => {
  const fetcher = fixtureFetch();
  const news = WORLD_SOURCES.find((s) => s.id === "news");
  const flaky = async (url) => {
    if (url.includes(encodeURIComponent("https://www.theguardian.com/world/rss"))) throw new Error("guardian down");
    return fetcher.json(url);
  };
  const partial = await news.run({ now: Date.now(), json: flaky, text: fetcher.text });
  assert.ok(partial.headlines.length > 0);
  const dead = async () => { throw new Error("offline"); };
  await assert.rejects(news.run({ now: Date.now(), json: dead, text: dead }), /offline/);
});

function fakeTimers() {
  let clock = 0;
  let nextId = 1;
  const queue = new Map();
  return {
    now: () => clock,
    setTimer: (callback, ms) => { const id = nextId++; queue.set(id, { at: clock + ms, callback }); return id; },
    clearTimer: (id) => queue.delete(id),
    pending: () => queue.size,
    async advance(ms) {
      const target = clock + ms;
      for (;;) {
        const due = [...queue.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        queue.delete(due[0]);
        clock = due[1].at;
        due[1].callback();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
      clock = target;
    },
  };
}

test("scheduler: staggered start, steady polling, exponential backoff, recovery, stop", async () => {
  const timers = fakeTimers();
  const statuses = new Map();
  const persisted = [];
  let failNext = 0;
  const source = (id, intervalMs, behaviour) => ({
    id, label: id, group: "g", intervalMs,
    run: async () => { behaviour(); return { metrics: [{ seriesId: id }], headlines: [], events: [] }; },
  });
  const sources = [
    source("steady", 1000, () => {}),
    source("flaky", 1000, () => { if (failNext > 0) { failNext--; throw new Error("boom"); } }),
  ];
  failNext = 3;
  const scheduler = startWorldScheduler({
    sources,
    onBatch: async (batch, s) => { persisted.push(s.id); },
    onStatus: (status) => statuses.set(status.id, status),
    fetchContext: () => ({ json: async () => ({}), text: async () => "" }),
    now: timers.now, setTimer: timers.setTimer, clearTimer: timers.clearTimer, staggerMs: 100,
  });
  assert.equal(statuses.get("steady").state, "pending");

  await timers.advance(50);
  assert.equal(statuses.get("steady").state, "ok", "first source runs immediately");
  assert.equal(statuses.get("flaky").state, "pending", "second source waits for its stagger");
  await timers.advance(100);
  assert.equal(statuses.get("flaky").state, "error");
  assert.equal(statuses.get("flaky").lastError, "boom");

  // Failures at t=100 (next in 2s), t=2100 (next in 4s), t=6100 (next in 8s), then success at t=14100.
  await timers.advance(1990);
  assert.equal(statuses.get("flaky").state, "error");
  await timers.advance(3900);
  await timers.advance(8100);
  assert.equal(statuses.get("flaky").state, "ok", "recovers after the failures are exhausted");
  assert.equal(statuses.get("flaky").lastError, null);
  assert.ok(statuses.get("steady").rows >= 10, "steady source keeps polling every second");
  assert.ok(persisted.includes("flaky"));

  scheduler.stop();
  assert.equal(timers.pending(), 0, "stop cancels every timer");
  const before = statuses.get("steady").rows;
  await timers.advance(5000);
  assert.equal(statuses.get("steady").rows, before, "nothing runs after stop");
});

test("scheduler: a failing persist step is reported as a source error", async () => {
  const timers = fakeTimers();
  let status;
  startWorldScheduler({
    sources: [{ id: "x", label: "x", group: "g", intervalMs: 1000, run: async () => ({ metrics: [], headlines: [], events: [] }) }],
    onBatch: async () => { throw new Error("db full"); },
    onStatus: (s) => { status = s; },
    fetchContext: () => ({ json: async () => ({}), text: async () => "" }),
    now: timers.now, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  await timers.advance(10);
  assert.equal(status.state, "error");
  assert.equal(status.lastError, "db full");
});
