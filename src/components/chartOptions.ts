import type * as echarts from "echarts";
import type {
  CandleRow,
  DiagnosticsRow,
  SentimentRow,
  StatusRow,
  TrendRow,
} from "@/types/analytics";
import {
  AXIS_TOOLTIP,
  CHART_GRID,
  CHART_INK,
  CHART_PANEL,
  CHART_SPLIT_LINE,
  CHART_TEXT,
  CHART_LEGEND,
  ITEM_TOOLTIP,
  SERIES_PALETTE,
  STATUS_COLORS,
  STATUS_ORDER,
  categoryAxis,
  formatNumber,
  horizontalValueAxis,
  lineSeries,
  valueAxis,
} from "@/components/chartTheme";

export const MARKET_OVERLAYS = {
  sma10: "SMA 10s",
  sma60: "SMA 60s",
  bbUpper: "Bollinger +2σ",
  bbLower: "Bollinger -2σ",
  trend: "Trend (60s fit)",
} as const;

export function marketSymbols(candles: CandleRow[]): string[] {
  return Array.from(new Set(candles.map((row) => row.symbol))).sort();
}

export function primarySymbol(
  symbols: string[],
  selected: Record<string, boolean>
): string | null {
  return symbols.find((symbol) => selected[symbol] !== false) ?? null;
}

export interface MarketOptionInput {
  candles: CandleRow[];
  selected: Record<string, boolean>;
  trends: TrendRow[];
  trendCutoffMs: number | null;
}

function compactVolume(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(value);
}

/** Buckets whose high-low range is unusually wide versus the rest of the window. */
function volatileBuckets(rows: CandleRow[]): CandleRow[] {
  if (rows.length < 8) return [];
  const ranges = rows.map((row) => (row.open > 0 ? (row.high - row.low) / row.open : 0));
  const mean = ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
  const variance = ranges.reduce((sum, value) => sum + (value - mean) ** 2, 0) / ranges.length;
  const threshold = mean + 1.5 * Math.sqrt(variance);
  return rows.filter((_, index) => ranges[index] > threshold);
}

