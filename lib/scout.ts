import { list, put } from "@vercel/blob";
import { generateText } from "ai";
import { normalizeSiteUrl } from "./config";
import { EMPTY_MODERATION, isBanned, readModeration } from "./moderation";
import { checkFavicon, fetchSitePitch } from "./site-meta";
import { addListing, getAllListings, ListingConflictError } from "./store";
import { fetchTweet, searchTweetsApify } from "./tweets";
import type { Listing, TweetData } from "./types";
import { postAsOutlike, scoutReplyText, xPostingEnabled } from "./x-post";

/** The alternative, zero-friction listing path: a cron scans X for fresh
 *  launch-style tweets and lists the product automatically — no form, no
 *  announcement template. The tweet itself becomes the listing, exactly as
 *  if its author had submitted it. */

const SCOUT_KEY = "cache/scout.json";
const SEARCH_TERMS = [
  '"outlike.lol"',
  '"producthunt.com"',
  '"product hunt"',
  '"producthunt"',
  "#launch",
];
const MAX_TWEETS_PER_SCAN = 80;
/** A launch tweet with a couple of likes shows a human behind it; keeps
 *  hashtag-spam bots off the board while staying easy to clear. Product Hunt
 *  launch posts bypass this gate when the AI check validates them — a PH
 *  launch minutes old legitimately has 0 likes. */
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

/** Which search query surfaced this tweet — stored on the listing so we can
 *  tell how much of the flywheel product hunt / #launch actually drive. */
function matchedTerm(hay: string): string {
  if (hay.includes("outlike.lol")) return "outlike.lol";
  if (hay.includes("producthunt") || hay.includes("product hunt")) {
    return "product hunt";
  }
  return "#launch";
}

/** AI gate: is this thread a genuine launch announcement by the maker?
 *  Returns null when the model is unavailable (gateway down / rate-limited)
 *  so callers can fall back to the likes gate instead of blocking. */
async function isLaunchPost(
  threadText: string,
  domain: string
): Promise<boolean | null> {
  try {
    const { text } = await generateText({
      model: "openai/gpt-5-nano",
      prompt: `You review tweets for a product-launch leaderboard. Decide if the tweet thread below is a genuine product launch announcement posted by the maker or team of the product itself — e.g. "introducing X", "we just launched", "launching on Product Hunt today". Answer NO for: news or commentary about someone else's launch, aggregator/curator accounts, job posts, giveaways, engagement bait, follow-for-follow spam, or generic marketing threads that don't announce a specific product.

The product's website is ${domain}.

Tweet thread:
${threadText.slice(0, 1500)}

Answer with exactly YES or NO.`,
      maxOutputTokens: 500,
      providerOptions: {
        openai: { reasoningEffort: "minimal", textVerbosity: "low" },
      },
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(8000),
    });
    const verdict = text.trim().toUpperCase();
    if (verdict.startsWith("YES")) return true;
    if (verdict.startsWith("NO")) return false;
    return null;
  } catch {
    return null;
  }
}

