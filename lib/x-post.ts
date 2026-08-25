import { createHmac, randomBytes } from "node:crypto";
import { APP_URL } from "./config";
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

/** Post a tweet, optionally as a reply. Returns the new tweet id, or null
 *  when posting is disabled or the API rejects the request. Never throws. */
export async function postAsOutlike(
  text: string,
  inReplyToTweetId?: string
): Promise<string | null> {
  const c = creds();
  if (!c) return null;
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
      return null;
    }
    return j.data.id;
  } catch (e) {
    console.error("x post failed", e);
    return null;
  }
}

/** Reply variants for scout-added listings. Deterministic per tweet so a
 *  retried scan can never produce two differently-worded replies, and varied
 *  across listings so the account isn't posting one identical string all day. */
const REPLY_VARIANTS: ((domain: string, card: string) => string)[] = [
  (domain, card) =>
    `congrats on the launch 💗 ${domain} is now live on outliked — the board where likes are the only currency. every like on this tweet pushes it toward #1.\n\nyour rank card: ${card}\n\n(auto-listed, free. want it removed? just reply.)`,
  (domain, card) =>
    `${domain} just landed on the outliked board 💗 rank = this tweet's like count, nothing else. rally your people.\n\ntrack your spot: ${card}\n\n(auto-listed, free. want it removed? just reply.)`,
  (domain, card) =>
    `we spotted this launch and listed ${domain} on outliked, free — the most-liked launch tweet holds #1, and likes on this tweet are your votes.\n\nyour rank card: ${card}\n\n(want it removed? just reply.)`,
];

/** X counts every URL as 23 characters regardless of length. */
function xCharCount(text: string): number {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
}

/** The under-the-launch-tweet reply for a listing the scout just added. */
export function scoutReplyText(listing: Listing): string {
  const card = `${APP_URL}/card/${listing.domain}`;
  // Stable pick: last digits of the tweet id.
  const pick = Number(listing.id.slice(-4)) % REPLY_VARIANTS.length;
  const text = REPLY_VARIANTS[pick](listing.domain, card);
  if (xCharCount(text) <= 280) return text;
  // Unusually long domain: fall back to the minimal form.
  return `${listing.domain} is now live on outliked 💗 every like on this tweet pushes it toward #1.\n\n${card}\n\n(auto-listed. want it removed? just reply.)`;
}
