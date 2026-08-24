import Link from "next/link";
import { after } from "next/server";
import { boardNeedsRefresh, getBoard, rebuildBoard } from "@/lib/store";
import { formatLikes } from "@/lib/config";
import { Board } from "./Board";
import { AutoRefresh } from "./live";
import { ClaimBar } from "./ClaimBar";

export const dynamic = "force-dynamic";

export default async function Home() {
  const board = await getBoard();
  if (boardNeedsRefresh(board)) {
    after(async () => {
      try {
        await rebuildBoard();
      } catch (e) {
        console.error("background refresh failed", e);
      }
    });
  }
  const { listings } = board;

  return (
    <>
      <header className="wrap">
        <nav className="nav">
          <Link href="/" className="logo">
            <span className="heart">💗</span> outliked
          </Link>
          <div className="nav-links">
            <a className="ghost-link" href="#how">
              how it works
            </a>
            <Link href="/list" className="btn btn-primary">
              list your site, free
            </Link>
          </div>
        </nav>
      </header>

      <main className="wrap">
        <section className="hero">
          <h1>
            get <span className="grad">outliked</span>
            <br />
            or get famous
          </h1>
          <p className="hero-sub">
            <b>Likes are the only currency.</b> List free, tweet it — the
            most-liked tweet holds <b>#1</b>.
          </p>
          <ClaimBar />
          <p className="hero-note">
            no signup · no payment · one tweet and you&apos;re live
          </p>
        </section>

        <section className="stats">
          <div className="stat">
            <div className="num">{listings.length}</div>
            <div className="lbl">sites listed</div>
          </div>
          <div className="stat">
            <div className="num pink">♥ {formatLikes(board.totalLikes)}</div>
            <div className="lbl">likes in play</div>
          </div>
          <div className="stat">
            <div className="num">$0</div>
            <div className="lbl">spent, ever</div>
          </div>
        </section>

        <section className="board" id="board">
          {listings.length === 0 ? (
            <div className="empty">
              <div className="big">👑</div>
              <h3>nobody has claimed #1 yet</h3>
              <p>
                the first listing takes the crown with a single like.
                <br />
                this is the cheapest #1 will ever be.
              </p>
              <ClaimBar />
            </div>
          ) : (
            <Board listings={listings} updatedAt={board.updatedAt} />
          )}
        </section>

        <section className="how" id="how">
          <h2>how it works</h2>
          <div className="how-grid">
            <div className="how-card">
              <div className="step">STEP 1</div>
              <h3>Drop your link 🔗</h3>
              <p>
                Just your URL. We pull the name and pitch from your site
                automatically. Takes 10 seconds, costs nothing.
              </p>
            </div>
            <div className="how-card">
              <div className="step">STEP 2</div>
              <h3>Tweet the announcement 📣</h3>
              <p>
                We pre-write the tweet for you. Post it. That tweet <i>is</i>{" "}
                your listing. No tweet, no listing.
              </p>
            </div>
            <div className="how-card">
              <div className="step">STEP 3</div>
              <h3>Get liked or get outliked 💗</h3>
              <p>
                Every like on your tweet is a vote. Most-liked tweet holds #1
                until someone outlikes it. Rally your people.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <p>
            likes are the only currency. <b>outliked</b>, season 1.
          </p>
          <div className="foot-row">
            <a href="https://github.com/tbll75/outliked" target="_blank" rel="noopener">
              open source
            </a>
            <a href="/api/leaderboard" target="_blank">
              public api
            </a>
            <span>
              inspired by outbid.lol · built by{" "}
              <a href="https://x.com/tibo_maker" target="_blank" rel="noopener">
                tibo_maker
              </a>{" "}
              · ai tweets idea by{" "}
              <a href="https://x.com/aidancramer" target="_blank" rel="noopener">
                aidancramer
              </a>
            </span>
          </div>
        </div>
      </footer>
      <AutoRefresh seconds={60} />
    </>
  );
}
