import { del, list, put } from "@vercel/blob";
import { createHmac, randomBytes } from "crypto";
import { APP_NAME, APP_URL, formatLikes } from "./config";
import type { Board, Listing } from "./types";

const SUBSCRIBER_PREFIX = "subscribers/";
/** Never email the same subscriber twice within this window. */
const NOTIFY_COOLDOWN_HOURS = 20;
/** A move of at least this many places counts as significant. */
const SIGNIFICANT_RANK_DELTA = 3;
/** Entering or leaving the top N counts as significant. */
const TOP_RANK_THRESHOLD = 3;
const MAX_SUBSCRIBERS_PER_LISTING = 20;
const KEY_SUFFIX_BYTES = 8;
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "outliked <outliked@mail.tmaker.io>";

export type AlertSubscriber = {
  email: string;
  token: string;
  createdAt: string;
  lastNotifiedAt: string | null;
  lastNotifiedRank: number;
};

function bust(url: string): string {
  return `${url}?v=${Date.now()}`;
}

/** Blob paths are public; an HMAC suffix keeps them unguessable even if the
 *  store hostname ever leaks, since listing ids are public knowledge. */
function subscriberKey(listingId: string): string {
  const secret = process.env.ALERTS_SALT ?? process.env.ADMIN_KEY ?? APP_NAME;
  const suffix = createHmac("sha256", secret)
    .update(listingId)
    .digest("hex")
    .slice(0, KEY_SUFFIX_BYTES * 2);
  return `${SUBSCRIBER_PREFIX}${listingId}-${suffix}.json`;
}

async function readSubscribers(blobUrl: string): Promise<AlertSubscriber[]> {
  try {
    const res = await fetch(bust(blobUrl), { cache: "no-store" });
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j) ? (j as AlertSubscriber[]) : [];
  } catch {
    return [];
  }
}

async function readSubscribersById(
  listingId: string
): Promise<AlertSubscriber[]> {
  const { blobs } = await list({ prefix: subscriberKey(listingId), limit: 1 });
  if (blobs.length === 0) return [];
  return readSubscribers(blobs[0].url);
}

async function writeSubscribers(
  listingId: string,
  subs: AlertSubscriber[]
): Promise<void> {
  if (subs.length === 0) {
    const { blobs } = await list({ prefix: subscriberKey(listingId), limit: 1 });
    await Promise.all(blobs.map((b) => del(b.url)));
    return;
  }
  await put(subscriberKey(listingId), JSON.stringify(subs), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export class SubscriberLimitError extends Error {}

/** Returns the new subscriber, or null when this email was already subscribed
 *  (so callers can welcome first-timers only). */
export async function addSubscriber(
  listingId: string,
  email: string,
  currentRank: number
): Promise<AlertSubscriber | null> {
  const subs = await readSubscribersById(listingId);
  const normalized = email.trim().toLowerCase();
  if (subs.some((s) => s.email === normalized)) return null;
  if (subs.length >= MAX_SUBSCRIBERS_PER_LISTING) {
    throw new SubscriberLimitError("Subscriber limit reached for this listing.");
  }
  const sub: AlertSubscriber = {
    email: normalized,
    token: randomBytes(16).toString("hex"),
    createdAt: new Date().toISOString(),
    lastNotifiedAt: null,
    lastNotifiedRank: currentRank,
  };
  subs.push(sub);
  await writeSubscribers(listingId, subs);
  return sub;
}

export function welcomeEmailText(domain: string | null, unsubscribeUrl: string): string {
  const opener = domain
    ? `${domain} is live on the ${APP_NAME} board. nice.`
    : `your site is live on the ${APP_NAME} board. nice.`;
  return [
    `hey, tibo here`,
    ``,
    opener,
    ``,
    `more likes on your tweet means a higher rank, so keep sharing it. we'll email you when your rank makes a big move, nothing else.`,
    ``,
    `btw, I share everything I learn building products at https://tmaker.io. free playbooks and tools over there if you're into that.`,
    ``,
    `good luck on the board 💗`,
    ``,
    `unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
}

/** Fire-and-forget welcome for a first-time alert subscriber. */
export async function sendWelcomeEmail(
  sub: AlertSubscriber,
  listingId: string,
  domain: string | null
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const unsubscribeUrl = `${APP_URL}/api/alerts/unsubscribe?listing=${listingId}&token=${sub.token}`;
  try {
    await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.ALERTS_FROM_EMAIL ?? DEFAULT_FROM,
        to: [sub.email],
        subject: `you're on ${APP_NAME}`,
        text: welcomeEmailText(domain, unsubscribeUrl),
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
      }),
      cache: "no-store",
    });
  } catch (e) {
    console.error("welcome email failed", e);
  }
}

