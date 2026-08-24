import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { APP_NAME, APP_URL, formatLikes } from "@/lib/config";
import { findRankedListing } from "@/lib/store";

export const dynamic = "force-dynamic";

// cache(): generateMetadata and the page share one lookup per request.
const findListing = cache((domainParam: string) =>
  findRankedListing(decodeURIComponent(domainParam).toLowerCase())
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ domain: string }>;
}): Promise<Metadata> {
  const { domain } = await params;
  const found = await findListing(domain);
  if (!found) return { title: `${APP_NAME}: rank card` };
  const { listing, rank } = found;
  const title = `${listing.domain} is #${rank} on ${APP_NAME}`;
  const description = `${formatLikes(listing.likes)} likes and counting. think you can outlike it?`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CardPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  const found = await findListing(domain);
  if (!found) notFound();
  const { listing, rank } = found;

  const tweetText = [
    `${listing.domain} is #${rank} on ${APP_NAME} with ${formatLikes(listing.likes)} likes ${rank === 1 ? "👑" : ""}`.trim(),
    ``,
    rank === 1 ? `think you can outlike the champion?` : `think you can outlike it?`,
    ``,
    `${APP_URL}/card/${listing.domain}`,
  ].join("\n");

  return (
    <>
      <header className="wrap">
        <nav className="nav">
          <Link href="/" className="logo">
            <span className="heart">💗</span> outliked
          </Link>
          <div className="nav-links">
            <Link href="/" className="ghost-link">
              ← back to the board
            </Link>
          </div>
        </nav>
      </header>
      <main className="wrap">
        <section className="card-hero">
          <div className="rank-line">{rank === 1 ? "👑 #1" : `#${rank}`}</div>
          <div className="domain-line">{listing.domain}</div>
          <div className="likes-line">
            ♥ {formatLikes(listing.likes)} likes and counting
          </div>
          <p className="by-line">
            listed by @{listing.authorHandle} · rank is the announcement
            tweet&apos;s like count. nothing else.
          </p>
          <div className="hero-cta">
            <a
              className="btn btn-primary btn-big"
              href={`https://x.com/intent/tweet?text=${encodeURIComponent(tweetText)}`}
              target="_blank"
              rel="noopener"
            >
              post it on 𝕏 📤
            </a>
            <a
              className="btn btn-outline btn-big"
              href={`https://x.com/intent/like?tweet_id=${listing.id}`}
              target="_blank"
              rel="noopener"
            >
              ♥ boost {listing.domain}
            </a>
          </div>
          <p className="hero-note">
            sharing this page shows the live rank card. it updates itself.
          </p>
        </section>
      </main>
    </>
  );
}
