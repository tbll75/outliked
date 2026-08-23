import { NextResponse } from "next/server";
import { recordClick } from "@/lib/clicks";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const err = (status: number, message: string) =>
  NextResponse.json({ ok: false, error: message }, { status });

export async function POST(req: Request) {
  if (!rateLimit(`click:${clientIp(req)}`, 30)) {
    return err(429, "slow down");
  }
  let id: unknown;
  try {
    id = ((await req.json()) as { id?: unknown }).id;
  } catch {
    return err(400, "Invalid JSON body.");
  }
  if (typeof id !== "string" || !/^\d{1,25}$/.test(id)) {
    return err(400, "id required");
  }
  const clicks = await recordClick(id);
  if (clicks === null) return err(404, "listing not found");
  return NextResponse.json({ ok: true, clicks });
}
