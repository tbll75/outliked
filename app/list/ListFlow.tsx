"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buildAnnouncementTweet, normalizeSiteUrl } from "@/lib/config";

type Phase = "form" | "tweet" | "verify" | "done";

function fireConfetti() {
  const c = document.createElement("canvas");
  c.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:9999;width:100vw;height:100vh";
  document.body.appendChild(c);
  c.width = innerWidth;
  c.height = innerHeight;
  const ctx = c.getContext("2d")!;
  const colors = ["#ff2e8c", "#ff5ca8", "#7c5cff", "#ffd24c", "#ffffff"];
  const parts = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 13 - 3,
    s: Math.random() * 7 + 3,
    r: Math.random() * Math.PI,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  let frames = 0;
  const tick = () => {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.25;
      p.r += 0.1;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    }
    if (++frames < 140) requestAnimationFrame(tick);
    else c.remove();
  };
  tick();
}

export function ListFlow() {
  const [phase, setPhase] = useState<Phase>("form");
  const [site, setSite] = useState("");
  const [tweetText, setTweetText] = useState("");
  const [tweetUrl, setTweetUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rank, setRank] = useState(0);

  const normalized = useMemo(() => normalizeSiteUrl(site), [site]);

  // Arriving from the homepage claim bar: ?site=… prefills and skips ahead.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("site");
    if (!param) return;
    const n = normalizeSiteUrl(param);
    if (!n) return;
    setSite(param);
    setTweetText(buildAnnouncementTweet(n.domain));
    setPhase("tweet");
  }, []);

  const startTweetStep = () => {
    if (!normalized) return;
    setTweetText(buildAnnouncementTweet(normalized.domain));
    setPhase("tweet");
    setError("");
  };

  const openIntent = () => {
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(tweetText)}`,
      "_blank",
      "noopener"
    );
    setPhase("verify");
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site: normalized?.site,
          tweetUrl: tweetUrl.trim(),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setError(j.error ?? "Something went wrong. Try again.");
        return;
      }
      setRank(j.rank);
      setPhase("done");
      fireConfetti();
    } catch {
      setError("Network hiccup. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (phase === "done") {
    return (
      <div className="success-card">
        <div className="rank-big">#{rank}</div>
        <h2>you&apos;re on the board 🎉</h2>
        <p>
          your rank is your tweet&apos;s like count.
          <br />
          now go make that tweet impossible to scroll past.
        </p>
        <div className="hero-cta">
          <a
            className="btn btn-primary btn-big"
            href={tweetUrl}
            target="_blank"
            rel="noopener"
          >
            open your tweet 💗
          </a>
          <Link className="btn btn-outline btn-big" href="/">
            see the board
          </Link>
        </div>
      </div>
    );
  }

  const stepClass = (order: number) => {
    const current = phase === "form" ? 1 : phase === "tweet" ? 2 : 3;
    if (order < current) return "step-card done";
    if (order === current) return "step-card active";
    return "step-card locked";
  };

  return (
    <div className="steps">
      <div className={stepClass(1)}>
        <div className="step-head">
          <div className="step-num">1</div>
          <h3>your site</h3>
        </div>
        <div className="field">
          <label>site url</label>
          <input
            value={site}
            onChange={(e) => setSite(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && normalized) startTweetStep();
            }}
            placeholder="yoursite.com"
            autoFocus
          />
          <p className="hint">
            that&apos;s it. name and pitch come from your site automatically.
          </p>
        </div>
        {phase === "form" && (
          <button
            className="btn btn-primary"
            disabled={!normalized}
            onClick={startTweetStep}
          >
            next → write the tweet
          </button>
        )}
      </div>

      <div className={stepClass(2)}>
        <div className="step-head">
          <div className="step-num">2</div>
          <h3>post the announcement</h3>
        </div>
        {(phase === "tweet" || phase === "verify") && (
          <>
            <div className="field">
              <label>your tweet. edit it, make it yours</label>
              <textarea
                value={tweetText}
                onChange={(e) => setTweetText(e.target.value)}
              />
              <p className="hint">
                just keep &quot;outliked&quot; in it. that&apos;s how we verify
                it&apos;s real.
              </p>
            </div>
            <button className="btn btn-primary" onClick={openIntent}>
              post on 𝕏 →
            </button>
          </>
        )}
      </div>

      <div className={stepClass(3)}>
        <div className="step-head">
          <div className="step-num">3</div>
          <h3>paste the tweet link</h3>
        </div>
        {phase === "verify" && (
          <>
            <div className="field">
              <label>tweet url</label>
              <input
                value={tweetUrl}
                onChange={(e) => setTweetUrl(e.target.value)}
                placeholder="https://x.com/you/status/…"
              />
              <p className="hint">
                on your tweet: share icon → copy link. paste it here.
              </p>
            </div>
            <button
              className="btn btn-primary"
              disabled={busy || !tweetUrl.trim()}
              onClick={submit}
            >
              {busy ? "verifying…" : "verify & go live 🚀"}
            </button>
            {error && <div className="error-box">{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
