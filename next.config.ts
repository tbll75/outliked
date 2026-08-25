import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // outlike.lol/weekly: the homepage with the weekly board pre-selected —
    // the URL the @outlike_lol bot links in its replies.
    return [{ source: "/weekly", destination: "/?scope=week" }];
  },
};

export default nextConfig;
