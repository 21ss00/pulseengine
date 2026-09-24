"use client";

import { useEffect, useMemo, useRef } from "react";
import type * as echarts from "echarts";
import { CloudSun, Globe } from "lucide-react";
import { DataBadge, Window } from "@/components/Window";
import { useEChart } from "@/hooks/useEChart";
import { useNow } from "@/hooks/useNow";
import type { WorldData } from "@/hooks/useWorldData";
import {
  CHART_INK,
  CHART_LEGEND,
  CHART_SPLIT_LINE,
  CHART_TEXT,
  CHART_TOOLTIP_BASE,
} from "@/components/chartTheme";
import type { EventQueryRow, IssPoint, WorldEventKind } from "@/types/world";
import { CITIES } from "@/world/constants";
import { formatCompact, timeAgo } from "@/components/world/format";

const KIND_STYLE: Record<Exclude<WorldEventKind, "quake">, { label: string; color: string; symbol: string }> = {
  storm: { label: "Storms", color: "#67e8f9", symbol: "diamond" },
  wildfire: { label: "Wildfires", color: "#fb923c", symbol: "triangle" },
  volcano: { label: "Volcanoes", color: "#fb7185", symbol: "arrow" },
  flood: { label: "Floods", color: "#818cf8", symbol: "rect" },
  other: { label: "Other events", color: "#a3a3b8", symbol: "circle" },
};

export function quakeColor(magnitude: number): string {
  if (magnitude >= 6) return "#fb7185";
  if (magnitude >= 5) return "#fb923c";
  if (magnitude >= 4) return "#fbbf24";
  return "#c084fc";
}

/** Splits the ISS ground track wherever it wraps across the antimeridian. */
export function issSegments(points: IssPoint[]): ([number, number] | null)[] {
  const out: ([number, number] | null)[] = [];
  let previous: IssPoint | null = null;
  for (const point of points) {
    if (previous && Math.abs(point.lon - previous.lon) > 180) out.push(null);
    out.push([point.lon, point.lat]);
    previous = point;
  }
  return out;
}

interface MapDatum {
  value: [number, number, number];
  name: string;
  t: number;
}

function toDatum(event: EventQueryRow): MapDatum {
  return { value: [event.lon, event.lat, event.magnitude ?? 0], name: event.title, t: event.t };
}

function buildMapOption(events: EventQueryRow[], iss: IssPoint[], current: IssPoint | null): echarts.EChartsOption {
  const series: echarts.SeriesOption[] = [
    {
      name: "Earthquakes",
      type: "scatter",
      data: events.filter((e) => e.kind === "quake").map(toDatum) as never,
      symbolSize: ((value: number[]) => 3 + (value[2] || 0) * 2.4) as never,
      itemStyle: {
        color: ((params: { value: number[] }) => quakeColor(params.value[2])) as never,
        opacity: 0.8,
      },
    },
  ];
  for (const [kind, style] of Object.entries(KIND_STYLE) as [keyof typeof KIND_STYLE, (typeof KIND_STYLE)[keyof typeof KIND_STYLE]][]) {
    const rows = events.filter((e) => e.kind === kind);
    if (rows.length === 0) continue;
    series.push({
      name: style.label,
      type: "scatter",
      symbol: style.symbol,
      symbolSize: 10,
      itemStyle: { color: style.color },
      data: rows.map(toDatum) as never,
    });
  }
  series.push({
    name: "ISS track",
    type: "line",
    showSymbol: false,
    silent: true,
    lineStyle: { color: "#f0abfc", width: 1, opacity: 0.7 },
    data: issSegments(iss) as never,
  });
  if (current) {
    series.push({
      name: "ISS",
      type: "scatter",
      symbol: "diamond",
      symbolSize: 15,
      itemStyle: { color: "#f0abfc", borderColor: "#fff", borderWidth: 1 },
      label: { show: true, formatter: "ISS", position: "right", color: CHART_INK, fontSize: 10 },
      data: [{ value: [current.lon, current.lat, 0], name: "International Space Station", t: current.t }] as never,
    });
  }

  return {
    legend: { ...CHART_LEGEND, type: "scroll" },
    tooltip: {
      ...CHART_TOOLTIP_BASE,
      trigger: "item",
      formatter: ((params: { data?: MapDatum; seriesName?: string }) => {
        const data = params.data;
        if (!data) return "";
        const magnitude = data.value[2] > 0 ? ` &middot; ${data.value[2].toFixed(1)}` : "";
        return `<div style="max-width:260px"><div style="color:${CHART_TEXT}">${params.seriesName}${magnitude}</div><div>${data.name.replace(/</g, "&lt;")}</div><div style="color:${CHART_TEXT}">${timeAgo(data.t)}</div></div>`;
      }) as never,
    },
    grid: { left: 40, right: 16, top: 34, bottom: 24 },
    xAxis: {
      type: "value",
      min: -180,
      max: 180,
      interval: 60,
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE } },
      axisLabel: { color: CHART_TEXT, fontSize: 10, formatter: "{value}°" },
    },
    yAxis: {
      type: "value",
      min: -90,
      max: 90,
      interval: 30,
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE } },
      axisLabel: { color: CHART_TEXT, fontSize: 10, formatter: "{value}°" },
    },
    series,
  };
}

