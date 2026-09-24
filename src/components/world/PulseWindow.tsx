"use client";

import { Gauge, Rss } from "lucide-react";
import { DataBadge, Window } from "@/components/Window";
import { AdviceList } from "@/components/ForecastPanel";
import { useNow } from "@/hooks/useNow";
import type { WorldData } from "@/hooks/useWorldData";
import type { FeedStatus } from "@/config/feeds";
import type { SourceStatus } from "@/types/world";
import { timeAgo } from "@/components/world/format";

const ZONES = [
  { label: "Stressed", color: "#fb7185", upTo: 25 },
  { label: "Cautious", color: "#fb923c", upTo: 45 },
  { label: "Neutral", color: "#c084fc", upTo: 60 },
  { label: "Confident", color: "#bef264", upTo: 75 },
  { label: "Euphoric", color: "#a3e635", upTo: 100 },
];

function zoneColor(score: number): string {
  return (ZONES.find((zone) => score < zone.upTo) ?? ZONES[ZONES.length - 1]).color;
}

export function PulseWindow({ data }: { data: WorldData }) {
  const { index } = data;
  const color = zoneColor(index.score);
  const hasData = index.components.length > 0;

  return (
    <Window
      title="world pulse // mood index + advice"
      icon={<Gauge className="h-3.5 w-3.5" />}
      actions={<DataBadge live />}
      footer={
        <>
          <span>heuristic composite, not an official index</span>
          <span>coverage {(index.coverage * 100).toFixed(0)}%</span>
          <span>{data.updatedAt ? `updated ${timeAgo(data.updatedAt)}` : "loading"}</span>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <div className="win-well p-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="font-display text-[10px] uppercase tracking-[0.2em] text-dim">World mood</p>
                <p
                  className="glow-text font-display text-6xl font-bold tabular-nums leading-none"
                  style={{ color }}
                  data-testid="world-index"
                >
                  {hasData ? index.score : "--"}
                </p>
              </div>
              <p className="font-display text-xl font-semibold uppercase tracking-[0.16em]" style={{ color }}>
                {hasData ? index.label : "loading"}
              </p>
            </div>
            <div className="relative mt-4 flex h-3">
              {ZONES.map((zone, i) => (
                <div
                  key={zone.label}
                  className="h-3 flex-1 opacity-70"
                  style={{ backgroundColor: zone.color, marginLeft: i === 0 ? 0 : 1 }}
                  title={zone.label}
                />
              ))}
              {hasData ? (
                <div
                  className="absolute -top-1.5 h-6 w-1 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]"
                  style={{ left: `calc(${index.score}% - 2px)` }}
                />
              ) : null}
            </div>
          </div>

          <ul className="mt-3 space-y-1.5" aria-label="Index components">
            {index.components.map((component) => (
              <li key={component.id} className="win-well p-2">
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="text-ink">{component.label}</span>
                  <span className="tabular-nums text-dim">{component.score.toFixed(0)}</span>
                </div>
                <div className="mt-1 h-1.5 bg-violet-950">
                  <div className="h-1.5" style={{ width: `${component.score}%`, backgroundColor: zoneColor(component.score) }} />
                </div>
                <p className="mt-1 text-[9px] uppercase tracking-[0.1em] text-dim">
                  {component.detail} &middot; weight {(component.weight * 100).toFixed(0)}%
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="xl:col-span-3">
          <h3 className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">
            Observations across the world data
          </h3>
          <AdviceList advice={data.advice} />
          <p className="mt-3 text-[10px] leading-relaxed text-dim">
            Automated observations from public data, not financial advice. Headline and post tone use a
            simple word list, so treat it as a rough gauge.
          </p>
        </div>
      </div>
    </Window>
  );
}

function formatInterval(ms: number): string {
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`;
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

const STATE_COLOR = { ok: "#a3e635", pending: "#fbbf24", error: "#fb7185" } as const;

export function SourcesWindow({ sources, feeds }: { sources: SourceStatus[]; feeds: FeedStatus[] }) {
  const live = sources.filter((source) => source.state === "ok").length;
  const failing = sources.filter((source) => source.state === "error").length;
  const groups = Array.from(new Set(sources.map((source) => source.group)));
  const now = useNow();

  return (
    <Window
      title="data sources // health"
      icon={<Rss className="h-3.5 w-3.5" />}
      footer={
        <>
          <span>
            {live}/{sources.length} sources ok
          </span>
          <span>{failing} failing</span>
          <span>failed feeds back off automatically</span>
        </>
      }
    >
      <div className="win-well mb-3 p-2.5">
        <p className="mb-1.5 font-display text-[10px] uppercase tracking-[0.18em] text-dim">Streaming feeds</p>
        <ul className="space-y-1 text-[11px]" data-testid="feeds">
          {feeds.map((feed) => (
            <li key={feed.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <DataBadge live={feed.live} label={feed.live ? (feed.state === "ok" ? "Live" : feed.state) : "Sim"} />
              <span className="text-ink">{feed.label}</span>
              <span className="text-dim">{feed.detail ?? (feed.state === "connecting" ? "connecting..." : "")}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="win-well max-h-[26rem] overflow-auto">
        <table className="w-full border-collapse text-left text-[11px] tabular-nums" data-testid="sources">
          <thead className="sticky top-0 bg-[#160a2b]">
            <tr>
              {["", "Source", "Rows", "Updated", "Every"].map((column) => (
                <th key={column} className="whitespace-nowrap border-b border-violet-900 px-2.5 py-1.5 font-display text-[9px] uppercase tracking-[0.14em] text-dim">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <FragmentRows key={group} group={group} sources={sources.filter((s) => s.group === group)} now={now} />
            ))}
          </tbody>
        </table>
      </div>
    </Window>
  );
}

function FragmentRows({ group, sources, now }: { group: string; sources: SourceStatus[]; now: number }) {
  return (
    <>
      <tr>
        <td colSpan={5} className="bg-violet-950/60 px-2.5 py-1 font-display text-[9px] uppercase tracking-[0.2em] text-violet-300">
          {group}
        </td>
      </tr>
      {sources.map((source) => (
        <tr key={source.id} className="odd:bg-white/[0.02]" title={source.lastError ?? undefined}>
          <td className="w-6 px-2.5 py-1.5">
            <span className="inline-block h-2.5 w-2.5" style={{ backgroundColor: STATE_COLOR[source.state] }} />
          </td>
          <td className="px-2.5 py-1.5 text-ink">
            {source.label}
            {source.state === "error" && source.lastError ? (
              <span className="block text-[10px] text-rose-300">{source.lastError}</span>
            ) : null}
          </td>
          <td className="px-2.5 py-1.5 text-dim">{source.rows.toLocaleString()}</td>
          <td className="whitespace-nowrap px-2.5 py-1.5 text-dim">
            {source.lastOkAt ? timeAgo(source.lastOkAt, now) : "--"}
          </td>
          <td className="px-2.5 py-1.5 text-dim">{formatInterval(source.intervalMs)}</td>
        </tr>
      ))}
    </>
  );
}
