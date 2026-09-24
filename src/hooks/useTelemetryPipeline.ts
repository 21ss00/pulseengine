"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Subscription, interval, map, merge } from "rxjs";
import { bufferTime, filter } from "rxjs/operators";
import {
  ALPHA_TABLE_NAME,
  BETA_TABLE_NAME,
  GAMMA_TABLE_NAME,
  type ExportableTable,
} from "@/analytics/schema";
import { RETENTION_WINDOW_MS, type ForecastSnapshot } from "@/types/analytics";
import type {
  StreamAlphaTick,
  StreamBetaSentiment,
  StreamGammaDiagnostic,
  TelemetryEvent,
  TelemetryIngestCounters,
} from "@/types/telemetry";
import { createCoinbaseAlphaFeed } from "@/hooks/coinbaseFeed";
import { createMastodonBetaFeed } from "@/hooks/mastodonFeed";
import { ALPHA_FEED, BETA_FEED, type FeedStatus } from "@/config/feeds";
import type { WorldBatch } from "@/types/world";
import {
  COINBASE_BETA_TOPICS,
  createTelemetryGenerators,
} from "@/telemetry/generators";
import type {
  DuckDBWorkerRequest,
  DuckDBWorkerResponse,
} from "@/workers/duckdb.worker";

const BUFFER_WINDOW_MS = 16;
const EVICTION_INTERVAL_MS = 5000;

const ALPHA_TICK_INTERVAL_MS = 40;
const BETA_SAMPLE_INTERVAL_MS = 220;
const GAMMA_SAMPLE_INTERVAL_MS = 120;

export type TelemetryPipelineStatus =
  | "idle"
  | "initializing"
  | "streaming"
  | "error";

export interface TelemetryPipelineState {
  status: TelemetryPipelineStatus;
  errorMessage: string | null;
  ingested: TelemetryIngestCounters;
  lastEvictionCount: number;
  lastEvictionAt: number | null;
}

export interface UserQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  elapsedMs: number;
}

export interface ExportedFile {
  fileName: string;
  mimeType: string;
  data: Uint8Array;
}

export interface UseTelemetryPipelineResult {
  state: TelemetryPipelineState;
  query: <TRow = Record<string, unknown>>(sql: string) => Promise<TRow[]>;
  forecast: () => Promise<ForecastSnapshot>;
  runUserQuery: (sql: string) => Promise<UserQueryResult>;
  feeds: FeedStatus[];
  insertWorld: (batch: WorldBatch) => Promise<void>;
  exportTable: (
    table: ExportableTable,
    format: "csv" | "parquet"
  ) => Promise<ExportedFile>;
}

