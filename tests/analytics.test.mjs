import { test, before } from "node:test";
import assert from "node:assert/strict";
import { openDb, simulate, toRows } from "./helpers.mjs";
import * as sql from "../src/analytics/sql.ts";
import { prepareReadOnlySql } from "../src/analytics/sqlGuard.ts";
import { buildAdvice, isSignificant } from "../src/analytics/advisor.ts";
import { evaluateAlerts, trendTag } from "../src/analytics/alerts.ts";

const endMs = 1_800_000_000_000;
const ctx = { nowMs: endMs, tzOffsetMinutes: -240 };
const oneMinute = { id: "1m", label: "1m", windowMs: 60_000, bucketSeconds: 2, pollMs: 1000 };
const fifteen = { id: "15m", label: "15m", windowMs: 900_000, bucketSeconds: 30, pollMs: 2000 };
let conn;
const rows = (text) => toRows(conn.query(text));

before(async () => {
  conn = await openDb();
  simulate(conn, { seconds: 900, endMs });
});

test("candles are valid OHLC with indicators and local-time labels", () => {
  const result = rows(sql.candlesSql(ctx, oneMinute));
  assert.ok(result.length >= 6 * 25, `expected ~30 candles per symbol, got ${result.length}`);
  for (const r of result) {
    assert.ok(r.low <= Math.min(r.open, r.close) + 1e-9, "low is the minimum");
    assert.ok(r.high >= Math.max(r.open, r.close) - 1e-9, "high is the maximum");
    assert.ok(r.volume > 0);
    assert.match(r.label, /^\d\d:\d\d:\d\d$/);
  }
  const last = result.filter((r) => r.symbol === "AAPL").at(-1);
  assert.ok(last.sma10 !== null && last.sma60 !== null, "SMAs present once enough history exists");
  assert.ok(last.bb_sd >= 0);
  assert.ok(Math.abs(last.obi) <= 1);
  // Endpoint 04:00:00 local = 08:00:00 UTC, so the last candle is 03:59:xx local.
  assert.equal(last.label.slice(0, 5), "03:59");
});

test("candle bucket width follows the selected range", () => {
  const result = rows(sql.candlesSql(ctx, fifteen)).filter((r) => r.symbol === "MSFT");
  assert.ok(result.length >= 25 && result.length <= 32, `got ${result.length}`);
  assert.equal(result[1].bucket_ms - result[0].bucket_ms, 30_000);
});

test("sentiment, diagnostics and status queries return usable rows", () => {
  const s = rows(sql.sentimentSql(ctx, oneMinute));
  assert.ok(s.length >= 25);
  assert.ok(s.every((r) => r.velocity > 0));
  const d = rows(sql.diagnosticsSql(ctx, oneMinute));
  assert.ok(d.length >= 25);
  assert.ok(d.every((r) => r.max_cpu_temp >= r.avg_cpu_temp));
  const status = rows(sql.statusSql(ctx));
  const total = status.reduce((sum, r) => sum + r.cnt, 0);
  assert.equal(total, 12, "every device is counted exactly once");
  const known = new Set(["nominal", "warning", "throttled", "offline"]);
  assert.ok(status.every((r) => known.has(r.status)));
});

test("device statuses are a genuine mix over time, not a static block", () => {
  const seen = new Set(rows("SELECT DISTINCT status FROM gamma_diagnostics").map((r) => r.status));
  for (const expected of ["nominal", "warning", "throttled", "offline"]) {
    assert.ok(seen.has(expected), `missing status ${expected}`);
  }
});

test("KPI query returns current and previous windows plus alert inputs", () => {
  const [k] = rows(sql.kpiSql(ctx, 60_000));
  assert.equal(k.active_symbols, 6);
  assert.equal(k.prev_active_symbols, 6);
  assert.equal(k.device_count, 12);
  assert.ok(k.post_velocity > 0 && k.prev_post_velocity > 0);
  assert.ok(k.health_pct >= 0 && k.health_pct <= 100);
  assert.ok(k.alert_peak_cpu > 0);
  assert.match(k.alert_peak_device, /^edge-node-\d\d$/);
});

test("REGR_SLOPE/REGR_INTERCEPT reproduce a known line exactly", () => {
  const c = conn;
  c.query("CREATE TABLE line_check (t DOUBLE, y DOUBLE)");
  c.query("INSERT INTO line_check SELECT i, 3.0 + 0.5 * i FROM range(0, 40) r(i)");
  const [fit] = rows("SELECT regr_slope(y, t) AS slope, regr_intercept(y, t) AS intercept, regr_r2(y, t) AS r2 FROM line_check");
  assert.ok(Math.abs(fit.slope - 0.5) < 1e-9);
  assert.ok(Math.abs(fit.intercept - 3) < 1e-9);
  assert.ok(Math.abs(fit.r2 - 1) < 1e-9);
  c.query("DROP TABLE line_check");
});