export type ScoutResult = {
  scanned: number;
  fresh: number;
  added: string[];
  replied: string[];
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
  // `seen` marks tweets we're permanently done with. A tweet skipped only
  // for too-few-likes is deliberately NOT marked: likes grow, so it gets
  // re-checked every scan while it stays inside the search window.
  const seen = new Set(state.seen);
  const listedIds = new Set(existing.map((l) => l.id));
  const listedDomains = new Set(existing.map((l) => l.domain));
  const added: string[] = [];
  const replied: string[] = [];

  for (const tweet of tweets) {
    if (added.length >= MAX_ADDS_PER_SCAN) break;
    if (seen.has(tweet.id) || listedIds.has(tweet.id)) {
      skip("already-seen");
      continue;
    }
    if (!tweet.authorHandle) {
      seen.add(tweet.id);
      skip("no-author");
      continue;
    }

    // The anchor is the tweet that gets listed and ranked. When the product
    // link lives in a reply under the author's own launch tweet ("link in
    // the comments"), anchor to the thread root — that's the tweet with the
    // likes. A reply into someone else's thread is drive-by promo: skip.
    let anchor = tweet;
    if (tweet.conversationId && tweet.conversationId !== tweet.id) {
      if (listedIds.has(tweet.conversationId)) {
        seen.add(tweet.id);
        skip("root-already-listed");
        continue;
      }
      const root = await fetchTweet(tweet.conversationId);
      if (
        !root ||
        !root.authorHandle ||
        root.authorHandle.toLowerCase() !== tweet.authorHandle.toLowerCase()
      ) {
        seen.add(tweet.id);
        skip("reply-to-other-thread");
        continue;
      }
      anchor = root;
    }

    // Product URL: the matched tweet first, then the thread root — the PH
    // pattern is "launch tweet with the site link, PH link in a reply".
    const site = productUrl(tweet) ?? (anchor !== tweet ? productUrl(anchor) : null);
    if (!site) {
      seen.add(tweet.id);
      skip("no-product-url");
      continue;
    }

    if (listedDomains.has(site.domain)) {
      // Never auto-take-over an existing listing; the manual flow owns that.
      seen.add(tweet.id);
      skip("domain-already-listed");
      continue;
    }
    if (isBanned(moderation, site.domain, anchor.authorHandle)) {
      seen.add(tweet.id);
      skip("banned");
      continue;
    }

    const threadText = [anchor.text, anchor !== tweet ? tweet.text : ""]
      .filter(Boolean)
      .join("\n---\n");
    const term = matchedTerm(
      [threadText, ...tweet.urls, ...anchor.urls].join(" ").toLowerCase()
    );

    // Likes gate: PH launch posts get in at 0 likes when the AI validates
    // them (a launch minutes old has none yet); everything else needs a
    // couple of likes first. AI-unavailable → retry next scan, never block.
    const phPost = term === "product hunt";
    if (!phPost && anchor.likes < MIN_LIKES) {
      skip("too-few-likes"); // not seen — retried next scan once likes catch up
      continue;
    }
    const verdict = await isLaunchPost(threadText, site.domain);
    if (verdict === false) {
      seen.add(tweet.id);
      skip("not-a-launch");
      continue;
    }
    if (verdict === null && anchor.likes < MIN_LIKES) {
      skip("ai-unavailable"); // 0-like PH post needs the AI's blessing; retry
      continue;
    }

    if (dryRun) {
      added.push(`${site.domain} (dry, via ${term}) @${anchor.authorHandle}`);
      continue;
    }

    const [pitch, hasFavicon] = await Promise.all([
      fetchSitePitch(site.site),
      checkFavicon(site.domain),
    ]);
    const listing: Listing = {
      id: anchor.id,
      site: site.site,
      domain: site.domain,
      name: site.domain,
      pitch,
      tweetUrl: `https://x.com/${anchor.authorHandle}/status/${anchor.id}`,
      authorHandle: anchor.authorHandle,
      authorName: anchor.authorName || anchor.authorHandle,
      authorAvatar: anchor.authorAvatar,
      likes: anchor.likes,
      replies: anchor.replies,
      createdAt: new Date().toISOString(),
      hasFavicon,
      authorFollowers: anchor.authorFollowers ?? tweet.authorFollowers,
      source: "scout",
      scoutTerm: term,
    };
    try {
      await addListing(listing);
      listedIds.add(anchor.id);
      listedDomains.add(site.domain);
      seen.add(tweet.id);
      added.push(`${site.domain} (via ${term})`);
      // Tell the author from @outlike_lol, right under their launch tweet.
      // Best-effort: a failed reply never blocks or retries (add-time is the
      // only reply moment, so a listing can never be replied to twice).
      if (xPostingEnabled()) {
        const replyId = await postAsOutlike(scoutReplyText(listing), anchor.id);
        if (replyId) replied.push(`${site.domain} → ${replyId}`);
      }
    } catch (e) {
      if (e instanceof ListingConflictError) {
        seen.add(tweet.id);
        skip("conflict");
      } else throw e;
    }
  }

  if (!dryRun) {
    await writeState({ seen: [...seen].slice(-SEEN_CAP) });
  }
  return {
    scanned: tweets.length,
    fresh: tweets.length - (skipped["already-seen"] ?? 0),
    added,
    replied,
    skipped,
  };
}
