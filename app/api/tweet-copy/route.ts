import { NextResponse } from "next/server";
import { generateText } from "ai";
import { APP_NAME, APP_URL, buildAnnouncementTweet, normalizeSiteUrl } from "@/lib/config";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** Body text budget: 280 minus the t.co link (23) and the blank line before it. */
const MAX_BODY_CHARS = 250;

const PROMPT = (domain: string) => `You write announcement tweets for ${APP_NAME} (outlike.lol), a leaderboard where founders list their site for free by tweeting about it. The most-liked announcement tweet holds #1, so every like on the tweet is a vote.

Write the announcement tweet body for the site "${domain}". The person posting it is the founder of ${domain}.

Hard rules:
- must contain the word "${APP_NAME}" and the domain "${domain}" verbatim (that's how the listing is verified)
- under ${MAX_BODY_CHARS} characters
- no hashtags, no @mentions, no links (the link is appended separately)
- at most one emoji, a heart if any
- all lowercase, casual builder voice, first person

Make it optimized for engagement: open with a hook (stakes, curiosity, or mild self-deprecation), make clear that likes on this exact tweet decide the ranking, and end with a light, non-cringe call to action to like it. Vary the phrasing so it doesn't read like a template. Output only the tweet body, nothing else.`;

export async function POST(req: Request) {
  if (!rateLimit(`tweet-copy:${clientIp(req)}`, 10)) {
    return NextResponse.json({ ok: false, error: "slow down" }, { status: 429 });
  }

  let site: unknown;
  try {
    site = ((await req.json()) as { site?: unknown }).site;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const normalized = typeof site === "string" ? normalizeSiteUrl(site) : null;
  if (!normalized) {
    return NextResponse.json({ ok: false, error: "site required" }, { status: 400 });
  }
  const { domain } = normalized;
  const fallback = buildAnnouncementTweet(domain);

  try {
    // gpt-5-nano: the cheap/fast tier the gateway allows without paid credits.
    // Swap to "anthropic/claude-haiku-4.5" once the team has gateway credits.
    const { text } = await generateText({
      model: "openai/gpt-5-nano",
      prompt: PROMPT(domain),
      maxOutputTokens: 1000,
      providerOptions: {
        openai: { reasoningEffort: "minimal", textVerbosity: "low" },
      },
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(8000),
    });

    const body = text.trim().replace(/^["'“”]+|["'“”]+$/g, "");
    const lower = body.toLowerCase();
    const valid =
      body.length > 0 &&
      body.length <= MAX_BODY_CHARS &&
      lower.includes(APP_NAME) &&
      lower.includes(domain) &&
      !/https?:\/\//.test(body);
    if (!valid) {
      return NextResponse.json({ ok: true, tweet: fallback, source: "fallback" });
    }

    const tweet = `${body}\n\n${APP_URL}/?via=${encodeURIComponent(domain)}`;
    return NextResponse.json({ ok: true, tweet, source: "ai" });
  } catch {
    // Gateway down, no credentials, timeout — the static template always works.
    return NextResponse.json({ ok: true, tweet: fallback, source: "fallback" });
  }
}
