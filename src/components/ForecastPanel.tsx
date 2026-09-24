import { BrainCircuit } from "lucide-react";
import { Window } from "@/components/Window";
import {
  BetaTable,
  CorrelationMatrices,
  GammaTable,
  SignalsTable,
} from "@/components/ForecastTables";
import type { AdviceItem, AdviceSeverity, ForecastSnapshot } from "@/types/analytics";

const SEVERITY_STYLE: Record<AdviceSeverity, { label: string; chip: string; bar: string }> = {
  critical: { label: "CRIT", chip: "bg-rose-600 text-white", bar: "#fb7185" },
  warning: { label: "WARN", chip: "bg-amber-500 text-black", bar: "#fbbf24" },
  watch: { label: "WATCH", chip: "bg-violet-600 text-white", bar: "#a855f7" },
  info: { label: "INFO", chip: "bg-slate-700 text-slate-200", bar: "#6b5b8a" },
};

const STREAM_LABEL: Record<AdviceItem["stream"], string> = {
  alpha: "market",
  beta: "social",
  gamma: "iot",
  cross: "cross-stream",
  system: "system",
};

function AdviceList({ advice }: { advice: AdviceItem[] }) {
  return (
    <ul
      className="max-h-[34rem] space-y-2.5 overflow-y-auto pr-1"
      aria-live="polite"
      aria-label="Automated advice"
    >
      {advice.map((item) => {
        const style = SEVERITY_STYLE[item.severity];
        return (
          <li
            key={item.id}
            className="win-well border-l-4 p-3"
            style={{ borderLeftColor: style.bar }}
            data-severity={item.severity}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className={`px-1.5 py-0.5 font-display text-[9px] font-bold tracking-[0.16em] ${style.chip}`}>
                {style.label}
              </span>
              <span className="text-[9px] uppercase tracking-[0.18em] text-dim">
                {STREAM_LABEL[item.stream]}
              </span>
            </div>
            <p className="text-xs font-semibold leading-snug text-ink">{item.headline}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-dim">{item.detail}</p>
          </li>
        );
      })}
    </ul>
  );
}

export default function ForecastPanel({
  snapshot,
  advice,
  liveFeed,
}: {
  snapshot: ForecastSnapshot | null;
  advice: AdviceItem[];
  liveFeed: boolean;
}) {
  return (
    <Window
      title="predictions // analysis // advice"
      icon={<BrainCircuit className="h-3.5 w-3.5" />}
      footer={
        <>
          <span>fit win 60s</span>
          <span>thermal win 45s</span>
          <span>corr 5m / 5s buckets</span>
          <span>refresh 1s</span>
          <span>
            {snapshot
              ? `updated ${new Date(snapshot.generatedAt).toLocaleTimeString()}`
              : "warming up"}
          </span>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <h3 className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">
            Advice &amp; anomaly warnings
          </h3>
          <AdviceList advice={advice} />
          <p className="mt-3 text-[10px] leading-relaxed text-dim">
            Automated statistical signals, not financial advice.{" "}
            {liveFeed
              ? "Prices are live from Coinbase; sentiment and IoT streams are synthetic."
              : "All streams are synthetic demo data, and the sentiment-to-price lead in it is simulated."}
          </p>
        </div>
        <div className="space-y-5 xl:col-span-3">
          <SignalsTable snapshot={snapshot} />
          <CorrelationMatrices snapshot={snapshot} />
        </div>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <GammaTable snapshot={snapshot} />
        <BetaTable snapshot={snapshot} />
      </div>
    </Window>
  );
}
