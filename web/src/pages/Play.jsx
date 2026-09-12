import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import RacksGameABI from "../contracts/RacksGameABI.json";
import { erc20Abi } from "../contracts/erc20Abi";
import { GAME_ADDRESS, TOKEN_ADDRESS, formatRacks, shortAddr } from "../config";
import { useGameData, useCountdown, useBidFeed } from "../game/hooks";
import { useBuy } from "../components/BuyModal";
import ChatPanel from "../components/ChatPanel";

const TICK_MULTIPLES = [1, 2, 5, 10, 25];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function CountdownRing({ total, remaining, ready, awaiting }) {
  const R = 48;
  const CIRC = 2 * Math.PI * R;
  const r = ready && remaining != null ? remaining : 0;
  const passed = Math.max(0, total - r);
  const pct = total > 0 ? passed / total : 0;
  const low = r <= 10 && total > 0;
  const mins = Math.floor(r / 60);
  const secs = r % 60;
  const time = ready ? `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : "—:—";
  const closed = ready && total > 0 && r === 0;
  const caption = !ready ? "SYNCING" : awaiting ? "AWAITING" : closed ? "CLOSED" : low ? "FINAL" : "TO BELL";

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
          <div className="ring-caption">{caption}</div>
        </div>
      </div>
    </div>
  );
}

function WinBanner({ round }) {
  return (
    <div className="win-banner">
      <h3>Bell dropped</h3>
      <p>
        Round {round?.toString()} is closed and the next pot is live off the 2.5% reserve. The
        winner has 1 hour to claim 95% of that pot — unclaimed winnings roll into the next round.
      </p>
    </div>
  );
}

export default function Play() {
  const { isConnected } = useAccount();
  const d = useGameData();
  const { remaining, ready } = useCountdown(d.timeRemaining);

  const hasBids = d.topBidder && d.topBidder !== ZERO_ADDRESS;
  const waitingFirstBid = !hasBids;
  const bellRang = waitingFirstBid && ready && remaining === 0;
  const closedRound = d.round && d.round > 1n ? d.round - 1n : d.round;

  const myClaim = d.pendingClaim;
  const claimLive = myClaim && Date.now() / 1000 < Number(myClaim.deadline);

  const pill = claimLive
    ? { status: "won", label: "You won — claim!" }
    : d.loading
    ? { status: "idle", label: "Loading…" }
    : waitingFirstBid
    ? { status: "idle", label: bellRang ? "Round settled" : "Awaiting first rack" }
    : { status: "live", label: "Live round" };

  return (
    <div className="play-layout">
      {!d.configured && (
        <div className="banner warn">
          Game contract not configured. Set <span className="mono">VITE_RACKS_GAME</span> and{" "}
          <span className="mono">VITE_RACKS_TOKEN</span> in <span className="mono">web/.env</span> to play.
        </div>
      )}

      <div className="play-grid">
        <section className="game-card hero-card">
          <div className="gc-head">
            <span className="round-no mono">ROUND #{d.round?.toString() ?? "—"}</span>
            <span className={`pill ${pill.status}`}>{pill.label}</span>
          </div>

          <div className="pot-stage">
            <div className="pot-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
              <div className="pot-label">The pot</div>
              <div className="pot-value">{formatRacks(d.potTotal)}</div>
              <div className="pot-unit">$RACKS</div>
            </div>
            <CountdownRing
              total={d.roundTime ? Number(d.roundTime) : 0}
              remaining={remaining}
              ready={ready}
              awaiting={waitingFirstBid && !bellRang}
            />
          </div>

          <div className="top-wrap">
            <div className="card-soft pc-stat">
              <div className="lbl">Top rack</div>
              <div className="val">{waitingFirstBid ? "—" : `${formatRacks(d.topBid)} $RACKS`}</div>
            </div>
            <div className="card-soft pc-stat">
              <div className="lbl">Top racker</div>
              <div className="val">{waitingFirstBid ? "—" : shortAddr(d.topBidder)}</div>
            </div>
          </div>

          {bellRang && <WinBanner round={closedRound} />}
        </section>

        <BidPanel
          d={d}
          connected={isConnected}
          bellRang={bellRang}
          waitingFirstBid={waitingFirstBid}
          myClaim={myClaim}
          claimLive={claimLive}
        />
        <BidFeed d={d} waitingFirstBid={waitingFirstBid} />
        <ChatPanel />
      </div>
    </div>
  );
}

const SIMULATION_HINT =
  'Robinhood Chain is new, so your wallet may show "Simulation failed" before signing. The approval is verified on-chain and safe — tap "Proceed anyway" / "Sign" in your wallet to continue.';

function friendlyTxError(e) {
  const msg = e?.shortMessage || e?.message || "";
  if (/simulat/i.test(msg) || /39000/.test(msg)) {
    return "Simulation error: " + SIMULATION_HINT;
  }
  return msg || "Transaction failed";
}

function BidPanel({ d, connected, bellRang, waitingFirstBid, myClaim, claimLive }) {
  const [multiple, setMultiple] = useState(1);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const { writeContractAsync } = useWriteContract();
  const { openBuy } = useBuy();
  const chainId = d.target.id;

  const busy = phase !== "idle";
  const topBid = d.topBid || 0n;
  // Contract tick is 10_000 wei (~1e-14 $RACKS), which is below display precision,
  // so we step the multiplier in whole $RACKS (any whole-token amount is a valid
  // multiple of the contract tick).
  const STEP = 10n ** 18n;
  const bidAmount = topBid + STEP * BigInt(multiple);
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
        case "claiming":
          await writeContractAsync({
            chainId,
            address: GAME_ADDRESS,
            abi: RacksGameABI,
            functionName: "claim",
            args: [myClaim.round],
          });
          break;
      }
      setPhase("idle");
    } catch (e) {
      setPhase("idle");
      setError(friendlyTxError(e));
    }
  };

  return (
    <section className="game-card">
      <h2 className="gc-title">{claimLive ? "Claim your win" : "Rack in"}</h2>

      {error && <div className="error">{error}</div>}

      {claimLive && (
        <div className="claim-box">
          <div className="claim-amount">
            <div className="lbl">Your winnings · round #{myClaim.round?.toString()}</div>
            <div className="val">{formatRacks(myClaim.amount)} $RACKS</div>
          </div>
          <button className="btn btn-primary" disabled={busy || !connected} onClick={() => setBid("claiming")}>
            {busy ? "Claiming…" : "CLAIM YOUR $RACKS"}
          </button>
          <p className="hint">
            Winners can claim within 1 hour of the bell. Unclaimed winnings roll into the next
            round&apos;s pot.
          </p>
        </div>
      )}

      {!connected ? (
        <div>
          <p className="hint">
            {claimLive ? "Connect your wallet to claim your winnings." : "Connect your wallet to start raking."}
          </p>
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
            Balance too low to bid. You have <span className="mono">{formatRacks(d.balance)} $RACKS</span> — grab
            more, then rack in.
          </p>
          <div className="buy-hint">
            <button className="btn btn-primary" onClick={openBuy}>
              Buy $RACKS
            </button>
            <span className="hint">Bridge ETH for gas on Robinhood Chain first.</span>
          </div>
        </div>
      ) : (
        <>
          {claimLive && (
            <p className="hint">
              Claimed? You can still rack into the live round below.
            </p>
          )}
          {waitingFirstBid && (
            <p className="hint">
              {bellRang
                ? "New round is live — the first bid starts the countdown."
                : "Place the first bid to start the countdown."}
            </p>
          )}

          {d.balance != null && (
            <div className="next-bid">
              <span>
                <div className="lbl">Your balance</div>
                <div className="val">{formatRacks(d.balance)} $RACKS</div>
              </span>
            </div>
          )}

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

          {!approved && (
            <p className="hint sim-hint">{SIMULATION_HINT}</p>
          )}

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