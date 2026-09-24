"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CandlestickChart,
  Cpu,
  MessageSquare,
  Radio,
  Terminal,
  Thermometer,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useTelemetryPipeline } from "@/hooks/useTelemetryPipeline";
import { useEChart } from "@/hooks/useEChart";
import { useForecast } from "@/hooks/useForecast";
import { buildAdvice } from "@/analytics/advisor";
import { evaluateAlerts, trendTag } from "@/analytics/alerts";
import {
  candlesSql,
  diagnosticsSql,
  kpiSql,
  sentimentSql,
  statusSql,
} from "@/analytics/sql";
import {
  RANGES,
  type CandleRow,
  type DiagnosticsRow,
  type KpiSnapshot,
  type RangeId,
  type SentimentRow,
  type StatusRow,
  type ThresholdAlert,
} from "@/types/analytics";
import { KpiTile, Readout, StatusIndicator, Window } from "@/components/Window";
import { TimeRangeSelector, ToastStack, type Toast } from "@/components/Controls";
import ConsoleModal from "@/components/ConsoleModal";
import ForecastPanel from "@/components/ForecastPanel";
import {
  MARKET_INITIAL_OPTION,
  SENTIMENT_INITIAL_OPTION,
  buildDiagnosticsOption,
  buildMarketOption,
  buildSentimentOption,
  buildStatusOption,
  marketSymbols,
} from "@/components/chartOptions";

const TOAST_LIFETIME_MS = 8000;
const ALERT_TOAST_COOLDOWN_MS = 30_000;
const MAX_TOASTS = 3;
const LIVE_FEED = process.env.NEXT_PUBLIC_ALPHA_FEED === "coinbase";

