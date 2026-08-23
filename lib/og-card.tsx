import { ImageResponse } from "next/og";
import { getBoard } from "@/lib/store";
import { formatLikes } from "@/lib/config";

export const OG_ALT =
  "outliked: the leaderboard where likes are the only currency";
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export async function renderOgCard() {
  let top: { name: string; likes: number }[] = [];
  try {
    const board = await getBoard();
    top = board.listings.slice(0, 3).map((l) => ({ name: l.name, likes: l.likes }));
  } catch {
    /* render without data */
  }
  const medals = ["🥇", "🥈", "🥉"];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background:
            "linear-gradient(135deg, #07070c 0%, #12081a 55%, #1a0712 100%)",
          color: "#f4f2f7",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            fontSize: 118,
            fontWeight: 800,
            letterSpacing: -6,
            display: "flex",
            alignItems: "center",
            gap: 24,
          }}
        >
          <span>💗</span>
          <span
            style={{
              background: "linear-gradient(93deg, #ff2e8c, #ff5ca8, #7c5cff)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            outliked
          </span>
        </div>
        <div style={{ fontSize: 34, color: "#b7b3c4", marginTop: 6, display: "flex" }}>
          the leaderboard where likes are the only currency
        </div>
        {top.length > 0 ? (
          <div style={{ display: "flex", gap: 26, marginTop: 48 }}>
            {top.map((t, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 18,
                  padding: "16px 26px",
                  fontSize: 28,
                }}
              >
                <span>{medals[i]}</span>
                <span style={{ fontWeight: 700 }}>{t.name}</span>
                <span style={{ color: "#ff5ca8" }}>♥ {formatLikes(t.likes)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              marginTop: 48,
              fontSize: 30,
              color: "#ffd24c",
              display: "flex",
              background: "rgba(255,210,76,0.1)",
              border: "1px solid rgba(255,210,76,0.4)",
              borderRadius: 18,
              padding: "16px 32px",
            }}
          >
            👑 #1 is unclaimed. list your site free
          </div>
        )}
        <div
          style={{
            position: "absolute",
            bottom: 34,
            fontSize: 24,
            color: "#8d8a99",
            display: "flex",
          }}
        >
          no bids · no money · one tweet and you&apos;re live
        </div>
      </div>
    ),
    OG_SIZE
  );
}
