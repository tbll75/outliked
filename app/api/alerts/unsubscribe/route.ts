import { removeSubscriber } from "@/lib/alerts";

export const maxDuration = 30;

const page = (message: string) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>outliked</title></head>` +
      `<body style="font-family:system-ui;background:#0d0b12;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">` +
      `<p>${message}</p></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );

export async function GET(req: Request) {
  const url = new URL(req.url);
  const listing = url.searchParams.get("listing") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!listing || !token) return page("that unsubscribe link looks broken.");
  const removed = await removeSubscriber(listing, token);
  return page(
    removed
      ? "done — no more rank emails for this listing. 💗"
      : "you were already unsubscribed."
  );
}
