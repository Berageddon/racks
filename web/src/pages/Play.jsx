import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import RacksGameABI from "../contracts/RacksGameABI.json";
import { erc20Abi } from "../contracts/erc20Abi";
import { GAME_ADDRESS, TOKEN_ADDRESS, formatRacks, shortAddr } from "../config";
import { useGameData, useCountdown, useBidFeed } from "../game/hooks";
import { useBuy } from "../components/BuyModal";
import ChatPanel from "../components/ChatPanel";

const TICK_MULTIPLES = [1, 2, 5, 10, 25];

function CountdownRing({ total, remaining }) {
  const R = 48;
  const CIRC = 2 * Math.PI * R;
  const passed = Math.max(0, total - remaining);
  const pct = total > 0 ? passed / total : 0;
  const low = remaining <= 10 && total > 0;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const time = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  const closed = total > 0 && remaining === 0;

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
          <div className="ring-caption">{closed ? "CLOSED" : low ? "FINAL" : "TO BELL"}</div>
        </div>
      </div>
    </div>
  );
}

function WinBanner({ winner, round }) {
  return (
    <div className="win-banner">
      <h3>Round {round?.toString()} close</h3>
      <p>
        <span className="mono">{shortAddr(winner)}</span> takes 95% of the pot. The next round
        auto-seeds from the 2.5% reserve.
      </p>
    </div>
  );
}

export default function Play() {
  const { isConnected } = useAccount();
  const d = useGameData();
  const { remaining } = useCountdown(d.roundEndsAt);

  const hasBids = d.topBidder && d.topBidder !== "0x0000000000000000000000000000000000000000";
  const roundOver = hasBids && remaining === 0;
  const waitingFirstBid = !hasBids;
  const status = waitingFirstBid ? "idle" : roundOver ? "over" : "live";
  const label = d.loading ? "Loading…" : waitingFirstBid ? "Awaiting first rack" : roundOver ? "Round settled" : "Live round";

  return (
    <div className="play-layout">
      {!d.configured && (
        <div className="banner warn">
          Game contract not configured. Set <span className="mono">VITE_RACKS_GAME</span> and{" "}
          <span className="mono">VITE_RACKS_TOKEN</span> in <span className="mono">web/.env</span> to play.
        </div>
      )}
      {d.paused && <div className="banner warn">The game is paused. Bidding is currently disabled by the owner.</div>}

      <div className="play-grid">
        <section className="game-card hero-card">
          <div className="gc-head">
            <span className="round-no mono">ROUND #{d.round?.toString() ?? "—"}</span>
            <span className={`pill ${status}`}>{label}</span>
          </div>

          <div className="pot-stage">
            <div className="pot-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
              <div className="pot-label">The pot</div>
              <div className="pot-value">{formatRacks(d.potTotal)}</div>
              <div className="pot-unit">$RACKS</div>
            </div>
            <CountdownRing total={d.roundTime ? Number(d.roundTime) : 0} remaining={remaining} />
          </div>

          <div className="top-wrap">
            <div className="card-soft pc-stat">
              <div className="lbl">Top rack</div>
              <div className="val">{formatRacks(d.topBid)} $RACKS</div>
            </div>
            <div className="card-soft pc-stat">
              <div className="lbl">Top racker</div>
              <div className="val">{waitingFirstBid ? "—" : shortAddr(d.topBidder)}</div>
            </div>
          </div>

          {roundOver && <WinBanner winner={d.topBidder} round={d.round} />}
        </section>

        <BidPanel d={d} connected={isConnected} roundOver={roundOver} waitingFirstBid={waitingFirstBid} />
        <BidFeed d={d} waitingFirstBid={waitingFirstBid} />
        <ChatPanel />
      </div>
    </div>
  );
}

