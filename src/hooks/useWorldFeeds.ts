"use client";

import { useEffect, useMemo, useState } from "react";
import type { SourceStatus, WorldBatch } from "@/types/world";
import { startWorldScheduler } from "@/world/scheduler";
import { WORLD_SOURCES } from "@/world/sources";

const REQUEST_TIMEOUT_MS = 20_000;

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  }
  return response;
}

/**
 * Starts the world-data scheduler once the database is ready and returns the
 * live status of every source. Each batch is written straight into DuckDB.
 */
export function useWorldFeeds(
  enabled: boolean,
  insertWorld: (batch: WorldBatch) => Promise<void>
): SourceStatus[] {
  const [statuses, setStatuses] = useState<Record<string, SourceStatus>>({});

  useEffect(() => {
    if (!enabled) return;
    const scheduler = startWorldScheduler({
      sources: WORLD_SOURCES,
      onBatch: (batch) => insertWorld(batch),
      onStatus: (status) => setStatuses((prev) => ({ ...prev, [status.id]: status })),
      fetchContext: () => ({
        json: async (url) => (await fetchOk(url)).json(),
        text: async (url) => (await fetchOk(url)).text(),
      }),
    });
    return () => scheduler.stop();
  }, [enabled, insertWorld]);

  return useMemo(
    () =>
      WORLD_SOURCES.map(
        (source) =>
          statuses[source.id] ?? {
            id: source.id,
            label: source.label,
            group: source.group,
            state: "pending",
            lastOkAt: null,
            lastError: null,
            rows: 0,
            intervalMs: source.intervalMs,
          }
      ),
    [statuses]
  );
}
