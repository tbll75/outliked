import { NextResponse } from "next/server";
import { deleteListing, rebuildBoard } from "@/lib/store";

export const maxDuration = 60;

export async function DELETE(req: Request) {
  const key = process.env.ADMIN_KEY;
  if (!key || req.headers.get("x-admin-key") !== key) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await deleteListing(id);
  await rebuildBoard(true);
  return NextResponse.json({ ok: true });
}
