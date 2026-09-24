/**
 * Which sources drive the streaming tables. The World edition defaults to real
 * data; set the variables to "synthetic" for fully offline demo traffic.
 *
 * NEXT_PUBLIC_ALPHA_FEED  coinbase (default) | synthetic
 * NEXT_PUBLIC_BETA_FEED   mastodon (default) | synthetic
 * NEXT_PUBLIC_WORLD       on (default) | off
 */
export const ALPHA_FEED: "coinbase" | "synthetic" =
  process.env.NEXT_PUBLIC_ALPHA_FEED === "synthetic" ? "synthetic" : "coinbase";

export const BETA_FEED: "mastodon" | "synthetic" =
  process.env.NEXT_PUBLIC_BETA_FEED === "synthetic" ? "synthetic" : "mastodon";

export const WORLD_ENABLED: boolean = process.env.NEXT_PUBLIC_WORLD !== "off";

export interface FeedStatus {
  id: string;
  label: string;
  live: boolean;
  state: "connecting" | "ok" | "error" | "simulated";
  detail: string | null;
  updatedAt: number | null;
}
