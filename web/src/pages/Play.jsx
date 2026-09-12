import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { decodeEventLog } from "viem";
import RacksGameABI from "../contracts/RacksGameABI.json";
import { erc20Abi } from "../contracts/erc20Abi";
import { GAME_ADDRESS, TOKEN_ADDRESS, formatRacks, shortAddr } from "../config";
import { useGameData, useCountdown, useBidFeed } from "../game/hooks";
import { useBuy } from "../components/BuyModal";
import ChatPanel from "../components/ChatPanel";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Whole-number RACKS formatting without a trailing ".00" (cleaner for bid amounts).
function fmtWhole(raw) {
  const val = BigInt(raw && raw.toString ? raw.toString() : 0);
  const whole = val / 10n ** 18n;
  const frac = val % 10n ** 18n;
  return frac === 0n ? new Intl.NumberFormat("en-US").format(whole) : formatRacks(val);
}

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

function WinBanner({ round, winner, amount }) {
  return (
    <div className="win-banner">
      <h3>Bell dropped</h3>
      <p>
        Round {round?.toString()} is closed{winner ? ` — won by ${winner}` : ""}
        {amount ? ` for ${amount} $RACKS` : ""}. The next pot is live off the 2.5% reserve. The
        winner has 1 hour to claim 95% of that pot — unclaimed winnings roll into the next round.
      </p>
    </div>
  );
}

export default function Play() {
  const { address, isConnected } = useAccount();
  const d = useGameData();
  const { remaining, ready } = useCountdown(d.timeRemaining);
  const feed = useBidFeed(d.target);

  const hasBids = d.topBidder && d.topBidder !== ZERO_ADDRESS;
  const waitingFirstBid = !hasBids;
  const bellRang = waitingFirstBid && ready && remaining === 0;
  const closedRound = d.round && d.round > 1n ? d.round - 1n : d.round;

  // "Bell rang" = a bid exists somewhere (raw) but timeRemaining hit 0 (raw,
  // timeRemaining is not auto-advancing). The winner can claim straight away —
  // the contract's claim() opens the next round internally.
  const CLAIM_WINDOW = 3600n;
  const WINNER_BPS = 9500n;
  const BPS_DENOM = 10000n;
  const roundExpired = d.rawTopBidder && d.rawTopBidder !== ZERO_ADDRESS && d.timeRemaining === 0n;
  const claimDeadline = d.roundEndsAt ? d.roundEndsAt + CLAIM_WINDOW : 0n;
  const nowTs = BigInt(Math.floor(Date.now() / 1000));
  const claimWindowOpen = claimDeadline > nowTs;
  const amIWinner =
    roundExpired && !!address && d.rawTopBidder?.toLowerCase() === address.toLowerCase();
  const canClaimDirect = amIWinner && claimWindowOpen;
  const claimAmount = d.rawPotTotal ? (d.rawPotTotal * WINNER_BPS) / BPS_DENOM : 0n;

  const myClaim = d.pendingClaim;
  const hasPendingClaim = myClaim && Date.now() / 1000 < Number(myClaim.deadline);
  const claimLive = hasPendingClaim || canClaimDirect;

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

          {bellRang && (
            <WinBanner
              round={closedRound}
              winner={d.rawTopBidder && d.rawTopBidder !== ZERO_ADDRESS ? shortAddr(d.rawTopBidder) : undefined}
              amount={claimAmount > 0n ? fmtWhole(claimAmount) : undefined}
            />
          )}
        </section>

        <BidPanel
          d={d}
          connected={isConnected}
          bellRang={bellRang}
          waitingFirstBid={waitingFirstBid}
          myClaim={myClaim}
          claimLive={claimLive}
          claimRound={closedRound}
          claimAmount={claimAmount}
          pushLocalBid={feed.pushLocalBid}
        />
        <BidFeed
          d={d}
          waitingFirstBid={waitingFirstBid}
          bids={feed.bids}
          settlements={feed.settlements}
          loading={feed.loading}
          you={address}
        />
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

function BidPanel({
  d,
  connected,
  bellRang,
  waitingFirstBid,
  myClaim,
  claimLive,
  claimRound,
  claimAmount,
  pushLocalBid,
}) {
  const [racks, setRacks] = useState(1);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: d.target.id });
  const { openBuy } = useBuy();
  const chainId = d.target.id;

  const busy = phase !== "idle";
  // Your bid = the CURRENT POT + whatever you add on top. Each `rack` = 10,000
  // $RACKS. Any whole-$RACKS bid satisfies the contract's (tiny) tick rule, and
  // since the pot always holds every bid ever made, pot + 10k is always a valid
  // beat of the previous top bid.
  const TICK_RACKS = 10_000n * 10n ** 18n;
  const potTotal = d.potTotal || 0n;
  const bidAmount = potTotal + TICK_RACKS * BigInt(racks);
  const approved = d.allowance && d.allowance >= bidAmount;
  const wrongChain = connected && !d.isOnTargetChain;
  const walletLow = d.balance && d.balance < bidAmount;
  const claimRoundFor = myClaim?.round || claimRound;

  const setBid = async (action) => {
    setError(null);
    setPhase(action);
    const placeBid = async () => {
      const hash = await writeContractAsync({
        chainId,
        address: GAME_ADDRESS,
        abi: RacksGameABI,
        functionName: "bid",
        args: [bidAmount],
      });
      pushBidLog(hash);
    };
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
          await placeBid();
          break;
        case "bidding":
          await placeBid();
          break;
        case "claiming":
          await writeContractAsync({
            chainId,
            address: GAME_ADDRESS,
            abi: RacksGameABI,
            functionName: "claim",
            args: [claimRoundFor],
          });
          break;
      }
      setPhase("idle");
    } catch (e) {
      setPhase("idle");
      setError(friendlyTxError(e));
    }
  };

  // Instantly prepend the connected wallet's own bid to the feed once its tx
  // lands, so their wallet + amount show at the top of the list right away.
  const pushBidLog = async (hash) => {
    if (!hash || !pushLocalBid) return;
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const log = receipt.logs.find(
        (l) => l.address.toLowerCase() === GAME_ADDRESS.toLowerCase()
      );
      if (!log) return;
      const decoded = decodeEventLog({ abi: RacksGameABI, data: log.data, topics: log.topics });
      if (decoded.eventName === "Bid") pushLocalBid(decoded.args);
    } catch (_) {
      /* polling will pick it up */
    }
  };

  return (
    <section className="game-card">
      <h2 className="gc-title">{claimLive ? "Claim your win" : "Rack in"}</h2>

      {error && <div className="error">{error}</div>}

      {claimLive && (
        <div className="claim-box">
          <div className="claim-amount">
            <div className="lbl">Your winnings · round #{claimRoundFor?.toString()}</div>
            <div className="val">{formatRacks(myClaim?.amount || claimAmount)} $RACKS</div>
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

          <div className="next-bid">
            <span>
              <div className="lbl">Your bid</div>
              <div className="val">{fmtWhole(bidAmount)} $RACKS</div>
            </span>
          </div>

          <div className="tick-row">
            <button
              className="step-btn"
              disabled={racks <= 1}
              onClick={() => setRacks((r) => Math.max(1, r - 1))}
              aria-label="Subtract one rack"
            >
              −
            </button>
            <span className="step-note">
              Pot <b>{fmtWhole(potTotal)}</b> + {fmtWhole(TICK_RACKS * BigInt(racks))} on top
            </span>
            <button className="step-btn" onClick={() => setRacks((r) => r + 1)} aria-label="Add one rack">
              +
            </button>
          </div>

          {!approved && (
            <p className="hint sim-hint">{SIMULATION_HINT}</p>
          )}

          {approved ? (
            <button className="btn btn-primary" disabled={busy || !connected} onClick={() => setBid("bidding")}>
              {busy ? "Racking in…" : `Rack in +${fmtWhole(TICK_RACKS * BigInt(racks))} $RACKS`}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy || !connected} onClick={() => setBid("approving")}>
              {busy ? "Approving…" : `Approve, then rack in +${fmtWhole(TICK_RACKS * BigInt(racks))} $RACKS`}
            </button>
          )}
        </>
      )}

      <div className="split-note">WINNER 95% · NEXT POT 2.5% · TEAM 2.5%</div>
    </section>
  );
}

