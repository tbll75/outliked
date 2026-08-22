"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Silently re-renders the server page every `seconds` so the board feels live. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

export function TimeAgo({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span>updated just now</span>;
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  const label =
    s < 60
      ? `${s}s ago`
      : s < 3600
        ? `${Math.floor(s / 60)}m ago`
        : `${Math.floor(s / 3600)}h ago`;
  return <span>updated {label}</span>;
}
