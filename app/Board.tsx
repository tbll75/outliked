"use client";

import { Fragment, useState } from "react";
import { formatLikes, LEAGUES, leagueIdForFollowers } from "@/lib/config";
import type { Listing } from "@/lib/types";
import { Favicon } from "./Favicon";

/** Fire-and-forget click tracking; must never block the navigation. */
function trackClick(id: string) {
  try {
    const payload = JSON.stringify({ id });
    const sent = navigator.sendBeacon?.(
      "/api/click",
      new Blob([payload], { type: "application/json" })
    );
    if (!sent) {
      fetch("/api/click", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // tracking is best-effort
  }
}

const TABS = [
  { id: "all", label: "all leagues" },
  ...LEAGUES.map((l) => ({ id: l.id, label: `${l.label} followers` })),
];

function Row({
  l,
  rank,
  aboveLikes,
}: {
  l: Listing;
  rank: number;
  aboveLikes?: number;
}) {
  const medal = rank <= 3 ? `r${rank}` : "";
  const gap = aboveLikes !== undefined ? aboveLikes - l.likes + 1 : 0;
  return (
    <div
      className={`row ${medal}`}
      onClick={(e) => {
        // Inner links (rank card, author, boost) keep their own targets.
        if ((e.target as HTMLElement).closest("a")) return;
        trackClick(l.id);
        window.open(l.site, "_blank", "noopener");
      }}
    >
      <a
        className="rank"
        href={`/card/${l.domain}`}
        title="get your rank card"
      >
        {rank === 1 ? "👑" : `#${rank}`}
      </a>
      <div className="favicon">
        <Favicon domain={l.domain} hasFavicon={l.hasFavicon} />
      </div>
      <div className="row-main">
        <div className="row-name">
          <a
            href={l.site}
            target="_blank"
            rel="noopener"
            onClick={() => trackClick(l.id)}
          >
            {l.name}
          </a>
          {l.name !== l.domain && <span className="row-domain">{l.domain}</span>}
        </div>
        {l.pitch && <div className="row-pitch">{l.pitch}</div>}
      </div>
      <a
        className="row-author"
        href={l.tweetUrl}
        target="_blank"
        rel="noopener"
        title="View the announcement tweet"
      >
        {l.authorAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.authorAvatar} alt="" loading="lazy" />
        ) : null}
        @{l.authorHandle}
      </a>
      <div className="row-likes">
        <div className="likes-num">
          <span className="heart">♥</span>
          {formatLikes(l.likes)}
        </div>
        {rank === 1 ? (
          <a
            className="boost"
            href={`https://x.com/intent/like?tweet_id=${l.id}`}
            target="_blank"
            rel="noopener"
          >
            keep them #1
          </a>
        ) : (
          <a
            className="boost"
            href={`https://x.com/intent/like?tweet_id=${l.id}`}
            target="_blank"
            rel="noopener"
            title={`${gap} more like${gap === 1 ? "" : "s"} to overtake #${rank - 1}`}
          >
            ♥ boost
          </a>
        )}
      </div>
    </div>
  );
}

export function Board({ listings }: { listings: Listing[] }) {
  const [tab, setTab] = useState("all");
  const filtered =
    tab === "all"
      ? listings
      : listings.filter(
          (l) =>
            typeof l.authorFollowers === "number" &&
            leagueIdForFollowers(l.authorFollowers) === tab
        );

  return (
    <>
      <div className="league-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`league-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="league-empty">
          nobody from this league yet. the crown&apos;s just sitting there 👑
        </div>
      ) : (
        <div className="rows">
          {filtered.map((l, i) => (
            <Fragment key={l.id}>
              {i === 3 && <div className="podium-divider" aria-hidden />}
              <Row
                l={l}
                rank={i + 1}
                aboveLikes={i > 0 ? filtered[i - 1].likes : undefined}
              />
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}
