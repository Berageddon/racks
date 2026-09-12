import { useEffect, useState } from "react";
import GitHubIcon from "../components/GitHubIcon";
import { GITHUB_REPO_URL, ADERYN_REPORT_URL, SLITHER_REPORT_URL, AUDIT_CI_URL } from "../config";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "how-to-play", label: "How to play" },
  { id: "mechanics", label: "Game mechanics" },
  { id: "contract", label: "Smart contract" },
  { id: "token", label: "$RACKS token" },
  { id: "security", label: "Security" },
  { id: "deploy", label: "Deploying the game" },
  { id: "faq", label: "FAQ" },
];

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function DocsNav() {
  const [active, setActive] = useState("overview");

  useEffect(() => {
    const onScroll = () => {
      let current = "overview";
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 120) current = s.id;
      }
      setActive(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <aside className="docs-nav">
      <h4>Docs</h4>
      <ul>
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className={active === s.id ? "active" : ""} onClick={(e) => { e.preventDefault(); scrollTo(s.id); }}>
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default function Docs() {
  return (
    <div className="docs">
      <DocsNav />
      <div className="docs-content">
        <Overview />
        <HowToPlay />
        <Mechanics />
        <Contract />
        <Token />
        <Security />
        <Deploy />
        <Faq />
      </div>
    </div>
  );
}

function Overview() {
  return (
    <section id="overview">
      <h2>Overview</h2>
      <p>
        RACKS is a count-up, all-pay auction played with the $RACKS token on Robinhood Chain. Users
        bid in fixed increments to hold the top spot. Every bid resets a countdown. When the
        countdown expires, the current top racker wins 95% of the pot; 2.5% automatically seeds the
        next round and 2.5% goes to the operating treasury.
      </p>
      <p>
        The game runs entirely on-chain. Deposits, tick enforcement, the countdown, and payouts are
        enforced by a single EVM smart contract. The website is only an interface — anyone can
        interact with the contract directly through any EVM wallet.
      </p>
      <div className="docs-callout">
        <b>TL;DR</b> — Rack in higher than everyone else. Be the last one holding the top bid when
        the clock hits zero. Take 95% of the pot.
      </div>
    </section>
  );
}

function HowToPlay() {
  return (
    <section id="how-to-play">
      <h2>How to play</h2>
      <ol>
        <li>
          <b>Get $RACKS.</b> The token is available on Robinhood Chain. Bridge ETH for gas, then trade
          for $RACKS on the DEX where the pair is listed.
        </li>
        <li>
          <b>Connect.</b> Open the app with Robinhood Wallet or any EVM-connected wallet on Robinhood
          Chain (chain ID <span className="mono">4663</span>).
        </li>
        <li>
          <b>Approve.</b> One-time approval lets the game contract spend your $RACKS.
        </li>
        <li>
          <b>Rack in.</b> Submit a bid that beats the current top rack by at least one tick. Pick a
          multiplier (+1×, +5×…) to jump ahead.
        </li>
        <li>
          <b>Win or retry.</b> If your bid is topped, your $RACKS stays in the pot — raise it again
          before the bell drops. If nobody else bids in time, you take 95% of the pot.
        </li>
      </ol>
      <div className="docs-callout warn">
        Bids are <b>non-refundable</b> (all-pay). Every amount you bid goes into the pot. This is a
        game of skill and timing — play only with what you can afford to lose.
      </div>
    </section>
  );
}

function Mechanics() {
  return (
    <section id="mechanics">
      <h2>Game mechanics</h2>
      <p>All values are enforced by the contract and fixed at deployment.</p>

      <div className="table-wrap">
        <table className="doc">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Default</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">tick</td>
              <td>10,000 $RACKS</td>
              <td>Minimum increment. Bids must be whole multiples of tick and at least one tick above the current top bid.</td>
            </tr>
            <tr>
              <td className="mono">roundTime</td>
              <td>180 seconds</td>
              <td>Countdown from the last bid. Resets on every accepted bid.</td>
            </tr>
            <tr>
              <td className="mono">Winner take</td>
              <td>95%</td>
              <td>Of the pot at the bell, reserved for the top bidder and claimed by them within the claim window.</td>
            </tr>
            <tr>
              <td className="mono">Claim window</td>
              <td>1 hour</td>
              <td>Winner must claim their 95% within one hour of the bell; otherwise it rolls into the next round's pot.</td>
            </tr>
            <tr>
              <td className="mono">Next-round reserve</td>
              <td>2.5%</td>
              <td>Banked automatically and used to seed the following round's starting pot the moment the bell drops.</td>
            </tr>
            <tr>
              <td className="mono">Treasury</td>
              <td>2.5%</td>
              <td>Sent to the configured dev/treasury wallet when the winner claims; forfeited shares accumulate and are paid out with the next claim.</td>
            </tr>
            <tr>
              <td className="mono">Seed</td>
              <td>Owner-managed</td>
              <td>The owner seeds a round before the first bid. Later rounds self-seed from the reserve.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>Round lifecycle</h3>
      <ol>
        <li>
          <b>Open</b> — no bids yet. The pot may already contain the owner&apos;s seed and the
          countdown has not started. The first bid — at least one tick — starts the timer.
        </li>
        <li>
          <b>Live</b> — bids land, each beating the last by ≥ 1 tick, each resetting the 180s clock.
        </li>
        <li>
          <b>Bell</b> — the clock expires. The round is decided instantly and the next round is
          already live, seeded by the 2.5% reserve. There is nothing to settle.
        </li>
        <li>
          <b>Claim</b> — the winner calls <span className="mono">claim(round)</span> within one hour
          to receive 95%. The treasury receives that round&apos;s 2.5% in the same transaction. If the
          winner never claims, their 95% rolls into the next round&apos;s pot and the treasury share
          is banked, then paid out on the next successful claim.
        </li>
      </ol>
    </section>
  );
}

function Contract() {
  return (
    <section id="contract">
      <h2>Smart contract</h2>
      <p>
        The game is a single contract: <span className="mono">RacksGame</span> (Solidity 0.8.24).
        It inherits OpenZeppelin&apos;s <span className="mono">Ownable</span> and{" "}
        <span className="mono">ReentrancyGuard</span>. Game rules (tick, countdown, dev wallet) are fixed at deployment and immutable.
      </p>

      <h3>Deployed addresses</h3>
      <div className="table-wrap">
        <table className="doc">
          <thead>
            <tr>
              <th>Network</th>
              <th>Chain ID</th>
              <th>RacksGame</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Robinhood Chain</td>
              <td className="mono">4663</td>
              <td className="mono">
                <a href="https://robinhoodchain.blockscout.com/address/0x92B0E6aAdeE33E559a0285e315d015Ab4793211C" target="_blank" rel="noreferrer">
                  0x92B0E6aAdeE33E559a0285e315d015Ab4793211C
                </a>
              </td>
            </tr>
            <tr>
              <td>Robinhood Chain Testnet</td>
              <td className="mono">46630</td>
              <td className="mono">pending</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Addresses are written to <span className="mono">deployed-&lt;network&gt;.json</span> after a
        successful <span className="mono">npm run deploy</span> and verified on Blockscout. Confirm a
        live address on the explorer before interacting.
      </p>

      <h3>Player-facing functions</h3>
      <div className="table-wrap">
        <table className="doc">
          <thead>
            <tr>
              <th>Function</th>
              <th>Access</th>
              <th>Effect</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">bid(uint256 amount)</td>
              <td>Anyone</td>
              <td>Pulls $RACKS via allowance, enforces tick + top-bid rules, resets the countdown. After the bell it auto-orders the next round and lands as its first bid.</td>
            </tr>
            <tr>
              <td className="mono">claim(uint256 settledRound)</td>
              <td>Winner only</td>
              <td>Within 1 hour of the bell, pays the winner 95% and the treasury that round&apos;s 2.5%, including any forfeited shares banked from earlier rounds.</td>
            </tr>
            <tr>
              <td className="mono">effectiveRound()</td>
              <td>View</td>
              <td>The live round number — advances automatically the moment the bell drops, no transaction needed.</td>
            </tr>
            <tr>
              <td className="mono">effectivePotTotal()</td>
              <td>View</td>
              <td>The live round&apos;s pot, already seeded from the reserve and any forfeited winnings.</td>
            </tr>
            <tr>
              <td className="mono">pendingClaimOf(address)</td>
              <td>View</td>
              <td>Returns any claim currently reserved for a wallet: round, amount, deadline, and whether it exists.</td>
            </tr>
            <tr>
              <td className="mono">timeRemaining()</td>
              <td>View</td>
              <td>Seconds left in the current round; the full round time while it awaits its first bid, 0 at the bell.</td>
            </tr>
            <tr>
              <td className="mono">isRoundLive()</td>
              <td>View</td>
              <td>True while bids are accepted.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>Owner functions</h3>
      <div className="table-wrap">
        <table className="doc">
          <thead>
            <tr>
              <th>Function</th>
              <th>Effect</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">seed(uint256)</td>
              <td>Adds owner $RACKS to the opening pot of a not-yet-started round.</td>
            </tr>
            <tr>
              <td className="mono">rescueTokens(address,uint256)</td>
              <td>Recovers tokens other than $RACKS accidentally sent to the contract.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>Events</h3>
      <div className="code">
        <div><span className="cmd">event</span> Bid(uint256 indexed round, address indexed bidder, uint256 amount, uint256 topBid, uint256 potTotal, uint256 roundEndsAt);</div>
        <div><span className="cmd">event</span> RoundStarted(uint256 indexed round, uint256 potTotal);</div>
        <div><span className="cmd">event</span> RoundSettled(uint256 indexed round, address indexed winner, uint256 potTotal, uint256 winnerAmount, uint256 devAmount, uint256 nextPot);</div>
        <div><span className="cmd">event</span> WinnerClaimed(uint256 indexed round, address indexed winner, uint256 winnerAmount, uint256 devAmount);</div>
        <div><span className="cmd">event</span> WinnerForfeited(uint256 indexed round, uint256 winnerAmount, uint256 devAmount);</div>
        <div><span className="cmd">event</span> Seeded(uint256 indexed round, uint256 amount, uint256 potTotal);</div>
      </div>
    </section>
  );
}

function Token() {
  return (
    <section id="token">
      <h2>$RACKS token</h2>
      <p>
        $RACKS is the game currency. It is a fixed-supply token launched on Robinhood Chain — no
        minting function exists, so the game contract cannot inflate the supply. The token pair is
        listed on Robinhood Chain DEXs, with trading fees set at launch (see the pons listing for
        the current tax schedule).
      </p>
      <div className="table-wrap">
        <table className="doc">
          <thead>
            <tr>
              <th>Property</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Name</td>
              <td>RACKS</td>
            </tr>
            <tr>
              <td>Symbol</td>
              <td className="mono">$RACKS</td>
            </tr>
            <tr>
              <td>Chain</td>
              <td>Robinhood Chain (L2, Arbitrum), chain ID 4663</td>
            </tr>
            <tr>
              <td>Standard</td>
              <td className="mono">ERC-20</td>
            </tr>
            <tr>
              <td>Expected supply</td>
              <td>1,000,000,000</td>
            </tr>
            <tr>
              <td>Minting</td>
              <td>None (fixed supply)</td>
            </tr>
            <tr>
              <td>Launch</td>
              <td>Pons launchpad (liquidity locked at launch)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="docs-callout">
        The game has <b>zero transfer tax of its own</b>. Only token-level trading taxes configured at
        launch apply, and they never touch pot balances.
      </div>
    </section>
  );
}

function Security() {
  return (
    <section id="security">
      <h2>Security</h2>
      <ul>
        <li>
          <b>Verified &amp; published source.</b> The deployed bytecode matches its verified source
          on Blockscout —{" "}
          <a href="https://robinhoodchain.blockscout.com/address/0x92B0E6aAdeE33E559a0285e315d015Ab4793211C" target="_blank" rel="noreferrer">
            0x92B0E6aAdeE33E559a0285e315d015Ab4793211C
          </a>{" "}
          — so anyone can cross-check the rules before playing.
        </li>
        <li>
          <b>Pull-based winner payouts.</b> Winners claim their 95% through <span className="mono">claim()</span>{" "}
          within a 1-hour window; the round always auto-advances, so the game never waits for a claim.
          All external calls are guarded by <span className="mono">ReentrancyGuard</span> and obey
          checks-effects-interactions.
        </li>
        <li>
          <b>No minting.</b> The game only moves user-deposited $RACKS; it can never create tokens.
        </li>
        <li>
          <b>No custody.</b> Funds live in the public contract. Anyone can verify balances on Blockscout.
        </li>
        <li>
          <b>Immutable rules.</b> The owner can only seed the pot and recover non-game tokens — tick,
          countdown, and dev wallet are fixed at deployment and can never be changed mid-game.
        </li>
        <li>
          <b>Tick math is integer-exact.</b> Splits use basis points (9500/250/250) with no
          truncated-value loss.
        </li>
        <li>
          <b>Rescue is scoped.</b> <span className="mono">rescueTokens</span> refuses to move $RACKS,
          so pot balances can never be rug-pulled via a rescue call.
        </li>
      </ul>
      <div className="docs-callout">
        <b>Audit status</b> — the contract passes automated static analysis with{" "}
        <b>Slither</b> (Trail of Bits) and <b>Cyfrin Aderyn</b>, re-run on every push in public CI.
        Every finding either scanner raised was reviewed line-by-line; remaining entries are false
        positives or accepted design trade-offs, annotated in the reports below.
      </div>
      <ul className="audit-links">
        <li>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
            <GitHubIcon size={15} />
            Source code on GitHub
          </a>
        </li>
        <li>
          <a href={ADERYN_REPORT_URL} target="_blank" rel="noreferrer">
            Aderyn report
          </a>
        </li>
        <li>
          <a href={SLITHER_REPORT_URL} target="_blank" rel="noreferrer">
            Slither report
          </a>
        </li>
        <li>
          <a href={AUDIT_CI_URL} target="_blank" rel="noreferrer">
            Audit CI status
          </a>
        </li>
      </ul>
      <div className="docs-callout warn">
        Automated scanning is not a substitute for a professional human audit, and on-chain games
        carry real financial risk — play only with funds you can afford to lose. The repository and
        reports are public so the contract can be reviewed by anyone before participating.
      </div>
    </section>
  );
}

function Deploy() {
  return (
    <section id="deploy">
      <h2>Deploying the game</h2>
      <p>
        Anyone can deploy their own instance. The repo ships a Hardhat setup pre-wired for Robinhood
        Chain testnet and mainnet.
      </p>
      <div className="code">
        <div><span className="cmd">npm</span> install</div>
        <div><span className="cmd">cp</span> .env.example .env   <span className="cmd">#</span> set PRIVATE_KEY + RACKS_TOKEN_ADDRESS</div>
        <div><span className="cmd">npm</span> run compile</div>
        <div><span className="cmd">npm</span> test</div>
        <div><span className="cmd">npm</span> run deploy:testnet   <span className="cmd">#</span> chain 46630</div>
        <div><span className="cmd">npm</span> run verify:testnet</div>
        <div><span className="cmd">npm</span> run deploy:mainnet   <span className="cmd">#</span> chain 4663</div>
      </div>
      <div className="table-wrap">
        <table className="doc">
          <thead>
            <tr>
              <th>Env var</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">PRIVATE_KEY</td>
              <td>Deployer key — must hold ETH for gas on the target network.</td>
            </tr>
            <tr>
              <td className="mono">RACKS_TOKEN_ADDRESS</td>
              <td>The $RACKS ERC-20 the game accepts.</td>
            </tr>
            <tr>
              <td className="mono">GAME_DEV_WALLET</td>
              <td>Receives the 2.5% treasury share (defaults to deployer).</td>
            </tr>
            <tr>
              <td className="mono">RH_MAINNET_RPC_URL / RH_TESTNET_RPC_URL</td>
              <td>RPC endpoints (sensible defaults included).</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Testnet ETH and faucet details are available at{" "}
        <a href="https://faucet.testnet.chain.robinhood.com" style={{ color: "var(--accent)", textDecoration: "underline" }} target="_blank" rel="noreferrer">
          faucet.testnet.chain.robinhood.com
        </a>
        .
      </p>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq">
      <h2>FAQ</h2>
      <h3>What happens if the round closes and no one wins?</h3>
      <p>
        A round without any bid is a non-starter: the seed stays in place and the first bid opens it
        and starts the countdown. A round only ever has a winner once at least one bid landed and the
        clock expired.
      </p>
      <h3>What if the winner never claims?</h3>
      <p>
        After the 1-hour claim window closes, the winner&apos;s 95% is forfeited and rolls into the
        next round&apos;s pot, while that round&apos;s 2.5% treasury share is banked and paid out on the
        next successful claim. The game itself always keeps rolling — no claim ever blocks the next
        round.
      </p>
      <h3>Can the owner take the pot?</h3>
      <p>
        No. The owner cannot transfer $RACKS out of the contract except as part of the scheduled
        dev share. The only owner lever over the pot is seeding a fresh round.
      </p>
      <h3>Can I bid less than the top bid?</h3>
      <p>
        No. The contract reverts any bid that isn&apos;t a whole multiple of the tick and at least one
        tick above the current top bid.
      </p>
      <h3>Who pays the gas for the winner claim?</h3>
      <p>
        The winner. Payouts are pull-based and only the winner can call{" "}
        <span className="mono">claim()</span>, so the winner&apos;s wallet covers the gas for the
        transaction that releases both their 95% and that round&apos;s 2.5% treasury share. The
        treasury never needs to act — it is paid automatically in the same transaction.
      </p>
      <h3>Do I get money back if I get outbid?</h3>
      <p>
        No — this is an all-pay auction. Every bid stays in the pot. That&apos;s what makes it a game,
        and it&apos;s why the same 95% final split can dwarf individual bids as the pot compounds.
      </p>
      <h3>How does the next round get its seed?</h3>
      <p>
        2.5% of every pot is banked as a reserve and automatically becomes the opening pot of the
        following round the moment the bell drops — plus any winnings forfeited by unclaimed prior
        rounds. No manual feeding is required after launch.
      </p>
      <h3>What network do I use?</h3>
      <p>
        Robinhood Chain mainnet, chain ID <span className="mono">4663</span>. Robinhood Wallet
        connects natively; any EVM wallet works with the standard RPC.
      </p>
    </section>
  );
}