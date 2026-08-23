import { NextResponse } from "next/server";
import { notifySignificantRankChanges } from "@/lib/alerts";
import { rebuildBoard } from "@/lib/store";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function refresh(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const board = await rebuildBoard(true);
    try {
      await notifySignificantRankChanges(board);
    } catch (e) {
      console.error("rank alerts failed", e);
    }
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

export async function GET(req: Request) {
  return refresh(req);
}

export async function POST(req: Request) {
  return refresh(req);
}
