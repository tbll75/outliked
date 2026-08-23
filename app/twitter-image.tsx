import { OG_ALT, OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og-card";

// A real route file (not a re-export of ./opengraph-image): the bare
// `export {...} from` form made Next treat this route as dynamic, so every
// crawler fetch paid a cold serverless render instead of hitting the
// prerendered static image.
export const runtime = "nodejs";
export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default renderOgCard;
