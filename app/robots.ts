import type { MetadataRoute } from "next";

// Explicit allow-all: without this, /robots.txt is an HTML 404 page.
// X's Twitterbot checks robots.txt before fetching card images.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
  };
}
