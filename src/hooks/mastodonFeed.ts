import { Observable } from "rxjs";
import type { BetaEnvelope } from "@/types/telemetry";
import { RETENTION_WINDOW_MS } from "@/types/analytics";
import { SOCIAL_TOPICS } from "@/world/constants";
import { newestMastodonId, parseMastodonPosts } from "@/world/parsersNews";

const BASE_URL = "https://mastodon.social/api/v1/timelines/tag";
const PAUSE_BETWEEN_TAGS_MS = 1500;
const PAUSE_BETWEEN_CYCLES_MS = 20_000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface SocialFeedStatus {
  ok: boolean;
  detail: string;
}

/**
 * Live social posts from Mastodon hashtag timelines (public, keyless). Each
 * new post becomes one Beta-stream row: tone from a word-list scorer, the
 * author's follower count as influencer reach. Only posts newer than the last
 * seen id are requested, and posts already outside the retention window are
 * dropped before they reach the database.
 */
export function createMastodonBetaFeed(
  nextId: () => number,
  onStatus?: (status: SocialFeedStatus) => void
): Observable<BetaEnvelope> {
  return new Observable<BetaEnvelope>((subscriber) => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sinceIds = new Map<string, string>();

    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });

    const run = async () => {
      while (!stopped) {
        let succeeded = 0;
        let failed = 0;
        let posts = 0;
        let lastError = "";

        for (const { tag, topic } of SOCIAL_TOPICS) {
          if (stopped) return;
          try {
            const since = sinceIds.get(tag);
            const url = `${BASE_URL}/${tag}?limit=40${since ? `&since_id=${since}` : ""}`;
            const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const json: unknown = await response.json();
            const newest = newestMastodonId(json);
            if (newest) sinceIds.set(tag, newest);

            const cutoff = Date.now() - RETENTION_WINDOW_MS;
            for (const envelope of parseMastodonPosts(json, topic, nextId)) {
              if (envelope.payload.timestamp < cutoff) continue;
              posts += 1;
              subscriber.next(envelope);
            }
            succeeded += 1;
          } catch (error) {
            failed += 1;
            lastError = error instanceof Error ? error.message : String(error);
          }
          await pause(PAUSE_BETWEEN_TAGS_MS);
        }

        onStatus?.({
          ok: succeeded > 0,
          detail:
            succeeded > 0
              ? `${succeeded}/${succeeded + failed} tags, ${posts} new posts`
              : `unreachable: ${lastError}`,
        });
        await pause(PAUSE_BETWEEN_CYCLES_MS);
      }
    };

    void run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  });
}
