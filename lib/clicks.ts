import { list, put } from "@vercel/blob";
import { readBoard } from "./store";

const CLICKS_KEY = "cache/clicks.json";

/** Tweet id -> number of site visits from the board. */
export type Clicks = Record<string, number>;

function bust(url: string): string {
  return `${url}?v=${Date.now()}`;
}

export async function readClicks(): Promise<Clicks> {
  try {
    const { blobs } = await list({ prefix: CLICKS_KEY, limit: 1 });
    if (blobs.length === 0) return {};
    const res = await fetch(bust(blobs[0].url), { cache: "no-store" });
    if (!res.ok) return {};
    return (await res.json()) as Clicks;
  } catch {
    return {};
  }
}

/** Count a click for a listing. A listing's counter is seeded on first click
 *  with (sites on the board - its current rank), so older/higher-ranked sites
 *  don't all start from a flat zero. Read-modify-write on a single blob:
 *  concurrent clicks can drop an increment, which is fine for analytics. */
export async function recordClick(id: string): Promise<number | null> {
  const board = await readBoard();
  if (!board) return null;
  const rank = board.listings.findIndex((l) => l.id === id) + 1;
  if (rank === 0) return null; // not on the public board
  const clicks = await readClicks();
  if (clicks[id] === undefined) {
    clicks[id] = Math.max(0, board.listings.length - rank);
  }
  clicks[id] += 1;
  await put(CLICKS_KEY, JSON.stringify(clicks), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  return clicks[id];
}
