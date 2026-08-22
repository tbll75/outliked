import { NextResponse } from "next/server";
import { getBoard } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const board = await getBoard();
  return NextResponse.json(board, {
    headers: { "access-control-allow-origin": "*" },
  });
}
