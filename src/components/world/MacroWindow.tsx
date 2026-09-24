"use client";

import { Landmark } from "lucide-react";
import { DataBadge, Window } from "@/components/Window";
import type { WorldData } from "@/hooks/useWorldData";
import type { WorldLatestRow } from "@/types/world";
import Sparkline from "@/components/world/Sparkline";
import {
  DOWN_COLOR,
  UP_COLOR,
  arrow,
  changeColor,
  formatCompact,
  formatPrice,
  signedPct,
} from "@/components/world/format";

export function fearGreedLabel(value: number): { text: string; color: string } {
  if (value < 25) return { text: "Extreme fear", color: DOWN_COLOR };
  if (value < 45) return { text: "Fear", color: "#fb923c" };
  if (value <= 55) return { text: "Neutral", color: "#c084fc" };
  if (value < 75) return { text: "Greed", color: "#bef264" };
  return { text: "Extreme greed", color: UP_COLOR };
}

const COUNTRIES = ["USA", "CHN", "DEU", "JPN", "GBR", "IND"];

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="win-well p-2.5">
      <p className="font-display text-[9px] uppercase tracking-[0.16em] text-dim">{label}</p>
      <p className="mt-0.5 font-display text-base font-bold tabular-nums" style={{ color: color ?? "#e9defa" }}>
        {value}
      </p>
      {sub ? <p className="text-[9px] uppercase tracking-[0.1em] text-dim">{sub}</p> : null}
    </div>
  );
}

export function MacroWindow({ data }: { data: WorldData }) {
  const byId = new Map<string, WorldLatestRow>(data.latest.map((row) => [row.series_id, row]));
  const value = (id: string) => byId.get(id)?.value ?? null;

  const fng = value("macro:FNG");
  const fngClass = fng === null ? null : fearGreedLabel(fng);
  const fngSeries = (data.series["macro:FNG"] ?? []).map((p) => p.value);

  const rates = [
    { id: "macro:TBILL", label: "T-Bills" },
    { id: "macro:TNOTE", label: "T-Notes" },
    { id: "macro:TBOND", label: "T-Bonds" },
  ];

  const countryName = (iso: string): string => {
    const label = byId.get(`wb:GDP:${iso}`)?.label ?? byId.get(`wb:CPI:${iso}`)?.label ?? iso;
    return label.replace(/ (gdp growth|inflation|unemployment)$/i, "");
  };
  const cell = (key: string, iso: string) => {
    const row = byId.get(`wb:${key}:${iso}`);
    return row ? `${row.value.toFixed(1)}%` : "--";
  };

  const btc = byId.get("crypto:BTC");
  const eth = byId.get("crypto:ETH");
  const btcChange = value("crypto:BTC:chg24");
  const ethChange = value("crypto:ETH:chg24");
  const mcapChange = value("crypto:MCAP_CHG24");

  return (
    <Window
      title="macro // rates + sentiment"
      icon={<Landmark className="h-3.5 w-3.5" />}
      actions={<DataBadge live />}
      footer={
        <>
          <span>alternative.me</span>
          <span>us treasury</span>
          <span>world bank (latest annual)</span>
          <span>coingecko, mempool.space</span>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="win-well p-3">
          <p className="font-display text-[10px] uppercase tracking-[0.18em] text-dim">Crypto fear &amp; greed</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <div>
              <p className="font-display text-4xl font-bold tabular-nums" style={{ color: fngClass?.color ?? "#e9defa" }}>
                {fng === null ? "--" : fng.toFixed(0)}
              </p>
              <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: fngClass?.color }}>
                {fngClass?.text ?? "loading"}
              </p>
            </div>
            <Sparkline points={fngSeries} color={fngClass?.color ?? "#c084fc"} width={130} height={40} />
          </div>
          <div className="relative mt-3 h-2 bg-gradient-to-r from-rose-500 via-violet-500 to-lime-400">
            {fng !== null ? (
              <div className="absolute -top-1 h-4 w-1 bg-white" style={{ left: `calc(${Math.min(100, fng)}% - 2px)` }} />
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {rates.map((rate) => {
            const row = byId.get(rate.id);
            const move = row?.prev_value != null ? row.value - row.prev_value : null;
            return (
              <Stat
                key={rate.id}
                label={rate.label}
                value={row ? `${row.value.toFixed(2)}%` : "--"}
                sub={move === null ? "avg rate" : `${arrow(move)} ${move > 0 ? "+" : ""}${move.toFixed(2)} pp m/m`}
                color={changeColor(null)}
              />
            );
          })}
          <Stat label="Bitcoin" value={btc ? `$${formatPrice(btc.value)}` : "--"} sub={`24h ${signedPct(btcChange, 1)}`} color={changeColor(btcChange)} />
          <Stat label="Ethereum" value={eth ? `$${formatPrice(eth.value)}` : "--"} sub={`24h ${signedPct(ethChange, 1)}`} color={changeColor(ethChange)} />
          <Stat
            label="Crypto cap"
            value={value("crypto:MCAP") === null ? "--" : `$${formatCompact(value("crypto:MCAP"))}`}
            sub={`24h ${signedPct(mcapChange, 1)}`}
            color={changeColor(mcapChange)}
          />
          <Stat label="BTC dominance" value={value("crypto:BTCDOM") === null ? "--" : `${value("crypto:BTCDOM")!.toFixed(1)}%`} />
          <Stat label="BTC fee" value={value("crypto:FEE_FAST") === null ? "--" : `${value("crypto:FEE_FAST")} sat/vB`} />
          <Stat label="Block height" value={value("crypto:HEIGHT") === null ? "--" : value("crypto:HEIGHT")!.toLocaleString()} />
        </div>
      </div>

      <div className="win-well mt-4 overflow-auto">
        <table className="w-full border-collapse text-left text-[11px] tabular-nums" data-testid="scoreboard">
          <thead className="bg-[#160a2b]">
            <tr>
              {["Country", "GDP growth", "Inflation", "Unemployment", "Year"].map((column) => (
                <th key={column} className="whitespace-nowrap border-b border-violet-900 px-2.5 py-1.5 font-display text-[9px] uppercase tracking-[0.14em] text-dim">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COUNTRIES.map((iso) => {
              const year = byId.get(`wb:GDP:${iso}`)?.aux;
              return (
                <tr key={iso} className="odd:bg-white/[0.02]">
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-semibold text-ink">{countryName(iso)}</td>
                  <td className="px-2.5 py-1.5 text-ink">{cell("GDP", iso)}</td>
                  <td className="px-2.5 py-1.5 text-ink">{cell("CPI", iso)}</td>
                  <td className="px-2.5 py-1.5 text-ink">{cell("UNEMP", iso)}</td>
                  <td className="px-2.5 py-1.5 text-dim">{year ?? "--"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Window>
  );
}
