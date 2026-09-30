import * as duckdb from "@duckdb/duckdb-wasm";
import {
  ALPHA_TABLE_NAME,
  BETA_TABLE_NAME,
  GAMMA_TABLE_NAME,
  SCHEMA_STATEMENTS,
  EXPORTABLE_TABLES,
  TELEMETRY_TABLES,
  buildAlphaInsertSql,
  buildBetaInsertSql,
  buildGammaInsertSql,
  buildWorldBatchInsertSql,
  buildWorldEvictionSql,
  type ExportableTable,
} from "@/analytics/schema";
import {
  GAMMA_FIT_WINDOW_MS,
  TREND_WINDOW_MS,
  alphaSignalSql,
  betaSignalSql,
  correlationSql,
  gammaSignalSql,
  trendSql,
} from "@/analytics/sql";
import { prepareReadOnlySql } from "@/analytics/sqlGuard";
import type {
  AlphaSignalRow,
  BetaSignalRow,
  CorrelationRow,
  ForecastSnapshot,
  GammaSignalRow,
  QueryContext,
  TrendRow,
} from "@/types/analytics";
import type { WorldBatch } from "@/types/world";
import type {
  StreamAlphaTick,
  StreamBetaSentiment,
  StreamGammaDiagnostic,
} from "@/types/telemetry";

/**
 * Request/response contract for the DuckDB worker RPC channel. The main
 * thread never touches DuckDB directly - every read and write crosses this
 * postMessage boundary so the wasm engine runs entirely off the UI thread.
 */
export type DuckDBWorkerRequest =
  | { type: "init"; requestId: string }
  | {
      type: "insertBatch";
      requestId: string;
      table: typeof ALPHA_TABLE_NAME;
      rows: StreamAlphaTick[];
    }
  | {
      type: "insertBatch";
      requestId: string;
      table: typeof BETA_TABLE_NAME;
      rows: StreamBetaSentiment[];
    }
  | {
      type: "insertBatch";
      requestId: string;
      table: typeof GAMMA_TABLE_NAME;
      rows: StreamGammaDiagnostic[];
    }
  | { type: "insertWorld"; requestId: string; batch: WorldBatch }
  | { type: "evict"; requestId: string; cutoffTimestampMs: number }
  | { type: "query"; requestId: string; sql: string }
  | { type: "forecast"; requestId: string; nowMs: number }
  | { type: "userQuery"; requestId: string; sql: string }
  | {
      type: "export";
      requestId: string;
      table: ExportableTable;
      format: "csv" | "parquet";
    };

export const USER_QUERY_ROW_LIMIT = 500;

export type DuckDBWorkerResponse =
  | { type: "ready"; requestId: string }
  | { type: "insertComplete"; requestId: string; rowsInserted: number }
  | { type: "evictComplete"; requestId: string; rowsDeleted: number }
  | {
      type: "queryResult";
      requestId: string;
      rows: Record<string, unknown>[];
    }
  | { type: "forecastResult"; requestId: string; snapshot: ForecastSnapshot }
  | {
      type: "userQueryResult";
      requestId: string;
      columns: string[];
      rows: Record<string, unknown>[];
      truncated: boolean;
      elapsedMs: number;
    }
  | {
      type: "exportResult";
      requestId: string;
      fileName: string;
      mimeType: string;
      data: Uint8Array;
    }
  | { type: "error"; requestId: string; message: string };

type WorkerGlobal = {
  postMessage: (message: DuckDBWorkerResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<DuckDBWorkerRequest>) => void) | null;
};

const workerContext = self as unknown as WorkerGlobal;

let database: duckdb.AsyncDuckDB | null = null;
let connection: duckdb.AsyncDuckDBConnection | null = null;
let initPromise: Promise<void> | null = null;

async function instantiateDuckDB(): Promise<void> {
  if (typeof Worker === "undefined") {
    throw new Error(
      "This browser cannot start nested Web Workers, which DuckDB-Wasm needs. Use a recent Chrome, Edge, Firefox, or Safari."
    );
  }

  // Inlined by Next.js at build time; matches next.config.ts's basePath so
  // this still resolves correctly when served from a GitHub Pages subpath.
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const assetBase = `${self.location.origin}${basePath}/duckdb`;
  const bundle = await duckdb.selectBundle({
    mvp: {
      mainModule: `${assetBase}/duckdb-mvp.wasm`,
      mainWorker: `${assetBase}/duckdb-browser-mvp.worker.js`,
    },
    eh: {
      mainModule: `${assetBase}/duckdb-eh.wasm`,
      mainWorker: `${assetBase}/duckdb-browser-eh.worker.js`,
    },
  });

  const workerBootstrap = `importScripts(${JSON.stringify(bundle.mainWorker!)});`;
  const bootstrapBlob = new Blob([workerBootstrap], {
    type: "text/javascript",
  });
  const bootstrapUrl = URL.createObjectURL(bootstrapBlob);

  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const dbWorker = new Worker(bootstrapUrl);
  const db = new duckdb.AsyncDuckDB(logger, dbWorker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(bootstrapUrl);

  const conn = await db.connect();
  for (const statement of SCHEMA_STATEMENTS) {
    await conn.query(statement);
  }

  database = db;
  connection = conn;
}

function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = instantiateDuckDB();
  }
  return initPromise;
}

