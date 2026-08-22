import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import { APP_URL } from "@/lib/config";
import "./globals.css";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
});

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: "outliked — the leaderboard where likes are the only currency",
  description:
    "List your site for free. Post the announcement tweet. The most-liked tweet holds #1. No bids, no money — just likes.",
  openGraph: {
    title: "outliked",
    description:
      "The leaderboard where likes are the only currency. List your site free — the most-liked announcement tweet holds #1.",
    url: APP_URL,
    siteName: "outliked",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "outliked — get outliked or get famous",
    description:
      "List your site for free. Post the tweet. Likes decide who's #1.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={grotesk.variable}>
      <body>{children}</body>
    </html>
  );
}
