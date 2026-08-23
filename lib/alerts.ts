import { del, list, put } from "@vercel/blob";
import { randomBytes } from "crypto";
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

function subscriberKey(listingId: string): string {
  return `${SUBSCRIBER_PREFIX}${listingId}.json`;
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

export async function addSubscriber(
  listingId: string,
  email: string,
  currentRank: number
): Promise<void> {
  const subs = await readSubscribersById(listingId);
  const normalized = email.trim().toLowerCase();
  if (subs.some((s) => s.email === normalized)) return;
  if (subs.length >= MAX_SUBSCRIBERS_PER_LISTING) {
    throw new Error("Subscriber limit reached for this listing.");
  }
  subs.push({
    email: normalized,
    token: randomBytes(16).toString("hex"),
    createdAt: new Date().toISOString(),
    lastNotifiedAt: null,
    lastNotifiedRank: currentRank,
  });
  await writeSubscribers(listingId, subs);
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

/** Compare two board snapshots and email subscribers about significant moves.
 *  Guard rails: only meaningful changes, one email per subscriber per cooldown
 *  window, and never re-alerting the same rank twice. */
export async function notifySignificantRankChanges(
  oldBoard: Board,
  newBoard: Board
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const { blobs } = await list({ prefix: SUBSCRIBER_PREFIX, limit: 1000 });
  if (blobs.length === 0) return;

  const oldRanks = new Map(oldBoard.listings.map((l, i) => [l.id, i + 1]));
  const nowMs = Date.now();
  const cooldownMs = NOTIFY_COOLDOWN_HOURS * 60 * 60 * 1000;

  for (const blob of blobs) {
    const listingId = blob.pathname
      .slice(SUBSCRIBER_PREFIX.length)
      .replace(/\.json$/, "");
    const newIndex = newBoard.listings.findIndex((l) => l.id === listingId);
    const prevRank = oldRanks.get(listingId);
    if (newIndex === -1 || prevRank === undefined) continue;
    const newRank = newIndex + 1;
    const change = describeChange(prevRank, newRank);
    if (!change) continue;

    const listing = newBoard.listings[newIndex];
    const subs = await readSubscribers(blob.url);
    let dirty = false;
    for (const sub of subs) {
      if (sub.lastNotifiedRank === newRank) continue;
      const last = sub.lastNotifiedAt ? new Date(sub.lastNotifiedAt).getTime() : 0;
      if (nowMs - last < cooldownMs) continue;
      const sent = await sendAlertEmail(apiKey, sub, listing, newRank, change);
      if (sent) {
        sub.lastNotifiedAt = new Date().toISOString();
        sub.lastNotifiedRank = newRank;
        dirty = true;
      }
    }
    if (dirty) await writeSubscribers(listingId, subs);
  }
}
