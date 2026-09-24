"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Play, Terminal, X } from "lucide-react";
import { Window } from "@/components/Window";
import type { ExportedFile, UserQueryResult } from "@/hooks/useTelemetryPipeline";
import {
  ALPHA_TABLE_NAME,
  BETA_TABLE_NAME,
  GAMMA_TABLE_NAME,
  WORLD_EVENTS_TABLE,
  WORLD_HEADLINES_TABLE,
  WORLD_METRICS_TABLE,
  type ExportableTable,
} from "@/analytics/schema";

const PRESETS: { label: string; sql: string }[] = [
  {
    label: "Buffer size",
    sql: `SELECT 'alpha_ticks' AS tbl, count(*) AS row_count, min(event_time) AS oldest, max(event_time) AS newest FROM alpha_ticks
UNION ALL SELECT 'beta_sentiment', count(*), min(event_time), max(event_time) FROM beta_sentiment
UNION ALL SELECT 'gamma_diagnostics', count(*), min(event_time), max(event_time) FROM gamma_diagnostics`,
  },
  {
    label: "Latest ticks",
    sql: "SELECT symbol, price, bid_size, ask_size, event_time FROM alpha_ticks ORDER BY event_time DESC LIMIT 25",
  },
  {
    label: "Per-symbol range",
    sql: "SELECT symbol, count(*) AS ticks, min(price) AS low, max(price) AS high, avg(price) AS mean FROM alpha_ticks GROUP BY symbol ORDER BY symbol",
  },
  {
    label: "Device states",
    sql: "SELECT device_id, arg_max(status, event_time) AS status, max(cpu_temperature_celsius) AS peak_temp, max(memory_utilization_percent) AS peak_mem FROM gamma_diagnostics GROUP BY device_id ORDER BY peak_temp DESC",
  },
  {
    label: "World series",
    sql: "SELECT series_id, label, value, unit, source, event_time FROM world_metrics ORDER BY event_time DESC LIMIT 50",
  },
  { label: "Schema", sql: "DESCRIBE alpha_ticks" },
];

const TABLES: { id: ExportableTable; label: string }[] = [
  { id: ALPHA_TABLE_NAME, label: "alpha_ticks (market)" },
  { id: BETA_TABLE_NAME, label: "beta_sentiment (social)" },
  { id: GAMMA_TABLE_NAME, label: "gamma_diagnostics (iot)" },
  { id: WORLD_METRICS_TABLE, label: "world_metrics (fx, metals, markets, macro...)" },
  { id: WORLD_HEADLINES_TABLE, label: "world_headlines (news)" },
  { id: WORLD_EVENTS_TABLE, label: "world_events (quakes, storms, fires)" },
];

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && !Number.isInteger(value)) {
    return Number(value.toPrecision(8)).toString();
  }
  return String(value);
}

