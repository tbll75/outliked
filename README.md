# 💗 outliked

**The leaderboard where likes are the only currency.**

[outbid.lol](https://outbid.lol) made people pay to hold #1. outliked makes them earn it:

1. **Drop your URL, free.** Nothing else. Name and pitch are pulled from your site automatically.
2. **Post the announcement tweet.** We pre-write it; the tweet *is* your listing. No tweet, no listing.
3. **Likes decide the rank.** The most-liked announcement tweet holds 👑 #1 until someone outlikes it.

No signup, no payment, no bids. The viral loop is the product: every listing is a tweet that links back to the board, and every "boost" button is a one-click X like intent.

## How it's built

- **Next.js 15** (App Router) on **Vercel**
- **Vercel Blob** as the datastore: one immutable JSON blob per listing (keyed by tweet id, so writes never race), plus a cached `board.json` with fresh like counts
- **Like tracking**, two engines:
  - [Apify `apidojo/tweet-scraper`](https://apify.com/apidojo/tweet-scraper) (batch, robust) when `APIFY_TOKEN` is set: one actor run refreshes every listing (~$0.0004/tweet)
  - Twitter syndication CDN as a free zero-auth fallback
- **Refresh strategy**: board rebuilds in the background (`after()`) when a visitor loads a stale board (>3 min), plus a daily Vercel cron; hard-throttled to once per 90s
- **Tweet verification**: the announcement tweet just has to mention outliked (checked against tweet text, expanded URL entities, and resolved t.co redirects)
- **Anti-spam**: one listing per domain; a new tweet can only take over a domain once it out-likes the current one
- **Dynamic OG image** — live top 3 rendered into the share card (`next/og`)

## Public API

```
GET /api/leaderboard   → { updatedAt, totalLikes, listings: [...] }   (CORS open)
```

## Env vars

| var | required | purpose |
| --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | yes | Vercel Blob store (auto-added when you connect a store) |
| `APIFY_TOKEN` | no | switches like-tracking to Apify batch scraping |
| `ADMIN_KEY` | no | enables `DELETE /api/admin?id=<tweetId>` (header `x-admin-key`) for moderation |
| `NEXT_PUBLIC_APP_URL` | no | canonical URL used in prefilled tweets |

## Run locally

```bash
npm install
vercel env pull .env.local   # brings the blob token
npm run dev
```

---

Inspired by the outbid.lol trend. Built with [Claude Code](https://claude.com/claude-code).