test("trend lines fit every symbol; intercept is anchored at the window start", () => {
  const trends = rows(sql.trendSql(ctx, sql.TREND_WINDOW_MS));
  assert.equal(trends.length, 6);
  for (const t of trends) {
    assert.ok(Number.isFinite(t.slope) && Number.isFinite(t.intercept));
    assert.ok(t.n >= 100);
    const fittedNow = t.intercept + t.slope * 60;
    assert.ok(Math.abs(fittedNow - t.last_price) / t.last_price < 0.05, "fit ends near the last price");
  }
});

test("alpha signals include SMA crossovers, Bollinger inputs and order-book imbalance", () => {
  const signals = rows(sql.alphaSignalSql(ctx));
  assert.equal(signals.length, 6);
  for (const s of signals) {
    assert.ok(s.n_sec >= 60);
    assert.ok([-1, 0, 1].includes(s.cross_recent));
    assert.ok(s.bb_sd >= 0 && Math.abs(s.obi) <= 1);
  }
});

test("regressing ln(temperature) recovers an exact exponential growth rate", () => {
  conn.query("CREATE TABLE exp_check (temp DOUBLE, t DOUBLE)");
  conn.query("INSERT INTO exp_check SELECT 40 * exp(0.01 * i), i FROM range(0, 40) r(i)");
  const [fit] = rows(
    "SELECT regr_slope(ln(temp), t) AS k, regr_intercept(ln(temp), t) AS b FROM exp_check"
  );
  conn.query("DROP TABLE exp_check");
  assert.ok(Math.abs(fit.k - 0.01) < 1e-9, `k=${fit.k}`);
  assert.ok(Math.abs(fit.b - Math.log(40)) < 1e-9);
});

test("the gamma query finds heating devices mid-climb in simulated traffic", () => {
  const hot = rows(sql.gammaSignalSql(ctx, sql.GAMMA_FIT_WINDOW_MS)).filter(
    (g) => g.temp_growth_k > 0.004 && g.temp_r2 > 0.6
  );
  assert.ok(hot.length >= 1, "at least one heater is mid-climb");
  assert.ok(hot.every((g) => /^edge-node-(02|06|10)$/.test(g.device_id)), "only heaters climb");
});

test("memory leak rate is detected in %/min on leaking devices", () => {
  const leaking = rows(sql.gammaSignalSql(ctx, sql.GAMMA_FIT_WINDOW_MS)).filter(
    (g) => g.leak_rate_per_min > 1 && g.mem_r2 > 0.6
  );
  assert.ok(leaking.length >= 1);
  assert.ok(leaking.every((g) => g.leak_rate_per_min < 15));
});

test("beta signals expose post velocity and influencer impact", () => {
  const beta = rows(sql.betaSignalSql(ctx));
  assert.equal(beta.length, 8);
  assert.ok(beta.every((b) => b.velocity_avg > 0 && Number.isFinite(b.impact)));
});

test("correlation matrix covers all lags and only symbols with topics", () => {
  const corr = rows(sql.correlationSql(ctx));
  assert.deepEqual(corr.map((c) => c.symbol), ["AAPL", "AMZN", "JPM", "MSFT", "NVDA", "TSLA"]);
  for (const c of corr) {
    for (const key of ["sent_c10", "sent_c30", "sent_c60", "vol_c10", "vol_c30", "vol_c60"]) {
      assert.ok(c[key] === null || Math.abs(c[key]) <= 1 + 1e-9, `${key} in [-1,1]`);
    }
    assert.ok(c.n10 >= c.n30 && c.n30 >= c.n60, "longer lags have fewer usable samples");
  }
});

