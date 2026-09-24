import type { ReactNode } from "react";
import { Minus, Square, X } from "lucide-react";
import type { TrendTag } from "@/types/analytics";

export function Window({
  title,
  icon,
  footer,
  actions,
  well = false,
  className = "",
  children,
}: {
  title: string;
  icon: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
  well?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`win flex flex-col ${className}`}>
      <header className="win-title flex items-center justify-between gap-2 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-2 text-purple-100">
          <span className="shrink-0">{icon}</span>
          <h2 className="truncate font-display text-xs font-semibold uppercase tracking-[0.2em]">
            {title}
          </h2>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        <div className="flex shrink-0 gap-1" aria-hidden="true">
          <span className="win-btn">
            <Minus className="h-2.5 w-2.5" />
          </span>
          <span className="win-btn">
            <Square className="h-2 w-2" />
          </span>
          <span className="win-btn">
            <X className="h-2.5 w-2.5" />
          </span>
        </div>
      </header>
      <div className="flex-1 p-3">
        {well ? <div className="win-well p-1">{children}</div> : children}
      </div>
      {footer ? (
        <footer className="win-status flex flex-wrap gap-x-4 gap-y-0.5 px-3 py-1 text-[10px] uppercase tracking-[0.15em] text-dim">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

const TREND_COLORS = { good: "#a3e635", bad: "#fb7185", neutral: "#8f7bb3" } as const;

export function KpiTile({
  icon,
  label,
  value,
  accent,
  trend,
  alert,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accent: string;
  trend?: TrendTag | null;
  alert?: string | null;
}) {
  return (
    <section
      className={`win ${alert ? "alert-ring" : ""}`}
      role={alert ? "alert" : undefined}
      data-alert={alert ? "true" : undefined}
    >
      <header className="win-title flex items-center justify-between px-2 py-1">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.22em] text-purple-100">
          {label}
        </span>
        <span
          className="h-2 w-2"
          style={{ backgroundColor: alert ? "#fb7185" : accent }}
        />
      </header>
      <div className="flex items-center gap-3 p-3">
        <div
          className="win-well flex h-11 w-11 shrink-0 items-center justify-center"
          style={{ color: alert ? "#fb7185" : accent }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p
            className="truncate font-display text-3xl font-bold text-ink"
            style={{ textShadow: `0 0 14px ${accent}99, 0 0 30px ${accent}44` }}
          >
            {value}
          </p>
          <p
            className="h-4 truncate text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: trend ? TREND_COLORS[trend.tone] : "transparent" }}
            data-testid="kpi-trend"
          >
            {trend?.text ?? "--"}
          </p>
        </div>
      </div>
      {alert ? (
        <p className="border-t border-rose-500/40 bg-rose-950/40 px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-rose-300">
          {alert}
        </p>
      ) : null}
    </section>
  );
}

export function Readout({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div
      className="win-well flex items-center gap-2 px-2.5 py-1.5 text-[11px] uppercase tracking-[0.18em]"
      data-testid={testId}
    >
      <span className="text-dim">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  idle: { color: "#6b5b8a", label: "IDLE" },
  initializing: { color: "#fbbf24", label: "BOOT" },
  streaming: { color: "#a3e635", label: "LIVE" },
  error: { color: "#fb7185", label: "FAULT" },
};

export function StatusIndicator({ status }: { status: string }) {
  const { color, label } = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;
  return (
    <div className="win-well flex items-center gap-2 px-2.5 py-1.5 text-[11px] uppercase tracking-[0.18em]">
      <span
        className={`h-2.5 w-2.5 ${status === "streaming" ? "led-live" : ""}`}
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
      />
      <span className="font-semibold text-ink">{label}</span>
    </div>
  );
}