interface PendingRequest {
  resolve: (response: DuckDBWorkerResponse) => void;
  reject: (error: Error) => void;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

type ResponseOf<T extends DuckDBWorkerResponse["type"]> = Extract<
  DuckDBWorkerResponse,
  { type: T }
>;

const initialFeeds: Record<string, FeedStatus> = {
  alpha: {
    id: "alpha",
    label: ALPHA_FEED === "coinbase" ? "Market ticks (Coinbase WebSocket)" : "Market ticks (simulated)",
    live: ALPHA_FEED === "coinbase",
    state: ALPHA_FEED === "coinbase" ? "connecting" : "simulated",
    detail: null,
    updatedAt: null,
  },
  beta: {
    id: "beta",
    label: BETA_FEED === "mastodon" ? "Social posts (Mastodon hashtags)" : "Social posts (simulated)",
    live: BETA_FEED === "mastodon",
    state: BETA_FEED === "mastodon" ? "connecting" : "simulated",
    detail: null,
    updatedAt: null,
  },
  gamma: {
    id: "gamma",
    label: "IoT diagnostics (simulated)",
    live: false,
    state: "simulated",
    detail: "no public real-world source; generated locally",
    updatedAt: null,
  },
};

const initialState: TelemetryPipelineState = {
  status: "initializing",
  errorMessage: null,
  ingested: { alpha: 0, beta: 0, gamma: 0 },
  lastEvictionCount: 0,
  lastEvictionAt: null,
};

export function useTelemetryPipeline(): UseTelemetryPipelineResult {
  const [state, setState] = useState<TelemetryPipelineState>(initialState);
  const [feeds, setFeeds] = useState<Record<string, FeedStatus>>(initialFeeds);
  const sendRequestRef = useRef<
    ((request: DuckDBWorkerRequest) => Promise<DuckDBWorkerResponse>) | null
  >(null);

  useEffect(() => {
    let disposed = false;

    const worker = new Worker(
      new URL("../workers/duckdb.worker.ts", import.meta.url),
      { type: "module" }
    );

    const pending = new Map<string, PendingRequest>();

    worker.onmessage = (event: MessageEvent<DuckDBWorkerResponse>) => {
      const response = event.data;
      const pendingRequest = pending.get(response.requestId);
      if (!pendingRequest) {
        return;
      }
      pending.delete(response.requestId);

      if (response.type === "error") {
        pendingRequest.reject(new Error(response.message));
        return;
      }
      pendingRequest.resolve(response);
    };

    worker.onerror = (event: ErrorEvent) => {
      if (disposed) return;
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: event.message,
      }));
    };

    const sendRequest = (
      request: DuckDBWorkerRequest
    ): Promise<DuckDBWorkerResponse> => {
      return new Promise((resolve, reject) => {
        pending.set(request.requestId, { resolve, reject });
        worker.postMessage(request);
      });
    };
    sendRequestRef.current = sendRequest;

