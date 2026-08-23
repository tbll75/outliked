import { NextResponse } from "next/server";
import { addSubscriber } from "@/lib/alerts";
import { getBoard } from "@/lib/store";
import { parseTweetUrl } from "@/lib/tweets";

export const maxDuration = 30;

const NEWSLETTER_ENDPOINT =
  "https://us-central1-tmaker-hub.cloudfunctions.net/newsletter-subscribe";
const NEWSLETTER_SOURCE = "outliked";
const NEWSLETTER_TAGS = ["outliked"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const err = (status: number, message: string) =>
  NextResponse.json({ ok: false, error: message }, { status });

async function joinNewsletter(email: string): Promise<void> {
  try {
    await fetch(NEWSLETTER_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        name: "",
        source: NEWSLETTER_SOURCE,
        tags: NEWSLETTER_TAGS,
      }),
      cache: "no-store",
    });
  } catch (e) {
    console.error("newsletter subscribe failed", e);
  }
}

export async function POST(req: Request) {
  let body: { email?: string; tweetUrl?: string; newsletter?: boolean };
  try {
    body = await req.json();
  } catch {
    return err(400, "Invalid JSON body.");
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return err(400, "That email doesn't look right.");

  const tweet = parseTweetUrl(body.tweetUrl ?? "");
  if (!tweet) return err(400, "Missing or invalid tweet link.");

  const board = await getBoard();
  const index = board.listings.findIndex((l) => l.id === tweet.id);
  if (index === -1) return err(404, "That listing isn't on the board.");

  try {
    await addSubscriber(tweet.id, email, index + 1);
  } catch {
    return err(429, "Too many subscribers for this listing.");
  }

  if (body.newsletter) await joinNewsletter(email);

  return NextResponse.json({ ok: true });
}
