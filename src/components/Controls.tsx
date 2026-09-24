"use client";

import { AlertTriangle, X } from "lucide-react";
import { RANGES, type RangeId } from "@/types/analytics";

export function TimeRangeSelector({
  value,
  onChange,
}: {
  value: RangeId;
  onChange: (next: RangeId) => void;
}) {
  return (
    <div
      className="win-well flex items-stretch"
      role="radiogroup"
      aria-label="Time range"
    >
      {RANGES.map((range) => {
        const active = range.id === value;
        return (
          <button
            key={range.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(range.id)}
            className={`px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors ${
              active
                ? "bg-violet-600 text-white shadow-[inset_1px_1px_0_rgba(233,213,255,0.5),inset_-1px_-1px_0_rgba(0,0,0,0.6)]"
                : "text-dim hover:bg-violet-950 hover:text-ink"
            }`}
          >
            {range.label}
          </button>
        );
      })}
    </div>
  );
}

export interface Toast {
  id: string;
  message: string;
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed bottom-6 right-6 z-[60] flex w-[min(24rem,calc(100vw-3rem))] flex-col gap-3"
      aria-live="assertive"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast win border-rose-500/70"
          role="alert"
          data-testid="toast"
        >
          <div className="flex items-start gap-3 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <p className="flex-1 text-xs leading-relaxed text-ink">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="win-btn shrink-0"
              aria-label="Dismiss alert"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
