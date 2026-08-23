import { del, list, put } from "@vercel/blob";
import type { Board, Listing } from "./types";
import { fetchTweetsBatch } from "./tweets";

const LISTING_PREFIX = "listings/";
const BOARD_KEY = "cache/board.json";

/** Refresh no more often than this (seconds) no matter who asks. */
const MIN_REFRESH_SECONDS = 45;

/** How often a listing's like count should be re-fetched, by listing age.
 *  Fresh listings move fast, old ones barely move — refresh accordingly. */
const REFRESH_TIERS: { maxAgeSeconds: number; intervalSeconds: number }[] = [
  { maxAgeSeconds: 15 * 60, intervalSeconds: 60 }, // first 15 min: every minute
  { maxAgeSeconds: 2 * 60 * 60, intervalSeconds: 10 * 60 }, // to 2 h: every 10 min
  { maxAgeSeconds: 24 * 60 * 60, intervalSeconds: 60 * 60 }, // to 24 h: hourly
  { maxAgeSeconds: 7 * 24 * 60 * 60, intervalSeconds: 6 * 60 * 60 }, // to 7 d: every 6 h
];
/** Older than the last tier: once a day. */
const MAX_REFRESH_INTERVAL_SECONDS = 24 * 60 * 60;

export function refreshIntervalSeconds(ageSeconds: number): number {
  for (const tier of REFRESH_TIERS) {
    if (ageSeconds < tier.maxAgeSeconds) return tier.intervalSeconds;
  }
  return MAX_REFRESH_INTERVAL_SECONDS;
}

function listingIsDue(l: Listing, nowMs: number): boolean {
  const last = l.lastRefreshedAt ?? l.createdAt;
  const ageSeconds = (nowMs - new Date(l.createdAt).getTime()) / 1000;
  const sinceRefreshSeconds = (nowMs - new Date(last).getTime()) / 1000;
  return sinceRefreshSeconds >= refreshIntervalSeconds(ageSeconds);
}

/** True when at least one listing is due for a like-count refresh. */
export function boardNeedsRefresh(board: Board | null): boolean {
  if (!board) return true;
  if (boardAgeSeconds(board) < MIN_REFRESH_SECONDS) return false;
  const nowMs = Date.now();
  return board.listings.some((l) => listingIsDue(l, nowMs));
}

function bust(url: string): string {
  return `${url}?v=${Date.now()}`;
}

export async function saveListing(l: Listing): Promise<void> {
  await put(`${LISTING_PREFIX}${l.id}.json`, JSON.stringify(l), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function deleteListing(id: string): Promise<void> {
  const { blobs } = await list({ prefix: `${LISTING_PREFIX}${id}.json` });
  await Promise.all(blobs.map((b) => del(b.url)));
}

export async function getAllListings(): Promise<Listing[]> {
  const out: Listing[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: LISTING_PREFIX, cursor, limit: 1000 });
    cursor = page.cursor;
    const fetched = await Promise.all(
      page.blobs.map(async (b) => {
        try {
          const res = await fetch(bust(b.url), { cache: "no-store" });
          if (!res.ok) return null;
          return (await res.json()) as Listing;
        } catch {
          return null;
        }
      })
    );
    for (const l of fetched) if (l?.id) out.push(l);
  } while (cursor);
  // De-dupe by tweet id in case of any historical double-write
  const seen = new Map<string, Listing>();
  for (const l of out) seen.set(l.id, l);
  return [...seen.values()];
}

export async function readBoard(): Promise<Board | null> {
  try {
    const { blobs } = await list({ prefix: BOARD_KEY, limit: 1 });
    if (blobs.length === 0) return null;
    const res = await fetch(bust(blobs[0].url), { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Board;
  } catch {
    return null;
  }
}

async function writeBoard(board: Board): Promise<void> {
  await put(BOARD_KEY, JSON.stringify(board), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

function sortBoard(listings: Listing[]): Listing[] {
  return listings.sort(
    (a, b) =>
      b.likes - a.likes ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

export function boardAgeSeconds(board: Board | null): number {
  if (!board) return Infinity;
  return (Date.now() - new Date(board.updatedAt).getTime()) / 1000;
}

/** Re-fetch due listings' like counts and rewrite the cached board.
 *  With `force`, every listing refreshes regardless of its schedule. */
export async function rebuildBoard(force = false): Promise<Board> {
  const current = await readBoard();
  if (!force && current && !boardNeedsRefresh(current)) {
    return current;
  }
  const listings = await getAllListings();
  const cachedById = new Map((current?.listings ?? []).map((l) => [l.id, l]));
  for (const l of listings) {
    const cached = cachedById.get(l.id);
    if (cached) {
      l.likes = cached.likes;
      l.lastRefreshedAt = cached.lastRefreshedAt ?? l.lastRefreshedAt;
      if (cached.authorAvatar) l.authorAvatar = cached.authorAvatar;
    }
  }
  const nowMs = Date.now();
  const due = force ? listings : listings.filter((l) => listingIsDue(l, nowMs));
  if (due.length > 0) {
    const fresh = await fetchTweetsBatch(
      due.map((l) => ({ id: l.id, tweetUrl: l.tweetUrl }))
    );
    const nowIso = new Date().toISOString();
    for (const l of due) {
      const t = fresh.get(l.id);
      if (t) {
        l.likes = t.likes;
        if (t.authorAvatar) l.authorAvatar = t.authorAvatar;
      }
      l.lastRefreshedAt = nowIso;
    }
  }
  const board: Board = {
    updatedAt: new Date().toISOString(),
    totalLikes: listings.reduce((s, l) => s + l.likes, 0),
    listings: sortBoard(listings),
  };
  await writeBoard(board);
  if (current && due.length > 0) {
    const { notifySignificantRankChanges } = await import("./alerts");
    try {
      await notifySignificantRankChanges(current, board);
    } catch (e) {
      console.error("rank alerts failed", e);
    }
  }
  return board;
}

/** Board for rendering: cached copy, rebuilt from scratch if missing. */
export async function getBoard(): Promise<Board> {
  const cached = await readBoard();
  if (cached) return cached;
  try {
    return await rebuildBoard(true);
  } catch {
    return { updatedAt: new Date(0).toISOString(), totalLikes: 0, listings: [] };
  }
}

/** Add a listing (or replace the existing listing for the same domain),
 *  then rewrite the board immediately so the submitter sees their rank. */
export async function addListing(l: Listing): Promise<Board> {
  const listings = await getAllListings();
  const sameDomain = listings.find(
    (x) => x.domain === l.domain && x.id !== l.id
  );
  if (sameDomain && sameDomain.likes > l.likes) {
    throw new ListingConflictError(
      `${l.domain} is already on the board with ${sameDomain.likes} likes. A new announcement tweet can only take over once it has more likes than the current one.`
    );
  }
  if (sameDomain) await deleteListing(sameDomain.id);
  await saveListing(l);
  const next = listings.filter((x) => x.id !== l.id && x.domain !== l.domain);
  next.push(l);
  const board: Board = {
    updatedAt: new Date().toISOString(),
    totalLikes: next.reduce((s, x) => s + x.likes, 0),
    listings: sortBoard(next),
  };
  await writeBoard(board);
  return board;
}

export class ListingConflictError extends Error {}
