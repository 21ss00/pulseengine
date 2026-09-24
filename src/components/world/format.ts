export const UP_COLOR = "#a3e635";
export const DOWN_COLOR = "#fb7185";
export const FLAT_COLOR = "#8f7bb3";

export function changeColor(change: number | null): string {
  if (change === null || Math.abs(change) < 1e-9) return FLAT_COLOR;
  return change > 0 ? UP_COLOR : DOWN_COLOR;
}

export function pctChange(current: number | null | undefined, base: number | null | undefined): number | null {
  if (current === null || current === undefined || base === null || base === undefined || base === 0) return null;
  return ((current - base) / Math.abs(base)) * 100;
}

export function signedPct(change: number | null, digits = 2): string {
  if (change === null) return "--";
  return `${change > 0 ? "+" : ""}${change.toFixed(digits)}%`;
}

export function arrow(change: number | null): string {
  if (change === null || Math.abs(change) < 1e-9) return "▬";
  return change > 0 ? "▲" : "▼";
}

export function formatPrice(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 10) return value.toFixed(3);
  return value.toFixed(4);
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value.toFixed(0);
}

export function timeAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function toneStyle(tone: number): { text: string; color: string } {
  if (tone >= 0.2) return { text: `+${tone.toFixed(2)}`, color: UP_COLOR };
  if (tone <= -0.2) return { text: tone.toFixed(2), color: DOWN_COLOR };
  return { text: tone >= 0 ? `+${tone.toFixed(2)}` : tone.toFixed(2), color: FLAT_COLOR };
}
