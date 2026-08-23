import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { deleteListing, rebuildBoard } from "@/lib/store";

export const maxDuration = 60;

function keyMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function DELETE(req: Request) {
  if (!keyMatches(req.headers.get("x-admin-key"), process.env.ADMIN_KEY)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await deleteListing(id);
  await rebuildBoard(true);
  return NextResponse.json({ ok: true });
}
