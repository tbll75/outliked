import { timingSafeEqual } from "crypto";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAllListings, readBoard } from "@/lib/store";
import { readClicks } from "@/lib/clicks";
import {
  EMPTY_MODERATION,
  isBanned,
  isCheatSuspect,
  readModeration,
} from "@/lib/moderation";
import { getAllSubscriberLists } from "@/lib/alerts";
import { AdminClient, type AdminRow } from "./AdminClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "admin · outliked",
  robots: { index: false, follow: false },
};

function keyMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;
  if (!keyMatches(key, process.env.ADMIN_KEY)) notFound();

  const [listings, board, moderation, subscriberLists, clicks] = await Promise.all([
    getAllListings().catch(() => []),
    readBoard(),
    readModeration().catch(() => EMPTY_MODERATION),
    getAllSubscriberLists().catch(() => []),
    readClicks(),
  ]);

  // The cached board carries the live like counts and the public ranking;
  // the listing blobs carry everything, including entries the board excludes.
  const boardById = new Map(board?.listings.map((l, i) => [l.id, { l, rank: i + 1 }]) ?? []);
  const hidden = new Set(moderation.hidden);
  const legit = new Set(moderation.legit);
  const subsByListing = new Map(subscriberLists.map((s) => [s.listingId, s.subscribers.length]));

  const rows: AdminRow[] = listings
    .map((l) => {
      const onBoard = boardById.get(l.id);
      const likes = Math.max(l.likes, onBoard?.l.likes ?? 0);
      const replies = onBoard?.l.replies ?? l.replies;
      return {
        ...l,
        likes,
        replies,
        lastRefreshedAt: onBoard?.l.lastRefreshedAt ?? l.lastRefreshedAt,
        authorAvatar: onBoard?.l.authorAvatar || l.authorAvatar,
        rank: onBoard?.rank ?? null,
        hidden: hidden.has(l.id),
        banned: isBanned(moderation, l.domain, l.authorHandle),
        cheat: isCheatSuspect({ likes, replies }) && !legit.has(l.id),
        legit: legit.has(l.id),
        subscriberCount: subsByListing.get(l.id) ?? 0,
        clicks: clicks[l.id] ?? 0,
      };
    })
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.likes - a.likes);

  return (
    <AdminClient
      adminKey={key!}
      rows={rows}
      bans={moderation.bans}
      subscriberLists={subscriberLists}
      boardUpdatedAt={board?.updatedAt ?? null}
      totalLikes={board?.totalLikes ?? 0}
    />
  );
}