test("read-only guard", () => {
  assert.equal(prepareReadOnlySql("SELECT 1;").ok, true);
  assert.equal(prepareReadOnlySql("  -- note\n WITH a AS (SELECT 1) SELECT * FROM a").ok, true);
  assert.equal(prepareReadOnlySql("SELECT ';' AS semi").ok, true, "semicolon inside a string is fine");
  assert.equal(prepareReadOnlySql("DESCRIBE alpha_ticks").ok, true);
  for (const bad of [
    "DROP TABLE alpha_ticks",
    "DELETE FROM alpha_ticks",
    "SELECT 1; DROP TABLE alpha_ticks",
    "INSERT INTO alpha_ticks VALUES (1)",
    "COPY alpha_ticks TO 'x.csv'",
    "EXPLAIN ANALYZE SELECT 1",
    "",
    "/* only a comment */",
    "SELECT 'unterminated",
  ]) {
    assert.equal(prepareReadOnlySql(bad).ok, false, `should reject: ${bad}`);
  }
  const wrapped = prepareReadOnlySql("SELECT count(*) AS n FROM alpha_ticks;");
  assert.equal(wrapped.ok && wrapped.wrappable, true);
  assert.equal(rows(`SELECT * FROM (${wrapped.sql}) LIMIT 5`)[0].n > 0, true);
});

test("significance bar scales with sample size", () => {
  assert.equal(isSignificant(0.31, 45), false, "0.31 is within noise for 45 samples");
  assert.equal(isSignificant(0.5, 45), true);
  assert.equal(isSignificant(0.9, 5), false, "too few samples");
  assert.equal(isSignificant(null, 100), false);
});

test("trend tags: direction, sign, and good/bad tone", () => {
  assert.deepEqual(trendTag(102.4, 100, "percent", true), { text: "+2.4% \u25b2", direction: "up", tone: "good" });
  assert.deepEqual(trendTag(98.9, 100, "percent", true), { text: "-1.1% \u25bc", direction: "down", tone: "bad" });
  assert.equal(trendTag(90, 80, "percent", false).tone, "bad", "hotter CPU is bad");
  assert.equal(trendTag(0.12, -0.05, "absolute", true).text, "+0.17 \u25b2");
  assert.equal(trendTag(100, 100, "percent", true).direction, "flat");
  assert.equal(trendTag(5, null, "percent", true), null);
  assert.equal(trendTag(5, 0, "percent", true), null);
});

test("threshold alerts fire below -0.5 sentiment and above 85C", () => {
  const base = { alert_min_sentiment: -0.2, alert_min_topic: "$TSLA", alert_peak_cpu: 70, alert_peak_device: "edge-node-02" };
  assert.deepEqual(evaluateAlerts(base), []);
  assert.deepEqual(evaluateAlerts({ ...base, alert_min_sentiment: -0.5 }), [], "boundary is exclusive");
  const both = evaluateAlerts({ ...base, alert_min_sentiment: -0.61, alert_peak_cpu: 88.4 });
  assert.deepEqual(both.map((a) => a.id), ["sentiment", "cpu"]);
  assert.match(both[0].message, /\$TSLA/);
  assert.match(both[1].message, /edge-node-02/);
  assert.deepEqual(evaluateAlerts(null), []);
});

function snapshot(overrides = {}) {
  const now = endMs;
  return {
    generatedAt: now,
    trendCutoffMs: now - 60_000,
    gammaCutoffMs: now - 45_000,
    trends: [],
    alpha: [],
    beta: [],
    gamma: [],
    correlations: [],
    ...overrides,
  };
}

test("advisor: quiet market yields an all-clear", () => {
  const advice = buildAdvice(snapshot());
  assert.equal(advice.length, 1);
  assert.equal(advice[0].id, "all-clear");
  assert.equal(buildAdvice(null)[0].id, "warming-up");
});

test("advisor: exponential heating predicts time to throttle", () => {
  // ln T = ln 40 + 0.01 t  ->  T reaches 85 at t = ln(85/40)/0.01 = 75.4s; now t = 45s -> ~30s left.
  const advice = buildAdvice(
    snapshot({
      gamma: [
        { device_id: "edge-node-02", status: "nominal", n: 30, mem_now: 40, leak_rate_per_min: 0, mem_r2: 0.1,
          temp_now: 62.7, temp_growth_k: 0.01, temp_intercept: Math.log(40), temp_r2: 0.99 },
      ],
    })
  );
  const item = advice.find((a) => a.id === "heat-edge-node-02");
  assert.ok(item, "prediction present");
  assert.equal(item.severity, "critical", "under 60s is critical");
  const seconds = Number(/~(\d+)s/.exec(item.headline)[1]);
  assert.ok(Math.abs(seconds - 30) <= 1, `eta ${seconds}`);
});

