"use client";

import { useEffect, useState } from "react";
import type { ForecastSnapshot } from "@/types/analytics";

/**
 * Polls the worker's forecasting query. Requests never overlap: if a fit is
 * still running when the timer fires, that tick is skipped.
 */
export function useForecast(
  enabled: boolean,
  forecast: () => Promise<ForecastSnapshot>,
  intervalMs = 1000
): ForecastSnapshot | null {
  const [snapshot, setSnapshot] = useState<ForecastSnapshot | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let busy = false;

    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await forecast();
        if (!cancelled) setSnapshot(next);
      } catch {
        // The worker may still be warming up; the next tick retries.
      } finally {
        busy = false;
      }
    };

    void tick();
    const timer = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, forecast, intervalMs]);

  return snapshot;
}
