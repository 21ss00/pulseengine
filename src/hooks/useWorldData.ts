"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildWorldAdvice } from "@/analytics/worldAdvisor";
import { computeWorldIndex } from "@/analytics/worldIndex";
import {
  crossAssetSql,
  issTrackSql,
  socialTopicsSql,
  worldEventsSql,
  worldHeadlinesSql,
  worldLatestSql,
  worldSeriesSql,
  worldSummarySql,
} from "@/analytics/worldSql";
import type { AdviceItem } from "@/types/analytics";
import type {
  CrossAssetRow,
  EventQueryRow,
  HeadlineQueryRow,
  IssPoint,
  SocialTopicRow,
  WorldIndex,
  WorldLatestRow,
  WorldSeriesPoint,
  WorldSummary,
} from "@/types/world";
import { DXY_SERIES_ID, FX_CURRENCIES } from "@/world/constants";

const POLL_MS = 3000;
const CROSS_POLL_MS = 30_000;
const DAY_MS = 86_400_000;

export const CROSS_ASSET_SERIES = [
  "daily:BTC",
  "daily:ETH",
  "daily:PAXG",
  DXY_SERIES_ID,
  "fx:EUR",
  "fx:JPY",
  "fx:GBP",
];

const FIXED_SPARK_SERIES = [
  ...FX_CURRENCIES.map((currency) => `fx:${currency.code}`),
  DXY_SERIES_ID,
  "metal:XAU",
  "metal:XAG",
  "metal:XPT",
  "metal:XPD",
  "metal:HG",
  "metal:GSR",
  "macro:FNG",
  "space:KP",
  "daily:PAXG",
  "crypto:BTC",
  "crypto:ETH",
];

export interface WorldData {
  ready: boolean;
  updatedAt: number | null;
  latest: WorldLatestRow[];
  series: Record<string, WorldSeriesPoint[]>;
  headlines: HeadlineQueryRow[];
  events: EventQueryRow[];
  iss: IssPoint[];
  summary: WorldSummary | null;
  cross: CrossAssetRow[];
  social: SocialTopicRow[];
  index: WorldIndex;
  advice: AdviceItem[];
}

const EMPTY = {
  latest: [] as WorldLatestRow[],
  series: {} as Record<string, WorldSeriesPoint[]>,
  headlines: [] as HeadlineQueryRow[],
  events: [] as EventQueryRow[],
  iss: [] as IssPoint[],
  summary: null as WorldSummary | null,
  cross: [] as CrossAssetRow[],
  social: [] as SocialTopicRow[],
};

type Snapshot = typeof EMPTY & { updatedAt: number | null };

/** Polls the world tables in DuckDB and derives the index and advice from them. */
export function useWorldData(
  enabled: boolean,
  query: <TRow = Record<string, unknown>>(sql: string) => Promise<TRow[]>
): WorldData {
  const [snapshot, setSnapshot] = useState<Snapshot>({ ...EMPTY, updatedAt: null });
  const crossRef = useRef<{ at: number; rows: CrossAssetRow[] }>({ at: 0, rows: [] });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let busy = false;

    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const now = Date.now();
        const latest = await query<WorldLatestRow>(worldLatestSql());
        const marketIds = latest
          .filter((row) => row.category === "politics")
          .map((row) => row.series_id)
          .filter((id) => /^[A-Za-z0-9:_. -]+$/.test(id));

        const cross =
          now - crossRef.current.at > CROSS_POLL_MS
            ? await query<CrossAssetRow>(crossAssetSql(CROSS_ASSET_SERIES, 60, now))
            : crossRef.current.rows;
        if (cross !== crossRef.current.rows) crossRef.current = { at: now, rows: cross };

        const [seriesRows, headlines, events, iss, summaryRows, social] = await Promise.all([
          query<WorldSeriesPoint>(worldSeriesSql([...FIXED_SPARK_SERIES, ...marketIds], now - 100 * DAY_MS, 100)),
          query<HeadlineQueryRow>(worldHeadlinesSql(160)),
          query<EventQueryRow>(worldEventsSql(now - 3 * DAY_MS)),
          query<IssPoint>(issTrackSql(now - 3 * 3_600_000)),
          query<WorldSummary>(worldSummarySql(now)),
          query<SocialTopicRow>(socialTopicsSql(now, 600_000)),
        ]);

        const series: Record<string, WorldSeriesPoint[]> = {};
        for (const point of seriesRows) (series[point.series_id] ??= []).push(point);

        if (!cancelled) {
          setSnapshot({
            latest,
            series,
            headlines,
            events,
            iss,
            summary: summaryRows[0] ?? null,
            cross,
            social,
            updatedAt: now,
          });
        }
      } catch {
        // The database may still be starting; the next poll retries.
      } finally {
        busy = false;
      }
    };

    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, query]);

  return useMemo(() => {
    const index = computeWorldIndex(snapshot.summary);
    const advice = buildWorldAdvice({
      summary: snapshot.summary,
      latest: snapshot.latest,
      index,
      cross: snapshot.cross,
    });
    return { ...snapshot, ready: snapshot.updatedAt !== null, index, advice };
  }, [snapshot]);
}
