export const APP_NAME = "outliked";
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.outlike.lol";
export const APP_DOMAIN = new URL(APP_URL).hostname;
export const APP_HANDLE = "outliked";
export const SEASON = 1;
export const SEASON_END_ISO = "2026-10-01T00:00:00.000Z";

const PRIVATE_HOST_RE =
  /^(localhost|.*\.(local|internal|localhost)|\d{1,3}(\.\d{1,3}){3}|\[.*\])$/i;
const PRIVATE_IP_RE =
  /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/;

export function normalizeSiteUrl(raw: string): { site: string; domain: string } | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".")) return null;
    if (u.hostname.endsWith("t.co")) return null;
    if (PRIVATE_HOST_RE.test(u.hostname) || PRIVATE_IP_RE.test(u.hostname)) return null;
    u.protocol = "https:";
    const domain = u.hostname.replace(/^www\./, "").toLowerCase();
    u.hash = "";
    u.search = "";
    return { site: u.toString().replace(/\/$/, ""), domain };
  } catch {
    return null;
  }
}

export function formatLikes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function buildAnnouncementTweet(domain: string): string {
  return [
    `i just listed ${domain} on ${APP_NAME}, the leaderboard where likes are the only currency.`,
    ``,
    `every like on this tweet pushes it closer to #1.`,
    `do your thing 💗`,
    ``,
    `${APP_URL}`,
  ].join("\n");
}