    const reportError = (error: Error) => {
      if (disposed) return;
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: error.message,
      }));
    };

    const subscription = new Subscription();

    sendRequest({ type: "init", requestId: crypto.randomUUID() })
      .then(() => {
        if (disposed) return;
        setState((prev) => ({ ...prev, status: "streaming" }));

        const liveAlpha = ALPHA_FEED === "coinbase";
        const liveBeta = BETA_FEED === "mastodon";
        const generators = createTelemetryGenerators({
          betaTopics: liveAlpha ? COINBASE_BETA_TOPICS : undefined,
        });
        const reportFeed = (id: string, status: { ok: boolean; detail: string }) => {
          if (disposed) return;
          setFeeds((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              state: status.ok ? "ok" : "error",
              detail: status.detail,
              updatedAt: Date.now(),
            },
          }));
        };

        const alpha$ = liveAlpha
          ? createCoinbaseAlphaFeed(generators.nextId, (status) => reportFeed("alpha", status))
          : interval(ALPHA_TICK_INTERVAL_MS).pipe(map(() => generators.alpha()));
        const beta$ = liveBeta
          ? createMastodonBetaFeed(generators.nextId, (status) => reportFeed("beta", status))
          : interval(BETA_SAMPLE_INTERVAL_MS).pipe(map(() => generators.beta()));
        const gamma$ = interval(GAMMA_SAMPLE_INTERVAL_MS).pipe(
          map(() => generators.gamma())
        );

        const ingestSubscription = merge(alpha$, beta$, gamma$)
          .pipe(
            bufferTime(BUFFER_WINDOW_MS),
            filter((batch: TelemetryEvent[]) => batch.length > 0)
          )
          .subscribe((batch: TelemetryEvent[]) => {
            const alphaRows: StreamAlphaTick[] = [];
            const betaRows: StreamBetaSentiment[] = [];
            const gammaRows: StreamGammaDiagnostic[] = [];

            for (const event of batch) {
              if (event.stream === "alpha") alphaRows.push(event.payload);
              else if (event.stream === "beta") betaRows.push(event.payload);
              else gammaRows.push(event.payload);
            }

            if (alphaRows.length > 0) {
              sendRequest({
                type: "insertBatch",
                requestId: crypto.randomUUID(),
                table: ALPHA_TABLE_NAME,
                rows: alphaRows,
              }).catch(reportError);
            }
            if (betaRows.length > 0) {
              sendRequest({
                type: "insertBatch",
                requestId: crypto.randomUUID(),
                table: BETA_TABLE_NAME,
                rows: betaRows,
              }).catch(reportError);
            }
            if (gammaRows.length > 0) {
              sendRequest({
                type: "insertBatch",
                requestId: crypto.randomUUID(),
                table: GAMMA_TABLE_NAME,
                rows: gammaRows,
              }).catch(reportError);
            }

            setState((prev) => ({
              ...prev,
              ingested: {
                alpha: prev.ingested.alpha + alphaRows.length,
                beta: prev.ingested.beta + betaRows.length,
                gamma: prev.ingested.gamma + gammaRows.length,
              },
            }));
          });
        subscription.add(ingestSubscription);

        const evictionSubscription = interval(
          EVICTION_INTERVAL_MS
        ).subscribe(() => {
          sendRequest({
            type: "evict",
            requestId: crypto.randomUUID(),
            cutoffTimestampMs: Date.now() - RETENTION_WINDOW_MS,
          })
            .then((response) => {
              if (response.type !== "evictComplete") return;
              setState((prev) => ({
                ...prev,
                lastEvictionCount: response.rowsDeleted,
                lastEvictionAt: Date.now(),
              }));
            })
            .catch(reportError);
        });
        subscription.add(evictionSubscription);
      })
      .catch(reportError);

    return () => {
      disposed = true;
      subscription.unsubscribe();
      for (const pendingRequest of pending.values()) {
        pendingRequest.reject(new Error("Telemetry pipeline unmounted."));
      }
      pending.clear();
      sendRequestRef.current = null;
      worker.terminate();
    };
  }, []);

  const call = useCallback(
    async <T extends DuckDBWorkerResponse["type"]>(
      request: DistributiveOmit<DuckDBWorkerRequest, "requestId">,
      expected: T
    ): Promise<ResponseOf<T>> => {
      const send = sendRequestRef.current;
      if (!send) {
        throw new Error("The telemetry pipeline is not ready.");
      }
      const response = await send({
        ...request,
        requestId: crypto.randomUUID(),
      } as DuckDBWorkerRequest);
      if (response.type !== expected) {
        throw new Error(`Unexpected worker response: ${response.type}`);
      }
      return response as ResponseOf<T>;
    },
    []
  );

  const query = useCallback(
    async <TRow = Record<string, unknown>>(sql: string): Promise<TRow[]> => {
      if (!sendRequestRef.current) return [];
      const response = await call({ type: "query", sql }, "queryResult");
      return response.rows as TRow[];
    },
    [call]
  );

  const forecast = useCallback(async (): Promise<ForecastSnapshot> => {
    const response = await call(
      { type: "forecast", nowMs: Date.now() },
      "forecastResult"
    );
    return response.snapshot;
  }, [call]);

  const runUserQuery = useCallback(
    async (sql: string): Promise<UserQueryResult> => {
      const { columns, rows, truncated, elapsedMs } = await call(
        { type: "userQuery", sql },
        "userQueryResult"
      );
      return { columns, rows, truncated, elapsedMs };
    },
    [call]
  );

  const exportTable = useCallback(
    async (
      table: ExportableTable,
      format: "csv" | "parquet"
    ): Promise<ExportedFile> => {
      const { fileName, mimeType, data } = await call(
        { type: "export", table, format },
        "exportResult"
      );
      return { fileName, mimeType, data };
    },
    [call]
  );

  const insertWorld = useCallback(
    async (batch: WorldBatch): Promise<void> => {
      await call({ type: "insertWorld", batch }, "insertComplete");
    },
    [call]
  );

  return {
    state,
    query,
    forecast,
    runUserQuery,
    exportTable,
    feeds: Object.values(feeds),
    insertWorld,
  };
}
