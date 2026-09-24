"use client";

import { useEffect, useState } from "react";

/** Current time that refreshes on a timer, so relative labels ("3m ago") stay honest without impure renders. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
