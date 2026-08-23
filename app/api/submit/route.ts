import { NextResponse } from "next/server";
import { after } from "next/server";
import { addListing, ListingConflictError, rebuildBoard } from "@/lib/store";
import { expandTcoLinks, fetchTweet, parseTweetUrl } from "@/lib/tweets";
import { APP_DOMAIN, APP_NAME, normalizeSiteUrl } from "@/lib/config";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { checkFavicon, fetchSitePitch } from "@/lib/site-meta";
import type { Listing } from "@/lib/types";

export const maxDuration = 60;

const SUBMITS_PER_MINUTE_PER_IP = 5;

const err = (status: number, message: string) =>
  NextResponse.json({ ok: false, error: message }, { status });

export async function POST(req: Request) {
  if (!rateLimit(`submit:${clientIp(req)}`, SUBMITS_PER_MINUTE_PER_IP)) {
    return err(429, "Too many submissions. Give it a minute.");
  }
  let body: { site?: string; tweetUrl?: string };
  try {
    body = await req.json();
  } catch {
    return err(400, "Invalid JSON body.");
  }

  const normalized = normalizeSiteUrl(body.site ?? "");
  if (!normalized) return err(400, "That site URL doesn't look right.");
  const { site, domain } = normalized;

  const tweet = parseTweetUrl(body.tweetUrl ?? "");
  if (!tweet)
    return err(
      400,
      "Paste the full link to your announcement tweet (x.com/you/status/…)."
    );

  const data = await fetchTweet(tweet.id);
  if (!data)
    return err(
      422,
      "Couldn't read that tweet. Is it public? Give it a few seconds and try again."
    );

  // The announcement has to mention outliked (name or domain) AND the listed site.
  const mentionsApp = (s: string) =>
    s.includes(APP_NAME) || s.includes(APP_DOMAIN);
  const mentionsSite = (s: string) => s.includes(domain);
  let haystack = [data.text, ...data.urls].join(" ").toLowerCase();
  if ((!mentionsApp(haystack) || !mentionsSite(haystack)) && /https:\/\/t\.co\//.test(data.text)) {
    const expanded = await expandTcoLinks(data.text);
    haystack = [haystack, ...expanded.map((u) => u.toLowerCase())].join(" ");
  }
  if (!mentionsApp(haystack))
    return err(
      422,
      `That tweet doesn't mention ${APP_NAME}. Check you pasted the link to your announcement tweet, not another one.`
    );
  if (!mentionsSite(haystack))
    return err(
      422,
      `That tweet doesn't mention ${domain}. The announcement has to name the site it's listing.`
    );

  const [pitch, hasFavicon] = await Promise.all([
    fetchSitePitch(site),
    checkFavicon(domain),
  ]);

  const listing: Listing = {
    id: data.id,
    site,
    domain,
    name: domain,
    pitch,
    tweetUrl: `https://x.com/${data.authorHandle || tweet.handle}/status/${data.id}`,
    authorHandle: data.authorHandle || tweet.handle,
    authorName: data.authorName || tweet.handle,
    authorAvatar: data.authorAvatar,
    likes: data.likes,
    createdAt: new Date().toISOString(),
    hasFavicon,
  };

  try {
    const rank = await addListing(listing);
    after(async () => {
      try {
        await rebuildBoard();
      } catch (e) {
        console.error("post-submit rebuild failed", e);
      }
    });
    return NextResponse.json({ ok: true, rank, likes: listing.likes });
  } catch (e) {
    if (e instanceof ListingConflictError) return err(409, e.message);
    console.error("submit failed", e);
    return err(500, "Something broke on our side. Try again in a minute.");
  }
}