function KpBar({ kp }: { kp: number | null }) {
  const level = kp ?? 0;
  const color = level >= 7 ? "#fb7185" : level >= 5 ? "#fbbf24" : level >= 4 ? "#fde68a" : "#a3e635";
  return (
    <div>
      <div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.14em] text-dim">
        <span>Geomagnetic Kp</span>
        <span className="font-display text-base font-bold" style={{ color }}>
          {kp === null ? "--" : kp.toFixed(1)}
        </span>
      </div>
      <div className="mt-1 h-2 bg-violet-950">
        <div className="h-2" style={{ width: `${Math.min(100, (level / 9) * 100)}%`, backgroundColor: color }} />
      </div>
      <p className="mt-1 text-[9px] uppercase tracking-[0.12em] text-dim">5+ is a storm, 7+ is severe</p>
    </div>
  );
}

export function PlanetWindow({ data }: { data: WorldData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useEChart(containerRef);
  const byId = useMemo(() => new Map(data.latest.map((row) => [row.series_id, row])), [data.latest]);

  const lat = byId.get("iss:LAT");
  const lon = byId.get("iss:LON");
  const current = useMemo<IssPoint | null>(
    () => (lat && lon ? { t: lat.t, lat: lat.value, lon: lon.value } : null),
    [lat, lon]
  );

  useEffect(() => {
    chartRef.current?.setOption(buildMapOption(data.events, data.iss, current), { replaceMerge: ["series"] });
  }, [chartRef, data.events, data.iss, current]);

  const dayAgo = useNow() - 86_400_000;
  const quakes = data.events.filter((e) => e.kind === "quake" && e.t > dayAgo);
  const strong = quakes.filter((e) => (e.magnitude ?? 0) >= 5).length;
  const strongest = quakes.reduce<EventQueryRow | null>(
    (best, event) => ((event.magnitude ?? 0) > (best?.magnitude ?? -1) ? event : best),
    null
  );
  const hazards = data.events.filter((e) => e.kind !== "quake");
  const kp = byId.get("space:KP")?.value ?? null;
  const altitude = byId.get("iss:ALT");
  const velocity = byId.get("iss:VEL");

  return (
    <Window
      title="planet // hazards + space"
      icon={<Globe className="h-3.5 w-3.5" />}
      actions={<DataBadge live />}
      footer={
        <>
          <span>usgs quakes 2 min</span>
          <span>nasa eonet 15 min</span>
          <span>noaa kp 10 min</span>
          <span>iss 30s</span>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="win-well p-1 xl:col-span-2">
          <div ref={containerRef} className="h-80 w-full" data-testid="hazard-map" />
        </div>
        <div className="space-y-4 text-[11px]">
          <div className="win-well p-3">
            <p className="font-display text-[10px] uppercase tracking-[0.18em] text-dim">Earthquakes, 24h (M2.5+)</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{quakes.length}</p>
            <p className="text-dim">
              {strong} at M5+{strongest ? `, strongest M${(strongest.magnitude ?? 0).toFixed(1)}` : ""}
            </p>
            {strongest ? <p className="mt-1 leading-snug text-ink">{strongest.title}</p> : null}
          </div>
          <div className="win-well p-3">
            <KpBar kp={kp} />
          </div>
          <div className="win-well p-3">
            <p className="font-display text-[10px] uppercase tracking-[0.18em] text-dim">Open natural events</p>
            <ul className="mt-1 space-y-0.5">
              {(Object.keys(KIND_STYLE) as (keyof typeof KIND_STYLE)[]).map((kind) => {
                const count = hazards.filter((e) => e.kind === kind).length;
                return count === 0 ? null : (
                  <li key={kind} className="flex justify-between">
                    <span style={{ color: KIND_STYLE[kind].color }}>{KIND_STYLE[kind].label}</span>
                    <span className="tabular-nums text-ink">{count}</span>
                  </li>
                );
              })}
              {hazards.length === 0 ? <li className="text-dim">none reported</li> : null}
            </ul>
          </div>
          <div className="win-well p-3">
            <p className="font-display text-[10px] uppercase tracking-[0.18em] text-dim">ISS</p>
            <p className="mt-1 tabular-nums text-ink">
              {current ? `${current.lat.toFixed(1)}°, ${current.lon.toFixed(1)}°` : "--"}
            </p>
            <p className="text-dim">
              {altitude ? `${altitude.value.toFixed(0)} km` : "--"} &middot;{" "}
              {velocity ? `${formatCompact(velocity.value)} km/h` : "--"}
            </p>
          </div>
        </div>
      </div>
    </Window>
  );
}

function aqiColor(aqi: number): string {
  if (aqi <= 50) return "#a3e635";
  if (aqi <= 100) return "#fde68a";
  if (aqi <= 150) return "#fb923c";
  if (aqi <= 200) return "#fb7185";
  if (aqi <= 300) return "#c084fc";
  return "#be123c";
}

function tempColor(celsius: number): string {
  if (celsius < 0) return "#67e8f9";
  if (celsius < 15) return "#818cf8";
  if (celsius < 25) return "#a3e635";
  if (celsius < 32) return "#fbbf24";
  return "#fb7185";
}

export function WeatherWindow({ data }: { data: WorldData }) {
  const byId = new Map(data.latest.map((row) => [row.series_id, row]));
  return (
    <Window
      title="weather // air quality"
      icon={<CloudSun className="h-3.5 w-3.5" />}
      actions={<DataBadge live />}
      footer={
        <>
          <span>open-meteo</span>
          <span>refresh 15 min</span>
          <span>aqi: us scale</span>
        </>
      }
    >
      <div className="win-well overflow-auto">
        <table className="w-full border-collapse text-left text-[11px] tabular-nums" data-testid="weather">
          <thead className="bg-[#160a2b]">
            <tr>
              {["City", "Temp", "Wind km/h", "AQI", "PM2.5"].map((column) => (
                <th key={column} className="whitespace-nowrap border-b border-violet-900 px-2.5 py-1.5 font-display text-[9px] uppercase tracking-[0.14em] text-dim">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CITIES.map((city) => {
              const temp = byId.get(`wx:TEMP:${city.name}`);
              const air = byId.get(`aq:${city.name}`);
              return (
                <tr key={city.name} className="odd:bg-white/[0.02]">
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-semibold text-ink">{city.name}</td>
                  <td className="px-2.5 py-1.5" style={{ color: temp ? tempColor(temp.value) : undefined }}>
                    {temp ? `${temp.value.toFixed(1)}°C` : "--"}
                  </td>
                  <td className="px-2.5 py-1.5 text-dim">{temp?.aux != null ? temp.aux.toFixed(0) : "--"}</td>
                  <td className="px-2.5 py-1.5">
                    {air ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5" style={{ backgroundColor: aqiColor(air.value) }} />
                        <span className="text-ink">{air.value.toFixed(0)}</span>
                      </span>
                    ) : (
                      "--"
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-dim">{air?.aux != null ? air.aux.toFixed(1) : "--"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Window>
  );
}
