import { del, list, put } from "@vercel/blob";
import type { Board, Listing } from "./types";
import { fetchTweetsBatch } from "./tweets";

const LISTING_PREFIX = "listings/";
const BOARD_KEY = "cache/board.json";

/** Refresh no more often than this (seconds) no matter who asks. */
const MIN_REFRESH_SECONDS = 90;
/** A board older than this triggers a background refresh on page view. */
export const STALE_AFTER_SECONDS = 180;

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

/** Re-fetch every listing's like count and rewrite the cached board. */
export async function rebuildBoard(force = false): Promise<Board> {
  const current = await readBoard();
  if (!force && boardAgeSeconds(current) < MIN_REFRESH_SECONDS) {
    return current as Board;
  }
  const listings = await getAllListings();
  const fresh = await fetchTweetsBatch(
    listings.map((l) => ({ id: l.id, tweetUrl: l.tweetUrl }))
  );
  for (const l of listings) {
    const t = fresh.get(l.id);
    if (t) {
      l.likes = t.likes;
      if (t.authorAvatar) l.authorAvatar = t.authorAvatar;
    }
  }
  const board: Board = {
    updatedAt: new Date().toISOString(),
    totalLikes: listings.reduce((s, l) => s + l.likes, 0),
    listings: sortBoard(listings),
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
