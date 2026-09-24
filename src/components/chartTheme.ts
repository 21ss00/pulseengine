import type * as echarts from "echarts";

export const CHART_TEXT = "#9d8bbd";
export const CHART_INK = "#e9defa";
export const CHART_AXIS_LINE = "rgba(168, 85, 247, 0.4)";
export const CHART_SPLIT_LINE = "rgba(168, 85, 247, 0.14)";
export const CHART_PANEL = "#0a0414";

export const SERIES_PALETTE = [
  "#c084fc",
  "#f0abfc",
  "#818cf8",
  "#f472b6",
  "#67e8f9",
  "#fde68a",
  "#a3e635",
  "#fb923c",
];

export const STATUS_ORDER = ["nominal", "warning", "throttled", "offline"];

export const STATUS_COLORS: Record<string, string> = {
  nominal: "#a3e635",
  warning: "#fbbf24",
  throttled: "#fb7185",
  offline: "#6b5b8a",
};

export const CHART_TOOLTIP_BASE: echarts.TooltipComponentOption = {
  backgroundColor: "#0d0616",
  borderColor: "#7c3aed",
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: CHART_INK, fontSize: 11 },
  extraCssText: "border-radius:0;box-shadow:4px 4px 0 #000;",
};

export const CHART_LEGEND: echarts.LegendComponentOption = {
  top: 0,
  right: 0,
  icon: "rect",
  itemWidth: 10,
  itemHeight: 10,
  itemGap: 12,
  textStyle: { color: CHART_TEXT, fontSize: 10 },
  inactiveColor: "#4b3b6b",
};

export function formatNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  if (abs >= 10) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(3);
  if (abs === 0) return "0";
  return value.toFixed(4);
}

interface TooltipParam {
  axisValueLabel?: string;
  seriesName?: string;
  seriesType?: string;
  color?: unknown;
  value?: unknown;
  data?: unknown;
}

function tooltipRow(color: string | null, label: string, value: string): string {
  const swatch =
    color === null
      ? '<span style="display:inline-block;width:8px;margin-right:6px"></span>'
      : `<span style="display:inline-block;width:8px;height:8px;background:${color};margin-right:6px"></span>`;
  return `<tr><td style="padding:1px 0;white-space:nowrap">${swatch}${label}</td><td style="text-align:right;padding-left:18px;font-variant-numeric:tabular-nums;color:${CHART_INK}">${value}</td></tr>`;
}

/**
 * Axis tooltip laid out as an aligned key/value table: one header with the
 * x-axis label, then a row per series (candles expand to O/H/L/C).
 */
export function alignedTooltip(params: unknown): string {
  const list = (Array.isArray(params) ? params : [params]) as TooltipParam[];
  const header = list[0]?.axisValueLabel ?? "";
  const rows: string[] = [];

  for (const param of list) {
    const color = typeof param.color === "string" ? param.color : "#c084fc";
    const name = param.seriesName ?? "";
    if (param.seriesType === "candlestick") {
      const data = Array.isArray(param.data) ? param.data.slice(-4) : [];
      if (data.length !== 4) continue;
      const [open, close, low, high] = data as number[];
      rows.push(tooltipRow(color, name, ""));
      rows.push(tooltipRow(null, "&nbsp;&nbsp;open", formatNumber(open)));
      rows.push(tooltipRow(null, "&nbsp;&nbsp;high", formatNumber(high)));
      rows.push(tooltipRow(null, "&nbsp;&nbsp;low", formatNumber(low)));
      rows.push(tooltipRow(null, "&nbsp;&nbsp;close", formatNumber(close)));
      continue;
    }
    const raw = Array.isArray(param.value) ? param.value[param.value.length - 1] : param.value;
    if (raw === null || raw === undefined || raw === "-") continue;
    const label = param.seriesType === "bar" && name ? `${name} volume` : name;
    rows.push(tooltipRow(color, label, formatNumber(raw)));
  }

  return `<div style="min-width:180px"><div style="color:${CHART_TEXT};margin-bottom:4px;padding-bottom:3px;border-bottom:1px solid #3a1c74">${header}</div><table style="width:100%;border-collapse:collapse">${rows.join("")}</table></div>`;
}

export const AXIS_TOOLTIP: echarts.TooltipComponentOption = {
  ...CHART_TOOLTIP_BASE,
  trigger: "axis",
  axisPointer: {
    type: "line",
    lineStyle: { color: "rgba(192, 132, 252, 0.6)", type: "dashed" },
  },
  formatter: alignedTooltip as never,
};

export const ITEM_TOOLTIP: echarts.TooltipComponentOption = {
  ...CHART_TOOLTIP_BASE,
  trigger: "item",
};

export const CHART_GRID: echarts.GridComponentOption = {
  left: 56,
  right: 16,
  top: 34,
  bottom: 28,
};

export function categoryAxis(
  data: string[],
  options: { showLabels?: boolean; gridIndex?: number } = {}
): echarts.XAXisComponentOption {
  return {
    type: "category",
    data,
    gridIndex: options.gridIndex ?? 0,
    axisLine: { lineStyle: { color: CHART_AXIS_LINE } },
    axisTick: { lineStyle: { color: CHART_AXIS_LINE } },
    axisLabel: {
      show: options.showLabels ?? true,
      color: CHART_TEXT,
      fontSize: 10,
      hideOverlap: true,
      showMaxLabel: false,
    },
  };
}

const VALUE_AXIS_BASE = {
  type: "value",
  splitLine: { lineStyle: { color: CHART_SPLIT_LINE } },
  axisLine: { show: false },
  axisLabel: { color: CHART_TEXT, fontSize: 10 },
} as const;

export function valueAxis(
  overrides: echarts.YAXisComponentOption = {}
): echarts.YAXisComponentOption {
  return { ...VALUE_AXIS_BASE, ...overrides } as echarts.YAXisComponentOption;
}

export function horizontalValueAxis(
  overrides: echarts.XAXisComponentOption = {}
): echarts.XAXisComponentOption {
  return { ...VALUE_AXIS_BASE, ...overrides } as echarts.XAXisComponentOption;
}

export function lineSeries(
  name: string,
  color: string,
  data: (number | null)[],
  options: {
    area?: boolean;
    dashed?: boolean;
    yAxisIndex?: number;
    width?: number;
  } = {}
): echarts.LineSeriesOption {
  return {
    name,
    type: "line",
    showSymbol: false,
    connectNulls: true,
    yAxisIndex: options.yAxisIndex ?? 0,
    lineStyle: {
      width: options.width ?? 2,
      color,
      type: options.dashed ? "dashed" : "solid",
    },
    itemStyle: { color },
    ...(options.area
      ? {
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${color}55` },
                { offset: 1, color: `${color}00` },
              ],
            },
          },
        }
      : {}),
    data,
  };
}