export default function Dashboard() {
  const { state, query, forecast, runUserQuery, exportTable } = useTelemetryPipeline();

  const [rangeId, setRangeId] = useState<RangeId>("live");
  const range = RANGES.find((item) => item.id === rangeId) ?? RANGES[0];
  const [kpis, setKpis] = useState<KpiSnapshot | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [zoomLocked, setZoomLocked] = useState(false);

  const streaming = state.status === "streaming";
  const snapshot = useForecast(streaming, forecast);
  const advice = useMemo(() => buildAdvice(snapshot), [snapshot]);
  const alerts = useMemo(() => evaluateAlerts(kpis), [kpis]);

  const snapshotRef = useRef(snapshot);
  const legendSelectedRef = useRef<Record<string, boolean>>({});
  const zoomLockedRef = useRef(false);
  const toastedAtRef = useRef(new Map<string, number>());
  const toastTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const marketContainerRef = useRef<HTMLDivElement>(null);
  const sentimentContainerRef = useRef<HTMLDivElement>(null);
  const diagnosticsContainerRef = useRef<HTMLDivElement>(null);
  const statusContainerRef = useRef<HTMLDivElement>(null);

  const marketChartRef = useEChart(marketContainerRef, MARKET_INITIAL_OPTION);
  const sentimentChartRef = useEChart(sentimentContainerRef, SENTIMENT_INITIAL_OPTION);
  const diagnosticsChartRef = useEChart(diagnosticsContainerRef);
  const statusChartRef = useEChart(statusContainerRef);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const chart = marketChartRef.current;
    if (!chart) return;
    const onLegend = (event: unknown) => {
      const selected = (event as { selected?: Record<string, boolean> }).selected;
      if (selected) legendSelectedRef.current = { ...selected };
    };
    const onZoom = () => {
      const zoom = (
        chart.getOption() as { dataZoom?: { start?: number; end?: number }[] }
      ).dataZoom?.[0];
      const locked = !!zoom && ((zoom.start ?? 0) > 0.5 || (zoom.end ?? 100) < 99.5);
      zoomLockedRef.current = locked;
      setZoomLocked(locked);
    };
    chart.on("legendselectchanged", onLegend);
    chart.on("datazoom", onZoom);
    return () => {
      chart.off("legendselectchanged", onLegend);
      chart.off("datazoom", onZoom);
    };
  }, [marketChartRef]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const raiseAlerts = useCallback(
    (active: ThresholdAlert[]) => {
      const toasted = toastedAtRef.current;
      const activeIds = new Set(active.map((alert) => alert.id));
      for (const id of Array.from(toasted.keys())) {
        if (!activeIds.has(id as ThresholdAlert["id"])) toasted.delete(id);
      }
      const now = Date.now();
      for (const alert of active) {
        const last = toasted.get(alert.id);
        if (last !== undefined && now - last < ALERT_TOAST_COOLDOWN_MS) continue;
        toasted.set(alert.id, now);
        const toast: Toast = { id: `${alert.id}-${now}`, message: alert.message };
        setToasts((current) => [...current.slice(-(MAX_TOASTS - 1)), toast]);
        toastTimersRef.current.push(
          setTimeout(() => dismissToast(toast.id), TOAST_LIFETIME_MS)
        );
      }
    },
    [dismissToast]
  );

  useEffect(() => {
    if (!streaming) return;

    let animationFrameId: number;
    let lastPollTime = 0;
    let isFetching = false;
    const tzOffsetMinutes = -new Date().getTimezoneOffset();

    const tick = (timestamp: number) => {
      animationFrameId = requestAnimationFrame(tick);
      if (isFetching || timestamp - lastPollTime < range.pollMs) return;
      lastPollTime = timestamp;
      isFetching = true;

      const ctx = { nowMs: Date.now(), tzOffsetMinutes };

      Promise.all([
        query<CandleRow>(candlesSql(ctx, range)),
        query<SentimentRow>(sentimentSql(ctx, range)),
        query<DiagnosticsRow>(diagnosticsSql(ctx, range)),
        query<StatusRow>(statusSql(ctx)),
        query<KpiSnapshot>(kpiSql(ctx, range.windowMs)),
      ])
        .then(([candles, sentimentRows, diagnosticsRows, statusRows, kpiRows]) => {
          const marketChart = marketChartRef.current;
          if (marketChart && !zoomLockedRef.current) {
            const selected = legendSelectedRef.current;
            const symbols = marketSymbols(candles);
            let anyVisible = symbols.some((symbol) => selected[symbol] === true);
            for (const symbol of symbols) {
              if (!(symbol in selected)) {
                selected[symbol] = !anyVisible;
                anyVisible = anyVisible || selected[symbol];
              }
            }
            const current = snapshotRef.current;
            marketChart.setOption(
              buildMarketOption({
                candles,
                selected,
                trends: current?.trends ?? [],
                trendCutoffMs: current?.trendCutoffMs ?? null,
              }),
              { replaceMerge: ["series"] }
            );
          }

          sentimentChartRef.current?.setOption(buildSentimentOption(sentimentRows));
          diagnosticsChartRef.current?.setOption(buildDiagnosticsOption(diagnosticsRows));
          statusChartRef.current?.setOption(buildStatusOption(statusRows));

          const kpi = kpiRows[0] ?? null;
          setKpis(kpi);
          raiseAlerts(evaluateAlerts(kpi));
        })
        .catch(() => {
          // Transient query errors are expected while DuckDB warms up; the
          // next animation-frame tick will retry automatically.
        })
        .finally(() => {
          isFetching = false;
        });
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    streaming,
    range,
    query,
    raiseAlerts,
    marketChartRef,
    sentimentChartRef,
    diagnosticsChartRef,
    statusChartRef,
  ]);

  const resetZoom = () => {
    marketChartRef.current?.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
  };

  const totalIngested =
    state.ingested.alpha + state.ingested.beta + state.ingested.gamma;
  const sentimentAlert = alerts.find((alert) => alert.id === "sentiment")?.message ?? null;
  const cpuAlert = alerts.find((alert) => alert.id === "cpu")?.message ?? null;
  const num = (value: number | null | undefined, digits: number, suffix = "") =>
    value === null || value === undefined ? "--" : `${value.toFixed(digits)}${suffix}`;

  return (
    <div className="scanlines relative min-h-screen text-ink">
      <div className="floor-grid" aria-hidden="true" />
      <div className="relative z-10 mx-auto max-w-[1600px] px-6 pb-40 pt-8">
        <header className="win mb-8 flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex items-center gap-3">
            <div className="win-well flex h-11 w-11 items-center justify-center text-neon">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h1 className="glow-text font-display text-2xl font-bold uppercase leading-none tracking-[0.28em] text-ink">
                Pulse<span className="ml-3 text-magenta">Engine</span>
              </h1>
              <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-dim">
                rt telemetry // duckdb-wasm // stream a-b-g
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {state.errorMessage ? (
              <div className="flex max-w-xl items-center gap-2 border border-rose-500/60 bg-rose-950/50 px-2.5 py-1.5 text-[11px] text-rose-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{state.errorMessage}</span>
              </div>
            ) : null}
            <TimeRangeSelector value={rangeId} onChange={setRangeId} />
            <button
              type="button"
              onClick={() => setConsoleOpen(true)}
              aria-haspopup="dialog"
              className="win-well flex items-center gap-2 px-2.5 py-1.5 text-[11px] uppercase tracking-[0.18em] text-ink hover:bg-violet-950"
            >
              <Terminal className="h-3.5 w-3.5 text-neon" />
              Console
            </button>
            <Readout label="Rows" value={totalIngested.toLocaleString()} />
            <Readout
              label="Evicted"
              value={
                state.lastEvictionAt === null
                  ? "--"
                  : state.lastEvictionCount.toLocaleString()
              }
              testId="eviction-status"
            />
            <StatusIndicator status={state.status} />
          </div>
        </header>

        <section className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-6">
          <KpiTile
            icon={<TrendingUp className="h-5 w-5" />}
            label="Active Symbols"
            value={num(kpis?.active_symbols, 0)}
            accent="#c084fc"
            trend={trendTag(kpis?.active_symbols ?? null, kpis?.prev_active_symbols ?? null, "percent", true)}
          />
          <KpiTile
            icon={<MessageSquare className="h-5 w-5" />}
            label="Avg Sentiment"
            value={num(kpis?.avg_sentiment, 2)}
            accent="#f0abfc"
            trend={trendTag(kpis?.avg_sentiment ?? null, kpis?.prev_avg_sentiment ?? null, "absolute", true)}
            alert={sentimentAlert}
          />
          <KpiTile
            icon={<Thermometer className="h-5 w-5" />}
            label="Peak CPU Temp"
            value={num(kpis?.peak_cpu_temp, 1, "°C")}
            accent="#fb923c"
            trend={trendTag(kpis?.peak_cpu_temp ?? null, kpis?.prev_peak_cpu_temp ?? null, "percent", false)}
            alert={cpuAlert}
          />
          <KpiTile
            icon={<Cpu className="h-5 w-5" />}
            label="System Health"
            value={num(kpis?.health_pct, 1, "%")}
            accent="#a3e635"
            trend={trendTag(kpis?.health_pct ?? null, kpis?.prev_health_pct ?? null, "percent", true)}
          />
          <KpiTile
            icon={<Radio className="h-5 w-5" />}
            label="Devices Reporting"
            value={num(kpis?.device_count, 0)}
            accent="#818cf8"
            trend={trendTag(kpis?.device_count ?? null, kpis?.prev_device_count ?? null, "percent", true)}
          />
          <KpiTile
            icon={<Zap className="h-5 w-5" />}
            label="Post Velocity"
            value={num(kpis?.post_velocity, 0, "/s")}
            accent="#67e8f9"
            trend={trendTag(kpis?.post_velocity ?? null, kpis?.prev_post_velocity ?? null, "percent", true)}
          />
        </section>

        <section className="grid grid-cols-1 gap-8 xl:grid-cols-3">
          <Window
            className="xl:col-span-3"
            title="market_feed // alpha"
            icon={<CandlestickChart className="h-3.5 w-3.5" />}
            well
            actions={
              zoomLocked ? (
                <button
                  type="button"
                  onClick={resetZoom}
                  className="win-well px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-amber-300 hover:bg-violet-950"
                >
                  Zoom locked - reset
                </button>
              ) : null
            }
            footer={
              <>
                <span>tbl alpha_ticks</span>
                <span>win {range.label}</span>
                <span>candle {range.bucketSeconds}s</span>
                <span>sma 10s/60s</span>
                <span>bollinger 20s 2&sigma;</span>
                <span>legend toggles symbols</span>
                <span>wheel / slider zooms</span>
              </>
            }
          >
            <div ref={marketContainerRef} className="h-[26rem] w-full" />
          </Window>

          <Window
            title="sentiment_trace // beta"
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            well
            footer={
              <>
                <span>tbl beta_sentiment</span>
                <span>win {range.label}</span>
                <span>bucket {range.bucketSeconds}s</span>
              </>
            }
          >
            <div ref={sentimentContainerRef} className="h-72 w-full" />
          </Window>

          <Window
            title="iot_diag // gamma"
            icon={<Thermometer className="h-3.5 w-3.5" />}
            well
            footer={
              <>
                <span>tbl gamma_diagnostics</span>
                <span>win {range.label}</span>
                <span>bucket {range.bucketSeconds}s</span>
              </>
            }
          >
            <div ref={diagnosticsContainerRef} className="h-72 w-full" />
          </Window>

          <Window
            title="device_status // gamma"
            icon={<BarChart3 className="h-3.5 w-3.5" />}
            well
            footer={
              <>
                <span>latest state per device</span>
                <span>win 30s</span>
              </>
            }
          >
            <div ref={statusContainerRef} className="h-72 w-full" />
          </Window>

          <div className="xl:col-span-3">
            <ForecastPanel snapshot={snapshot} advice={advice} liveFeed={LIVE_FEED} />
          </div>
        </section>
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {consoleOpen ? (
        <ConsoleModal
          onClose={() => setConsoleOpen(false)}
          runUserQuery={runUserQuery}
          exportTable={exportTable}
        />
      ) : null}
    </div>
  );
}
