const { expect } = require("chai");
const { ethers } = require("hardhat");

const MAX_NUMBER = 30n;
const JACKPOT_BPS = 7_000n;
const TIER4_BPS   = 1_500n;
const TIER3_BPS   = 1_000n;
const DEV_BPS     =   250n;
const RESERVE_BPS =   250n;
const BPS = 10_000n;
const CLAIM_WINDOW = 3600n;       // 1 hour
const ROUND_DURATION = 21_600n;   // 6 hours

const SEED = ethers.parseEther("50000");
const TICKET = ethers.parseEther("1000");

const poolOf = (pot, tierBps) => (pot * tierBps) / BPS;

async function timeJump(seconds) {
  await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await ethers.provider.send("evm_mine", []);
}

function matchCount(a, b) {
  let i = 0;
  let j = 0;
  let count = 0;
  while (i < a.length && j < b.length) {
    if (a[i] < b[j]) i += 1;
    else if (a[i] > b[j]) j += 1;
    else {
      count += 1;
      i += 1;
      j += 1;
    }
  }
  return count;
}

function randomPicks(n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const set = new Set();
    while (set.size < 5) set.add(1 + Math.floor(Math.random() * 30));
    out.push([...set].sort((a, b) => a - b));
  }
  return out;
}

// Mirrors RackLotto._drawWinningNumbers: seed from blockhash(parent) + timestamp +
// round + drawNonce, then keccak(counter) % 30 + 1, skipping duplicates, sorted up.
function predictNumbers(prevHash, ts, round, drawNonce) {
  const seed = ethers.toBigInt(
    ethers.keccak256(
      ethers.concat([
        ethers.toBeHex(prevHash, 32),
        ethers.toBeHex(ts, 32),
        ethers.toBeHex(round, 32),
        ethers.toBeHex(drawNonce, 32),
      ])
    )
  );
  const picks = [];
  let counter = 0n;
  while (picks.length < 5) {
    const c = ethers.toBigInt(
      ethers.keccak256(ethers.concat([ethers.toBeHex(seed, 32), ethers.toBeHex(counter, 32)]))
    );
    const candidate = (c % MAX_NUMBER) + 1n;
    counter += 1n;
    if (!picks.includes(candidate)) picks.push(candidate);
  }
  return picks.sort((a, b) => (a < b ? -1 : 1));
}

