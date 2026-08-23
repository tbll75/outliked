import { list, put } from "@vercel/blob";

const MODERATION_KEY = "moderation/state.json";

export type Ban = {
  domain: string;
  handle: string; // lowercase, without @
  listingId?: string; // the listing that triggered the ban, if any
  reason?: string;
  createdAt: string;
};

export type Moderation = {
  hidden: string[]; // listing ids kept in the store but excluded from the board
  bans: Ban[];
  legit: string[]; // listing ids the admin exempted from the auto anti-cheat
};

export const EMPTY_MODERATION: Moderation = { hidden: [], bans: [], legit: [] };

/** Auto anti-cheat: 100+ likes with (almost) nobody replying is the signature
 *  of bought likes — a genuinely liked launch tweet draws conversation.
 *  Listings without a known reply count are never flagged. */
export const CHEAT_MIN_LIKES = 101;
export const CHEAT_MAX_REPLIES = 2;

export function isCheatSuspect(l: { likes: number; replies?: number }): boolean {
  return (
    typeof l.replies === "number" &&
    l.likes >= CHEAT_MIN_LIKES &&
    l.replies <= CHEAT_MAX_REPLIES
  );
}

function bust(url: string): string {
  return `${url}?v=${Date.now()}`;
}

/** Read the moderation state. A missing blob means "nothing moderated yet";
 *  a transient read failure throws, so a flaky fetch can't silently un-hide
 *  or un-ban everything on the next board rebuild. */
export async function readModeration(): Promise<Moderation> {
  const { blobs } = await list({ prefix: MODERATION_KEY, limit: 1 });
  if (blobs.length === 0) return { hidden: [], bans: [], legit: [] };
  const res = await fetch(bust(blobs[0].url), { cache: "no-store" });
  if (!res.ok) throw new Error(`moderation read failed: ${res.status}`);
  const j = await res.json();
  return {
    hidden: Array.isArray(j?.hidden) ? j.hidden : [],
    bans: Array.isArray(j?.bans) ? j.bans : [],
    legit: Array.isArray(j?.legit) ? j.legit : [],
  };
}

export async function writeModeration(m: Moderation): Promise<void> {
  await put(MODERATION_KEY, JSON.stringify(m), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export function isBanned(m: Moderation, domain: string, handle: string): boolean {
  const h = handle.toLowerCase();
  const d = domain.toLowerCase();
  return m.bans.some(
    (b) => b.domain.toLowerCase() === d || b.handle.toLowerCase() === h
  );
}
