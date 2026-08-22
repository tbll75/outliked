import Link from "next/link";
import type { Metadata } from "next";
import { ListFlow } from "./ListFlow";

export const metadata: Metadata = {
  title: "list your site · outliked",
  description:
    "List your site on the outliked leaderboard for free. One tweet is the price of admission.",
};

export default function ListPage() {
  return (
    <>
      <header className="wrap">
        <nav className="nav">
          <Link href="/" className="logo">
            <span className="heart">💗</span> outliked
          </Link>
          <div className="nav-links">
            <Link href="/" className="ghost-link">
              ← back to the board
            </Link>
          </div>
        </nav>
      </header>
      <main className="submit-wrap">
        <h1 className="submit-title">
          claim your <span style={{ color: "var(--gold)" }}>spot</span>
        </h1>
        <p className="submit-sub">
          three steps. zero dollars. the tweet is the price of admission.
        </p>
        <ListFlow />
      </main>
    </>
  );
}
