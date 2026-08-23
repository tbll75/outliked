import { del, list, put } from "@vercel/blob";
import type { Board, Listing } from "./types";
import { fetchTweetsBatch } from "./tweets";
import {
  isBanned,
  isCheatSuspect,
  readModeration,
  type Moderation,
} from "./moderation";

const LISTING_PREFIX = "listings/";
const BOARD_KEY = "cache/board.json";

/** Refresh no more often than this (seconds) no matter who asks.
 *  Kept above Vercel Blob's ~60s overwrite propagation window. */
const MIN_REFRESH_SECONDS = 60;

/** How often a listing's like count should be re-fetched, by listing age.
 *  Fresh listings move fast, old ones barely move — refresh accordingly. */
const REFRESH_TIERS: { maxAgeSeconds: number; intervalSeconds: number }[] = [
  { maxAgeSeconds: 30 * 60, intervalSeconds: 60 }, // first 30 min: every minute
  { maxAgeSeconds: 6 * 60 * 60, intervalSeconds: 5 * 60 }, // to 6 h: every 5 min
  { maxAgeSeconds: 24 * 60 * 60, intervalSeconds: 30 * 60 }, // to 24 h: every 30 min
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

/** True when at least one listing is due for a like-count refresh.
 *  An empty board also qualifies: it may be the result of a failed rebuild,
 *  and re-checking the store is the only way to recover. */
export function boardNeedsRefresh(board: Board | null): boolean {
  if (!board) return true;
  if (boardAgeSeconds(board) < MIN_REFRESH_SECONDS) return false;
  if (board.listings.length === 0) return true;
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

/** Read every listing blob. Throws when any blob can't be read: a partial
 *  result must never flow into rebuildBoard, or a transient fetch failure
 *  silently erases listings from the board (this happened once). */
export async function getAllListings(): Promise<Listing[]> {
  const out: Listing[] = [];
  let expected = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: LISTING_PREFIX, cursor, limit: 1000 });
    cursor = page.cursor;
    expected += page.blobs.length;
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
  if (out.length < expected) {
    throw new Error(
      `getAllListings read ${out.length}/${expected} listing blobs; refusing partial result`
    );
  }
  // De-dupe by tweet id in case of any historical double-write
  const seen = new Map<string, Listing>();
  for (const l of out) seen.set(l.id, l);
  return [...seen.values()];
}

/** True when the listing blob exists, even if the cached board doesn't
 *  reflect it yet — board.json overwrites take up to ~60s to propagate,
 *  while newly created blobs show up in list() almost immediately. */
