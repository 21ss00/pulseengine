import type { ReactNode } from "react";
import {
  isSignificant,
  memoryEtaMinutes,
  throttleEtaSeconds,
} from "@/analytics/advisor";
import type { CorrelationRow, ForecastSnapshot } from "@/types/analytics";

function Table({
  title,
  columns,
  children,
  empty,
}: {
  title: string;
  columns: string[];
  children: ReactNode;
  empty: boolean;
}) {
  return (
    <div>
      <h3 className="mb-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">
        {title}
      </h3>
      <div className="win-well max-h-60 overflow-auto">
        <table className="w-full border-collapse text-left text-[11px] tabular-nums">
          <thead className="sticky top-0 bg-[#160a2b]">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  className="whitespace-nowrap border-b border-violet-900 px-2.5 py-1.5 font-display text-[9px] uppercase tracking-[0.14em] text-dim"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
        {empty ? (
          <p className="px-3 py-3 text-[11px] text-dim">Collecting samples...</p>
        ) : null}
      </div>
    </div>
  );
}

const cell = "whitespace-nowrap px-2.5 py-1";

function tone(value: number | null, goodWhenPositive = true): string {
  if (value === null || Math.abs(value) < 1e-9) return "text-ink";
  return (value > 0) === goodWhenPositive ? "text-lime-300" : "text-rose-300";
}

function signed(value: number | null, digits: number, suffix = ""): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