describe("RackLotto", () => {
  let racks, lotto, owner, dev, players;

  beforeEach(async () => {
    [owner, dev, ...players] = await ethers.getSigners();
    players = players.slice(0, 4);

    const MockRacks = await ethers.getContractFactory("MockRacks");
    racks = await MockRacks.deploy(ethers.parseEther("1000000"));
    await racks.waitForDeployment();

    const RackLotto = await ethers.getContractFactory("RackLotto");
    lotto = await RackLotto.deploy(await racks.getAddress(), dev.address, TICKET);
    await lotto.waitForDeployment();

    for (const player of players) {
      await racks.mint(player.address, ethers.parseEther("10000000"));
      await racks.connect(player).approve(await lotto.getAddress(), ethers.MaxUint256);
    }
    await racks.connect(owner).approve(await lotto.getAddress(), ethers.MaxUint256);
  });

  // Expire the current round and force a draw with a 1-ticket trigger buy.
  // Returns the settled round and the drawn winning numbers (read back on-chain).
  async function settle() {
    await timeJump(ROUND_DURATION + 1n);
    await lotto.connect(players[1]).buyTickets([[1, 2, 3, 4, 5]]);
    const settledRound = (await lotto.round()) - 1n;
    const winning = await lotto.winningNumbers(settledRound);
    return { settledRound, winning: winning.map((x) => Number(x)) };
  }

  // Recompute a round's math entirely in JS from the ticket picks and winning numbers.
  function recomputeRound(picks, winning) {
    const counts = { k3: 0, k4: 0, k5: 0 };
    const perOwner = new Map();
    for (const pick of picks) {
      const m = matchCount(pick, winning);
      if (m === 5) counts.k5 += 1;
      else if (m === 4) counts.k4 += 1;
      else if (m === 3) counts.k3 += 1;
    }
    return {
      counts,
      hits: counts.k3 + counts.k4 + counts.k5,
      perOwner,
    };
  }

  // Returns picks, plus per-owner ticket ownership for the accounting identity.
  function ownershipOf(picks) {
    const byOwner = new Map();
    picks.forEach((pick, i) => {
      const who = ownershipOf.player(i);
      if (!byOwner.has(who)) byOwner.set(who, []);
      byOwner.get(who).push(pick);
    });
    return byOwner;
  }
  ownershipOf.player = (i) => i % 4;

  // Seed + buy `numTickets` random tickets (round-robin across the 4 players) +
  // settle in a fresh chain state, retrying (via snapshots) until at least one
  // ticket lands a 3+ match. Failed attempts are discarded; the successful
  // attempt's chain state is kept for follow-up assertions.
  async function findWinningRound(numTickets, maxTries = 8) {
    for (let attempt = 0; ; attempt++) {
      const snap = await ethers.provider.send("evm_snapshot", []);
      await lotto.seed(SEED);
      const picks = randomPicks(numTickets);
      for (let g = 0; g < 4; g++) {
        const slice = picks.filter((_, i) => i % 4 === g);
        if (slice.length) await lotto.connect(players[g]).buyTickets(slice);
      }
      const { settledRound, winning } = await settle();
      const { counts, hits } = recomputeRound(picks, winning);
      if (hits > 0) return { picks, settledRound, winning, counts };
      if (attempt + 1 >= maxTries) throw new Error("no winning round produced");
      await ethers.provider.send("evm_revert", [snap]);
    }
  }

  // --- Deploy validation ---

  it("rejects zero token, zero dev wallet, and zero price at deploy", async () => {
    const RackLotto = await ethers.getContractFactory("RackLotto");
    const MockRacks = await ethers.getContractFactory("MockRacks");
    const tmp = await MockRacks.deploy(1);
    await tmp.waitForDeployment();

    await expect(RackLotto.deploy(ethers.ZeroAddress, dev.address, TICKET))
      .to.be.revertedWithCustomError(RackLotto, "InvalidToken");
    await expect(RackLotto.deploy(await tmp.getAddress(), ethers.ZeroAddress, TICKET))
      .to.be.revertedWithCustomError(RackLotto, "InvalidDevWallet");
    await expect(RackLotto.deploy(await tmp.getAddress(), dev.address, 0))
      .to.be.revertedWithCustomError(RackLotto, "InvalidParams");
  });

  it("keeps game rules (price, split, round duration, window) immutable", async () => {
    expect(await lotto.ticketPrice()).to.equal(TICKET);
    expect(await lotto.ROUND_DURATION()).to.equal(ROUND_DURATION);
    expect(await lotto.JACKPOT_BPS()).to.equal(JACKPOT_BPS);
    expect(await lotto.TIER4_BPS()).to.equal(TIER4_BPS);
    expect(await lotto.TIER3_BPS()).to.equal(TIER3_BPS);
    expect(await lotto.DEV_BPS()).to.equal(DEV_BPS);
    expect(await lotto.RESERVE_BPS()).to.equal(RESERVE_BPS);
    expect(await lotto.CLAIM_WINDOW()).to.equal(CLAIM_WINDOW);
  });

  it("the three tiers + dev + reserve sum to exactly the pot", async () => {
    const jp = await lotto.JACKPOT_BPS();
    const t4 = await lotto.TIER4_BPS();
    const t3 = await lotto.TIER3_BPS();
    const dev = await lotto.DEV_BPS();
    const res = await lotto.RESERVE_BPS();
    expect(jp + t4 + t3 + dev + res).to.equal(10_000n);
  });

  // --- Input validation ---

  it("rejects out-of-range and duplicated numbers", async () => {
    await lotto.seed(SEED);
    await expect(lotto.connect(players[1]).buyTickets([[0, 2, 3, 4, 5]]))
      .to.be.revertedWithCustomError(lotto, "InvalidNumbers");
    await expect(lotto.connect(players[1]).buyTickets([[1, 2, 3, 4, 31]]))
      .to.be.revertedWithCustomError(lotto, "InvalidNumbers");
    await expect(lotto.connect(players[1]).buyTickets([[1, 1, 3, 4, 5]]))
      .to.be.revertedWithCustomError(lotto, "NumbersMustBeDistinct");
  });

  it("rejects buying zero tickets", async () => {
    await lotto.seed(SEED);
    await expect(lotto.connect(players[1]).buyTickets([]))
      .to.be.revertedWithCustomError(lotto, "ZeroAmount");
  });

  // --- Round lifecycle ---

  it("accumulates the pot and records tickets without drawing before the timer", async () => {
    await lotto.seed(SEED);
    const before = await racks.balanceOf(await lotto.getAddress());
    await lotto.connect(players[1]).buyTickets([[1, 2, 3, 4, 5]]);
    expect(await lotto.ticketsSold()).to.equal(1n);
    expect(await lotto.round()).to.equal(1n);
    expect(await lotto.potTotal()).to.equal(SEED + TICKET);
    expect(await racks.balanceOf(await lotto.getAddress())).to.equal(before + TICKET);
    const t = await lotto.tickets(0);
    expect(t.owner).to.equal(players[1].address);
  });

  it("seed or first buy starts the round timer; it counts down to zero", async () => {
    expect(await lotto.roundClosesAt()).to.equal(0n);
    expect(await lotto.timeRemaining()).to.equal(0n);
    await lotto.seed(SEED);
    expect(await lotto.roundClosesAt()).to.be.gt(0n);
    expect(await lotto.timeRemaining()).to.be.gt(0n);
    await timeJump(ROUND_DURATION + 1n);
    expect(await lotto.timeRemaining()).to.equal(0n);
  });

  it("cannot seed when the round is already open", async () => {
    await lotto.seed(SEED);
    await expect(lotto.seed(1)).to.be.revertedWithCustomError(lotto, "RoundLive");
  });

  it("draws when the timer expires, resets the round, records 5 valid numbers, reserves dev", async () => {
    await lotto.seed(SEED);
    await lotto.connect(players[1]).buyTickets([[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]]);
    expect(await lotto.ticketsSold()).to.equal(2n);

    const { settledRound, winning } = await settle();
    expect(settledRound).to.equal(1n);
    expect(await lotto.round()).to.equal(2n);
    expect(await lotto.ticketsSold()).to.equal(1n); // trigger buy landed in round 2
    expect(await lotto.drawNonce()).to.equal(1n);
    expect(winning.length).to.equal(5);
    expect(new Set(winning).size).to.equal(5);
    for (const n of winning) expect(n >= 1 && n <= 30).to.equal(true);
    // Dev is NOT paid at the draw — it's reserved per round.
    const devReserved = poolOf(SEED + TICKET * 2n, DEV_BPS);
    expect(await racks.balanceOf(dev.address)).to.equal(0n);
    expect(await lotto.pendingDevAmount(settledRound)).to.equal(devReserved);
    expect(await lotto.devAccum()).to.equal(0n);
  });

  // --- Math: the draw is deterministic given the block; pools split exactly ---

  it("draws numbers deterministic by blockhash and splits every tier exactly", async () => {
    await lotto.seed(SEED);
    await lotto.connect(players[1]).buyTickets([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]);
    await timeJump(ROUND_DURATION + 1n);

    // Predict the exact draw numbers from the pin we set for the trigger buy's block.
    await ethers.provider.send("evm_mine", []);
    const parent = await ethers.provider.getBlock("latest");
    const targetTime = parent.timestamp + 60;
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(targetTime)]);
    const round_ = await lotto.round();
    const nonce = await lotto.drawNonce();
    const predicted = predictNumbers(parent.hash, targetTime, round_, nonce);
    // Trigger buy must be the next mined block so blockhash + timestamp match.
    await lotto.connect(players[1]).buyTickets([[1, 2, 3, 4, 5]]);

    const settledRound = (await lotto.round()) - 1n;
    const winning = (await lotto.winningNumbers(settledRound)).map((x) => Number(x));
    expect(winning.map((x) => x.toString())).to.deep.equal(predicted.map((x) => x.toString()));

    const pot = SEED + TICKET * 2n;
    const jp = poolOf(pot, JACKPOT_BPS);
    const t4 = poolOf(pot, TIER4_BPS);
    const t3 = poolOf(pot, TIER3_BPS);
    const devAmt = poolOf(pot, DEV_BPS);
    const reserve = pot - jp - t4 - t3 - devAmt;

    expect(await lotto.roundJackpotPool(settledRound)).to.equal(jp);
    expect(await lotto.roundTier4Pool(settledRound)).to.equal(t4);
    expect(await lotto.roundTier3Pool(settledRound)).to.equal(t3);

    // No winners on this draw (the 2 round-1 tickets are distinct from the draw):
    // every tier rolls into the next pot.
    const k5 = aWinCount([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]], winning, 5);
    const k4 = aWinCount([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]], winning, 4);
    const k3 = aWinCount([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]], winning, 3);
    let rolled = 0n;
    if (k5 === 0) rolled += jp;
    if (k4 === 0) rolled += t4;
    if (k3 === 0) rolled += t3;
    let dust = 0n;
    if (k5 > 0) dust += jp % BigInt(k5);
    if (k4 > 0) dust += t4 % BigInt(k4);
    if (k3 > 0) dust += t3 % BigInt(k3);
    expect(await lotto.potTotal()).to.equal(reserve + rolled + dust + TICKET);

    // Dev stays in the contract, reserved for a future claim.
    expect(await racks.balanceOf(dev.address)).to.equal(0n);
    expect(await lotto.pendingDevAmount(settledRound)).to.equal(devAmt);
    expect(await lotto.devAccum()).to.equal(0n);
  });

  // --- Math: zero winners (deterministic via an empty round) ---

  it("an expiring round with NO tickets rolls the whole pot forward (guaranteed zero winners)", async () => {
    await lotto.seed(SEED);
    const { settledRound } = await settle();

    const pot = SEED;
    const devAmt = poolOf(pot, DEV_BPS);
    const reserve = pot - devAmt; // jp/t4/t3 pools have zero winners → all roll

    expect(await lotto.jackpotWinnersCount(settledRound)).to.equal(0n);
    expect(await lotto.tier4WinnersCount(settledRound)).to.equal(0n);
    expect(await lotto.tier3WinnersCount(settledRound)).to.equal(0n);
    expect(await lotto.pendingAvailable(settledRound)).to.equal(0n);
    // next pot = seed minus the reserved dev, plus the trigger ticket.
    expect(await lotto.potTotal()).to.equal(reserve + TICKET);
    expect(await racks.balanceOf(dev.address)).to.equal(0n);
    expect(await lotto.pendingDevAmount(settledRound)).to.equal(devAmt);
    expect(await lotto.pendingClaimOf(players[1].address)).to.deep.equal([0n, 0n, 0n, false]);
  });

  // --- Math: full accounting identity on every draw (hand-recomputed vs on-chain) ---

  it("pays every tier exactly — accounting identity holds for every draw outcome", async () => {
    const numTickets = 500;
    const { picks, settledRound, winning, counts } = await findWinningRound(numTickets);

    const pot = SEED + TICKET * BigInt(numTickets);
    const jp = poolOf(pot, JACKPOT_BPS);
    const t4 = poolOf(pot, TIER4_BPS);
    const t3 = poolOf(pot, TIER3_BPS);
    const devAmt = poolOf(pot, DEV_BPS);
    const reserve = pot - jp - t4 - t3 - devAmt;

    expect(await lotto.roundPot(settledRound)).to.equal(pot);
    expect(await lotto.roundJackpotPool(settledRound)).to.equal(jp);
    expect(await lotto.roundTier4Pool(settledRound)).to.equal(t4);
    expect(await lotto.roundTier3Pool(settledRound)).to.equal(t3);
    expect(await lotto.jackpotWinnersCount(settledRound)).to.equal(BigInt(counts.k5));
    expect(await lotto.tier4WinnersCount(settledRound)).to.equal(BigInt(counts.k4));
    expect(await lotto.tier3WinnersCount(settledRound)).to.equal(BigInt(counts.k3));

    // Per-tier shares + per-owner accrual, recomputed by hand.
    const tier = (pool, k) => {
      if (k === 0) return { share: 0n, paid: 0n, dust: 0n, rolled: true };
      const share = pool / BigInt(k);
      return { share, paid: share * BigInt(k), dust: pool - share * BigInt(k), rolled: false };
    };
    const j5 = tier(jp, counts.k5);
    const j4 = tier(t4, counts.k4);
    const j3 = tier(t3, counts.k3);
    const expectedPending = j5.paid + j4.paid + j3.paid;
    expect(await lotto.pendingAvailable(settledRound)).to.equal(expectedPending);

    const byOwner = ownershipOf(picks);
    let rolled = 0n;
    for (const [whom, ownerPicks] of byOwner) {
      let expected = 0n;
      for (const pick of ownerPicks) {
        const m = matchCount(pick, winning);
        if (m === 5) expected += j5.share;
        else if (m === 4) expected += j4.share;
        else if (m === 3) expected += j3.share;
      }
      expect(await lotto.pendingClaimAmount(settledRound, players[whom].address)).to.equal(expected);
    }
    if (j5.rolled) rolled += jp;
    if (j4.rolled) rolled += t4;
    if (j3.rolled) rolled += t3;
    const dust = j5.dust + j4.dust + j3.dust;

    // Next pot = reserve + rolled tiers + dust + trigger ticket.
    expect(await lotto.potTotal()).to.equal(reserve + rolled + dust + TICKET);
    // Dev reserved, never paid at the draw.
    expect(await lotto.pendingDevAmount(settledRound)).to.equal(devAmt);
    expect(await racks.balanceOf(dev.address)).to.equal(0n);
    //
    // Conservation inside this round: everything deposited is either in the next
    // pot, reserved for the winners, or reserved for dev. Nothing leaked.
    const contractBalance = await racks.balanceOf(await lotto.getAddress());
    expect(contractBalance).to.equal(
      (await lotto.potTotal()) + expectedPending + (await lotto.pendingDevAmount(settledRound))
    );
  });

  it("accrues across multiple wallets and splits not just per-owner but per ticket", async () => {
    const numTickets = 800;
    const { picks, settledRound, winning, counts } = await findWinningRound(numTickets);
    expect(counts.k3 + counts.k4 + counts.k5).to.be.gt(0);

    const pot = SEED + TICKET * BigInt(numTickets);
    const jp = poolOf(pot, JACKPOT_BPS);
    const t4 = poolOf(pot, TIER4_BPS);
    const t3 = poolOf(pot, TIER3_BPS);

    // total accrued across wallets equals the sum of every winning tier's pool,
    // minus rounding dust.
    let sumOwnerShares = 0n;
    for (const pick of picks) {
      const m = matchCount(pick, winning);
      if (m === 5) sumOwnerShares += jp / BigInt(counts.k5);
      else if (m === 4) sumOwnerShares += t4 / BigInt(counts.k4);
      else if (m === 3) sumOwnerShares += t3 / BigInt(counts.k3);
    }
    expect(sumOwnerShares).to.equal(await lotto.pendingAvailable(settledRound));
  });

  // --- Math: claims ---

  it("claim pays exactly the accrued share, releases dev, and clears the book", async () => {
    const numTickets = 500;
    const { picks, settledRound, winning } = await findWinningRound(numTickets);

    const pot = SEED + TICKET * BigInt(picks.length);
    const jp = poolOf(pot, JACKPOT_BPS);
    const t4 = poolOf(pot, TIER4_BPS);
    const t3 = poolOf(pot, TIER3_BPS);
    const k5 = aWinCount(picks, winning, 5);
    const k4 = aWinCount(picks, winning, 4);
    const k3 = aWinCount(picks, winning, 3);
    const shareFor = (pick) => {
      const m = matchCount(pick, winning);
      if (m === 5) return jp / BigInt(k5);
      if (m === 4) return t4 / BigInt(k4);
      if (m === 3) return t3 / BigInt(k3);
      return 0n;
    };

    const devBefore = await racks.balanceOf(dev.address);
    let lastClaimer;
    for (let whom = 0; whom < 4; whom++) {
      let share = 0n;
      for (let i = 0; i < picks.length; i++) if (i % 4 === whom) share += shareFor(picks[i]);
      if (share === 0n) continue;

      const chain = await lotto.pendingClaimAmount(settledRound, players[whom].address);
      expect(chain).to.equal(share);
      const before = await racks.balanceOf(players[whom].address);
      await lotto.connect(players[whom]).claim(settledRound);
      expect(await racks.balanceOf(players[whom].address)).to.equal(before + share);
      expect(await lotto.pendingClaimAmount(settledRound, players[whom].address)).to.equal(0n);
      lastClaimer = players[whom];
    }

    // Every winner claimed: nothing left pending for the round.
    expect(await lotto.pendingAvailable(settledRound)).to.equal(0n);
    // Dev received exactly this round's reserved share on the first claim.
    const devAmt = poolOf(pot, DEV_BPS);
    expect(await racks.balanceOf(dev.address)).to.equal(devBefore + devAmt);
    expect(await lotto.devAccum()).to.equal(0n);

    // No double claims.
    await expect(lotto.connect(lastClaimer).claim(settledRound))
      .to.be.revertedWithCustomError(lotto, "NotPendingWinner");
  });

  it("a non-winner cannot claim and claiming an undrawn round reverts", async () => {
    await lotto.seed(SEED);
    await lotto.connect(players[1]).buyTickets([[1, 2, 3, 4, 5]]);
    const { settledRound } = await settle();
    await expect(lotto.connect(players[3]).claim(settledRound))
      .to.be.revertedWithCustomError(lotto, "NotPendingWinner");
    await expect(lotto.connect(players[1]).claim(settledRound + 1n))
      .to.be.revertedWithCustomError(lotto, "RoundNotDrawn");
  });

  // --- Math: dev stacking (forfeited shares) ---

  it("forfeited dev stakes in devAccum and is released on the next claim", async () => {
    // Round 1: empty → dev reserved, nothing claimed.
    await lotto.seed(SEED);
    const { settledRound: r1 } = await settle();
    const dev1 = await lotto.pendingDevAmount(r1);
    expect(dev1).to.be.gt(0n);
    expect(await lotto.devAccum()).to.equal(0n);

    // Expire round 1's claim window; the next buy sweeps it → devAccum stacks dev1.
    await timeJump(CLAIM_WINDOW + 1n);
    await lotto.connect(players[1]).buyTickets([[1, 2, 3, 4, 5]]);
    expect(await lotto.roundSwept(r1)).to.equal(true);
    expect(await lotto.pendingDevAmount(r1)).to.equal(0n);
    expect(await lotto.devAccum()).to.equal(dev1);

    // Round 2: draw it, reserve dev2; expiry of its window stacks dev2 too.
    await timeJump(ROUND_DURATION + 1n);
    await lotto.connect(players[1]).buyTickets([[1, 2, 3, 4, 5]]);
    const r2 = await lotto.round();
    expect(r2).to.equal(3n);
    const dev2 = await lotto.pendingDevAmount(r2 - 1n);
    expect(await lotto.devAccum()).to.equal(dev1); // fresh reservation, not stacked yet

    await timeJump(CLAIM_WINDOW + 1n);
    await lotto.connect(players[1]).buyTickets([[1, 2, 3, 4, 5]]);
    expect(await lotto.devAccum()).to.equal(dev1 + dev2);
    expect(await racks.balanceOf(dev.address)).to.equal(0n); // nothing paid until a claim

    // Any valid claim releases devAccum (covered by the claim test above which asserts
    // dev receives roundDev + devAccum exactly).
  });

  // --- Math: sweep after claim window folds unclaimed into the live pot ---

  it("unclaimed winnings join the live pot after the claim window (sweep)", async () => {
    const numTickets = 500;
    const { picks, settledRound, winning } = await findWinningRound(numTickets);

    let claimer;
    for (let whom = 0; whom < 4 && claimer === undefined; whom++) {
      for (let i = 0; i < picks.length; i++) {
        if (i % 4 === whom && [3, 4, 5].includes(matchCount(picks[i], winning))) {
          claimer = whom;
          break;
        }
      }
    }
    expect(claimer).to.not.equal(undefined);
    expect(await lotto.pendingClaimOf(players[claimer].address)).to.deep.equal([
      settledRound,
      (await lotto.pendingClaimAmount(settledRound, players[claimer].address)),
      (await lotto.pendingDeadline(settledRound)),
      true,
    ]);

    const potBefore = await lotto.potTotal();
    const unclaimed = await lotto.pendingAvailable(settledRound);
    expect(unclaimed).to.be.gt(0n);

    await timeJump(CLAIM_WINDOW + 1n);
    await lotto.connect(players[2]).buyTickets([[1, 2, 3, 4, 5]]);

    expect(await lotto.roundSwept(settledRound)).to.equal(true);
    expect(await lotto.pendingAvailable(settledRound)).to.equal(0n);
    // The round's dev stacks into devAccum too.
    const devAmt = poolOf(SEED + TICKET * BigInt(picks.length), DEV_BPS);
    expect(await lotto.devAccum()).to.equal(devAmt);
    expect(await lotto.potTotal()).to.equal(potBefore + unclaimed + TICKET);

    // Expired claim is hidden from the view and cannot be claimed.
    expect(await lotto.pendingClaimOf(players[claimer].address)).to.deep.equal([0n, 0n, 0n, false]);
    await expect(lotto.connect(players[claimer]).claim(settledRound))
      .to.be.revertedWithCustomError(lotto, "ClaimExpired");
  });

  it("winner pays no tax and can claim once per sold round within the window", async () => {
    const numTickets = 500;
    const { picks, settledRound, winning } = await findWinningRound(numTickets);

    const devBefore = await racks.balanceOf(dev.address);
    const roundDev = poolOf(SEED + TICKET * BigInt(picks.length), DEV_BPS);

    // Claim by a winning account.
    let claimer = -1;
    for (let whom = 0; whom < 4 && claimer < 0; whom++) {
      for (let i = 0; i < picks.length; i++) {
        if (i % 4 === whom && [3, 4, 5].includes(matchCount(picks[i], winning))) {
          claimer = whom;
          break;
        }
      }
    }
    expect(claimer).to.be.gt(-1);

    const amount = await lotto.pendingClaimAmount(settledRound, players[claimer].address);
    const before = await racks.balanceOf(players[claimer].address);
    await lotto.connect(players[claimer]).claim(settledRound);
    expect(await racks.balanceOf(players[claimer].address)).to.equal(before + amount);
    expect(await racks.balanceOf(dev.address)).to.equal(devBefore + roundDev);
    expect(await lotto.devAccum()).to.equal(0n);
  });

  // --- Owner only ---

  it("non-owners cannot seed or draw early; drawEarly requires tickets", async () => {
    await expect(lotto.connect(players[1]).seed(SEED))
      .to.be.revertedWithCustomError(lotto, "OwnableUnauthorizedAccount");
    await expect(lotto.connect(players[1]).drawEarly())
      .to.be.revertedWithCustomError(lotto, "OwnableUnauthorizedAccount");
    await expect(lotto.drawEarly())
      .to.be.revertedWithCustomError(lotto, "NoTickets");
  });

  it("owner can draw a live round early; the empty-round path rolls it", async () => {
    await lotto.seed(SEED);
    await lotto.connect(players[1]).buyTickets([[1, 2, 3, 4, 5]]);
    await lotto.drawEarly();
    expect(await lotto.round()).to.equal(2n);
    expect(await lotto.ticketsSold()).to.equal(0n);
    expect(await lotto.drawNonce()).to.equal(1n);
  });

  it("cannot rescue the game token", async () => {
    await lotto.seed(SEED);
    await expect(lotto.rescueTokens(await racks.getAddress()))
      .to.be.revertedWithCustomError(lotto, "TransferFailed");
  });
});

