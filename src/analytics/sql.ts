import type { QueryContext, RangeConfig } from "../types/analytics";

/**
 * SQL builders for every chart, KPI and forecasting query. Every interpolated
 * value is a number derived here, never user text, so the strings are safe to
 * hand straight to DuckDB.
 */

function int(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot build SQL from non-finite number: ${value}`);
  }
  return Math.trunc(value);
}

function ts(ms: number): string {
  return `epoch_ms(${int(ms)})`;
}

function since(ctx: QueryContext, windowMs: number): string {
  return ts(ctx.nowMs - windowMs);
}

function localLabel(bucketExpr: string, ctx: QueryContext): string {
  return `strftime(${bucketExpr} + to_minutes(${int(ctx.tzOffsetMinutes)}), '%H:%M:%S')`;
}

/**
 * Per-second price series with the Alpha indicators computed via time-based
 * window functions: 10s/60s SMAs, 20s Bollinger bands (mean and population
 * stddev) and the SMA crossover direction (+1 golden, -1 death, 0 none).
 */
function indicatorCtes(fromTs: string): string {
  return `sec AS (
    SELECT symbol, time_bucket(INTERVAL 1 SECOND, event_time) AS b, avg(price) AS p
    FROM alpha_ticks WHERE event_time > ${fromTs}
    GROUP BY 1, 2
  ),
  ind AS (
    SELECT symbol, b, p,
      avg(p) OVER w10 AS sma10,
      avg(p) OVER w60 AS sma60,
      avg(p) OVER w20 AS bb_mid,
      coalesce(stddev_pop(p) OVER w20, 0) AS bb_sd
    FROM sec
    WINDOW
      w10 AS (PARTITION BY symbol ORDER BY b RANGE BETWEEN INTERVAL 9 SECOND PRECEDING AND CURRENT ROW),
      w20 AS (PARTITION BY symbol ORDER BY b RANGE BETWEEN INTERVAL 19 SECOND PRECEDING AND CURRENT ROW),
      w60 AS (PARTITION BY symbol ORDER BY b RANGE BETWEEN INTERVAL 59 SECOND PRECEDING AND CURRENT ROW)
  ),
  xo AS (
    SELECT symbol, b, p, sma10, sma60, bb_mid, bb_sd,
      sign(sma10 - sma60) AS side,
      lag(sign(sma10 - sma60)) OVER (PARTITION BY symbol ORDER BY b) AS prev_side
    FROM ind
  ),
  fl AS (
    SELECT symbol, b, p, sma10, sma60, bb_mid, bb_sd,
      CASE WHEN prev_side IS NOT NULL AND side <> 0 AND prev_side <> 0 AND side <> prev_side
           THEN side ELSE 0 END AS cross_side
    FROM xo
  )`;
}

export function candlesSql(ctx: QueryContext, range: RangeConfig): string {
  const bucket = int(range.bucketSeconds);
  const visibleFrom = since(ctx, range.windowMs);
  const indicatorFrom = since(ctx, range.windowMs + 60_000);
  return `WITH ${indicatorCtes(indicatorFrom)},
  ind_b AS (
    SELECT symbol, time_bucket(INTERVAL ${bucket} SECOND, b) AS bk,
      arg_max(sma10, b) AS sma10, arg_max(sma60, b) AS sma60,
      arg_max(bb_mid, b) AS bb_mid, arg_max(bb_sd, b) AS bb_sd,
      sum(cross_side) AS cross_dir
    FROM fl GROUP BY 1, 2
  ),
  cnd AS (
    SELECT symbol, time_bucket(INTERVAL ${bucket} SECOND, event_time) AS bk,
      arg_min(price, event_time) AS open, arg_max(price, event_time) AS close,
      min(price) AS low, max(price) AS high, sum(volume) AS volume,
      avg((bid_size - ask_size) / NULLIF(bid_size + ask_size, 0)) AS obi
    FROM alpha_ticks WHERE event_time > ${visibleFrom}
    GROUP BY 1, 2
  )
  SELECT c.symbol, ${localLabel("c.bk", ctx)} AS label, epoch_ms(c.bk)::BIGINT AS bucket_ms,
    c.open, c.close, c.low, c.high, c.volume, c.obi,
    i.sma10, i.sma60, i.bb_mid, i.bb_sd, i.cross_dir::INTEGER AS cross_dir
  FROM cnd c LEFT JOIN ind_b i ON i.symbol = c.symbol AND i.bk = c.bk
  ORDER BY c.bk, c.symbol;`;
}

export function sentimentSql(ctx: QueryContext, range: RangeConfig): string {
  const bucket = int(range.bucketSeconds);
  return `SELECT ${localLabel("bk", ctx)} AS label, avg_sentiment, weighted_sentiment, velocity, impact
  FROM (
    SELECT time_bucket(INTERVAL ${bucket} SECOND, event_time) AS bk,
      avg(sentiment_score) AS avg_sentiment,
      sum(sentiment_score * influencer_followers) / NULLIF(sum(influencer_followers), 0) AS weighted_sentiment,
      sum(mention_volume) / ${bucket}.0 AS velocity,
      avg(influencer_impact) AS impact
    FROM beta_sentiment WHERE event_time > ${since(ctx, range.windowMs)}
    GROUP BY 1
  ) ORDER BY bk;`;
}

export function diagnosticsSql(ctx: QueryContext, range: RangeConfig): string {
  const bucket = int(range.bucketSeconds);
  return `SELECT ${localLabel("bk", ctx)} AS label, avg_latency, avg_cpu_temp, max_cpu_temp, avg_memory
  FROM (
    SELECT time_bucket(INTERVAL ${bucket} SECOND, event_time) AS bk,
      avg(network_latency_ms) AS avg_latency,
      avg(cpu_temperature_celsius) AS avg_cpu_temp,
      max(cpu_temperature_celsius) AS max_cpu_temp,
      avg(memory_utilization_percent) AS avg_memory
    FROM gamma_diagnostics WHERE event_time > ${since(ctx, range.windowMs)}
    GROUP BY 1
  ) ORDER BY bk;`;
}

/** Number of devices currently in each state (latest reading per device). */
export function statusSql(ctx: QueryContext): string {
  return `SELECT status, count(*)::INTEGER AS cnt
  FROM (
    SELECT device_id, arg_max(status, event_time) AS status
    FROM gamma_diagnostics WHERE event_time > ${since(ctx, 30_000)}
    GROUP BY device_id
  ) GROUP BY status;`;
}

export function kpiSql(ctx: QueryContext, windowMs: number): string {
  const c1 = since(ctx, windowMs);
  const c2 = since(ctx, windowMs * 2);
  const cAlert = since(ctx, 15_000);
  const seconds = windowMs / 1000;
  return `WITH topic_now AS (
    SELECT topic, avg(sentiment_score) AS a FROM beta_sentiment
    WHERE event_time > ${cAlert} GROUP BY topic HAVING count(*) >= 3
  ),
  device_now AS (
    SELECT device_id, arg_max(cpu_temperature_celsius, event_time) AS t
    FROM gamma_diagnostics WHERE event_time > ${cAlert} GROUP BY device_id
  )
  SELECT
    (SELECT NULLIF(count(DISTINCT symbol), 0) FROM alpha_ticks WHERE event_time > ${c1})::INTEGER AS active_symbols,
    (SELECT NULLIF(count(DISTINCT symbol), 0) FROM alpha_ticks WHERE event_time > ${c2} AND event_time <= ${c1})::INTEGER AS prev_active_symbols,
    (SELECT avg(sentiment_score) FROM beta_sentiment WHERE event_time > ${c1}) AS avg_sentiment,
    (SELECT avg(sentiment_score) FROM beta_sentiment WHERE event_time > ${c2} AND event_time <= ${c1}) AS prev_avg_sentiment,
    (SELECT max(cpu_temperature_celsius) FROM gamma_diagnostics WHERE event_time > ${c1}) AS peak_cpu_temp,
    (SELECT max(cpu_temperature_celsius) FROM gamma_diagnostics WHERE event_time > ${c2} AND event_time <= ${c1}) AS prev_peak_cpu_temp,
    (SELECT count(*) FILTER (WHERE status = 'nominal') * 100.0 / NULLIF(count(*), 0) FROM gamma_diagnostics WHERE event_time > ${c1}) AS health_pct,
    (SELECT count(*) FILTER (WHERE status = 'nominal') * 100.0 / NULLIF(count(*), 0) FROM gamma_diagnostics WHERE event_time > ${c2} AND event_time <= ${c1}) AS prev_health_pct,
    (SELECT NULLIF(count(DISTINCT device_id), 0) FROM gamma_diagnostics WHERE event_time > ${c1})::INTEGER AS device_count,
    (SELECT NULLIF(count(DISTINCT device_id), 0) FROM gamma_diagnostics WHERE event_time > ${c2} AND event_time <= ${c1})::INTEGER AS prev_device_count,
    (SELECT sum(mention_volume) / ${seconds} FROM beta_sentiment WHERE event_time > ${c1}) AS post_velocity,
    (SELECT sum(mention_volume) / ${seconds} FROM beta_sentiment WHERE event_time > ${c2} AND event_time <= ${c1}) AS prev_post_velocity,
    (SELECT min(a) FROM topic_now) AS alert_min_sentiment,
    (SELECT arg_min(topic, a) FROM topic_now) AS alert_min_topic,
    (SELECT max(t) FROM device_now) AS alert_peak_cpu,
    (SELECT arg_max(device_id, t) FROM device_now) AS alert_peak_device;`;
}

/** Least-squares trend line per symbol over the trailing window (t in seconds since cutoff). */
export function trendSql(ctx: QueryContext, windowMs: number): string {
  const cutoff = int(ctx.nowMs - windowMs);
  return `SELECT symbol,
    regr_slope(price, t) AS slope,
    regr_intercept(price, t) AS intercept,
    regr_r2(price, t) AS r2,
    count(*)::INTEGER AS n,
    arg_max(price, event_time) AS last_price
  FROM (
    SELECT symbol, price, event_time, (epoch_ms(event_time) - ${cutoff}) / 1000.0 AS t
    FROM alpha_ticks WHERE event_time > epoch_ms(${cutoff})
  )
  GROUP BY symbol HAVING count(*) >= 10 ORDER BY symbol;`;
}

export function alphaSignalSql(ctx: QueryContext): string {
  return `WITH ${indicatorCtes(since(ctx, 150_000))},
  book AS (
    SELECT symbol, avg((bid_size - ask_size) / NULLIF(bid_size + ask_size, 0)) AS obi
    FROM alpha_ticks WHERE event_time > ${since(ctx, 10_000)} GROUP BY symbol
  )
  SELECT fl.symbol,
    arg_max(fl.p, fl.b) AS price,
    arg_max(fl.sma10, fl.b) AS sma10,
    arg_max(fl.sma60, fl.b) AS sma60,
    arg_max(fl.bb_mid, fl.b) AS bb_mid,
    arg_max(fl.bb_sd, fl.b) AS bb_sd,
    coalesce(arg_max(fl.cross_side, fl.b) FILTER (WHERE fl.cross_side <> 0 AND fl.b > ${since(ctx, 30_000)}), 0)::INTEGER AS cross_recent,
    count(*)::INTEGER AS n_sec,
    max(book.obi) AS obi
  FROM fl LEFT JOIN book ON book.symbol = fl.symbol
  GROUP BY fl.symbol ORDER BY fl.symbol;`;
}

export function betaSignalSql(ctx: QueryContext): string {
  const c10 = since(ctx, 10_000);
  return `SELECT topic,
    sum(mention_volume) FILTER (WHERE event_time > ${c10}) / 10.0 AS velocity_now,
    sum(mention_volume) / 60.0 AS velocity_avg,
    avg(influencer_impact) AS impact,
    avg(sentiment_score) FILTER (WHERE event_time > ${c10}) AS sentiment_now,
    avg(sentiment_score) AS sentiment_avg,
    sum(sentiment_score * influencer_followers) / NULLIF(sum(influencer_followers), 0) AS weighted_sentiment
  FROM beta_sentiment WHERE event_time > ${since(ctx, 60_000)}
  GROUP BY topic ORDER BY topic;`;
}

/**
 * Per-device memory leak rate (%/min, linear fit) and an exponential thermal
 * fit: regressing ln(temperature) on time gives growth rate k and intercept.
 */
export function gammaSignalSql(ctx: QueryContext, windowMs: number): string {
  const cutoff = int(ctx.nowMs - windowMs);
  return `SELECT device_id,
    arg_max(status, event_time) AS status,
    count(*)::INTEGER AS n,
    arg_max(memory_utilization_percent, event_time) AS mem_now,
    regr_slope(memory_utilization_percent, t) * 60.0 AS leak_rate_per_min,
    regr_r2(memory_utilization_percent, t) AS mem_r2,
    arg_max(cpu_temperature_celsius, event_time) AS temp_now,
    regr_slope(ln(cpu_temperature_celsius), t) AS temp_growth_k,
    regr_intercept(ln(cpu_temperature_celsius), t) AS temp_intercept,
    regr_r2(ln(cpu_temperature_celsius), t) AS temp_r2
  FROM (
    SELECT device_id, status, memory_utilization_percent, cpu_temperature_celsius, event_time,
      (epoch_ms(event_time) - ${cutoff}) / 1000.0 AS t
    FROM gamma_diagnostics WHERE event_time > epoch_ms(${cutoff})
  )
  GROUP BY device_id HAVING count(*) >= 8 ORDER BY device_id;`;
}

/**
 * Lead/lag correlation between social signals and forward price returns.
 * Sentiment change and social-volume change per 5s bucket are correlated with
 * the price return over the following 10s/30s/60s (volume against |return|,
 * since volume speaks to volatility rather than direction).
 */
export function correlationSql(ctx: QueryContext): string {
  const from = since(ctx, 300_000);
  return `WITH sb AS (
    SELECT lower(ltrim(topic, '$')) AS k, time_bucket(INTERVAL 5 SECOND, event_time) AS b,
      avg(sentiment_score) AS s, sum(mention_volume) AS v
    FROM beta_sentiment WHERE event_time > ${from} GROUP BY 1, 2
  ),
  pb AS (
    SELECT lower(split_part(symbol, '-', 1)) AS k, time_bucket(INTERVAL 5 SECOND, event_time) AS b,
      avg(price) AS p
    FROM alpha_ticks WHERE event_time > ${from} GROUP BY 1, 2
  ),
  j AS (
    SELECT sb.k, sb.b, sb.s, sb.v, pb.p FROM sb JOIN pb ON sb.k = pb.k AND sb.b = pb.b
  ),
  d AS (
    SELECT cur.k, cur.b, cur.s - prv.s AS ds, cur.v - prv.v AS dv, cur.p AS p
    FROM j cur JOIN j prv ON prv.k = cur.k AND prv.b = cur.b - INTERVAL 5 SECOND
  ),
  r AS (
    SELECT d.k, d.ds, d.dv,
      f10.p / d.p - 1 AS r10, f30.p / d.p - 1 AS r30, f60.p / d.p - 1 AS r60
    FROM d
    LEFT JOIN j f10 ON f10.k = d.k AND f10.b = d.b + INTERVAL 10 SECOND
    LEFT JOIN j f30 ON f30.k = d.k AND f30.b = d.b + INTERVAL 30 SECOND
    LEFT JOIN j f60 ON f60.k = d.k AND f60.b = d.b + INTERVAL 60 SECOND
  )
  SELECT upper(k) AS symbol,
    corr(ds, r10) AS sent_c10, corr(ds, r30) AS sent_c30, corr(ds, r60) AS sent_c60,
    corr(dv, abs(r10)) AS vol_c10, corr(dv, abs(r30)) AS vol_c30, corr(dv, abs(r60)) AS vol_c60,
    count(r10)::INTEGER AS n10, count(r30)::INTEGER AS n30, count(r60)::INTEGER AS n60
  FROM r GROUP BY k HAVING count(r10) >= 8 ORDER BY k;`;
}

export const TREND_WINDOW_MS = 60_000;
export const GAMMA_FIT_WINDOW_MS = 45_000;
