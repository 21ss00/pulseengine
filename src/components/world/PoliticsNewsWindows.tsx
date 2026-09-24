"use client";

import { useState } from "react";
import { ExternalLink, Newspaper, Users, Vote } from "lucide-react";
import { DataBadge, Window } from "@/components/Window";
import { useNow } from "@/hooks/useNow";
import type { WorldData } from "@/hooks/useWorldData";
import type { HeadlineCategory } from "@/types/world";
import { BETA_FEED } from "@/config/feeds";
import Sparkline from "@/components/world/Sparkline";
import {
  DOWN_COLOR,
  FLAT_COLOR,
  UP_COLOR,
  arrow,
  changeColor,
  formatCompact,
  timeAgo,
  toneStyle,
} from "@/components/world/format";

/** Only http(s) links from third-party feeds are ever rendered as anchors. */
export function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function PoliticsWindow({ data }: { data: WorldData }) {
  const markets = data.latest
    .filter((row) => row.category === "politics")
    .sort((a, b) => (b.aux ?? 0) - (a.aux ?? 0))
    .slice(0, 16);

  return (
    <Window
      title="politics // prediction markets"
      icon={<Vote className="h-3.5 w-3.5" />}
      actions={<DataBadge live />}
      footer={
        <>
          <span>polymarket 2 min</span>
          <span>kalshi 10 min</span>
          <span>probability = market price</span>
        </>
      }
    >
      {markets.length === 0 ? (
        <p className="win-well p-3 text-[11px] text-dim">Loading prediction markets...</p>
      ) : (
        <ul className="max-h-[30rem] space-y-2 overflow-y-auto pr-1" data-testid="markets">
          {markets.map((row) => {
            const base = row.d1 ?? row.prev_value;
            const move = base === null ? null : row.value - base;
            const href = safeUrl(row.url);
            const points = (data.series[row.series_id] ?? []).map((p) => p.value);
            return (
              <li key={row.series_id} className="win-well p-2.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-[11px] leading-snug text-ink">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-neon">
                        {row.label}
                        <ExternalLink className="ml-1 inline h-2.5 w-2.5 align-baseline opacity-60" />
                      </a>
                    ) : (
                      row.label
                    )}
                  </p>
                  <p className="shrink-0 font-display text-lg font-bold tabular-nums text-ink">
                    {row.value.toFixed(0)}%
                  </p>
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <div className="h-2 flex-1 bg-violet-950">
                    <div className="h-2 bg-violet-500" style={{ width: `${Math.min(100, Math.max(0, row.value))}%` }} />
                  </div>
                  <Sparkline points={points} color="#c084fc" width={64} height={18} />
                </div>
                <p className="mt-1 flex flex-wrap gap-x-3 text-[9px] uppercase tracking-[0.12em] text-dim">
                  <span>{row.source}</span>
                  <span style={{ color: changeColor(move) }}>
                    {arrow(move)} {move === null ? "--" : `${move > 0 ? "+" : ""}${move.toFixed(1)} pts 24h`}
                  </span>
                  {row.aux !== null ? <span>vol {formatCompact(row.aux)}</span> : null}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Window>
  );
}

const TABS: { id: "all" | HeadlineCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "politics", label: "Politics" },
  { id: "world", label: "World" },
  { id: "business", label: "Business" },
  { id: "tech", label: "Tech" },
  { id: "trending", label: "Trending" },
];

export function NewsWindow({ data }: { data: WorldData }) {
  const [tab, setTab] = useState<"all" | HeadlineCategory>("all");
  const rows = data.headlines
    .filter((row) => (tab === "all" ? row.category !== "trending" : row.category === tab))
    .slice(0, 60);
  const summary = data.summary;
  const now = useNow();

  return (
    <Window
      title="news // headlines"
      icon={<Newspaper className="h-3.5 w-3.5" />}
      actions={<DataBadge live />}
      footer={
        <>
          <span>bbc, guardian, npr, al jazeera</span>
          <span>hacker news, wikipedia</span>
          <span>
            tone{" "}
            {summary?.news_tone_24h != null
              ? `${summary.news_tone_24h.toFixed(2)} over ${summary.news_count_24h} headlines (24h)`
              : "--"}
          </span>
        </>
      }
    >
      <div className="win-well mb-3 inline-flex flex-wrap" role="tablist" aria-label="Headline category">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`px-2.5 py-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.16em] ${
              tab === item.id ? "bg-violet-600 text-white" : "text-dim hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="win-well p-3 text-[11px] text-dim">Loading headlines...</p>
      ) : (
        <ul className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1" data-testid="headlines">
          {rows.map((row) => {
            const tone = toneStyle(row.tone);
            const href = safeUrl(row.url);
            return (
              <li key={row.id} className="win-well flex items-start gap-3 p-2.5">
                <span
                  className="mt-0.5 w-11 shrink-0 text-center text-[10px] font-bold tabular-nums"
                  style={{ color: tone.color }}
                  title="Word-list tone of the headline"
                >
                  {tone.text}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] leading-snug text-ink">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-neon">
                        {row.title}
                      </a>
                    ) : (
                      row.title
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-[9px] uppercase tracking-[0.12em] text-dim">
                    <span>{row.source}</span>
                    <span>{row.category === "trending" ? "yesterday" : timeAgo(row.t, now)}</span>
                    {row.aux !== null ? (
                      <span>{row.category === "trending" ? `${formatCompact(row.aux)} views` : `${row.aux} pts`}</span>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Window>
  );
}

export function SocialWindow({ data }: { data: WorldData }) {
  const live = BETA_FEED === "mastodon";
  const topics = data.social;

  return (
    <Window
      title="social pulse // beta"
      icon={<Users className="h-3.5 w-3.5" />}
      actions={<DataBadge live={live} />}
      footer={
        <>
          <span>{live ? "mastodon hashtag timelines" : "simulated posts"}</span>
          <span>last 10 min</span>
          <span>tone: word-list heuristic</span>
        </>
      }
    >
      {topics.length === 0 ? (
        <p className="win-well p-3 text-[11px] text-dim">
          {live ? "Collecting posts from Mastodon..." : "Waiting for simulated posts..."}
        </p>
      ) : (
        <div className="win-well max-h-[22rem] overflow-auto">
          <table className="w-full border-collapse text-left text-[11px] tabular-nums" data-testid="social-topics">
            <thead className="sticky top-0 bg-[#160a2b]">
              <tr>
                {["Topic", "Posts", "/min", "Tone", "Wtd", "Top reach"].map((column) => (
                  <th key={column} className="whitespace-nowrap border-b border-violet-900 px-2.5 py-1.5 font-display text-[9px] uppercase tracking-[0.14em] text-dim">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topics.map((row) => {
                const tone = row.avg_tone ?? 0;
                return (
                  <tr key={row.topic} className="odd:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-2.5 py-1 font-semibold text-ink">{row.topic}</td>
                    <td className="px-2.5 py-1 text-ink">{row.posts}</td>
                    <td className="px-2.5 py-1 text-dim">{row.posts_per_min.toFixed(1)}</td>
                    <td className="px-2.5 py-1">
                      <div className="flex items-center gap-2">
                        <div className="relative h-2 w-16 bg-violet-950">
                          <div
                            className="absolute top-0 h-2"
                            style={{
                              backgroundColor: tone >= 0 ? UP_COLOR : DOWN_COLOR,
                              left: tone >= 0 ? "50%" : `${50 + tone * 50}%`,
                              width: `${Math.abs(tone) * 50}%`,
                            }}
                          />
                          <div className="absolute left-1/2 top-0 h-2 w-px" style={{ backgroundColor: FLAT_COLOR }} />
                        </div>
                        <span style={{ color: toneStyle(tone).color }}>{tone.toFixed(2)}</span>
                      </div>
                    </td>
                    <td className="px-2.5 py-1 text-dim">{row.weighted_tone === null ? "--" : row.weighted_tone.toFixed(2)}</td>
                    <td className="px-2.5 py-1 text-dim">{formatCompact(row.top_followers)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Window>
  );
}
