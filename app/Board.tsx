"use client";

import { Fragment, useMemo, useState } from "react";
import {
  currentWeekStartIso,
  formatLikes,
  LEAGUES,
  leagueIdForFollowers,
} from "@/lib/config";
import type { Listing } from "@/lib/types";
import { Favicon } from "./Favicon";
import { TimeAgo } from "./live";

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

const PER_PAGE = 50;

/** Page numbers to render: 1 … around current … last, à la classic pagers. */
function pageItems(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((p) => wanted.add(p));
  if (current >= total - 2)
    [total - 3, total - 2, total - 1].forEach((p) => wanted.add(p));
  const sorted = [...wanted]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push("…");
    out.push(sorted[i]);
  }
  return out;
}

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

export function Board({
  listings,
  updatedAt,
}: {
  listings: Listing[];
  updatedAt: string;
}) {
  const [tab, setTabState] = useState("all");
  const [scope, setScopeState] = useState<"all" | "week">("all");
  const [page, setPage] = useState(1);
  const setTab = (id: string) => {
    setTabState(id);
    setPage(1);
  };
  const setScope = (s: "all" | "week") => {
    setScopeState(s);
    setPage(1);
  };
  // Weekly board: everything listed since Monday 00:01 PT, re-ranked among
  // itself. Fresh listings compete only with this week's crop, so newcomers
  // get a winnable board every week while all-time stays the default.
  const weekStart = useMemo(() => currentWeekStartIso(), []);
  const scoped =
    scope === "week"
      ? listings.filter((l) => l.createdAt >= weekStart)
      : listings;
  const filtered =
    tab === "all"
      ? scoped
      : scoped.filter(
          (l) =>
            typeof l.authorFollowers === "number" &&
            leagueIdForFollowers(l.authorFollowers) === tab
        );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PER_PAGE;
  const paged = filtered.slice(start, start + PER_PAGE);
  const goTo = (p: number) => {
    setPage(p);
    // instant: the page-height jump makes smooth scrolling disorienting
    document.getElementById("board")?.scrollIntoView({ behavior: "instant" });
  };
  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <>
      <div className="board-head">
        <div className="board-title">
          <h2>the board</h2>
          <div className="scope-switch">
            <button
              className={scope === "all" ? "on" : ""}
              onClick={() => setScope("all")}
            >
              👑 all time
            </button>
            <button
              className={scope === "week" ? "on" : ""}
              onClick={() => setScope("week")}
            >
              ⚡ this week
            </button>
          </div>
        </div>
        <div className="board-meta">
          <span className="live-dot" />
          {scope === "week" ? (
            <>fresh board every monday 00:01 PT</>
          ) : (
            <>
              <TimeAgo iso={updatedAt} /> · likes update automatically
            </>
          )}
        </div>
      </div>
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
          {scope === "week"
            ? "nobody's listed this week yet. cleanest shot at #1 you'll ever get 👑"
            : "nobody from this league yet. the crown's just sitting there 👑"}
        </div>
      ) : (
        <div className="rows">
          {paged.map((l, i) => {
            const idx = start + i;
            return (
              <Fragment key={l.id}>
                {idx === 3 && <div className="podium-divider" aria-hidden />}
                <Row
                  l={l}
                  rank={idx + 1}
                  aboveLikes={idx > 0 ? filtered[idx - 1].likes : undefined}
                />
              </Fragment>
            );
          })}
        </div>
      )}
      {totalPages > 1 && (
        <>
          <div className="pager">
            <button
              className="pager-arrow"
              disabled={safePage === 1}
              onClick={() => goTo(safePage - 1)}
              aria-label="previous page"
            >
              ‹
            </button>
            {pageItems(safePage, totalPages).map((it, i) =>
              it === "…" ? (
                <span key={`e${i}`} className="pager-ellipsis">
                  …
                </span>
              ) : (
                <button
                  key={it}
                  className={`pager-num ${it === safePage ? "active" : ""}`}
                  onClick={() => goTo(it)}
                >
                  {it}
                </button>
              )
            )}
            <button
              className="pager-arrow"
              disabled={safePage === totalPages}
              onClick={() => goTo(safePage + 1)}
              aria-label="next page"
            >
              ›
            </button>
          </div>
          <div className="pager-count">
            {fmt(start + 1)} – {fmt(Math.min(start + PER_PAGE, filtered.length))}{" "}
            of {fmt(filtered.length)}
          </div>
        </>
      )}
    </>
  );
}
