import { Link } from "react-router-dom";
import { useGameData, useCountdown } from "../game/hooks";
import { useBuy } from "../components/BuyModal";
import { formatRacks, shortAddr } from "../config";
import { TOKEN_CA, SWAP_LINKS, TOKEN_STATS } from "../token";

function CountdownRing({ total, remaining }) {
  const R = 48;
  const CIRC = 2 * Math.PI * R;
  const passed = Math.max(0, total - remaining);
  const pct = total > 0 ? passed / total : 0;
  const low = remaining <= 10 && total > 0;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const time = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  return (
    <div className={`ring ${low ? "low" : ""}`}>
      <svg width="116" height="116" viewBox="0 0 116 116">
        <circle className="ring-bg" cx="58" cy="58" r={R} fill="none" strokeWidth="8" />
        <circle
          className="ring-fg"
          cx="58"
          cy="58"
          r={R}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - pct)}
        />
      </svg>
      <div className="ring-center">
        <div>
          <div className="ring-time">{time}</div>
          <div className="ring-caption">{remaining === 0 && total > 0 ? "CLOSED" : low ? "FINAL" : "TO BELL"}</div>
        </div>
      </div>
    </div>
  );
}

function PotPreview() {
  const d = useGameData();
  const { remaining } = useCountdown(d.roundEndsAt);
  const hasBids = d.topBidder && d.topBidder !== "0x0000000000000000000000000000000000000000";
  const status = !hasBids ? "idle" : remaining === 0 ? "over" : "live";
  const label = d.loading ? "…" : !hasBids ? "Awaiting first rack" : remaining === 0 ? "Round settled" : "Live round";

  return (
    <div className="pot-card">
      <div className="pc-top">
        <span className="round-no mono">ROUND #{d.round?.toString() ?? "—"}</span>
        <span className={`pill ${status}`}>{label}</span>
      </div>
      <div className="pot-stage">
        <div className="pot-row" style={{ flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div className="pot-label">THE POT</div>
          <div className="pot-value">{formatRacks(d.potTotal)}</div>
          <div className="pot-unit">$RACKS</div>
        </div>
        <CountdownRing total={d.roundTime ? Number(d.roundTime) : 0} remaining={remaining} />
      </div>
      <div className="pc-stats">
        <div className="pc-stat">
          <div className="lbl">Top rack</div>
          <div className="val">{(d.topBid && formatRacks(d.topBid)) || "—"}</div>
        </div>
        <div className="pc-stat">
          <div className="lbl">Top racker</div>
          <div className="val">{hasBids ? shortAddr(d.topBidder) : "—"}</div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { openBuy } = useBuy();
  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <div>
            <span className="hero-tag">
              <span className="dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} />
              Live on Robinhood Chain
            </span>
            <h1>
              The last bid <span className="accent-text">wins the racks.</span>
            </h1>
            <p className="lead">
              RACKS is a community count-up auction for $RACKS. Everyone racks in, every bid resets
              the clock, and when the bell drops, the top racker takes 95% of the pot.
            </p>
            <div className="hero-cta">
              <Link className="btn btn-primary btn-lg" to="/play">
                Start playing
              </Link>
              <button className="btn btn-dark btn-lg" onClick={openBuy}>
                Buy $RACKS
              </button>
              <Link className="btn btn-outline btn-lg" to="/docs">
                Read the docs
              </Link>
            </div>
            <p className="hero-note">Winner 95% · 2.5% auto-seeds the next round · 2.5% team.</p>
          </div>

          <PotPreview />
        </div>
      </section>

      <section className="section section-alt" style={{ padding: "0" }}>
        <div className="container">
          <div className="split-banner" style={{ transform: "translateY(-1px)", borderRadius: "0 0 20px 20px", borderTop: "none" }}>
            <div className="split-item">
              <div className="big">2.5%</div>
              <div className="small">auto-seeds the next round</div>
            </div>
            <div className="split-item">
              <div className="big">95%</div>
              <div className="small">goes to the top racker</div>
            </div>
            <div className="split-item">
              <div className="big">2.5%</div>
              <div className="small">team treasury</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="grid cols-3">
            <div className="step">
              <div className="step-num">1</div>
              <h3>Rack in</h3>
              <p>Deposit $RACKS in whole increments. Every bid must beat the current top rack by at least one tick.</p>
            </div>
            <div className="step">
              <div className="step-num">2</div>
              <h3>Beat the clock</h3>
              <p>Each bid resets a 180-second countdown. Bids only land higher, never higher&apos;s equal.</p>
            </div>
            <div className="step">
              <div className="step-num">3</div>
              <h3>Take the pot</h3>
              <p>When the clock hits zero, the current top racker wins 95% of the entire pot. On-chain. Permissionless.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div style={{ maxWidth: 560 }}>
            <span className="eyebrow">
              <span className="dot" />
              Game specs
            </span>
            <h2 style={{ marginBottom: 16 }}>Rules are simple, funds are automatic.</h2>
            <p className="lead" style={{ fontSize: 16 }}>
              Each bid must beat the top rack by at least 10,000 $RACKS, the clock resets to 180
              seconds on every bid, and the split is 95 / 2.5 / 2.5 at the bell. No manual refills needed —
              2.5% of every settled pot automatically seeds the round that follows.
            </p>
          </div>
          <div className="grid cols-3" style={{ marginTop: 32 }}>
            <div className="card card-soft">
              <div className="stat-label">Increment tick</div>
              <div className="stat-value">10,000</div>
              <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>
                $RACKS per step, configurable by the owner.
              </p>
            </div>
            <div className="card card-soft">
              <div className="stat-label">Countdown</div>
              <div className="stat-value">180s</div>
              <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>
                Reset on every bid. Front-running neutral by design.
              </p>
            </div>
            <div className="card card-soft">
              <div className="stat-label">Settlement</div>
<div className="stat-value">95 / 2.5 / 2.5</div>
                <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>
                Winner takes 95%, 2.5% seeds next, 2.5% treasury.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="acquire-grid">
            <div className="card acquire-card">
              <span className="eyebrow">
                <span className="dot" />
                Buy $RACKS
              </span>
              <h3>One token. One game. One chain.</h3>
              <p>
                $RACKS is a fixed-supply token launched on Robinhood Chain via pons. The game is
                fully on-chain — deposits, the timer, and the payout are enforced by a verified
                smart contract, not a website. Bridge ETH for gas, then grab $RACKS from any of the
                routes below.
              </p>
              <div className="acquire-links" style={{ marginBottom: 14 }}>
                {SWAP_LINKS.map((l) => (
                  <a key={l.id} className="btn btn-dark" href={l.url} target="_blank" rel="noreferrer">
                    {l.label} ↗
                  </a>
                ))}
              </div>
              <div className="ca-row">
                <span className="mono">{TOKEN_CA}</span>
                <button className="btn btn-outline btn-sm" onClick={openBuy}>
                  View &amp; copy
                </button>
              </div>
            </div>

            <div>
              <span className="eyebrow">
                <span className="dot" />
                Token snapshot
              </span>
              <div className="grid cols-2">
                {TOKEN_STATS.map((s) => (
                  <div className="card card-hover" key={s.label}>
                    <div className="stat-label">{s.label}</div>
                    <div className="stat-value" style={{ fontSize: 24 }}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ color: "var(--faint)", fontSize: 13, marginTop: 14 }}>
                Figures mirror the pons listing. Verify the contract address before any trade.
              </p>
              <Link className="btn btn-outline btn-sm" to="/docs" style={{ marginTop: 12 }}>
                Contract docs
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}