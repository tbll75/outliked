import { createHash } from "crypto";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const GOOGLE_FAVICON_URL = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
const NO_FAVICON_PROBE_DOMAIN = "this-domain-surely-has-no-favicon-probe.com";
const FAVICON_TIMEOUT_MS = 4000;

async function fetchImageHash(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FAVICON_TIMEOUT_MS);
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

let globeHashPromise: Promise<string | null> | null = null;
function getGlobeHash(): Promise<string | null> {
  globeHashPromise ??= fetchImageHash(GOOGLE_FAVICON_URL(NO_FAVICON_PROBE_DOMAIN));
  return globeHashPromise;
}

/** True when Google has a real favicon for the domain (not its generic globe).
 *  Benefit of the doubt on any failure: the client still has a fallback. */
export async function checkFavicon(domain: string): Promise<boolean> {
  const [iconHash, globeHash] = await Promise.all([
    fetchImageHash(GOOGLE_FAVICON_URL(domain)),
    getGlobeHash(),
  ]);
  if (!iconHash) return false;
  if (!globeHash) return true;
  return iconHash !== globeHash;
}

function extractMeta(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`,
    "i"
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
  return content?.trim() || null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/** Best-effort fetch of the site's meta description for the board pitch. */
export async function fetchSitePitch(site: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    const res = await fetch(site, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: ctrl.signal,
      redirect: "follow",
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return "";
    try {
      const finalHost = new URL(res.url).hostname;
      if (/^(localhost|.*\.(local|internal|localhost))$/i.test(finalHost)) return "";
      if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(finalHost)) return "";
    } catch {
      return "";
    }
    const html = (await res.text()).slice(0, 300_000);
    const pitch =
      extractMeta(html, "og:description") ??
      extractMeta(html, "description") ??
      "";
    return decodeEntities(pitch).replace(/\s+/g, " ").trim().slice(0, 90);
  } catch {
    return "";
  }
}