type ArrowResult = Awaited<ReturnType<duckdb.AsyncDuckDBConnection["query"]>>;

interface ColumnKind {
  timestamp: boolean;
  date: boolean;
  decimalScale: number | null;
}

function columnKind(typeText: string): ColumnKind {
  const decimal = /^Decimal\[\d+e([+-]?\d+)\]/.exec(typeText);
  return {
    timestamp: typeText.startsWith("Timestamp"),
    date: typeText.startsWith("Date"),
    decimalScale: decimal ? Math.abs(Number(decimal[1])) : null,
  };
}

/** 128-bit little-endian two's-complement words (HUGEINT/DECIMAL) to a bigint. */
function wordsToBigInt(words: Uint32Array): bigint {
  const one = BigInt(1);
  const wordBits = BigInt(32);
  let value = BigInt(0);
  for (let i = words.length - 1; i >= 0; i--) {
    value = (value << wordBits) | BigInt(words[i]);
  }
  const bits = BigInt(words.length * 32);
  return value >= one << (bits - one) ? value - (one << bits) : value;
}

function normalizeValue(value: unknown, kind: ColumnKind): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") {
    if (kind.timestamp) return new Date(value).toISOString().replace("T", " ").replace("Z", "");
    if (kind.date) return new Date(value).toISOString().slice(0, 10);
    return value;
  }
  if (value instanceof Uint32Array) {
    const scaled = Number(wordsToBigInt(value));
    return kind.decimalScale ? scaled / 10 ** kind.decimalScale : scaled;
  }
  if (typeof value === "object") return String(value);
  return value;
}

function arrowTableToRows(table: ArrowResult): {
  columns: string[];
  rows: Record<string, unknown>[];
} {
  const columns = table.schema.fields.map((field) => field.name);
  const kinds = table.schema.fields.map((field) => columnKind(String(field.type)));
  const rows = table.toArray().map((row) => {
    const plain = (row as unknown as { toJSON: () => Record<string, unknown> }).toJSON();
    const normalized: Record<string, unknown> = {};
    columns.forEach((name, index) => {
      normalized[name] = normalizeValue(plain[name], kinds[index]);
    });
    return normalized;
  });
  return { columns, rows };
}

function requireConnection(): duckdb.AsyncDuckDBConnection {
  if (!connection) {
    throw new Error("DuckDB connection is not initialized.");
  }
  return connection;
}

async function handleInsertBatch(
  request: Extract<DuckDBWorkerRequest, { type: "insertBatch" }>
): Promise<number> {
  const conn = requireConnection();
  if (request.rows.length === 0) {
    return 0;
  }

  let sql: string;
  switch (request.table) {
    case ALPHA_TABLE_NAME:
      sql = buildAlphaInsertSql(request.rows);
      break;
    case BETA_TABLE_NAME:
      sql = buildBetaInsertSql(request.rows);
      break;
    case GAMMA_TABLE_NAME:
      sql = buildGammaInsertSql(request.rows);
      break;
  }

  await conn.query(sql);
  return request.rows.length;
}

async function handleInsertWorld(batch: WorldBatch): Promise<number> {
  const conn = requireConnection();
  for (const statement of buildWorldBatchInsertSql(batch)) {
    await conn.query(statement);
  }
  return batch.metrics.length + batch.headlines.length + batch.events.length;
}

async function handleEvict(cutoffTimestampMs: number): Promise<number> {
  const conn = requireConnection();

  let totalDeleted = 0;
  for (const table of TELEMETRY_TABLES) {
    const countStatement = await conn.prepare(
      `SELECT count(*)::BIGINT AS cnt FROM ${table} WHERE event_time < epoch_ms(CAST(? AS BIGINT));`
    );
    const countResult = await countStatement.query(cutoffTimestampMs);
    await countStatement.close();
    const { rows } = arrowTableToRows(countResult);
    const staleCount = rows.length > 0 ? Number(rows[0].cnt) : 0;

    if (staleCount > 0) {
      const deleteStatement = await conn.prepare(
        `DELETE FROM ${table} WHERE event_time < epoch_ms(CAST(? AS BIGINT));`
      );
      await deleteStatement.query(cutoffTimestampMs);
      await deleteStatement.close();
      totalDeleted += staleCount;
    }
  }
  for (const statement of buildWorldEvictionSql(Date.now())) {
    await conn.query(statement);
  }
  return totalDeleted;
}

