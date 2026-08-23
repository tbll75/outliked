"use client";

import { useState } from "react";

/** Google's s2 service returns its generic 16px globe (HTTP 200) when a site
 *  has no favicon; anything at or below this size is treated as missing. */
const GOOGLE_FALLBACK_MAX_PX = 16;

export function Favicon({ domain, hasFavicon }: { domain: string; hasFavicon?: boolean }) {
  const [failed, setFailed] = useState(false);

  if (hasFavicon === false || failed) {
    return (
      <span className="favicon-letter" aria-hidden="true">
        {domain[0]?.toUpperCase() ?? "•"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      onLoad={(e) => {
        if (e.currentTarget.naturalWidth <= GOOGLE_FALLBACK_MAX_PX) {
          setFailed(true);
        }
      }}
    />
  );
}
