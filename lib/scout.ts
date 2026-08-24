import { list, put } from "@vercel/blob";
import { normalizeSiteUrl } from "./config";
import { EMPTY_MODERATION, isBanned, readModeration } from "./moderation";
import { checkFavicon, fetchSitePitch } from "./site-meta";
import { addListing, getAllListings, ListingConflictError } from "./store";
import { searchTweetsApify } from "./tweets";
import type { Listing, TweetData } from "./types";

/** The alternative, zero-friction listing path: a cron scans X for fresh
 *  launch-style tweets and lists the product automatically — no form, no
 *  announcement template. The tweet itself becomes the listing, exactly as
 *  if its author had submitted it. */

const SCOUT_KEY = "cache/scout.json";
const SEARCH_TERMS = ['"outlike.lol"', '"producthunt.com"', "#launch"];
const MAX_TWEETS_PER_SCAN = 60;
/** A launch tweet with a couple of likes shows a human behind it; keeps
 *  hashtag-spam bots off the board while staying easy to clear. */
const MIN_LIKES = 2;
const MAX_ADDS_PER_SCAN = 15;
const SEEN_CAP = 3000;

/** Hosts that are never the product being launched. */
const SKIP_HOSTS = [
  "outlike.lol",
  "outliked.vercel.app",
  "x.com",
  "twitter.com",
  "t.co",
  "producthunt.com",
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "linkedin.com",
  "discord.gg",
  "discord.com",
  "t.me",
  "reddit.com",
  "medium.com",
  // launch aggregators + review sites people link next to their product
  "g2.com",
  "capterra.com",
  "trustpilot.com",
  "getapp.com",
  "alternativeto.net",
  "saasworthy.com",
  "toolify.ai",
  "futurepedia.io",
  "indiehackers.com",
  "news.ycombinator.com",
  "ycombinator.com",
  "betalist.com",
  "peerlist.io",
  "devhunt.org",
  "microlaunch.net",
  "fazier.com",
  "uneed.best",
  "dev.to",
  "kickstarter.com",
  "gofundme.com",
  // shorteners we can't cheaply resolve
  "bit.ly",
  "buff.ly",
  "lnkd.in",
  "tinyurl.com",
];

function isSkippedDomain(domain: string): boolean {
  return SKIP_HOSTS.some((h) => domain === h || domain.endsWith(`.${h}`));
}

type ScoutState = { seen: string[] };

function bust(url: string): string {
  return `${url}?v=${Date.now()}`;
}

async function readState(): Promise<ScoutState> {
  try {
    const { blobs } = await list({ prefix: SCOUT_KEY, limit: 1 });
    if (blobs.length === 0) return { seen: [] };
    const res = await fetch(bust(blobs[0].url), { cache: "no-store" });
    if (!res.ok) return { seen: [] };
    const j = (await res.json()) as ScoutState;
    return { seen: Array.isArray(j.seen) ? j.seen : [] };
  } catch {
    return { seen: [] };
  }
}

async function writeState(state: ScoutState): Promise<void> {
  await put(SCOUT_KEY, JSON.stringify(state), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

/** The URL being launched, or null. A real launch tweet links its own
 *  product (one, maybe two URLs); a tweet linking 3+ distinct sites is a
 *  link-dump — marketing spam no blocklist can keep up with — so skip it. */
function productUrl(tweet: TweetData): { site: string; domain: string } | null {
  const byDomain = new Map<string, { site: string; domain: string }>();
  for (const raw of tweet.urls) {
    const normalized = normalizeSiteUrl(raw);
    if (!normalized) continue;
    if (isSkippedDomain(normalized.domain)) continue;
    if (!byDomain.has(normalized.domain)) {
      byDomain.set(normalized.domain, normalized);
    }
  }
  const unique = [...byDomain.values()];
  if (unique.length === 0 || unique.length > 2) return null;
  return unique[0];
}

export type ScoutResult = {
  scanned: number;
  fresh: number;
  added: string[];
  skipped: Record<string, number>;
};

export async function scoutLaunchTweets(dryRun = false): Promise<ScoutResult> {
  const skipped: Record<string, number> = {};
  const skip = (why: string) => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };

  const [state, tweets, existing, moderation] = await Promise.all([
    readState(),
    searchTweetsApify(SEARCH_TERMS, MAX_TWEETS_PER_SCAN),
    getAllListings(),
    readModeration().catch(() => EMPTY_MODERATION),
  ]);
  const seen = new Set(state.seen);
  const listedIds = new Set(existing.map((l) => l.id));
  const listedDomains = new Set(existing.map((l) => l.domain));
  const added: string[] = [];

  for (const tweet of tweets) {
    if (added.length >= MAX_ADDS_PER_SCAN) break;
    if (seen.has(tweet.id) || listedIds.has(tweet.id)) {
      skip("already-seen");
      continue;
    }
    seen.add(tweet.id);
    if (!tweet.authorHandle) {
      skip("no-author");
      continue;
    }
    if (tweet.likes < MIN_LIKES) {
      skip("too-few-likes");
      continue;
    }
    const site = productUrl(tweet);
    if (!site) {
      skip("no-product-url");
      continue;
    }
    if (listedDomains.has(site.domain)) {
      // Never auto-take-over an existing listing; the manual flow owns that.
      skip("domain-already-listed");
      continue;
    }
    if (isBanned(moderation, site.domain, tweet.authorHandle)) {
      skip("banned");
      continue;
    }

    if (dryRun) {
      added.push(`${site.domain} (dry) via @${tweet.authorHandle}`);
      continue;
    }

    const [pitch, hasFavicon] = await Promise.all([
      fetchSitePitch(site.site),
      checkFavicon(site.domain),
    ]);
    const listing: Listing = {
      id: tweet.id,
      site: site.site,
      domain: site.domain,
      name: site.domain,
      pitch,
      tweetUrl: `https://x.com/${tweet.authorHandle}/status/${tweet.id}`,
      authorHandle: tweet.authorHandle,
      authorName: tweet.authorName || tweet.authorHandle,
      authorAvatar: tweet.authorAvatar,
      likes: tweet.likes,
      replies: tweet.replies,
      createdAt: new Date().toISOString(),
      hasFavicon,
      authorFollowers: tweet.authorFollowers,
      source: "scout",
    };
    try {
      await addListing(listing);
      listedDomains.add(site.domain);
      added.push(site.domain);
    } catch (e) {
      if (e instanceof ListingConflictError) skip("conflict");
      else throw e;
    }
  }

  if (!dryRun) {
    await writeState({ seen: [...seen].slice(-SEEN_CAP) });
  }
  return { scanned: tweets.length, fresh: tweets.length - (skipped["already-seen"] ?? 0), added, skipped };
}