async function handleQuery(sql: string): Promise<Record<string, unknown>[]> {
  const result = await requireConnection().query(sql);
  return arrowTableToRows(result).rows;
}

async function handleForecast(nowMs: number): Promise<ForecastSnapshot> {
  const ctx: QueryContext = { nowMs, tzOffsetMinutes: 0 };
  const trends = (await handleQuery(trendSql(ctx, TREND_WINDOW_MS))) as unknown as TrendRow[];
  const alpha = (await handleQuery(alphaSignalSql(ctx))) as unknown as AlphaSignalRow[];
  const beta = (await handleQuery(betaSignalSql(ctx))) as unknown as BetaSignalRow[];
  const gamma = (await handleQuery(
    gammaSignalSql(ctx, GAMMA_FIT_WINDOW_MS)
  )) as unknown as GammaSignalRow[];
  const correlations = (await handleQuery(correlationSql(ctx))) as unknown as CorrelationRow[];

  return {
    generatedAt: nowMs,
    trendCutoffMs: nowMs - TREND_WINDOW_MS,
    gammaCutoffMs: nowMs - GAMMA_FIT_WINDOW_MS,
    trends,
    alpha,
    beta,
    gamma,
    correlations,
  };
}

async function handleUserQuery(sqlText: string): Promise<{
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  elapsedMs: number;
}> {
  const guarded = prepareReadOnlySql(sqlText);
  if (!guarded.ok) {
    throw new Error(guarded.error);
  }

  const started = performance.now();
  const statement = guarded.wrappable
    ? `SELECT * FROM (${guarded.sql}) LIMIT ${USER_QUERY_ROW_LIMIT + 1}`
    : guarded.sql;
  const result = await requireConnection().query(statement);
  const { columns, rows } = arrowTableToRows(result);
  const truncated = rows.length > USER_QUERY_ROW_LIMIT;

  return {
    columns,
    rows: truncated ? rows.slice(0, USER_QUERY_ROW_LIMIT) : rows,
    truncated,
    elapsedMs: performance.now() - started,
  };
}

async function handleExport(
  table: ExportableTable,
  format: "csv" | "parquet"
): Promise<{ fileName: string; mimeType: string; data: Uint8Array }> {
  const conn = requireConnection();
  if (!database || !EXPORTABLE_TABLES.includes(table)) {
    throw new Error(`Unknown table: ${table}`);
  }

  const fileName = `${table}-${Date.now()}.${format}`;
  const options = format === "csv" ? "FORMAT CSV, HEADER" : "FORMAT PARQUET";
  await conn.query(
    `COPY (SELECT * FROM ${table} ORDER BY event_time) TO '${fileName}' (${options});`
  );
  const data = await database.copyFileToBuffer(fileName);
  await database.dropFile(fileName);

  return {
    fileName,
    mimeType: format === "csv" ? "text/csv" : "application/vnd.apache.parquet",
    data,
  };
}

workerContext.onmessage = async (event: MessageEvent<DuckDBWorkerRequest>) => {
  const request = event.data;

  try {
    await ensureInitialized();
    switch (request.type) {
      case "init": {
        workerContext.postMessage({ type: "ready", requestId: request.requestId });
        break;
      }
      case "insertBatch": {
        const rowsInserted = await handleInsertBatch(request);
        workerContext.postMessage({
          type: "insertComplete",
          requestId: request.requestId,
          rowsInserted,
        });
        break;
      }
      case "insertWorld": {
        const rowsInserted = await handleInsertWorld(request.batch);
        workerContext.postMessage({
          type: "insertComplete",
          requestId: request.requestId,
          rowsInserted,
        });
        break;
      }
      case "evict": {
        const rowsDeleted = await handleEvict(request.cutoffTimestampMs);
        workerContext.postMessage({
          type: "evictComplete",
          requestId: request.requestId,
          rowsDeleted,
        });
        break;
      }
      case "query": {
        const rows = await handleQuery(request.sql);
        workerContext.postMessage({
          type: "queryResult",
          requestId: request.requestId,
          rows,
        });
        break;
      }
      case "forecast": {
        const snapshot = await handleForecast(request.nowMs);
        workerContext.postMessage({
          type: "forecastResult",
          requestId: request.requestId,
          snapshot,
        });
        break;
      }
      case "userQuery": {
        const result = await handleUserQuery(request.sql);
        workerContext.postMessage({
          type: "userQueryResult",
          requestId: request.requestId,
          ...result,
        });
        break;
      }
      case "export": {
        const file = await handleExport(request.table, request.format);
        workerContext.postMessage(
          { type: "exportResult", requestId: request.requestId, ...file },
          [file.data.buffer]
        );
        break;
      }
    }
  } catch (error) {
    workerContext.postMessage({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