test("advisor: throttled device and memory exhaustion", () => {
  const advice = buildAdvice(
    snapshot({
      gamma: [
        { device_id: "edge-node-10", status: "throttled", n: 30, mem_now: 50, leak_rate_per_min: 0, mem_r2: 0,
          temp_now: 91, temp_growth_k: 0.005, temp_intercept: 3, temp_r2: 0.9 },
        { device_id: "edge-node-03", status: "nominal", n: 30, mem_now: 60, leak_rate_per_min: 5, mem_r2: 0.99,
          temp_now: 50, temp_growth_k: 0, temp_intercept: 3.9, temp_r2: 0.1 },
        { device_id: "edge-node-04", status: "offline", n: 30, mem_now: 99, leak_rate_per_min: 9, mem_r2: 0.99,
          temp_now: 99, temp_growth_k: 0.02, temp_intercept: 3, temp_r2: 0.99 },
      ],
    })
  );
  assert.equal(advice[0].id, "throttled-edge-node-10", "critical sorts first");
  const leak = advice.find((a) => a.id === "leak-edge-node-03");
  assert.equal(leak.severity, "warning", "5 min < eta <= 15 min");
  assert.match(leak.detail, /about 8\.0 min/);
  const imminent = buildAdvice(
    snapshot({
      gamma: [
        { device_id: "edge-node-07", status: "nominal", n: 30, mem_now: 80, leak_rate_per_min: 5, mem_r2: 0.99,
          temp_now: 50, temp_growth_k: 0, temp_intercept: 3.9, temp_r2: 0.1 },
      ],
    })
  ).find((a) => a.id === "leak-edge-node-07");
  assert.equal(imminent.severity, "critical", "4 min to exhaustion is critical");
  assert.ok(!advice.some((a) => a.id.includes("edge-node-04")), "offline devices are skipped");
});

test("advisor: alpha confluence, golden cross, Bollinger and imbalance", () => {
  const advice = buildAdvice(
    snapshot({
      trends: [{ symbol: "NVDA", slope: 0.05, intercept: 100, r2: 0.9, n: 200, last_price: 103 }],
      alpha: [
        { symbol: "NVDA", price: 103, sma10: 102, sma60: 100, bb_mid: 100, bb_sd: 1, cross_recent: 1, n_sec: 120, obi: 0.4 },
      ],
    })
  );
  const ids = advice.map((a) => a.id);
  for (const id of ["confluence-NVDA", "cross-NVDA", "bollinger-NVDA", "obi-NVDA", "trend-NVDA"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  assert.match(advice.find((a) => a.id === "cross-NVDA").headline, /golden/);
  assert.match(advice.find((a) => a.id === "trend-NVDA").detail, /projects 104\.500 in 30s/);
});

test("advisor: crossovers need a full 60s of history", () => {
  const advice = buildAdvice(
    snapshot({ alpha: [{ symbol: "AAPL", price: 100, sma10: 101, sma60: 100, bb_mid: 100, bb_sd: 1, cross_recent: 1, n_sec: 30, obi: 0 }] })
  );
  assert.ok(!advice.some((a) => a.id === "cross-AAPL"));
});

test("advisor: social surge and lead-lag verdict", () => {
  const strong = (symbol) => ({ symbol, sent_c10: 0.05, sent_c30: 0.1, sent_c60: 0.55, vol_c10: 0.4, vol_c30: 0, vol_c60: 0, n10: 50, n30: 46, n60: 40 });
  const advice = buildAdvice(
    snapshot({
      beta: [{ topic: "$TSLA", velocity_now: 120, velocity_avg: 20, impact: 1.2, sentiment_now: -0.2, sentiment_avg: -0.1, weighted_sentiment: -0.55 }],
      correlations: [strong("AAPL"), strong("MSFT"), { ...strong("JPM"), sent_c60: 0.05, vol_c10: 0 }],
    })
  );
  const ids = advice.map((a) => a.id);
  assert.ok(ids.includes("surge-$TSLA") && ids.includes("bearish-$TSLA"));
  assert.ok(ids.includes("lead-sent-AAPL") && ids.includes("lead-vol-MSFT"));
  assert.ok(!ids.includes("lead-sent-JPM"));
  const summary = advice.find((a) => a.id === "lead-summary");
  assert.equal(summary.severity, "warning");
  assert.match(summary.headline, /2 of 3 symbols/);
});

test("advisor: noise-level correlations are not reported as leading", () => {
  const noisy = { symbol: "AAPL", sent_c10: 0.25, sent_c30: -0.2, sent_c60: 0.28, vol_c10: 0.2, vol_c30: 0.1, vol_c60: 0, n10: 45, n30: 42, n60: 38 };
  const advice = buildAdvice(snapshot({ correlations: [noisy] }));
  assert.ok(!advice.some((a) => a.id.startsWith("lead-sent") || a.id.startsWith("lead-vol")));
  assert.equal(advice.find((a) => a.id === "lead-summary").severity, "info");
});
