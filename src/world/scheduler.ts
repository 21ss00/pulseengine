import type { SourceStatus, WorldBatch } from "../types/world.ts";
import type { FetchContext, WorldSource } from "./sources.ts";

export interface SchedulerOptions {
  sources: WorldSource[];
  /** Persists a batch. A rejection marks the source as failed. */
  onBatch: (batch: WorldBatch, source: WorldSource) => Promise<void>;
  onStatus: (status: SourceStatus) => void;
  fetchContext: (now: number) => Omit<FetchContext, "now">;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Delay between the first runs of consecutive sources, to avoid a burst of requests. */
  staggerMs?: number;
  maxBackoffFactor?: number;
}

export interface WorldScheduler {
  stop: () => void;
}

function rowCount(batch: WorldBatch): number {
  return batch.metrics.length + batch.headlines.length + batch.events.length;
}

/**
 * Runs each source on its own interval. Runs never overlap, failures back off
 * exponentially (capped) and recover on the next success, and every state
 * change is reported so the UI can show which feeds are live.
 */
export function startWorldScheduler(options: SchedulerOptions): WorldScheduler {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const stagger = options.staggerMs ?? 250;
  const maxFactor = options.maxBackoffFactor ?? 8;

  let stopped = false;
  const handles = new Set<unknown>();

  const schedule = (callback: () => void, ms: number) => {
    const handle = setTimer(() => {
      handles.delete(handle);
      if (!stopped) callback();
    }, ms);
    handles.add(handle);
  };

  options.sources.forEach((source, index) => {
    const status: SourceStatus = {
      id: source.id,
      label: source.label,
      group: source.group,
      state: "pending",
      lastOkAt: null,
      lastError: null,
      rows: 0,
      intervalMs: source.intervalMs,
    };
    options.onStatus({ ...status });
    let failures = 0;

    const cycle = async () => {
      const started = now();
      try {
        const batch = await source.run({ now: started, ...options.fetchContext(started) });
        if (stopped) return;
        await options.onBatch(batch, source);
        failures = 0;
        status.state = "ok";
        status.lastOkAt = now();
        status.lastError = null;
        status.rows += rowCount(batch);
      } catch (error) {
        if (stopped) return;
        failures += 1;
        status.state = "error";
        status.lastError = error instanceof Error ? error.message : String(error);
      }
      options.onStatus({ ...status });
      const factor = failures === 0 ? 1 : Math.min(2 ** failures, maxFactor);
      schedule(cycle, source.intervalMs * factor);
    };

    schedule(cycle, index * stagger);
  });

  return {
    stop: () => {
      stopped = true;
      for (const handle of handles) clearTimer(handle);
      handles.clear();
    },
  };
}
