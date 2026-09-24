"use client";

import { useEffect, useRef } from "react";
import { DollarSign, Gem, Scale } from "lucide-react";
import { DataBadge, Window } from "@/components/Window";
import { useEChart } from "@/hooks/useEChart";
import { CROSS_ASSET_SERIES, type WorldData } from "@/hooks/useWorldData";
import {
  AXIS_TOOLTIP,
  CHART_GRID,
  categoryAxis,
  lineSeries,
  valueAxis,
} from "@/components/chartTheme";
import { DXY_SERIES_ID, FX_CURRENCIES, METALS } from "@/world/constants";
import type { WorldLatestRow, WorldSeriesPoint } from "@/types/world";
import Sparkline from "@/components/world/Sparkline";
import {
  arrow,
  changeColor,
  formatPrice,
  pctChange,
  signedPct,
  timeAgo,
} from "@/components/world/format";

const DAY_MS = 86_400_000;

function newestTime(rows: (WorldLatestRow | undefined)[]): number | null {
  const times = rows.filter((row): row is WorldLatestRow => !!row).map((row) => row.t);
  return times.length > 0 ? Math.max(...times) : null;
}

function RateCard({
  row,
  points,
  featured = false,
  changeLabel,
  change,
  extra,
}: {
  row: WorldLatestRow | undefined;
  points: WorldSeriesPoint[];
  featured?: boolean;
  changeLabel: string;
  change: number | null;
  extra?: string;
}) {
  if (!row) {
    return (
      <div className="win-well p-2.5 text-[11px] text-dim">
        <p className="font-display uppercase tracking-[0.16em]">--</p>
        <p className="mt-2">waiting for data</p>
      </div>
    );
  }
  const color = changeColor(change);
  return (
    <div className={`win-well p-2.5 ${featured ? "border-violet-500/60" : ""}`} data-testid="rate-card">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-dim">
          {row.label}
        </p>
        <p className="text-[10px] tabular-nums" style={{ color }}>
          {arrow(change)} {signedPct(change)}
        </p>
      </div>
      <p className="mt-1 font-display text-xl font-bold tabular-nums text-ink">{formatPrice(row.value)}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <Sparkline points={points.map((p) => p.value)} color={color === "#8f7bb3" ? "#c084fc" : color} width={88} height={24} />
        <p className="text-right text-[9px] uppercase tracking-[0.12em] text-dim">
          {changeLabel}
          {extra ? <span className="block">{extra}</span> : null}
        </p>
      </div>
    </div>
  );
}

export function FxWindow({ data }: { data: WorldData }) {
  const byId = new Map(data.latest.map((row) => [row.series_id, row]));
  const ids = [DXY_SERIES_ID, ...FX_CURRENCIES.map((currency) => `fx:${currency.code}`)];
  const updated = newestTime(ids.map((id) => byId.get(id)));

  return (
    <Window
      title="currencies // fx"
      icon={<DollarSign className="h-3.5 w-3.5" />}
      actions={<DataBadge live />}
      footer={
        <>
          <span>ecb reference rates</span>
          <span>via frankfurter.dev</span>
          <span>daily, 90d history</span>
          <span>{updated ? `latest ${new Date(updated).toISOString().slice(0, 10)}` : "loading"}</span>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {ids.map((id, index) => {
          const row = byId.get(id);
          const points = data.series[id] ?? [];
          const first = points[0];
          const span = first && points.length > 1 ? Math.round((points[points.length - 1].t - first.t) / DAY_MS) : 0;
          return (
            <RateCard
              key={id}
              row={row}
              points={points}
              featured={index === 0}
              change={pctChange(row?.value, row?.prev_value)}
              changeLabel="1d"
              extra={span > 1 ? `${span}d ${signedPct(pctChange(row?.value, first?.value), 1)}` : undefined}
            />
          );
        })}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-dim">
        Pairs are quoted by market convention (EUR/USD, GBP/USD and AUD/USD as foreign per dollar
        inverted). The USD index applies the ICE formula to the ECB rates.
      </p>
    </Window>
  );
}

function GoldChart({ points }: { points: WorldSeriesPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useEChart(containerRef);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || points.length === 0) return;
    chart.setOption({
      tooltip: AXIS_TOOLTIP,
      grid: { ...CHART_GRID, top: 12, bottom: 22, right: 12 },
      xAxis: categoryAxis(
        points.map((point) =>
          new Date(point.t).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        )
      ),
      yAxis: valueAxis({ scale: true }),
      series: [lineSeries("Gold token close", "#fde68a", points.map((p) => p.value), { area: true })],
    });
  }, [chartRef, points]);

  return <div ref={containerRef} className="h-44 w-full" />;
}

