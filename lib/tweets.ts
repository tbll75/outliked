import type { TweetData } from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export function parseTweetUrl(
  raw: string
): { id: string; handle: string } | null {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!/(^|\.)((twitter)|(x))\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/);
    if (!m) return null;
    return { handle: m[1], id: m[2] };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Path 1: Twitter syndication CDN (free, no auth, per-tweet)
// ---------------------------------------------------------------------------

function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, "");
}

export async function fetchTweetSyndication(
  id: string
): Promise<TweetData | null> {
  try {
    const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${syndicationToken(id)}`;
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j?.id_str && !j?.text) return null;
    if (typeof j.favorite_count !== "number") return null;
    const urls: string[] = (j.entities?.urls ?? [])
      .map((u: { expanded_url?: string }) => u.expanded_url)
      .filter(Boolean);
    return {
      id: j.id_str ?? id,
      text: j.text ?? "",
      urls,
      likes: j.favorite_count,
      replies:
        typeof j.conversation_count === "number"
          ? j.conversation_count
          : undefined,
      authorHandle: j.user?.screen_name ?? "",
      authorName: j.user?.name ?? "",
      authorAvatar: j.user?.profile_image_url_https ?? "",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Path 2: Apify apidojo/tweet-scraper (batch, robust, needs APIFY_TOKEN)
// ---------------------------------------------------------------------------

const APIFY_ACTOR = "apidojo~tweet-scraper";

type ApifyTweet = {
  id?: string;
  fullText?: string;
  text?: string;
  likeCount?: number;
  replyCount?: number;
  entities?: { urls?: { expanded_url?: string }[] };
  author?: {
    userName?: string;
    name?: string;
    profilePicture?: string;
    followers?: number;
  };
};

function mapApifyTweet(t: ApifyTweet): TweetData | null {
  if (!t?.id || typeof t.likeCount !== "number") return null;
  return {
    id: t.id,
    text: t.fullText ?? t.text ?? "",
    urls: (t.entities?.urls ?? [])
      .map((u) => u.expanded_url)
      .filter((u): u is string => Boolean(u)),
    likes: t.likeCount,
    replies: typeof t.replyCount === "number" ? t.replyCount : undefined,
    authorHandle: t.author?.userName ?? "",
    authorName: t.author?.name ?? "",
    authorAvatar: t.author?.profilePicture ?? "",
    authorFollowers:
      typeof t.author?.followers === "number" ? t.author.followers : undefined,
  };
}

async function runApifyActor(
  input: Record<string, unknown>
): Promise<ApifyTweet[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return [];
  const res = await fetch(
    `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=50&memory=1024`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    }
  );
  if (!res.ok) return [];
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

export async function fetchTweetsApify(
  tweetUrls: string[]
): Promise<Map<string, TweetData>> {
  const out = new Map<string, TweetData>();
  if (tweetUrls.length === 0) return out;
  try {
    const items = await runApifyActor({
      startUrls: tweetUrls,
      maxItems: tweetUrls.length,
    });
    for (const t of items) {
      const mapped = mapApifyTweet(t);
      if (mapped) out.set(mapped.id, mapped);
    }
    return out;
  } catch {
    return out;
  }
}

/** Search recent tweets matching the given queries (newest first). Used by
 *  the launch-tweet scout; needs APIFY_TOKEN, returns [] without it. */
export async function searchTweetsApify(
  searchTerms: string[],
  maxItems: number,
  sinceDaysAgo = 2
): Promise<TweetData[]> {
  try {
    const start = new Date(Date.now() - sinceDaysAgo * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const items = await runApifyActor({
      searchTerms,
      maxItems,
      sort: "Latest",
      start,
    });
    return items
      .map(mapApifyTweet)
      .filter((t): t is TweetData => t !== null);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Combined
// ---------------------------------------------------------------------------

export async function fetchTweet(id: string): Promise<TweetData | null> {
  const syn = await fetchTweetSyndication(id);
  if (syn) return syn;
  const viaApify = await fetchTweetsApify([`https://x.com/i/status/${id}`]);
  return viaApify.get(id) ?? null;
}

/** Batch-fetch like counts. Apify first (one actor run for all tweets),
 *  syndication fills in whatever Apify missed. */
export async function fetchTweetsBatch(
  tweets: { id: string; tweetUrl: string }[]
): Promise<Map<string, TweetData>> {
  const result = await fetchTweetsApify(tweets.map((t) => t.tweetUrl));
  const missing = tweets.filter((t) => !result.has(t.id));
  const CONCURRENCY = 8;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const chunk = missing.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      chunk.map((t) => fetchTweetSyndication(t.id))
    );
    for (const t of fetched) if (t) result.set(t.id, t);
  }
  return result;
}

const FXTWITTER_ENDPOINT = (id: string) => `https://api.fxtwitter.com/status/${id}`;
const FOLLOWERS_TIMEOUT_MS = 4000;

/** Best-effort author follower count via the public fxtwitter API, used when
 *  the tweet source didn't include it (syndication never does). */
export async function fetchAuthorFollowers(id: string): Promise<number | undefined> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FOLLOWERS_TIMEOUT_MS);
    const res = await fetch(FXTWITTER_ENDPOINT(id), {
      headers: { "user-agent": UA },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return undefined;
    const j = await res.json();
    const followers = j?.tweet?.author?.followers;
    return typeof followers === "number" ? followers : undefined;
  } catch {
    return undefined;
  }
}

/** Expand t.co links by following redirects, as backup when entities are absent. */
export async function expandTcoLinks(text: string): Promise<string[]> {
  const tcos = text.match(/https:\/\/t\.co\/[A-Za-z0-9]+/g) ?? [];
  const out: string[] = [];
  await Promise.all(
    tcos.slice(0, 6).map(async (u) => {
      try {
        const res = await fetch(u, {
          method: "HEAD",
          redirect: "manual",
          headers: { "user-agent": UA },
          cache: "no-store",
        });
        const loc = res.headers.get("location");
        if (loc) out.push(loc);
      } catch {
        /* ignore */
      }
    })
  );
  return out;
}
