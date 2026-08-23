"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { normalizeSiteUrl } from "@/lib/config";

export function ClaimBar({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [site, setSite] = useState("");
  const ok = Boolean(normalizeSiteUrl(site));

  const go = () => {
    if (!ok) return;
    router.push(`/list?site=${encodeURIComponent(site.trim())}`);
  };

  return (
    <div className="claim-bar">
      <input
        value={site}
        onChange={(e) => setSite(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go();
        }}
        placeholder="yoursite.com"
        autoFocus={autoFocus}
        aria-label="your site url"
      />
      <button className="btn btn-primary" disabled={!ok} onClick={go}>
        claim your spot 💗
      </button>
    </div>
  );
}
