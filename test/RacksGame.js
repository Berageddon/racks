const { expect } = require("chai");
const { ethers } = require("hardhat");

const TICK = 10_000n;
const ROUND_TIME = 180n;
const CLAIM_WINDOW = 3600n;
const WINNER_BPS = 9500n;
const DEV_BPS = 250n;

async function timeJump(seconds) {
  await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await ethers.provider.send("evm_mine", []);
}

describe("RacksGame", () => {
  let racks, game, owner, dev, alice, bob, carol;
  const SEED = 100_000n;

  beforeEach(async () => {
    [owner, dev, alice, bob, carol] = await ethers.getSigners();

    const MockRacks = await ethers.getContractFactory("MockRacks");
    racks = await MockRacks.deploy(ethers.parseEther("1000000"));
    await racks.waitForDeployment();

    const RacksGame = await ethers.getContractFactory("RacksGame");
    game = await RacksGame.deploy(await racks.getAddress(), dev.address);
    await game.waitForDeployment();

    // Fund players + approve the game
    for (const player of [alice, bob, carol]) {
      await racks.mint(player.address, ethers.parseEther("100000"));
    }
    await racks.connect(owner).approve(await game.getAddress(), ethers.MaxUint256);
    await racks.connect(alice).approve(await game.getAddress(), ethers.MaxUint256);
    await racks.connect(bob).approve(await game.getAddress(), ethers.MaxUint256);
    await racks.connect(carol).approve(await game.getAddress(), ethers.MaxUint256);
  });

  it("seeds the pot and starts round 1 with a waiting countdown", async () => {
    await game.seed(SEED);
    expect(await game.potTotal()).to.equal(SEED);
    expect(await game.round()).to.equal(1n);
    expect(await game.topBid()).to.equal(0n);
    // The countdown has not started until the first bid lands.
    expect(await game.timeRemaining()).to.equal(ROUND_TIME);
    expect(await game.effectiveRound()).to.equal(1n);
  });

  it("rejects seeding while a round has bids", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    await expect(game.seed(SEED)).to.be.revertedWithCustomError(game, "RoundLive");
  });

  it("rejects zero or sub-tick first bids", async () => {
    await game.seed(SEED);
    await expect(game.connect(alice).bid(0n)).to.be.revertedWithCustomError(game, "ZeroAmount");
    await expect(game.connect(alice).bid(TICK / 2n)).to.be.revertedWithCustomError(game, "NotMultipleOfTick");
  });

  it("rejects non-multiple-of-tick bids", async () => {
    await game.seed(SEED);
    await expect(game.connect(alice).bid(TICK + 1n)).to.be.revertedWithCustomError(game, "NotMultipleOfTick");
  });

  it("requires each bid to beat the top bid by a tick", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    await expect(game.connect(bob).bid(TICK)).to.be.revertedWithCustomError(game, "BidTooLow");
    await game.connect(bob).bid(TICK * 2n);
    expect(await game.topBidder()).to.equal(bob.address);
    expect(await game.topBid()).to.equal(TICK * 2n);
  });

  it("accumulates the pot with seed + all bids", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    await game.connect(bob).bid(TICK * 2n);
    await game.connect(carol).bid(TICK * 3n);
    expect(await game.potTotal()).to.equal(SEED + TICK * 6n);
  });

  it("resets the countdown on every bid", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    const endAfterFirst = await game.roundEndsAt();
    await timeJump(120);
    await game.connect(bob).bid(TICK * 2n);
    const endAfterSecond = await game.roundEndsAt();
    expect(endAfterSecond).to.be.greaterThan(endAfterFirst);
  });

  it("auto-advances the live round at the bell via views (no transaction needed)", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    const pot = await game.potTotal();

    await timeJump(ROUND_TIME + 1n);

    expect(await game.isRoundExpired()).to.equal(true);
    expect(await game.effectiveRound()).to.equal(2n);
    expect(await game.effectivePotTotal()).to.equal((pot * 250n) / 10_000n);
    expect(await game.effectiveTopBid()).to.equal(0n);
    expect(await game.effectiveTopBidder()).to.equal(ethers.ZeroAddress);
    expect(await game.timeRemaining()).to.equal(0n);

    // Stored state only moves when someone interacts.
    expect(await game.round()).to.equal(1n);
    expect(await game.potTotal()).to.equal(pot);
  });

  it("opens the next round on the next bid and lands it as the first bid", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    const pot = await game.potTotal();
    const winnerAmount = (pot * WINNER_BPS) / 10_000n;
    const devAmount = (pot * DEV_BPS) / 10_000n;
    const round1End = await game.roundEndsAt();

    await timeJump(ROUND_TIME + 1n);
    await game.connect(bob).bid(TICK);

    expect(await game.round()).to.equal(2n);
    expect(await game.potTotal()).to.equal((pot * 250n) / 10_000n + TICK);
    expect(await game.topBid()).to.equal(TICK);
    expect(await game.topBidder()).to.equal(bob.address);

    // Alice's win is reserved for claim, with a 1-hour window from the bell.
    const claim = await game.pendingClaimOf(alice.address);
    expect(claim[3]).to.equal(true);
    expect(claim[0]).to.equal(1n);
    expect(claim[1]).to.equal(winnerAmount);
    expect(claim[2]).to.equal(round1End + CLAIM_WINDOW);

    // Funds stay in the contract: live pot + reserved winner/dev shares.
    const contractBalance = await racks.balanceOf(await game.getAddress());
    const pending = winnerAmount + devAmount;
    expect(contractBalance).to.equal((await game.potTotal()) + pending);
  });

  it("rejects invalid bids after the bell (transitioned round)", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK * 2n);
    await timeJump(ROUND_TIME + 1n);
    await expect(game.connect(bob).bid(0n)).to.be.revertedWithCustomError(game, "ZeroAmount");
    await expect(game.connect(bob).bid(TICK / 2n)).to.be.revertedWithCustomError(game, "NotMultipleOfTick");
  });

  it("lets the winner claim: 95% to winner, 2.5% to dev, 2.5% seeds the next round", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    await game.connect(bob).bid(TICK * 2n);
    await game.connect(carol).bid(TICK * 3n);
    const pot = SEED + TICK * 6n;

    const winnerAmount = (pot * WINNER_BPS) / 10_000n;
    const devAmount = (pot * DEV_BPS) / 10_000n;
    const nextPot = pot - winnerAmount - devAmount;

    const devBefore = await racks.balanceOf(dev.address);
    const carolBefore = await racks.balanceOf(carol.address);

    await timeJump(ROUND_TIME + 1n);
    await expect(game.connect(carol).claim(1n))
      .to.emit(game, "WinnerClaimed")
      .withArgs(1n, carol.address, winnerAmount, devAmount);

    expect(await racks.balanceOf(carol.address)).to.equal(carolBefore + winnerAmount);
    expect(await racks.balanceOf(dev.address)).to.equal(devBefore + devAmount);
    expect(await game.round()).to.equal(2n);
    expect(await game.potTotal()).to.equal(nextPot);
    expect(await game.topBid()).to.equal(0n);
    expect(await game.topBidder()).to.equal(ethers.ZeroAddress);
    const carolClaim = await game.pendingClaimOf(carol.address);
    expect(carolClaim[3]).to.equal(false);
  });

  it("rejects claims from non-winners, live rounds, and biddess rounds", async () => {
    // A round nobody bid into has no winner to claim.
    await game.seed(SEED);
    await expect(game.connect(alice).claim(1n)).to.be.revertedWithCustomError(game, "NotPendingWinner");

    // Live round has no pending claim yet.
    await game.connect(alice).bid(TICK);
    await expect(game.connect(alice).claim(1n)).to.be.revertedWithCustomError(game, "NotPendingWinner");

    // Non-winner after the bell.
    await timeJump(ROUND_TIME + 1n);
    await expect(game.connect(bob).claim(1n)).to.be.revertedWithCustomError(game, "NotPendingWinner");
  });

  it("rejects claims after the one-hour window and rolls the share into the next round", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    const pot = await game.potTotal();
    const winnerAmount = (pot * WINNER_BPS) / 10_000n;
    const devAmount = (pot * DEV_BPS) / 10_000n;

    await timeJump(ROUND_TIME + 1n);
    await timeJump(CLAIM_WINDOW + 1n);
    await expect(game.connect(alice).claim(1n)).to.be.revertedWithCustomError(game, "ClaimExpired");
    expect(await game.round()).to.equal(1n);

    // Any bid re-runs the sweep; forfeiture lands on the next sweep pass.
    await game.connect(bob).bid(TICK);
    await game.connect(bob).bid(TICK * 2n);

    expect(await game.futureSeed()).to.equal(winnerAmount);
    expect(await game.devAccum()).to.equal(devAmount);
    const aliceClaim = await game.pendingClaimOf(alice.address);
    expect(aliceClaim[3]).to.equal(false);
    await expect(game.connect(alice).claim(1n)).to.be.revertedWithCustomError(game, "NotPendingWinner");
  });

  it("accumulates forfeited dev shares and pays them to the dev wallet on the next claim", async () => {
    await game.seed(SEED);

    // Round 1: alice wins, never claims. The next bid sweeps her forfeited shares.
    await game.connect(alice).bid(TICK);
    const pot1 = SEED + TICK;
    const w1 = (pot1 * WINNER_BPS) / 10_000n;
    const d1 = (pot1 * DEV_BPS) / 10_000n;
    await timeJump(ROUND_TIME + 1n);
    await timeJump(CLAIM_WINDOW + 1n);
    await game.connect(bob).bid(TICK);
    await game.connect(bob).bid(TICK * 2n);
    expect(await game.futureSeed()).to.equal(w1);
    expect(await game.devAccum()).to.equal(d1);

    // Round 2: bob wins, never claims. Same dance for a second unclaimed round.
    const round2Pot = await game.potTotal();
    const w2 = (round2Pot * WINNER_BPS) / 10_000n;
    const d2 = (round2Pot * DEV_BPS) / 10_000n;
    await timeJump(ROUND_TIME + 1n);
    await timeJump(CLAIM_WINDOW + 1n);
    await game.connect(carol).bid(TICK);
    await game.connect(carol).bid(TICK * 2n);
    expect(await game.futureSeed()).to.equal(w2);
    expect(await game.devAccum()).to.equal(d1 + d2);

    // Round 3: carol wins and claims. Dev receives round-3 dev + both accumulated shares.
    const pot3 = await game.potTotal();
    const w3 = (pot3 * WINNER_BPS) / 10_000n;
    const d3 = (pot3 * DEV_BPS) / 10_000n;

    await timeJump(ROUND_TIME + 1n);
    const carolBefore = await racks.balanceOf(carol.address);
    const devBefore = await racks.balanceOf(dev.address);
    await game.connect(carol).claim(3n);

    expect(await racks.balanceOf(carol.address)).to.equal(carolBefore + w3);
    expect(await racks.balanceOf(dev.address)).to.equal(devBefore + d3 + d1 + d2);
    expect(await game.round()).to.equal(4n);
    expect(await game.futureSeed()).to.equal(0n);
    expect(await game.devAccum()).to.equal(0n);
    const carolClaim = await game.pendingClaimOf(carol.address);
    expect(carolClaim[3]).to.equal(false);
  });

  it("allows the owner to seed the next round once the previous winner claims", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    await timeJump(ROUND_TIME + 1n);
    await game.connect(alice).claim(1n);

    expect(await game.round()).to.equal(2n);
    expect(await game.topBid()).to.equal(0n);
    await game.seed(SEED);
    expect(await game.potTotal()).to.equal((SEED + TICK) * 250n / 10_000n + SEED);
  });

  it("keeps game rules fixed: tick / roundTime / devWallet are immutable", async () => {
    expect(await game.tick()).to.equal(TICK);
    expect(await game.roundTime()).to.equal(ROUND_TIME);
    expect(await game.devWallet()).to.equal(dev.address);
  });

  it("renounces nothing can be rescued for the game token", async () => {
    await game.seed(SEED);
    await expect(game.rescueTokens(await racks.getAddress(), 1n)).to.be.revertedWithCustomError(
      game,
      "TransferFailed"
    );
  });

  it("non-owners cannot seed or rescue tokens", async () => {
    await expect(game.connect(alice).seed(SEED)).to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
    await expect(game.connect(alice).rescueTokens(racks.getAddress(), 1n)).to.be.revertedWithCustomError(
      game,
      "OwnableUnauthorizedAccount"
    );
  });

  it("rejects a zero token address on deploy", async () => {
    const RacksGame = await ethers.getContractFactory("RacksGame");
    await expect(RacksGame.deploy(ethers.ZeroAddress, dev.address)).to.be.revertedWithCustomError(
      game,
      "InvalidToken"
    );
  });

  it("rejects a zero dev wallet on deploy", async () => {
    const RacksGame = await ethers.getContractFactory("RacksGame");
    const tokenAddress = await racks.getAddress();
    await expect(RacksGame.deploy(tokenAddress, ethers.ZeroAddress)).to.be.revertedWithCustomError(
      game,
      "InvalidDevWallet"
    );
  });
});

