import { DXY_SERIES_ID } from "../world/constants.ts";

/**
 * Read queries for the world tables. Series ids are interpolated, so they are
 * validated against a strict pattern; every other value is a number.
 */

const SERIES_ID = /^[A-Za-z0-9:_.\- ]+$/;
const DAY_MS = 86_400_000;

function seriesList(ids: string[]): string {
  if (ids.length === 0) throw new Error("At least one series id is required.");
  return ids
    .map((id) => {
      if (!SERIES_ID.test(id)) throw new Error(`Invalid series id: ${id}`);
      return `'${id}'`;
    })
    .join(", ");
}

function ts(ms: number): string {
  if (!Number.isFinite(ms)) throw new Error("Non-finite timestamp");
  return `epoch_ms(${Math.trunc(ms)})`;
}

/** Newest observation of every series with its prior reading and 1d/7d/30d-ago values. */
export function worldLatestSql(): string {
  return `WITH ranked AS (
    SELECT series_id, category, label, unit, source, url, value, aux, event_time,
      row_number() OVER (PARTITION BY series_id ORDER BY event_time DESC) AS rn
    FROM world_metrics
  )
  SELECT r.series_id, r.category, r.label, r.unit, r.source, r.url, r.value, r.aux,
    epoch_ms(r.event_time)::BIGINT AS t,
    (SELECT p.value FROM ranked p WHERE p.series_id = r.series_id AND p.rn = 2) AS prev_value,
    (SELECT arg_max(m.value, m.event_time) FROM world_metrics m
       WHERE m.series_id = r.series_id AND m.event_time <= r.event_time - INTERVAL 1 DAY) AS d1,
    (SELECT arg_max(m.value, m.event_time) FROM world_metrics m
       WHERE m.series_id = r.series_id AND m.event_time <= r.event_time - INTERVAL 7 DAY) AS d7,
    (SELECT arg_max(m.value, m.event_time) FROM world_metrics m
       WHERE m.series_id = r.series_id AND m.event_time <= r.event_time - INTERVAL 30 DAY) AS d30
  FROM ranked r WHERE r.rn = 1
  ORDER BY r.category, r.series_id;`;
}

/** Recent points of the given series, oldest first, capped per series. */
export function worldSeriesSql(seriesIds: string[], sinceMs: number, maxPoints = 120): string {
  return `SELECT series_id, epoch_ms(event_time)::BIGINT AS t, value
  FROM (
    SELECT series_id, event_time, value,
      row_number() OVER (PARTITION BY series_id ORDER BY event_time DESC) AS rn
    FROM world_metrics
    WHERE series_id IN (${seriesList(seriesIds)}) AND event_time > ${ts(sinceMs)}
  )
  WHERE rn <= ${Math.trunc(maxPoints)}
  ORDER BY series_id, t;`;
}

export function worldHeadlinesSql(limit = 150): string {
  return `SELECT id, category, source, title, url, tone, aux, epoch_ms(event_time)::BIGINT AS t
  FROM world_headlines ORDER BY event_time DESC LIMIT ${Math.trunc(limit)};`;
}

export function worldEventsSql(sinceMs: number, limit = 600): string {
  return `SELECT id, kind, title, magnitude, unit, lat, lon, url, epoch_ms(event_time)::BIGINT AS t
  FROM world_events WHERE event_time > ${ts(sinceMs)}
  ORDER BY event_time DESC LIMIT ${Math.trunc(limit)};`;
}

export function issTrackSql(sinceMs: number): string {
  return `SELECT epoch_ms(a.event_time)::BIGINT AS t, a.value AS lat, b.value AS lon
  FROM world_metrics a
  JOIN world_metrics b ON b.series_id = 'iss:LON' AND b.event_time = a.event_time
  WHERE a.series_id = 'iss:LAT' AND a.event_time > ${ts(sinceMs)}
  ORDER BY a.event_time;`;
}

export function socialTopicsSql(nowMs: number, windowMs: number): string {
  return `SELECT topic,
    count(*)::INTEGER AS posts,
    avg(sentiment_score) AS avg_tone,
    sum(sentiment_score * influencer_followers) / NULLIF(sum(influencer_followers), 0) AS weighted_tone,
    count(*) * 60000.0 / ${Math.trunc(windowMs)} AS posts_per_min,
    max(influencer_followers) AS top_followers
  FROM beta_sentiment WHERE event_time > ${ts(nowMs - windowMs)}
  GROUP BY topic ORDER BY posts DESC;`;
}

