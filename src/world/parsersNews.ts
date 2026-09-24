import type { BetaEnvelope } from "../types/telemetry.ts";
import type { HeadlineCategory, WorldHeadlineRow } from "../types/world.ts";
import { scoreTone, stripHtml } from "./tone.ts";

type Json = Record<string, unknown>;

/** FNV-1a, enough to give feed items a short stable id. */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// RSS via rss2json ------------------------------------------------------

export function parseRss2Json(
  json: Json,
  source: string,
  category: HeadlineCategory,
  now: number
): WorldHeadlineRow[] {
  if (json.status !== "ok" || !Array.isArray(json.items)) return [];
  const out: WorldHeadlineRow[] = [];
  for (const item of json.items as Json[]) {
    const title = typeof item.title === "string" ? stripHtml(item.title) : "";
    const link = typeof item.link === "string" ? item.link : "";
    if (!title || !link) continue;
    const description = typeof item.description === "string" ? stripHtml(item.description) : "";
    const published =
      typeof item.pubDate === "string" ? Date.parse(`${item.pubDate.replace(" ", "T")}Z`) : NaN;
    out.push({
      id: `${source}:${shortHash(link)}`,
      category,
      source,
      title,
      url: link,
      tone: scoreTone(`${title}. ${description}`),
      aux: null,
      timestamp: Number.isFinite(published) ? published : now,
    });
  }
  return out;
}

// Hacker News (Algolia front page) ------------------------------------------

export function parseHackerNews(json: Json, now: number): WorldHeadlineRow[] {
  if (!Array.isArray(json.hits)) return [];
  const out: WorldHeadlineRow[] = [];
  for (const hit of json.hits as Json[]) {
    const title = typeof hit.title === "string" ? hit.title : "";
    const id = String(hit.objectID ?? "");
    if (!title || !id) continue;
    const created = typeof hit.created_at_i === "number" ? hit.created_at_i * 1000 : now;
    out.push({
      id: `hn:${id}`,
      category: "tech",
      source: "Hacker News",
      title,
      url: typeof hit.url === "string" && hit.url ? hit.url : `https://news.ycombinator.com/item?id=${id}`,
      tone: scoreTone(title),
      aux: typeof hit.points === "number" ? hit.points : null,
      timestamp: created,
    });
  }
  return out;
}

// Wikipedia: what the world is reading -------------------------------------

const WIKI_SKIP = /^(Main_Page|Special:|Wikipedia:|Portal:|File:|Help:|Category:|Template:|Talk:|User:)/;

export function parseWikiMostRead(json: Json, limit = 15): WorldHeadlineRow[] {
  const mostread = json.mostread as Json | undefined;
  const articles = mostread?.articles;
  if (!mostread || !Array.isArray(articles) || typeof mostread.date !== "string") return [];
  const day = Date.parse(`${mostread.date.replace("Z", "")}T00:00:00Z`);
  const out: WorldHeadlineRow[] = [];
  for (const article of articles as Json[]) {
    const raw = typeof article.title === "string" ? article.title : "";
    if (!raw || WIKI_SKIP.test(raw)) continue;
    const description = typeof article.description === "string" ? article.description : "";
    const pages = article.content_urls as Json | undefined;
    const url = ((pages?.desktop as Json | undefined)?.page as string | undefined) ?? `https://en.wikipedia.org/wiki/${raw}`;
    const title = raw.replace(/_/g, " ");
    out.push({
      id: `wiki:${mostread.date}:${raw}`,
      category: "trending",
      source: "Wikipedia",
      title: description ? `${title} — ${description}` : title,
      url,
      tone: scoreTone(`${title}. ${description}`),
      aux: typeof article.views === "number" ? article.views : null,
      timestamp: Number.isFinite(day) ? day : Date.now(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Mastodon: real social posts as Beta-stream rows -----------------------------

function newestId(posts: Json[]): string | null {
  let best: bigint | null = null;
  let bestText: string | null = null;
  for (const post of posts) {
    const id = typeof post.id === "string" ? post.id : null;
    if (!id || !/^\d+$/.test(id)) continue;
    const value = BigInt(id);
    if (best === null || value > best) {
      best = value;
      bestText = id;
    }
  }
  return bestText;
}

export function newestMastodonId(json: unknown): string | null {
  return Array.isArray(json) ? newestId(json as Json[]) : null;
}

export function parseMastodonPosts(
  json: unknown,
  topic: string,
  nextId: () => number
): BetaEnvelope[] {
  if (!Array.isArray(json)) return [];
  const out: BetaEnvelope[] = [];
  for (const post of json as Json[]) {
    const language = post.language;
    if (language !== null && language !== undefined && language !== "en") continue;
    const created = typeof post.created_at === "string" ? Date.parse(post.created_at) : NaN;
    const text = typeof post.content === "string" ? stripHtml(post.content) : "";
    if (!Number.isFinite(created) || text.length < 12) continue;

    const account = post.account as Json | undefined;
    const followers = Math.max(0, Number(account?.followers_count ?? 0));
    const favourites = Number(post.favourites_count ?? 0);
    const boosts = Number(post.reblogs_count ?? 0);
    const engagement = Math.min(100, ((favourites + boosts) / Math.max(followers, 10)) * 100);
    const tone = scoreTone(text);
    const bullish = (tone + 1) / 2;

    out.push({
      stream: "beta",
      payload: {
        id: nextId(),
        platform: "mastodon",
        topic,
        sentimentScore: tone,
        mentionVolume: 1,
        engagementRate: Number(engagement.toFixed(4)),
        bullishRatio: Number(bullish.toFixed(4)),
        bearishRatio: Number((1 - bullish).toFixed(4)),
        influencerFollowers: followers,
        influencerImpact: Number((tone * Math.log10(followers + 1) * (engagement / 10)).toFixed(4)),
        timestamp: created,
      },
    });
  }
  return out;
}
