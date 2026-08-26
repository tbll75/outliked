import { createHmac, randomBytes } from "node:crypto";
import { generateText } from "ai";
import type { Listing } from "./types";

/** Post as @outlike_lol via the X API v2 (OAuth 1.0a user context).
 *  Needs four env vars from the X developer app, generated while signed in
 *  as @outlike_lol with Read and write permission:
 *    X_API_KEY, X_API_SECRET          (consumer key + secret)
 *    X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET  (@outlike_lol's user tokens)
 *  All posting is skipped silently when any of them is missing. */

function creds() {
  const {
    X_API_KEY: key,
    X_API_SECRET: keySecret,
    X_ACCESS_TOKEN: token,
    X_ACCESS_TOKEN_SECRET: tokenSecret,
  } = process.env;
  if (!key || !keySecret || !token || !tokenSecret) return null;
  return { key, keySecret, token, tokenSecret };
}

export function xPostingEnabled(): boolean {
  return creds() !== null;
}

/** RFC 3986 percent-encoding, which OAuth 1.0a requires. */
function pct(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

type XPostFailure = { status: number | null; detail?: string };

/** Post a tweet, optionally as a reply. Resolves to the new tweet id or a
 *  failure with the HTTP status (null = disabled/network). Never throws. */
async function postTweet(
  text: string,
  inReplyToTweetId?: string
): Promise<{ id: string } | XPostFailure> {
  const c = creds();
  if (!c) return { status: null, detail: "posting disabled" };
  const url = "https://api.x.com/2/tweets";
  const oauth: Record<string, string> = {
    oauth_consumer_key: c.key,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: c.token,
    oauth_version: "1.0",
  };
  // JSON bodies are not part of the OAuth 1.0a signature base string.
  const paramString = Object.keys(oauth)
    .sort()
    .map((k) => `${pct(k)}=${pct(oauth[k])}`)
    .join("&");
  const base = ["POST", pct(url), pct(paramString)].join("&");
  const signingKey = `${pct(c.keySecret)}&${pct(c.tokenSecret)}`;
  oauth.oauth_signature = createHmac("sha1", signingKey)
    .update(base)
    .digest("base64");
  const authorization =
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pct(k)}="${pct(oauth[k])}"`)
      .join(", ");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text,
        ...(inReplyToTweetId
          ? { reply: { in_reply_to_tweet_id: inReplyToTweetId } }
          : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json().catch(() => null)) as {
      data?: { id?: string };
      detail?: string;
      title?: string;
    } | null;
    if (!res.ok || !j?.data?.id) {
      console.error(
        "x post failed",
        res.status,
        JSON.stringify(j ?? {}).slice(0, 300)
      );
      return { status: res.status, detail: j?.detail };
    }
    return { id: j.data.id };
  } catch (e) {
    console.error("x post failed", e);
    return { status: null };
  }
}

/** Back-compat convenience: post and return the tweet id, or null. */
export async function postAsOutlike(
  text: string,
  inReplyToTweetId?: string
): Promise<string | null> {
  const r = await postTweet(text, inReplyToTweetId);
  return "id" in r ? r.id : null;
}

/** Every reply ends with this line: the weekly board link (where a fresh
 *  listing is most visible) plus the founder's handle for legitimacy. */
const SIGN_OFF = "from outlike.lol/weekly by @tibo_maker";

/** Board numbers the reply can cite as social proof. Real values only —
 *  the prompt forbids inventing numbers, and the fallback only cites
 *  clicksOut when it's actually nonzero. */
export type ScoutReplyStats = {
  sitesListed: number;
  totalLikes: number;
  clicksOut: number;
};

/** X counts every URL (incl. bare domains like outlike.lol/weekly) as 23 chars. */
function xCharCount(text: string): number {
  return text
    .replace(/https?:\/\/\S+/g, "x".repeat(23))
    .replace(/\boutlike\.lol\S*/g, "x".repeat(23)).length;
}

const fmtNum = (n: number) => n.toLocaleString("en-US");

const REPLY_PROMPT = (domain: string, s: ScoutReplyStats) =>
  `You write the short reply that @outlike_lol posts under a maker's launch tweet, right after auto-listing their product on outlike.lol (a free leaderboard of product launches where a launch tweet's like count decides its rank).

