import { NextResponse } from "next/server";
import { after } from "next/server";
import { scoutLaunchTweets } from "@/lib/scout";
import { rebuildBoard } from "@/lib/store";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function scout(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  try {
    const result = await scoutLaunchTweets(dryRun);
    // One line per run in the Vercel logs: what was scanned, added, skipped.
    console.log("scout run", JSON.stringify({ dryRun, ...result }));
    if (!dryRun && result.added.length > 0) {
      after(async () => {
        try {
          await rebuildBoard();
        } catch (e) {
          console.error("post-scout rebuild failed", e);
        }
      });
    }
    return NextResponse.json({ ok: true, dryRun, ...result });
  } catch (e) {
    console.error("scout failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return scout(req);
}

export async function POST(req: Request) {
  return scout(req);
}