/** One row of headline numbers feeding the composite world index and advice. */
export function worldSummarySql(nowMs: number): string {
  const c24 = ts(nowMs - DAY_MS);
  const c1h = ts(nowMs - 3_600_000);
  return `WITH fng AS (
    SELECT value, row_number() OVER (ORDER BY event_time DESC) AS rn
    FROM world_metrics WHERE series_id = 'macro:FNG'
  ),
  gold AS (
    SELECT value, row_number() OVER (ORDER BY event_time DESC) AS rn
    FROM world_metrics WHERE series_id = 'daily:PAXG'
  ),
  dxy AS (
    SELECT value, event_time, row_number() OVER (ORDER BY event_time DESC) AS rn
    FROM world_metrics WHERE series_id = '${DXY_SERIES_ID}'
  )
  SELECT
    (SELECT value FROM fng WHERE rn = 1) AS fear_greed,
    (SELECT value FROM fng WHERE rn = 2) AS fear_greed_prev,
    (SELECT (g1.value - g2.value) / g2.value * 100 FROM gold g1, gold g2 WHERE g1.rn = 1 AND g2.rn = 2) AS gold_change_1d_pct,
    (SELECT (d1.value - old.value) / old.value * 100
       FROM dxy d1, world_metrics old
       WHERE d1.rn = 1 AND old.series_id = '${DXY_SERIES_ID}'
         AND old.event_time = (SELECT max(event_time) FROM world_metrics
                               WHERE series_id = '${DXY_SERIES_ID}' AND event_time <= d1.event_time - INTERVAL 30 DAY)
    ) AS dxy_change_30d_pct,
    (SELECT arg_max(value, event_time) FROM world_metrics WHERE series_id = 'crypto:BTC:chg24') AS btc_change_24h_pct,
    (SELECT avg(tone) FROM world_headlines
       WHERE event_time > ${c24} AND category IN ('politics', 'world', 'business')) AS news_tone_24h,
    (SELECT count(*)::INTEGER FROM world_headlines
       WHERE event_time > ${c24} AND category IN ('politics', 'world', 'business')) AS news_count_24h,
    (SELECT avg(sentiment_score) FROM beta_sentiment WHERE event_time > ${c1h}) AS social_tone_1h,
    (SELECT count(*)::INTEGER FROM beta_sentiment WHERE event_time > ${c1h}) AS social_posts_1h,
    (SELECT count(*)::INTEGER FROM world_events
       WHERE kind = 'quake' AND magnitude >= 5.5 AND event_time > ${c24}) AS quakes_m55_24h,
    (SELECT max(magnitude) FROM world_events WHERE kind = 'quake' AND event_time > ${c24}) AS max_quake_mag_24h,
    (SELECT max(value) FROM world_metrics WHERE series_id = 'space:KP' AND event_time > ${c24}) AS kp_max_24h,
    (SELECT count(*)::INTEGER FROM world_events
       WHERE kind IN ('storm', 'wildfire', 'volcano', 'flood')) AS open_hazards;`;
}

/**
 * Pairwise correlation of daily returns. Days are restricted to those with a
 * dollar-index observation so weekend crypto candles do not distort the
 * weekday-only FX series.
 */
export function crossAssetSql(seriesIds: string[], days: number, nowMs: number): string {
  const since = ts(nowMs - days * DAY_MS);
  return `WITH ref_days AS (
    SELECT DISTINCT CAST(event_time AS DATE) AS day FROM world_metrics
    WHERE series_id = '${DXY_SERIES_ID}' AND event_time > ${since}
  ),
  daily AS (
    SELECT series_id, CAST(event_time AS DATE) AS day, arg_max(value, event_time) AS v
    FROM world_metrics
    WHERE series_id IN (${seriesList(seriesIds)}) AND event_time > ${since}
    GROUP BY 1, 2
  ),
  aligned AS (SELECT * FROM daily WHERE day IN (SELECT day FROM ref_days)),
  r AS (
    SELECT series_id, day, v / lag(v) OVER (PARTITION BY series_id ORDER BY day) - 1 AS ret
    FROM aligned
  )
  SELECT a.series_id AS x, b.series_id AS y, corr(a.ret, b.ret) AS corr, count(*)::INTEGER AS n
  FROM r a JOIN r b ON a.day = b.day AND a.series_id <= b.series_id
  WHERE a.ret IS NOT NULL AND b.ret IS NOT NULL
  GROUP BY 1, 2 ORDER BY 1, 2;`;
}