export function buildMarketOption(input: MarketOptionInput): echarts.EChartsOption {
  const { candles, selected, trends, trendCutoffMs } = input;
  const symbols = marketSymbols(candles);
  const buckets = Array.from(new Set(candles.map((row) => row.bucket_ms))).sort((a, b) => a - b);
  const labelByBucket = new Map(candles.map((row) => [row.bucket_ms, row.label]));
  const categories = buckets.map((bucket) => labelByBucket.get(bucket) ?? "");
  const primary = primarySymbol(symbols, selected);

  const series: echarts.SeriesOption[] = [];
  symbols.forEach((symbol, index) => {
    const color = SERIES_PALETTE[index % SERIES_PALETTE.length];
    const rows = new Map(
      candles.filter((row) => row.symbol === symbol).map((row) => [row.bucket_ms, row])
    );

    const flagged = symbol === primary ? volatileBuckets(Array.from(rows.values())) : [];
    series.push({
      name: symbol,
      type: "candlestick",
      xAxisIndex: 0,
      yAxisIndex: 0,
      itemStyle: {
        color,
        color0: CHART_PANEL,
        borderColor: color,
        borderColor0: color,
        borderWidth: 1,
      },
      data: buckets.map((bucket) => {
        const row = rows.get(bucket);
        return row ? [row.open, row.close, row.low, row.high] : "-";
      }) as never,
      markArea: {
        silent: true,
        itemStyle: { color: "rgba(232, 121, 249, 0.12)" },
        data: flagged.map((row) => [{ xAxis: row.label }, { xAxis: row.label }]) as never,
      },
    });
    series.push({
      name: symbol,
      type: "bar",
      xAxisIndex: 1,
      yAxisIndex: 1,
      stack: "volume",
      itemStyle: { color: `${color}99` },
      data: buckets.map((bucket) => rows.get(bucket)?.volume ?? 0),
    });
  });

  const overlayNames: string[] = [];
  if (primary) {
    const rows = new Map(
      candles.filter((row) => row.symbol === primary).map((row) => [row.bucket_ms, row])
    );
    const pick = (read: (row: CandleRow) => number | null) =>
      buckets.map((bucket) => {
        const row = rows.get(bucket);
        return row ? read(row) : null;
      });
    const band = (sign: 1 | -1) =>
      pick((row) =>
        row.bb_mid !== null && row.bb_sd !== null ? row.bb_mid + sign * 2 * row.bb_sd : null
      );

    series.push(
      lineSeries(MARKET_OVERLAYS.sma10, "#fde68a", pick((row) => row.sma10), { width: 1.5 }),
      lineSeries(MARKET_OVERLAYS.sma60, "#67e8f9", pick((row) => row.sma60), { width: 1.5 }),
      lineSeries(MARKET_OVERLAYS.bbUpper, "#a78bfa", band(1), { dashed: true, width: 1 }),
      lineSeries(MARKET_OVERLAYS.bbLower, "#a78bfa", band(-1), { dashed: true, width: 1 })
    );
    overlayNames.push(
      MARKET_OVERLAYS.sma10,
      MARKET_OVERLAYS.sma60,
      MARKET_OVERLAYS.bbUpper,
      MARKET_OVERLAYS.bbLower
    );

    const trend = trends.find((item) => item.symbol === primary);
    if (trend && trendCutoffMs !== null) {
      series.push(
        lineSeries(
          MARKET_OVERLAYS.trend,
          "#f0abfc",
          buckets.map((bucket) =>
            bucket >= trendCutoffMs
              ? trend.intercept + trend.slope * ((bucket - trendCutoffMs) / 1000)
              : null
          ),
          { dashed: true, width: 2 }
        )
      );
      overlayNames.push(MARKET_OVERLAYS.trend);
    }
  }

  return {
    legend: {
      ...CHART_LEGEND,
      type: "scroll",
      data: [...symbols, ...overlayNames],
      selected: selected as never,
    },
    tooltip: {
      ...AXIS_TOOLTIP,
      axisPointer: { type: "cross", link: [{ xAxisIndex: "all" }] },
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      { ...CHART_GRID, left: 60, top: 34, height: "50%" },
      { ...CHART_GRID, left: 60, top: "68%", height: "14%" },
    ],
    xAxis: [
      categoryAxis(categories, { showLabels: false, gridIndex: 0 }),
      categoryAxis(categories, { gridIndex: 1 }),
    ],
    yAxis: [
      valueAxis({ scale: true, axisLabel: { color: CHART_TEXT, fontSize: 10, formatter: (v: number) => formatNumber(v) } }),
      valueAxis({
        gridIndex: 1,
        splitNumber: 2,
        axisLabel: { color: CHART_TEXT, fontSize: 10, formatter: (v: number) => compactVolume(v) },
      }),
    ],
    series,
  };
}

export const MARKET_INITIAL_OPTION: echarts.EChartsOption = {
  dataZoom: [
    { type: "inside", xAxisIndex: [0, 1], filterMode: "filter", zoomOnMouseWheel: true },
    {
      type: "slider",
      xAxisIndex: [0, 1],
      filterMode: "filter",
      height: 14,
      bottom: 6,
      borderColor: "#3a1c74",
      backgroundColor: "#05010b",
      fillerColor: "rgba(192, 132, 252, 0.22)",
      handleStyle: { color: "#c084fc", borderColor: "#c084fc" },
      textStyle: { color: CHART_TEXT, fontSize: 9 },
      dataBackground: { lineStyle: { color: "#3a1c74" }, areaStyle: { color: "#1a0b33" } },
    },
  ],
};

export const SENTIMENT_VELOCITY = "Post velocity (posts/s)";
export const SENTIMENT_IMPACT = "Influencer impact";