function BidPanel({ d, connected, roundOver, waitingFirstBid }) {
  const [multiple, setMultiple] = useState(1);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const { writeContractAsync } = useWriteContract();
  const { openBuy } = useBuy();
  const chainId = d.target.id;

  const tick = d.tick || 0n;
  const topBid = d.topBid || 0n;
  const bidAmount = topBid + tick * BigInt(multiple);
  const approved = d.allowance && d.allowance >= bidAmount;
  const wrongChain = connected && !d.isOnTargetChain;
  const walletLow = d.balance && d.balance < bidAmount;

  const setBid = async (action) => {
    setError(null);
    setPhase(action);
    try {
      switch (action) {
        case "approving":
          await writeContractAsync({
            chainId,
            address: TOKEN_ADDRESS,
            abi: erc20Abi,
            functionName: "approve",
            args: [GAME_ADDRESS, BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")],
          });
          setPhase("bidding");
          await writeContractAsync({
            chainId,
            address: GAME_ADDRESS,
            abi: RacksGameABI,
            functionName: "bid",
            args: [bidAmount],
          });
          break;
        case "bidding":
          await writeContractAsync({
            chainId,
            address: GAME_ADDRESS,
            abi: RacksGameABI,
            functionName: "bid",
            args: [bidAmount],
          });
          break;
        case "settle":
          await writeContractAsync({
            chainId,
            address: GAME_ADDRESS,
            abi: RacksGameABI,
            functionName: "settle",
            args: [],
          });
          break;
      }
      setPhase("idle");
    } catch (e) {
      setPhase("idle");
      setError(e?.shortMessage || e?.message || "Transaction failed");
    }
  };

  const busy = phase !== "idle";

  return (
    <section className="game-card">
      <h2 className="gc-title">{roundOver ? "Settle the round" : "Rack in"}</h2>

      {error && <div className="error">{error}</div>}

      {d.paused ? (
        <p className="hint">Hush — the game is paused right now.</p>
      ) : !connected ? (
        <div>
          <p className="hint">Connect your wallet to start raking.</p>
          <div className="buy-hint">
            <button className="btn btn-primary" onClick={openBuy}>
              Buy $RACKS
            </button>
            <span className="hint">New here? Grab $RACKS first.</span>
          </div>
        </div>
      ) : wrongChain ? (
        <p className="hint">
          Wrong network — switch to <b>{d.target.name}</b> in Robinhood Wallet.
        </p>
      ) : walletLow ? (
        <div>
          <p className="hint">
            Balance too low. You have <span className="mono">{formatRacks(d.balance)} $RACKS</span> — grab
            more, then rack in.
          </p>
          <div className="buy-hint">
            <button className="btn btn-primary" onClick={openBuy}>
              Buy $RACKS
            </button>
            <span className="hint">Bridge ETH for gas on Robinhood Chain first.</span>
          </div>
        </div>
      ) : roundOver ? (
        <button className="btn btn-primary" disabled={busy} onClick={() => setBid("settle")}>
          {busy ? "Settling…" : "Settle the bell"}
        </button>
      ) : (
        <>
          <div className="ticks">
            {TICK_MULTIPLES.map((m) => (
              <button
                key={m}
                className={`tick-btn ${m === multiple ? "active" : ""}`}
                onClick={() => setMultiple(m)}
              >
                +{m}×
              </button>
            ))}
          </div>

          <div className="next-bid">
            <span>
              <div className="lbl">Your bid</div>
              <div className="val">{formatRacks(bidAmount)} $RACKS</div>
            </span>
          </div>

          {approved ? (
            <button className="btn btn-primary" disabled={busy || !connected} onClick={() => setBid("bidding")}>
              {busy ? "Racking in…" : "Rack in"}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy || !connected} onClick={() => setBid("approving")}>
              {busy ? "Approving…" : "Approve $RACKS, then rack in"}
            </button>
          )}
        </>
      )}

      <div className="split-note">WINNER 95% · NEXT POT 2.5% · TEAM 2.5%</div>
    </section>
  );
}

function BidFeed({ d, waitingFirstBid }) {
  const { bids, loading } = useBidFeed(d.target);
  return (
    <section className="game-card feed-card">
      <h2 className="gc-title">Recent racks</h2>
      {loading ? (
        <p className="hint">Loading…</p>
      ) : bids.length === 0 ? (
        <p className="hint">No racks yet. Be the first.</p>
      ) : (
        <ul>
          {bids.map((b, i) => (
            <li key={`${b.round}-${b.bidder}-${b.topBid}-${i}`}>
              <span className="who mono">{shortAddr(b.bidder)}</span>
              <span className="amount">
                +{formatRacks(b.amount)} $RACKS
              </span>
              <span className="dim">round #{b.round?.toString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}