export async function listingExists(id: string): Promise<boolean> {
  const { blobs } = await list({
    prefix: `${LISTING_PREFIX}${id}.json`,
    limit: 1,
  });
  return blobs.length > 0;
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

/** Overlay live like counts from the cached board onto blob listings, whose
 *  own likes are frozen at submit time. */
function overlayCachedLikes(listings: Listing[], cached: Board | null): void {
  const cachedById = new Map((cached?.listings ?? []).map((l) => [l.id, l]));
  for (const l of listings) {
    const c = cachedById.get(l.id);
    if (c) {
      l.likes = Math.max(l.likes, c.likes);
      const own = l.lastRefreshedAt ? new Date(l.lastRefreshedAt).getTime() : 0;
      const cached = c.lastRefreshedAt ? new Date(c.lastRefreshedAt).getTime() : 0;
      if (typeof c.replies === "number" && (cached > own || l.replies === undefined)) {
        l.replies = c.replies;
      }
      if (cached > own) l.lastRefreshedAt = c.lastRefreshedAt;
      if (c.authorAvatar) l.authorAvatar = c.authorAvatar;
      if (l.authorFollowers === undefined) l.authorFollowers = c.authorFollowers;
    }
  }
}

/** Two concurrent same-domain submits can leave two blobs; keep the stronger. */
function dedupeByDomain(listings: Listing[]): Listing[] {
  const byDomain = new Map<string, Listing>();
  for (const l of listings) {
    const existing = byDomain.get(l.domain);
    if (!existing || l.likes > existing.likes) byDomain.set(l.domain, l);
  }
  return [...byDomain.values()];
}

export function boardAgeSeconds(board: Board | null): number {
  if (!board) return Infinity;
  return (Date.now() - new Date(board.updatedAt).getTime()) / 1000;
}

/** Fast path for admin actions: drop moderated (or deleted) listings from the
 *  cached board without re-fetching any like counts, so the action's HTTP
 *  response doesn't wait on a full rebuild. The cached read can be up to ~60s
 *  stale, so the caller must still schedule a forced rebuild to follow. */
export async function applyModerationToBoard(
  mod: Moderation,
  dropIds: string[] = []
): Promise<void> {
  const current = await readBoard();
  if (!current) return;
  const hiddenIds = new Set([...mod.hidden, ...dropIds]);
  const listings = current.listings.filter(
    (l) => !hiddenIds.has(l.id) && !isBanned(mod, l.domain, l.authorHandle)
  );
  if (listings.length === current.listings.length) return;
  await writeBoard({
    updatedAt: current.updatedAt, // likes weren't refreshed; keep the age honest
    totalLikes: listings.reduce((s, l) => s + l.likes, 0),
    listings,
  });
}

/** Re-fetch due listings' like counts and rewrite the cached board.
 *  With `force`, every listing refreshes regardless of its schedule.
 *  Admin actions pass the moderation state they just wrote so the rebuild
 *  can't act on a stale blob read. */
export async function rebuildBoard(
  force = false,
  moderation?: Moderation
): Promise<Board> {
  const current = await readBoard();
  if (!force && current && !boardNeedsRefresh(current)) {
    return current;
  }
  const mod = moderation ?? (await readModeration());
  const hiddenIds = new Set(mod.hidden);
  const listings = dedupeByDomain(await getAllListings()).filter(
    (l) => !hiddenIds.has(l.id) && !isBanned(mod, l.domain, l.authorHandle)
  );
  overlayCachedLikes(listings, current);
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
        if (typeof t.replies === "number") l.replies = t.replies;
        if (t.authorAvatar) l.authorAvatar = t.authorAvatar;
        if (t.authorFollowers !== undefined) l.authorFollowers = t.authorFollowers;
      }
      l.lastRefreshedAt = nowIso;
    }
  }
  if (!force && current && current.listings.length > 0 && listings.length === 0) {
    return current;
  }
  // Anti-cheat: big like counts with a dead reply section get pulled off the
  // public board automatically, unless the admin marked the listing legit.
  const legitIds = new Set(mod.legit);
  const suspects = listings.filter(
    (l) => isCheatSuspect(l) && !legitIds.has(l.id)
  );
  // Suspects leave the cached board, which normally carries the live counts —
  // persist their refreshed numbers so the flag survives the next rebuild
  // (and clears itself if replies show up later).
  const dueIds = new Set(due.map((l) => l.id));
  await Promise.all(
    suspects.filter((l) => dueIds.has(l.id)).map((l) => saveListing(l))
  );
  const suspectIds = new Set(suspects.map((l) => l.id));
  const visible = listings.filter((l) => !suspectIds.has(l.id));
  const board: Board = {
    updatedAt: new Date().toISOString(),
    totalLikes: visible.reduce((s, l) => s + l.likes, 0),
    listings: sortBoard(visible),
  };
  await writeBoard(board);
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

/** Add a listing (or replace the existing listing for the same domain) and
 *  return the rank the submitter would hold. Deliberately does NOT rewrite the
 *  cached board: blob reads can be up to ~60s stale, and a submit-time board
 *  write built on a stale cache reverts fresh like counts. The next rebuild
 *  folds the new listing in from the durable blobs. */
export async function addListing(l: Listing): Promise<number> {
  const current = await readBoard();
  const listings = await getAllListings();
  overlayCachedLikes(listings, current);
  const sameDomain = listings.find(
    (x) => x.domain === l.domain && x.id !== l.id
  );
  if (
    sameDomain &&
    sameDomain.authorHandle.toLowerCase() !== l.authorHandle.toLowerCase()
  ) {
    throw new ListingConflictError(
      `${l.domain} is already on the board, listed by @${sameDomain.authorHandle}. Only the same account can replace its announcement tweet.`
    );
  }
  if (sameDomain && sameDomain.likes > l.likes) {
    throw new ListingConflictError(
      `${l.domain} is already on the board with ${sameDomain.likes} likes. A new announcement tweet can only take over once it has more likes than the current one.`
    );
  }
  await saveListing(l);
  if (sameDomain) await deleteListing(sameDomain.id);
  const next = listings.filter((x) => x.id !== l.id && x.domain !== l.domain);
  next.push(l);
  return sortBoard(next).findIndex((x) => x.id === l.id) + 1;
}

export class ListingConflictError extends Error {}
