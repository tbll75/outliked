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
    if (u.hostname === "t.co" || u.hostname.endsWith(".t.co")) return null;
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

export const LEAGUES = [
  { id: "0-1k", label: "0–1k", min: 0, max: 1_000 },
  { id: "1k-10k", label: "1k–10k", min: 1_000, max: 10_000 },
  { id: "10k-100k", label: "10k–100k", min: 10_000, max: 100_000 },
  { id: "100k+", label: "100k+", min: 100_000, max: Infinity },
];

export function leagueIdForFollowers(followers: number): string {
  for (const league of LEAGUES) {
    if (followers < league.max) return league.id;
  }
  return LEAGUES[LEAGUES.length - 1].id;
}

/** Start of the current ranking week: Monday 00:01 America/Los_Angeles.
 *  The weekly board is simply every listing created after this instant, so
 *  the reset needs no cron — the filter moves on its own. */
export function currentWeekStartIso(now: Date = new Date()): string {
  // LA wall-clock rendered into a Date whose fields read as LA local time.
  const la = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );
  const offset = now.getTime() - la.getTime();
  const start = new Date(la);
  start.setDate(la.getDate() - ((la.getDay() + 6) % 7)); // back to Monday
  start.setHours(0, 1, 0, 0);
  return new Date(start.getTime() + offset).toISOString();
}

export function formatLikes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function buildAnnouncementTweet(domain: string): string {
  // Unique URL per announcement: X caches link cards per exact URL, so a
  // shared bare APP_URL would pin every tweet to whatever card X cached first.
  return [
    `i just listed ${domain} on ${APP_NAME}, the leaderboard where you participate by posting and win based on likes.`,
    ``,
    `every like on this tweet pushes it closer to #1.`,
    `do your thing 💗`,
    ``,
    `${APP_URL}/?via=${encodeURIComponent(domain)}`,
  ].join("\n");
}
