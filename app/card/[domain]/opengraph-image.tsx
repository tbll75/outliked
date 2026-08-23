import { ImageResponse } from "next/og";
import { formatLikes } from "@/lib/config";
import { getBoard } from "@/lib/store";

export const runtime = "nodejs";
export const alt = "outliked rank card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function CardImage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain: domainParam } = await params;
  const domain = decodeURIComponent(domainParam).toLowerCase();
  let rank = 0;
  let likes = 0;
  let handle = "";
  try {
    const board = await getBoard();
    const index = board.listings.findIndex((l) => l.domain === domain);
    if (index !== -1) {
      rank = index + 1;
      likes = board.listings[index].likes;
      handle = board.listings[index].authorHandle;
    }
  } catch {
    /* render a generic card */
  }

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
            fontSize: 44,
            display: "flex",
            alignItems: "center",
            gap: 12,
            color: "#8d8a99",
          }}
        >
          <span>💗</span>
          <span style={{ fontWeight: 700, color: "#f4f2f7" }}>outliked</span>
          <span>rank card</span>
        </div>
        <div
          style={{
            fontSize: 128,
            fontWeight: 800,
            letterSpacing: -8,
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 20,
          }}
        >
          {rank === 1 ? <span>👑</span> : null}
          <span style={{ color: rank === 1 ? "#ffd24c" : "#f4f2f7" }}>
            {rank > 0 ? `#${rank}` : "?"}
          </span>
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: -3,
            background: "linear-gradient(93deg, #ff2e8c, #ff5ca8, #7c5cff)",
            backgroundClip: "text",
            color: "transparent",
            display: "flex",
          }}
        >
          {domain}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 26,
            marginTop: 20,
            fontSize: 30,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "rgba(255,46,140,0.12)",
              border: "1px solid rgba(255,46,140,0.4)",
              borderRadius: 18,
              padding: "12px 26px",
              color: "#ff5ca8",
              fontWeight: 700,
            }}
          >
            ♥ {formatLikes(likes)} likes
          </span>
          {handle ? (
            <span style={{ color: "#8d8a99", display: "flex" }}>
              by @{handle}
            </span>
          ) : null}
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 26,
            fontSize: 26,
            color: "#8d8a99",
            display: "flex",
          }}
        >
          think you can outlike it? → outlike.lol
        </div>
      </div>
    ),
    size
  );
}