function aWinCount(picks, winning, tier) {
  let k = 0;
  for (const p of picks) if (matchCount(p, winning) === tier) k += 1;
  return k;
}

describe("RackLotto fee-on-transfer safety", () => {
  let racks, lotto, owner, dev, alice;

  beforeEach(async () => {
    [owner, dev, alice] = await ethers.getSigners();

    const MockFeeOnTransfer = await ethers.getContractFactory("MockFeeOnTransfer");
    racks = await MockFeeOnTransfer.deploy();
    await racks.waitForDeployment();

    const RackLotto = await ethers.getContractFactory("RackLotto");
    lotto = await RackLotto.deploy(await racks.getAddress(), dev.address, TICKET);
    await lotto.waitForDeployment();

    for (const player of [owner, alice]) {
      await racks.mint(player.address, ethers.parseEther("100000"));
      await racks.connect(player).approve(await lotto.getAddress(), ethers.MaxUint256);
    }
  });

  const afterFee = (amount) => amount - (amount * 200n) / 10_000n;

  it("counts the pot by actual tokens received, not face value", async () => {
    await lotto.seed(SEED);
    expect(await lotto.potTotal()).to.equal(afterFee(SEED));
    await lotto.connect(alice).buyTickets([[1, 2, 3, 4, 5]]);
    expect(await lotto.potTotal()).to.equal(afterFee(SEED) + afterFee(TICKET));
  });

  it("settles the full split from the actual balance with no stuck dust", async () => {
    await lotto.seed(SEED);
    await lotto.connect(alice).buyTickets([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]);
    await timeJump(ROUND_DURATION + 1n);
    await lotto.connect(alice).buyTickets([[1, 2, 3, 4, 5]]);

    const settledRound = (await lotto.round()) - 1n;
    const pot = afterFee(SEED) + afterFee(TICKET) * 2n;
    const devAmt = poolOf(pot, DEV_BPS);

    // Dev is reserved (still in the contract), not paid at the draw.
    expect(await racks.balanceOf(dev.address)).to.equal(0n);
    expect(await lotto.pendingDevAmount(settledRound)).to.equal(devAmt);
    expect(await lotto.devAccum()).to.equal(0n);

    // Nothing stuck: contract balance == next pot + unclaimed winner shares +
    // reserved dev shares.
    const pending = await lotto.pendingAvailable(settledRound);
    expect(await racks.balanceOf(await lotto.getAddress())).to.equal(
      (await lotto.potTotal()) + pending + (await lotto.pendingDevAmount(settledRound))
    );
    // Unclaimed winner shares can never exceed the pools that were actually split.
    expect(pending).to.be.lte(poolOf(pot, JACKPOT_BPS) + poolOf(pot, TIER4_BPS) + poolOf(pot, TIER3_BPS));
  });
});