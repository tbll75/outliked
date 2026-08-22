import { NextResponse } from "next/server";
import { rebuildBoard } from "@/lib/store";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function refresh() {
  try {
    const board = await rebuildBoard();
    return NextResponse.json({
      ok: true,
      updatedAt: board.updatedAt,
      listings: board.listings.length,
      totalLikes: board.totalLikes,
    });
  } catch (e) {
    console.error("refresh failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET() {
  return refresh();
}

export async function POST() {
  return refresh();
}