export const SENTIMENT_INITIAL_OPTION: echarts.EChartsOption = {
  legend: { selected: { [SENTIMENT_IMPACT]: false } },
};

export function buildSentimentOption(rows: SentimentRow[]): echarts.EChartsOption {
  return {
    legend: { ...CHART_LEGEND, type: "scroll" },
    tooltip: AXIS_TOOLTIP,
    grid: { ...CHART_GRID, right: 52 },
    xAxis: categoryAxis(rows.map((row) => row.label)),
    yAxis: [
      valueAxis({ min: -1, max: 1 }),
      valueAxis({ splitLine: { show: false }, min: 0 }),
    ],
    series: [
      {
        name: SENTIMENT_VELOCITY,
        type: "bar",
        yAxisIndex: 1,
        barMaxWidth: 14,
        itemStyle: { color: "rgba(129, 140, 248, 0.32)" },
        data: rows.map((row) => row.velocity),
      },
      lineSeries("Sentiment", "#e879f9", rows.map((row) => row.avg_sentiment), { area: true }),
      lineSeries("Influencer-weighted", "#c084fc", rows.map((row) => row.weighted_sentiment), {
        dashed: true,
      }),
      lineSeries(SENTIMENT_IMPACT, "#fde68a", rows.map((row) => row.impact), { width: 1.5 }),
    ],
  };
}

export function buildDiagnosticsOption(rows: DiagnosticsRow[]): echarts.EChartsOption {
  const peak = lineSeries("Peak CPU (°C)", "#fb7185", rows.map((row) => row.max_cpu_temp));
  peak.markLine = {
    silent: true,
    symbol: "none",
    lineStyle: { color: "#fb7185", type: "dashed", width: 1 },
    label: { color: "#fb7185", fontSize: 9, formatter: "85°C throttle" },
    data: [{ yAxis: 85 }],
  };
  return {
    legend: { ...CHART_LEGEND, type: "scroll" },
    tooltip: AXIS_TOOLTIP,
    grid: { ...CHART_GRID, right: 52 },
    xAxis: categoryAxis(rows.map((row) => row.label)),
    yAxis: [
      valueAxis({ min: 0, max: 100 }),
      valueAxis({ splitLine: { show: false }, min: 0 }),
    ],
    series: [
      peak,
      lineSeries("Avg CPU (°C)", "#f472b6", rows.map((row) => row.avg_cpu_temp)),
      lineSeries("Memory (%)", "#c084fc", rows.map((row) => row.avg_memory), { dashed: true }),
      lineSeries("Latency (ms)", "#67e8f9", rows.map((row) => row.avg_latency), {
        yAxisIndex: 1,
        width: 1.5,
      }),
    ],
  };
}

export function buildStatusOption(rows: StatusRow[]): echarts.EChartsOption {
  const ordered = STATUS_ORDER.map((status) => ({
    status,
    cnt: rows.find((row) => row.status === status)?.cnt ?? 0,
  }));
  return {
    grid: { left: 84, right: 48, top: 12, bottom: 12 },
    tooltip: ITEM_TOOLTIP,
    xAxis: horizontalValueAxis({ type: "value", minInterval: 1 }),
    yAxis: {
      type: "category",
      inverse: true,
      data: ordered.map((row) => row.status.toUpperCase()),
      axisLine: { lineStyle: { color: CHART_SPLIT_LINE } },
      axisTick: { show: false },
      axisLabel: { color: CHART_TEXT, fontSize: 10 },
    },
    series: [
      {
        name: "Devices",
        type: "bar",
        barWidth: 20,
        label: { show: true, position: "right", color: CHART_INK, fontSize: 11 },
        data: ordered.map((row) => ({
          value: row.cnt,
          itemStyle: { color: STATUS_COLORS[row.status], borderRadius: 0 },
        })),
      },
    ],
  };
}