Facts you may use, nothing else:
- product: ${domain}
- their launch tweet is now ranked on this week's board; every like on it moves them up
- board so far: ${fmtNum(s.sitesListed)} products listed, ${fmtNum(s.totalLikes)} likes in play, ${fmtNum(s.clicksOut)} clicks sent out from the board to listed products

Write ONLY the reply body, 1 to 3 short sentences, under 170 characters:
- congratulate briefly and name the product (its domain, exactly as given)
- say their launch tweet is ranked and likes on it move it up
- work in exactly one of the numbers above as social proof, angled at sending them traffic (e.g. hoping to send some of those clicks their way). never invent or round numbers
- all lowercase, plain punctuation. no dashes of any kind, no hashtags, no links, no @mentions, no quotes
- write like a busy human typing, not marketing copy. banned: "game changer", "excited", "amazing", "likes are the only currency", "we've got you", any tagline-y phrasing
- at most one emoji

Output only the reply body.`;

function sanitizeBody(raw: string): string {
  return raw
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s*[—–]+\s*/g, ", ")
    .trim();
}

function fallbackBody(domain: string, s: ScoutReplyStats): string {
  const traffic =
    s.clicksOut > 0
      ? `the board has sent ${fmtNum(s.clicksOut)} clicks to listed products so far, hope some head your way.`
      : `hope we can send some traffic your way.`;
  return `congrats on the launch 💗 ${domain} is on this week's board, every like on your tweet moves it up. ${traffic}`;
}

/** The announcement body for a listing the scout just added. AI-worded so
 *  they don't all read identically; falls back to a fixed template when the
 *  model is unavailable or breaks the rules. Body only — no links, no
 *  mentions — so the composers below can place it in a reply or a mention. */
async function scoutReplyBody(
  listing: Listing,
  stats: ScoutReplyStats
): Promise<string> {
  try {
    const { text } = await generateText({
      model: "openai/gpt-5-nano",
      prompt: REPLY_PROMPT(listing.domain, stats),
      maxOutputTokens: 600,
      providerOptions: {
        openai: { reasoningEffort: "minimal", textVerbosity: "low" },
      },
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(8000),
    });
    const candidate = sanitizeBody(text);
    const ok =
      candidate.length > 0 &&
      candidate.length <= 200 &&
      candidate.toLowerCase().includes(listing.domain) &&
      !/https?:\/\//.test(candidate) &&
      !/[—–#]/.test(candidate) &&
      !/@\w/.test(candidate);
    if (ok) return candidate;
  } catch {
    // model unavailable — fall through to the template
  }
  return fallbackBody(listing.domain, stats);
}

/** Compose body + sign-off under X's 280 limit, degrading through fallback
 *  and minimal bodies when a long domain (or handle prefix) blows the cap. */
function composeWithLimit(
  bodies: string[],
  listing: Listing,
  prefix: string
): string {
  const minimal = `congrats on the launch 💗 ${listing.domain} is on this week's board, every like on your launch tweet moves it up.`;
  for (const body of [...bodies, minimal]) {
    const text = `${prefix}${body}\n\n${SIGN_OFF}`;
    if (xCharCount(text) <= 280) return text;
  }
  return `${prefix}${listing.domain} is on this week's board 💗\n\n${SIGN_OFF}`;
}

/** Announce a scout-added listing from @outlike_lol. Tries a reply under the
 *  launch tweet first; the current X API tier rejects replies to posts that
 *  don't mention us (403 not-authorized-for-resource), so on exactly that
 *  failure it posts a standalone tweet @mentioning the maker instead — same
 *  notification for them, and it works within the tier's rules. If X ever
 *  allows replies (tier upgrade), threads resume automatically. */
export async function announceScoutListing(
  listing: Listing,
  stats: ScoutReplyStats
): Promise<{ id: string; mode: "reply" | "mention" } | null> {
  if (!xPostingEnabled()) return null;
  const body = await scoutReplyBody(listing, stats);
  const fallback = fallbackBody(listing.domain, stats);
  const bodies = body === fallback ? [body] : [body, fallback];

  const reply = composeWithLimit(bodies, listing, "");
  const r = await postTweet(reply, listing.id);
  if ("id" in r) return { id: r.id, mode: "reply" };
  if (r.status !== 403) return null;

  const mention = composeWithLimit(bodies, listing, `@${listing.authorHandle} `);
  const m = await postTweet(mention);
  return "id" in m ? { id: m.id, mode: "mention" } : null;
}