describe("RacksGame fee-on-transfer safety", () => {
  let racks, game, owner, dev, alice, bob;
  const FEE_BPS = 200n;
  const SEED = 100_000n;

  const afterFee = (amount) => amount - (amount * FEE_BPS) / 10_000n;

  beforeEach(async () => {
    [owner, dev, alice, bob] = await ethers.getSigners();

    const MockFeeOnTransfer = await ethers.getContractFactory("MockFeeOnTransfer");
    racks = await MockFeeOnTransfer.deploy();
    await racks.waitForDeployment();

    const RacksGame = await ethers.getContractFactory("RacksGame");
    game = await RacksGame.deploy(await racks.getAddress(), dev.address);
    await game.waitForDeployment();

    for (const player of [owner, alice, bob]) {
      await racks.mint(player.address, ethers.parseEther("100000"));
      await racks.connect(player).approve(await game.getAddress(), ethers.MaxUint256);
    }
  });

  it("tracks the pot by actual tokens received, not face amounts", async () => {
    await game.seed(SEED);
    expect(await game.potTotal()).to.equal(afterFee(SEED));
    expect(await racks.balanceOf(await game.getAddress())).to.equal(afterFee(SEED));
  });

  it("accrues after-tax bid amounts while ranking on face value", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    expect(await game.potTotal()).to.equal(afterFee(SEED) + afterFee(TICK));
    expect(await game.topBid()).to.equal(TICK);
  });

  it("claims exactly the reserved 95/2.5 from the actual balance (no drift, no stuck pot)", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK * 2n);
    await game.connect(bob).bid(TICK * 4n);

    const pot = await racks.balanceOf(await game.getAddress());
    const winnerAmount = (pot * WINNER_BPS) / 10_000n;
    const devAmount = (pot * DEV_BPS) / 10_000n;
    const nextPot = pot - winnerAmount - devAmount;

    const bobBefore = await racks.balanceOf(bob.address);
    const devBefore = await racks.balanceOf(dev.address);

    await timeJump(ROUND_TIME + 1n);
    await game.connect(bob).claim(1n);

    expect(await racks.balanceOf(bob.address)).to.equal(bobBefore + afterFee(winnerAmount));
    expect(await racks.balanceOf(dev.address)).to.equal(devBefore + afterFee(devAmount));
    expect(await game.potTotal()).to.equal(nextPot);
    expect(await racks.balanceOf(await game.getAddress())).to.equal(nextPot);
  });

  it("auto-advances across rounds without bookkeeping drift", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    await timeJump(ROUND_TIME + 1n);

    // Round 2 starts on bob's bid; alice's round-1 payout is reserved, not paid.
    await game.connect(bob).bid(TICK);
    await game.connect(bob).bid(TICK * 2n);
    const round2Pot = await game.potTotal();

    await timeJump(ROUND_TIME + 1n);
    // Alice claims round 1: funds leave the contract, round 2 stays expired with its
    // winner/dev shares still folded into the pot (reserved only on transition).
    await game.connect(alice).claim(1n);
    expect(await game.round()).to.equal(2n);
    expect(await racks.balanceOf(await game.getAddress())).to.equal(await game.potTotal());

    // Next bid starts round 3 off the reserve and carves round 2's pending claim out of
    // the pot; bookkeeping still matches reality.
    const winner2 = (round2Pot * WINNER_BPS) / 10_000n;
    const dev2 = (round2Pot * DEV_BPS) / 10_000n;
    await game.connect(bob).bid(TICK);
    expect(await game.round()).to.equal(3n);
    expect(await racks.balanceOf(await game.getAddress())).to.equal((await game.potTotal()) + winner2 + dev2);
  });
});