export function MetalsWindow({ data }: { data: WorldData }) {
  const byId = new Map(data.latest.map((row) => [row.series_id, row]));
  const token = byId.get("daily:PAXG");
  const tokenSeries = data.series["daily:PAXG"] ?? [];
  const updated = newestTime(METALS.map((metal) => byId.get(`metal:${metal.symbol}`)));

  return (
    <Window
      title="metals // gold"
      icon={<Gem className="h-3.5 w-3.5" />}
      actions={<DataBadge live />}
      footer={
        <>
          <span>spot: gold-api.com, 1 min</span>
          <span>history: paxg token daily</span>
          <span>{updated ? `updated ${timeAgo(updated)}` : "loading"}</span>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {METALS.map((metal) => {
          const row = byId.get(`metal:${metal.symbol}`);
          const points = data.series[`metal:${metal.symbol}`] ?? [];
          const isGold = metal.symbol === "XAU";
          return (
            <RateCard
              key={metal.symbol}
              row={row}
              points={points}
              featured={isGold}
              change={pctChange(row?.value, points[0]?.value)}
              changeLabel="session"
              extra={isGold && token ? `token 1d ${signedPct(pctChange(token.value, token.prev_value), 1)}` : metal.unit}
            />
          );
        })}
        <RateCard
          row={byId.get("metal:GSR")}
          points={data.series["metal:GSR"] ?? []}
          change={pctChange(byId.get("metal:GSR")?.value, data.series["metal:GSR"]?.[0]?.value)}
          changeLabel="session"
          extra="oz gold per oz silver"
        />
      </div>
      <div className="win-well mt-3 p-1">
        <GoldChart points={tokenSeries} />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-dim">
        Gold history is the PAXG token (one troy ounce of gold each), which tracks spot closely.
        Oil is not shown because no free browser-accessible source exists.
      </p>
    </Window>
  );
}

const ASSET_LABEL: Record<string, string> = {
  "daily:BTC": "BTC",
  "daily:ETH": "ETH",
  "daily:PAXG": "GOLD",
  [DXY_SERIES_ID]: "USD IX",
  "fx:EUR": "EUR",
  "fx:JPY": "JPY",
  "fx:GBP": "GBP",
};

export function CrossAssetWindow({ data }: { data: WorldData }) {
  const lookup = new Map<string, { corr: number | null; n: number }>();
  for (const row of data.cross) {
    lookup.set(`${row.x}|${row.y}`, row);
    lookup.set(`${row.y}|${row.x}`, row);
  }
  const ids = CROSS_ASSET_SERIES;
  const populated = data.cross.some((row) => row.x !== row.y && row.corr !== null);

  return (
    <Window
      title="cross-asset correlation"
      icon={<Scale className="h-3.5 w-3.5" />}
      actions={<DataBadge live />}
      footer={
        <>
          <span>daily returns, 60d</span>
          <span>weekdays only</span>
          <span>sources: coinbase + ecb</span>
        </>
      }
    >
      <div className="win-well overflow-auto">
        <table className="w-full border-collapse text-center text-[11px] tabular-nums" data-testid="cross-asset">
          <thead>
            <tr>
              <th className="p-2" />
              {ids.map((id) => (
                <th key={id} className="p-2 font-display text-[9px] uppercase tracking-[0.14em] text-dim">
                  {ASSET_LABEL[id]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ids.map((rowId) => (
              <tr key={rowId}>
                <th className="p-2 text-left font-display text-[9px] uppercase tracking-[0.14em] text-dim">
                  {ASSET_LABEL[rowId]}
                </th>
                {ids.map((columnId) => {
                  const cell = lookup.get(`${rowId}|${columnId}`);
                  const corr = cell?.corr ?? null;
                  const diagonal = rowId === columnId;
                  const alpha = corr === null ? 0 : Math.min(0.6, Math.abs(corr) * 0.75);
                  const rgb = corr !== null && corr < 0 ? "251, 113, 133" : "192, 132, 252";
                  return (
                    <td
                      key={columnId}
                      className={`p-2 ${diagonal ? "text-dim" : "text-ink"}`}
                      style={{ backgroundColor: diagonal ? "transparent" : `rgba(${rgb}, ${alpha})` }}
                      title={cell ? `r=${corr?.toFixed(3)}, ${cell.n} days` : "not enough overlapping days"}
                    >
                      {diagonal ? "1.00" : corr === null ? "--" : corr.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-dim">
        {populated
          ? "Purple means the pair moves together, red means it moves oppositely. Correlations shift, so treat them as context rather than a rule."
          : "Waiting for enough overlapping daily history from Coinbase and the ECB."}
      </p>
    </Window>
  );
}