function saveFile(file: ExportedFile): void {
  const blob = new Blob([file.data as unknown as BlobPart], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function ConsoleModal({
  onClose,
  runUserQuery,
  exportTable,
}: {
  onClose: () => void;
  runUserQuery: (sql: string) => Promise<UserQueryResult>;
  exportTable: (
    table: ExportableTable,
    format: "csv" | "parquet"
  ) => Promise<ExportedFile>;
}) {
  const [tab, setTab] = useState<"query" | "export">("query");
  const [sql, setSql] = useState(PRESETS[0].sql);
  const [result, setResult] = useState<UserQueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [table, setTable] = useState<ExportableTable>(ALPHA_TABLE_NAME);
  const [format, setFormat] = useState<"csv" | "parquet">("csv");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    textareaRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async () => {
    setRunning(true);
    setQueryError(null);
    try {
      setResult(await runUserQuery(sql));
    } catch (error) {
      setResult(null);
      setQueryError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const runExport = async () => {
    setExporting(true);
    setExportMessage(null);
    try {
      const file = await exportTable(table, format);
      saveFile(file);
      setExportMessage(
        `Saved ${file.fileName} (${(file.data.byteLength / 1024).toFixed(1)} KiB)`
      );
    } catch (error) {
      setExportMessage(
        `Export failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setExporting(false);
    }
  };

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.18em] ${
      active ? "bg-violet-600 text-white" : "text-dim hover:text-ink"
    }`;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/75 px-4 py-10"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-5xl"
        role="dialog"
        aria-modal="true"
        aria-label="Export and query console"
      >
        <Window
          title="query_console // duckdb"
          icon={<Terminal className="h-3.5 w-3.5" />}
          actions={
            <button
              type="button"
              onClick={onClose}
              className="win-btn"
              aria-label="Close console"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          }
          footer={
            <>
              <span>read-only sql</span>
              <span>max 500 rows displayed</span>
              <span>esc closes</span>
            </>
          }
        >
          <div className="win-well mb-3 inline-flex" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "query"}
              className={tabClass(tab === "query")}
              onClick={() => setTab("query")}
            >
              Query
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "export"}
              className={tabClass(tab === "export")}
              onClick={() => setTab("export")}
            >
              Export
            </button>
          </div>

          {tab === "query" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setSql(preset.sql)}
                    className="win-well px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-dim hover:text-ink"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                value={sql}
                onChange={(event) => setSql(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void run();
                  }
                }}
                spellCheck={false}
                aria-label="SQL query"
                className="win-well h-32 w-full resize-y bg-transparent p-3 font-mono text-xs leading-relaxed text-ink outline-none focus:border-violet-500"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void run()}
                  disabled={running}
                  className="flex items-center gap-2 bg-violet-600 px-4 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-white shadow-[inset_1px_1px_0_rgba(233,213,255,0.5),inset_-1px_-1px_0_rgba(0,0,0,0.6)] hover:bg-violet-500 disabled:opacity-50"
                >
                  <Play className="h-3 w-3" />
                  {running ? "Running" : "Run"}
                </button>
                <span className="text-[10px] uppercase tracking-[0.15em] text-dim">
                  ctrl + enter
                </span>
                {result ? (
                  <span className="ml-auto text-[10px] uppercase tracking-[0.15em] text-dim" data-testid="query-summary">
                    {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
                    {result.truncated ? " (truncated)" : ""} in {result.elapsedMs.toFixed(0)} ms
                  </span>
                ) : null}
              </div>

              {queryError ? (
                <p className="border border-rose-500/60 bg-rose-950/40 p-3 text-xs text-rose-300" role="alert" data-testid="query-error">
                  {queryError}
                </p>
              ) : null}

              {result ? (
                <div className="win-well max-h-80 overflow-auto">
                  <table className="w-full border-collapse text-left text-[11px]" data-testid="query-results">
                    <thead className="sticky top-0 bg-[#160a2b]">
                      <tr>
                        {result.columns.map((column) => (
                          <th key={column} className="whitespace-nowrap border-b border-violet-900 px-3 py-1.5 font-display uppercase tracking-[0.12em] text-violet-300">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="odd:bg-white/[0.02]">
                          {result.columns.map((column) => (
                            <td
                              key={column}
                              className={`whitespace-nowrap px-3 py-1 tabular-nums ${
                                row[column] === null ? "text-dim" : "text-ink"
                              }`}
                            >
                              {formatCell(row[column])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs leading-relaxed text-dim">
                Download the current in-memory buffer for one table. Only rows
                inside the retention window exist; older rows have been evicted.
              </p>
              <fieldset className="space-y-2">
                <legend className="mb-2 font-display text-[10px] uppercase tracking-[0.2em] text-dim">
                  Table
                </legend>
                {TABLES.map((item) => (
                  <label key={item.id} className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                    <input
                      type="radio"
                      name="export-table"
                      checked={table === item.id}
                      onChange={() => setTable(item.id)}
                      className="accent-violet-500"
                    />
                    {item.label}
                  </label>
                ))}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="mb-2 font-display text-[10px] uppercase tracking-[0.2em] text-dim">
                  Format
                </legend>
                {(["csv", "parquet"] as const).map((item) => (
                  <label key={item} className="flex cursor-pointer items-center gap-2 text-xs uppercase text-ink">
                    <input
                      type="radio"
                      name="export-format"
                      checked={format === item}
                      onChange={() => setFormat(item)}
                      className="accent-violet-500"
                    />
                    {item}
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                onClick={() => void runExport()}
                disabled={exporting}
                className="flex items-center gap-2 bg-violet-600 px-4 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-white shadow-[inset_1px_1px_0_rgba(233,213,255,0.5),inset_-1px_-1px_0_rgba(0,0,0,0.6)] hover:bg-violet-500 disabled:opacity-50"
              >
                <Download className="h-3 w-3" />
                {exporting ? "Exporting" : "Download"}
              </button>
              {exportMessage ? (
                <p className="text-xs text-violet-200" data-testid="export-message">
                  {exportMessage}
                </p>
              ) : null}
            </div>
          )}
        </Window>
      </div>
    </div>
  );
}