function BidFeed({ d, waitingFirstBid, bids, settlements, loading, you }) {
  const youLow = you?.toLowerCase();
  return (
    <section className="game-card feed-card">
      <h2 className="gc-title">Recent racks</h2>
      {loading ? (
        <p className="hint">Loading…</p>
      ) : bids.length === 0 && settlements.length === 0 ? (
        <p className="hint">No racks yet. Be the first.</p>
      ) : (
        <>
          {settlements.length > 0 && (
            <div className="feed-settle-section">
              <h3 className="feed-sub">Winners</h3>
              {settlements.slice(0, 5).map((s, i) => (
                <div key={`${s.round}-${s.winner}-${i}`} className="settle-item">
                  <span className="who mono">{shortAddr(s.winner)}</span>
                  <span className="amount">won {formatRacks(s.winnerAmount)} $RACKS</span>
                  <span className="dim">round #{s.round?.toString()}</span>
                </div>
              ))}
            </div>
          )}
          <ul>
            {bids.map((b, i) => (
              <li key={`${b.round}-${b.bidder}-${b.potTotal}-${i}`} className={youLow && b.bidder?.toLowerCase() === youLow ? "mine" : ""}>
                <span className="who mono">
                  {shortAddr(b.bidder)}
                  {youLow && b.bidder?.toLowerCase() === youLow && <span className="you-tag">you</span>}
                </span>
                <span className="amount">
                  +{formatRacks(b.amount)} $RACKS
                </span>
                <span className="dim">round #{b.round?.toString()}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}