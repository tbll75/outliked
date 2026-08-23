import { timingSafeEqual } from "crypto";
import { after, NextResponse } from "next/server";
import {
  applyModerationToBoard,
  deleteListing,
  getAllListings,
  rebuildBoard,
} from "@/lib/store";
import { readModeration, writeModeration } from "@/lib/moderation";

export const maxDuration = 60;

function keyMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(req: Request): boolean {
  const provided =
    req.headers.get("x-admin-key") ?? new URL(req.url).searchParams.get("key");
  return keyMatches(provided, process.env.ADMIN_KEY);
}

const err = (status: number, message: string) =>
  NextResponse.json({ ok: false, error: message }, { status });

type AdminAction = {
  action: "hide" | "unhide" | "ban" | "unban" | "delete" | "legit" | "unlegit";
  id?: string; // listing / tweet id
  domain?: string; // unban target
  handle?: string; // unban target
  reason?: string;
};

export async function POST(req: Request) {
  if (!authorized(req)) return err(401, "unauthorized");
  let body: AdminAction;
  try {
    body = await req.json();
  } catch {
    return err(400, "Invalid JSON body.");
  }

  const mod = await readModeration();

  switch (body.action) {
    case "hide": {
      if (!body.id) return err(400, "id required");
      if (!mod.hidden.includes(body.id)) mod.hidden.push(body.id);
      break;
    }
    case "unhide": {
      if (!body.id) return err(400, "id required");
      mod.hidden = mod.hidden.filter((h) => h !== body.id);
      break;
    }
    case "ban": {
      if (!body.id) return err(400, "id required");
      const listing = (await getAllListings()).find((l) => l.id === body.id);
      if (!listing) return err(404, "listing not found");
      if (!mod.hidden.includes(listing.id)) mod.hidden.push(listing.id);
      const exists = mod.bans.some(
        (b) =>
          b.domain === listing.domain &&
          b.handle.toLowerCase() === listing.authorHandle.toLowerCase()
      );
      if (!exists) {
        mod.bans.push({
          domain: listing.domain,
          handle: listing.authorHandle.toLowerCase(),
          listingId: listing.id,
          reason: body.reason?.slice(0, 300) || undefined,
          createdAt: new Date().toISOString(),
        });
      }
      break;
    }
    case "unban": {
      const before = mod.bans.length;
      const lifted = mod.bans.filter(
        (b) =>
          (body.domain && b.domain === body.domain) ||
          (body.handle && b.handle.toLowerCase() === body.handle.toLowerCase())
      );
      mod.bans = mod.bans.filter((b) => !lifted.includes(b));
      if (mod.bans.length === before) return err(404, "no matching ban");
      // Restore the listing the ban had hidden, so unban is a full undo.
      const restore = new Set(
        lifted.map((b) => b.listingId).filter((id): id is string => !!id)
      );
      mod.hidden = mod.hidden.filter((h) => !restore.has(h));
      break;
    }
    case "delete": {
      if (!body.id) return err(400, "id required");
      await deleteListing(body.id);
      mod.hidden = mod.hidden.filter((h) => h !== body.id);
      mod.legit = mod.legit.filter((h) => h !== body.id);
      break;
    }
    // Anti-cheat override: "legit" exempts a listing from the auto cheat
    // filter, "unlegit" puts it back under the automatic rule.
    case "legit": {
      if (!body.id) return err(400, "id required");
      if (!mod.legit.includes(body.id)) mod.legit.push(body.id);
      break;
    }
    case "unlegit": {
      if (!body.id) return err(400, "id required");
      mod.legit = mod.legit.filter((h) => h !== body.id);
      break;
    }
    default:
      return err(400, "unknown action");
  }

  await writeModeration(mod);
  // Fast path: rewrite the cached board with the moderated listing filtered
  // out, without waiting on the ~25s full rebuild (Apify like refresh).
  const dropIds = body.action === "delete" && body.id ? [body.id] : [];
  await applyModerationToBoard(mod, dropIds);
  // Full rebuild runs after the response is sent. Pass the state we just
  // wrote: a fresh blob read can lag ~60s behind.
  after(async () => {
    try {
      await rebuildBoard(true, mod);
    } catch (e) {
      console.error("admin: async board rebuild failed", e);
    }
  });
  return NextResponse.json({ ok: true });
}

// Kept for backwards compatibility with the original curl-based admin flow.
export async function DELETE(req: Request) {
  if (!authorized(req)) return err(401, "unauthorized");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return err(400, "id required");
  await deleteListing(id);
  const mod = await readModeration();
  await applyModerationToBoard(mod, [id]);
  after(async () => {
    try {
      await rebuildBoard(true, mod);
    } catch (e) {
      console.error("admin: async board rebuild failed", e);
    }
  });
  return NextResponse.json({ ok: true });
}