export function SignalsTable({ snapshot }: { snapshot: ForecastSnapshot | null }) {
  const tNow = snapshot ? (snapshot.generatedAt - snapshot.trendCutoffMs) / 1000 : 0;
  const trends = new Map((snapshot?.trends ?? []).map((t) => [t.symbol, t]));
  const rows = snapshot?.alpha ?? [];

  return (
    <Table
      title="Stream alpha // trend + signals"
      columns={["Symbol", "Slope %/min", "R²", "+30s fcst", "OBI", "SMA 10/60", "Boll z"]}
      empty={rows.length === 0}
    >
      {rows.map((row) => {
        const trend = trends.get(row.symbol);
        const slopePct = trend ? ((trend.slope * 60) / trend.last_price) * 100 : null;
        const projected = trend ? trend.intercept + trend.slope * (tNow + 30) : null;
        const z =
          row.bb_mid !== null && row.bb_sd !== null && row.bb_sd > 0
            ? (row.price - row.bb_mid) / row.bb_sd
            : null;
        const smaDiff =
          row.sma10 !== null && row.sma60 !== null && row.n_sec >= 60
            ? row.sma10 - row.sma60
            : null;
        return (
          <tr key={row.symbol} className="odd:bg-white/[0.02]">
            <td className={`${cell} font-semibold text-ink`}>{row.symbol}</td>
            <td className={`${cell} ${tone(slopePct)}`}>{signed(slopePct, 2)}</td>
            <td className={`${cell} text-dim`}>{trend?.r2 != null ? trend.r2.toFixed(2) : "--"}</td>
            <td className={`${cell} text-ink`}>{projected !== null ? projected.toFixed(2) : "--"}</td>
            <td className={`${cell} ${tone(row.obi)}`}>{signed(row.obi, 2)}</td>
            <td className={`${cell} ${tone(smaDiff)}`}>
              {smaDiff === null ? "--" : smaDiff >= 0 ? "▲ fast>slow" : "▼ fast<slow"}
              {row.cross_recent !== 0 && smaDiff !== null ? " *" : ""}
            </td>
            <td className={`${cell} ${z !== null && Math.abs(z) >= 2 ? "text-amber-300" : "text-ink"}`}>
              {signed(z, 1)}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

const LAGS = [10, 30, 60] as const;

function CorrelationTable({
  title,
  kind,
  rows,
}: {
  title: string;
  kind: "sent" | "vol";
  rows: CorrelationRow[];
}) {
  return (
    <Table title={title} columns={["Symbol", "10s", "30s", "60s"]} empty={rows.length === 0}>
      {rows.map((row) => (
        <tr key={row.symbol} className="odd:bg-white/[0.02]">
          <td className={`${cell} font-semibold text-ink`}>{row.symbol}</td>
          {LAGS.map((lag) => {
            const r = row[`${kind}_c${lag}` as keyof CorrelationRow] as number | null;
            const n = row[`n${lag}` as keyof CorrelationRow] as number;
            const significant = isSignificant(r, n);
            const alpha = r === null ? 0 : Math.min(0.55, Math.abs(r) * 0.9);
            const rgb = r !== null && r < 0 ? "251, 113, 133" : "192, 132, 252";
            return (
              <td
                key={lag}
                className={`${cell} text-center ${significant ? "font-bold text-white" : "text-dim"}`}
                style={{ backgroundColor: `rgba(${rgb}, ${alpha})` }}
                title={r === null ? "not enough samples" : `r=${r.toFixed(3)}, n=${n}${significant ? " (significant)" : ""}`}
              >
                {r === null ? "--" : r.toFixed(2)}
                {significant ? "*" : ""}
              </td>
            );
          })}
        </tr>
      ))}
    </Table>
  );
}

export function CorrelationMatrices({ snapshot }: { snapshot: ForecastSnapshot | null }) {
  const rows = snapshot?.correlations ?? [];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <CorrelationTable title="Sentiment change -> return" kind="sent" rows={rows} />
      <CorrelationTable title="Social volume change -> |return|" kind="vol" rows={rows} />
    </div>
  );
}

export function GammaTable({ snapshot }: { snapshot: ForecastSnapshot | null }) {
  const tNow = snapshot ? (snapshot.generatedAt - snapshot.gammaCutoffMs) / 1000 : 0;
  const rows = (snapshot?.gamma ?? [])
    .map((row) => ({
      row,
      heat: throttleEtaSeconds(row, tNow),
      oom: memoryEtaMinutes(row),
    }))
    .sort(
      (a, b) =>
        (a.heat ?? Infinity) - (b.heat ?? Infinity) ||
        (a.oom ?? Infinity) - (b.oom ?? Infinity) ||
        a.row.device_id.localeCompare(b.row.device_id)
    );

  return (
    <Table
      title="Stream gamma // throttle + leak forecast"
      columns={["Device", "State", "Temp °C", "Growth %/s", "Throttle in", "Mem %", "Leak %/min", "OOM in"]}
      empty={rows.length === 0}
    >
      {rows.map(({ row, heat, oom }) => (
        <tr key={row.device_id} className="odd:bg-white/[0.02]">
          <td className={`${cell} font-semibold text-ink`}>{row.device_id.replace("edge-node-", "node-")}</td>
          <td className={`${cell} ${row.status === "nominal" ? "text-lime-300" : row.status === "offline" ? "text-dim" : "text-amber-300"}`}>
            {row.status}
          </td>
          <td className={`${cell} text-ink`}>{row.temp_now?.toFixed(1) ?? "--"}</td>
          <td className={`${cell} ${tone(row.temp_growth_k, false)}`}>
            {row.temp_growth_k !== null ? signed(row.temp_growth_k * 100, 2) : "--"}
          </td>
          <td className={`${cell} ${heat !== null && heat <= 60 ? "font-bold text-rose-300" : "text-ink"}`}>
            {heat !== null ? `${Math.round(heat)}s` : "--"}
          </td>
          <td className={`${cell} text-ink`}>{row.mem_now?.toFixed(0) ?? "--"}</td>
          <td className={`${cell} ${tone(row.leak_rate_per_min, false)}`}>{signed(row.leak_rate_per_min, 1)}</td>
          <td className={`${cell} ${oom !== null && oom <= 5 ? "font-bold text-rose-300" : "text-ink"}`}>
            {oom !== null ? `${oom.toFixed(1)}m` : "--"}
          </td>
        </tr>
      ))}
    </Table>
  );
}

export function BetaTable({ snapshot }: { snapshot: ForecastSnapshot | null }) {
  const rows = snapshot?.beta ?? [];
  return (
    <Table
      title="Stream beta // velocity + influence"
      columns={["Topic", "Posts/s", "Base", "Ratio", "Impact", "Wtd sent"]}
      empty={rows.length === 0}
    >
      {rows.map((row) => {
        const ratio =
          row.velocity_now !== null && row.velocity_avg ? row.velocity_now / row.velocity_avg : null;
        return (
          <tr key={row.topic} className="odd:bg-white/[0.02]">
            <td className={`${cell} font-semibold text-ink`}>{row.topic}</td>
            <td className={`${cell} text-ink`}>{row.velocity_now?.toFixed(0) ?? "--"}</td>
            <td className={`${cell} text-dim`}>{row.velocity_avg?.toFixed(0) ?? "--"}</td>
            <td className={`${cell} ${ratio !== null && ratio >= 2.5 ? "font-bold text-amber-300" : "text-ink"}`}>
              {ratio !== null ? `x${ratio.toFixed(1)}` : "--"}
            </td>
            <td className={`${cell} ${tone(row.impact)}`}>{signed(row.impact, 2)}</td>
            <td className={`${cell} ${tone(row.weighted_sentiment)}`}>{signed(row.weighted_sentiment, 2)}</td>
          </tr>
        );
      })}
    </Table>
  );
}
