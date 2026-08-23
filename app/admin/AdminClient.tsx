"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatLikes } from "@/lib/config";
import type { Listing } from "@/lib/types";
import type { Ban } from "@/lib/moderation";
import type { SubscriberList } from "@/lib/alerts";
import { Favicon } from "../Favicon";
import { TimeAgo } from "../live";

export type AdminRow = Listing & {
  rank: number | null;
  hidden: boolean;
  banned: boolean;
  cheat: boolean; // auto anti-cheat flag: pulled off the board
  legit: boolean; // admin exempted this listing from the anti-cheat
  subscriberCount: number;
};

type Props = {
  adminKey: string;
  rows: AdminRow[];
  bans: Ban[];
  subscriberLists: SubscriberList[];
  boardUpdatedAt: string | null;
  totalLikes: number;
};

type Tab = "submissions" | "moderation" | "subscribers";

function fmtDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AdminClient({
  adminKey,
  rows,
  bans,
  subscriberLists,
  boardUpdatedAt,
  totalLikes,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("submissions");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(payload: Record<string, string | undefined>, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setError(j?.error ?? `Request failed (${res.status}).`);
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  const hide = (id: string) => act({ action: "hide", id }, `hide:${id}`);
  const unhide = (id: string) => act({ action: "unhide", id }, `unhide:${id}`);
  const markLegit = (id: string) => act({ action: "legit", id }, `legit:${id}`);
  const unmarkLegit = (id: string) => act({ action: "unlegit", id }, `unlegit:${id}`);
  const ban = (row: AdminRow) => {
    const reason = window.prompt(
      `Ban ${row.domain} + @${row.authorHandle}?\nThis hides the listing and blocks resubmission.\n\nReason (optional):`
    );
    if (reason === null) return;
    act({ action: "ban", id: row.id, reason: reason || undefined }, `ban:${row.id}`);
  };
  const unban = (b: Ban) =>
    act({ action: "unban", domain: b.domain, handle: b.handle }, `unban:${b.domain}`);
  const del = (row: AdminRow) => {
    if (
      !window.confirm(
        `Permanently delete the listing for ${row.domain} (@${row.authorHandle})? This cannot be undone.`
      )
    )
      return;
    act({ action: "delete", id: row.id }, `delete:${row.id}`);
  };

  const hiddenCount = rows.filter((r) => r.hidden || r.banned || r.cheat).length;
  const subCount = subscriberLists.reduce((s, l) => s + l.subscribers.length, 0);
  const rowByListingId = new Map(rows.map((r) => [r.id, r]));

  return (
    <>
      <header className="wrap">
        <nav className="nav">
          <Link href="/" className="logo">
            <span className="heart">💗</span> outliked <span className="admin-badge">admin</span>
          </Link>
          <div className="nav-links">
            <Link href="/" className="ghost-link">
              ← back to the board
            </Link>
          </div>
        </nav>
      </header>

      <main className="wrap admin">
        <section className="stats admin-stats">
          <div className="stat">
            <div className="num">{rows.length}</div>
            <div className="lbl">submissions</div>
          </div>
          <div className="stat">
            <div className="num pink">♥ {formatLikes(totalLikes)}</div>
            <div className="lbl">likes in play</div>
          </div>
          <div className="stat">
            <div className="num">{hiddenCount}</div>
            <div className="lbl">hidden / banned</div>
          </div>
          <div className="stat">
            <div className="num">{subCount}</div>
            <div className="lbl">alert subscribers</div>
          </div>
        </section>

        <div className="admin-meta">
          {boardUpdatedAt ? <TimeAgo iso={boardUpdatedAt} /> : <span>no cached board</span>}
          <span> · actions rebuild the board; blob reads can lag ~1 min</span>
        </div>

        {error && <div className="admin-error">⚠ {error}</div>}

        <div className="admin-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "submissions"}
            className={tab === "submissions" ? "on" : ""}
            onClick={() => setTab("submissions")}
          >
            submissions <span className="count">{rows.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === "moderation"}
            className={tab === "moderation" ? "on" : ""}
            onClick={() => setTab("moderation")}
          >
            bans <span className="count">{bans.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === "subscribers"}
            className={tab === "subscribers" ? "on" : ""}
            onClick={() => setTab("subscribers")}
          >
            subscribers <span className="count">{subCount}</span>
          </button>
        </div>

        {tab === "submissions" && (
          <div className="admin-rows">
            {rows.length === 0 && <div className="admin-empty">no submissions yet.</div>}
            {rows.map((r) => (
              <div key={r.id} className={`admin-row ${r.hidden || r.banned || r.cheat ? "off" : ""}`}>
                <div className="admin-row-head">
                  <div className="rank">{r.rank ? `#${r.rank}` : "—"}</div>
                  <div className="favicon">
                    <Favicon domain={r.domain} hasFavicon={r.hasFavicon} />
                  </div>
                  <div className="admin-row-main">
                    <div className="row-name">
                      <a href={r.site} target="_blank" rel="noopener">
                        {r.name}
                      </a>
                      {r.banned && <span className="chip chip-ban">banned</span>}
                      {r.hidden && !r.banned && <span className="chip chip-hidden">hidden</span>}
                      {r.cheat && (
                        <span
                          className="chip chip-cheat"
                          title={`${r.likes} likes but ${r.replies} repl${r.replies === 1 ? "y" : "ies"} — auto-hidden as suspected bought likes`}
                        >
                          cheat
                        </span>
                      )}
                      {r.legit && <span className="chip chip-legit">legit ✓</span>}
                    </div>
                    {r.pitch && <div className="row-pitch">{r.pitch}</div>}
                  </div>
                  <a
                    className="row-author"
                    href={r.tweetUrl}
                    target="_blank"
                    rel="noopener"
                    title="View the announcement tweet"
                  >
                    {r.authorAvatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.authorAvatar} alt="" loading="lazy" />
                    ) : null}
                    @{r.authorHandle}
                  </a>
                  <div className="likes-num">
                    <span className="heart">♥</span>
                    {formatLikes(r.likes)}
                  </div>
                </div>
                <div className="admin-row-detail">
                  <span title="tweet id">
                    id <a href={r.tweetUrl} target="_blank" rel="noopener">{r.id}</a>
                  </span>
                  <span>site <a href={r.site} target="_blank" rel="noopener">{r.site}</a></span>
                  <span>author {r.authorName}</span>
                  <span>replies {typeof r.replies === "number" ? r.replies : "?"}</span>
                  <span>listed {fmtDate(r.createdAt)}</span>
                  <span>likes refreshed {fmtDate(r.lastRefreshedAt)}</span>
                  {r.subscriberCount > 0 && <span>🔔 {r.subscriberCount} subscriber{r.subscriberCount === 1 ? "" : "s"}</span>}
                </div>
                <div className="admin-actions">
                  {r.cheat && (
                    <button
                      className="abtn"
                      disabled={busy !== null}
                      onClick={() => markLegit(r.id)}
                      title="False positive — exempt from the anti-cheat and restore to the board"
                    >
                      {busy === `legit:${r.id}` ? "…" : "mark legit"}
                    </button>
                  )}
                  {r.legit && (
                    <button
                      className="abtn"
                      disabled={busy !== null}
                      onClick={() => unmarkLegit(r.id)}
                      title="Put this listing back under the automatic anti-cheat rule"
                    >
                      {busy === `unlegit:${r.id}` ? "…" : "re-flag"}
                    </button>
                  )}
                  {r.hidden ? (
                    <button
                      className="abtn"
                      disabled={busy !== null}
                      onClick={() => unhide(r.id)}
                    >
                      {busy === `unhide:${r.id}` ? "…" : "unhide"}
                    </button>
                  ) : (
                    <button
                      className="abtn"
                      disabled={busy !== null}
                      onClick={() => hide(r.id)}
                      title="Remove from the public board, keep the submission"
                    >
                      {busy === `hide:${r.id}` ? "…" : "hide"}
                    </button>
                  )}
                  {!r.banned && (
                    <button
                      className="abtn abtn-warn"
                      disabled={busy !== null}
                      onClick={() => ban(r)}
                      title="Hide + block this domain and account from resubmitting"
                    >
                      {busy === `ban:${r.id}` ? "…" : "ban"}
                    </button>
                  )}
                  <button
                    className="abtn abtn-danger"
                    disabled={busy !== null}
                    onClick={() => del(r)}
                    title="Permanently delete the submission"
                  >
                    {busy === `delete:${r.id}` ? "…" : "delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "moderation" && (
          <div className="admin-rows">
            {bans.length === 0 && <div className="admin-empty">no bans. peaceful times.</div>}
            {bans.map((b) => (
              <div key={`${b.domain}-${b.handle}`} className="admin-row">
                <div className="admin-row-head">
                  <div className="favicon">
                    <Favicon domain={b.domain} />
                  </div>
                  <div className="admin-row-main">
                    <div className="row-name">{b.domain}</div>
                    <div className="row-pitch">
                      @{b.handle}
                      {b.reason ? ` · ${b.reason}` : ""}
                    </div>
                  </div>
                </div>
                <div className="admin-row-detail">
                  <span>banned {fmtDate(b.createdAt)}</span>
                  {b.listingId && <span>listing {b.listingId}</span>}
                </div>
                <div className="admin-actions">
                  <button
                    className="abtn"
                    disabled={busy !== null}
                    onClick={() => unban(b)}
                    title="Lift the ban and restore the hidden listing"
                  >
                    {busy === `unban:${b.domain}` ? "…" : "unban"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "subscribers" && (
          <div className="admin-rows">
            {subscriberLists.length === 0 && (
              <div className="admin-empty">no alert subscribers yet.</div>
            )}
            {subscriberLists.map((sl) => {
              const listing = rowByListingId.get(sl.listingId);
              return (
                <div key={sl.listingId} className="admin-row">
                  <div className="admin-row-head">
                    {listing && (
                      <div className="favicon">
                        <Favicon domain={listing.domain} hasFavicon={listing.hasFavicon} />
                      </div>
                    )}
                    <div className="admin-row-main">
                      <div className="row-name">
                        {listing ? listing.domain : `listing ${sl.listingId} (deleted)`}
                      </div>
                      <div className="row-pitch">
                        {sl.subscribers.length} subscriber{sl.subscribers.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                  <div className="admin-subs">
                    {sl.subscribers.map((s) => (
                      <div key={s.email} className="admin-sub">
                        <span className="email">{s.email}</span>
                        <span>joined {fmtDate(s.createdAt)}</span>
                        <span>
                          last emailed {s.lastNotifiedAt ? fmtDate(s.lastNotifiedAt) : "never"}
                          {` · baseline #${s.lastNotifiedRank}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