export async function removeSubscriber(
  listingId: string,
  token: string
): Promise<boolean> {
  const subs = await readSubscribersById(listingId);
  const next = subs.filter((s) => s.token !== token);
  if (next.length === subs.length) return false;
  await writeSubscribers(listingId, next);
  return true;
}

export type SubscriberList = {
  listingId: string;
  subscribers: Omit<AlertSubscriber, "token">[];
};

/** Every alert subscriber, grouped by listing — for the admin dashboard.
 *  Unsubscribe tokens stay server-side. */
export async function getAllSubscriberLists(): Promise<SubscriberList[]> {
  const { blobs } = await list({ prefix: SUBSCRIBER_PREFIX, limit: 1000 });
  const out: SubscriberList[] = [];
  for (const blob of blobs) {
    const listingId = blob.pathname
      .slice(SUBSCRIBER_PREFIX.length)
      .replace(/-[0-9a-f]+\.json$/, "")
      .replace(/\.json$/, "");
    const subs = await readSubscribers(blob.url);
    if (subs.length === 0) continue;
    out.push({
      listingId,
      subscribers: subs.map(({ token: _token, ...rest }) => rest),
    });
  }
  return out;
}

/** Human line for a rank move, or null when the move isn't worth an email. */
function describeChange(prev: number, next: number): string | null {
  if (prev === next) return null;
  if (next === 1) return "you just took #1 👑";
  if (prev === 1) return `you lost #1 — you're now #${next}`;
  if (prev > TOP_RANK_THRESHOLD && next <= TOP_RANK_THRESHOLD)
    return `you broke into the top ${TOP_RANK_THRESHOLD} — you're #${next}`;
  if (prev <= TOP_RANK_THRESHOLD && next > TOP_RANK_THRESHOLD)
    return `you dropped out of the top ${TOP_RANK_THRESHOLD} — you're #${next}`;
  if (Math.abs(prev - next) >= SIGNIFICANT_RANK_DELTA)
    return next < prev
      ? `you climbed from #${prev} to #${next}`
      : `you slipped from #${prev} to #${next}`;
  return null;
}

async function sendAlertEmail(
  apiKey: string,
  sub: AlertSubscriber,
  listing: Listing,
  rank: number,
  change: string
): Promise<boolean> {
  const unsubscribeUrl = `${APP_URL}/api/alerts/unsubscribe?listing=${listing.id}&token=${sub.token}`;
  const subject = `${APP_NAME}: ${listing.name} — ${change.replace(/ 👑$/, "")}`;
  const text = [
    `${change}`,
    ``,
    `${listing.name} is #${rank} on ${APP_NAME} with ${formatLikes(listing.likes)} likes.`,
    ``,
    `rally more likes on your tweet: ${listing.tweetUrl}`,
    `see the board: ${APP_URL}`,
    ``,
    `—`,
    `you only get these on significant rank moves.`,
    `unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.ALERTS_FROM_EMAIL ?? DEFAULT_FROM,
        to: [sub.email],
        subject,
        text,
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
      }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Email each subscriber whose listing moved significantly since the last
 *  email they received (their own baseline, so gradual drift still alerts).
 *  Call this from exactly one place (the hourly cron) so concurrent rebuilds
 *  can't double-send. */
export async function notifySignificantRankChanges(board: Board): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const { blobs } = await list({ prefix: SUBSCRIBER_PREFIX, limit: 1000 });
  if (blobs.length === 0) return;

  const rankById = new Map(board.listings.map((l, i) => [l.id, i + 1]));
  const nowMs = Date.now();
  const cooldownMs = NOTIFY_COOLDOWN_HOURS * 60 * 60 * 1000;

  for (const blob of blobs) {
    const listingId = blob.pathname
      .slice(SUBSCRIBER_PREFIX.length)
      .replace(/-[0-9a-f]+\.json$/, "")
      .replace(/\.json$/, "");
    const newRank = rankById.get(listingId);
    if (!newRank) continue;
    const listing = board.listings[newRank - 1];

    const subs = await readSubscribers(blob.url);
    const notified = new Map<string, { at: string; rank: number }>();
    for (const sub of subs) {
      const change = describeChange(sub.lastNotifiedRank, newRank);
      if (!change) continue;
      const last = sub.lastNotifiedAt ? new Date(sub.lastNotifiedAt).getTime() : 0;
      if (nowMs - last < cooldownMs) continue;
      const sent = await sendAlertEmail(apiKey, sub, listing, newRank, change);
      if (sent) {
        notified.set(sub.token, { at: new Date().toISOString(), rank: newRank });
      }
    }
    if (notified.size > 0) {
      const latest = await readSubscribersById(listingId);
      for (const sub of latest) {
        const n = notified.get(sub.token);
        if (n) {
          sub.lastNotifiedAt = n.at;
          sub.lastNotifiedRank = n.rank;
        }
      }
      await writeSubscribers(listingId, latest);
    }
  }
}
