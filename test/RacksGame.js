const { expect } = require("chai");
const { ethers } = require("hardhat");

const TICK = 10_000n;
const ROUND_TIME = 180n;
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

  it("seeds the pot and starts round 1", async () => {
    await game.seed(SEED);
    expect(await game.potTotal()).to.equal(SEED);
    expect(await game.round()).to.equal(1n);
    expect(await game.topBid()).to.equal(0n);
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

  it("rejects bids after the countdown expires", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    await timeJump(ROUND_TIME + 1n);
    await expect(game.connect(bob).bid(TICK * 2n)).to.be.revertedWithCustomError(game, "RoundEnded");
  });

  it("cannot settle while the round is live", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    await expect(game.settle()).to.be.revertedWithCustomError(game, "RoundStillLive");
  });

  it("cannot settle a round with no bidders", async () => {
    await game.seed(SEED);
    await timeJump(ROUND_TIME + 1n);
    await expect(game.settle()).to.be.revertedWithCustomError(game, "NoTopBidder");
  });

  it("pays 95% winner / 2.5% dev / 2.5% next pot on settle", async () => {
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
    await game.settle();

    expect(await racks.balanceOf(carol.address)).to.equal(carolBefore + winnerAmount);
    expect(await racks.balanceOf(dev.address)).to.equal(devBefore + devAmount);
    expect(await game.round()).to.equal(2n);
    expect(await game.potTotal()).to.equal(nextPot);
    expect(await game.topBid()).to.equal(0n);
    expect(await game.topBidder()).to.equal(ethers.ZeroAddress);
  });

  it("starts the next round pre-seeded from the reserve", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    await timeJump(ROUND_TIME + 1n);
    await game.settle();

    // New round is already usable with the carried pot
    const secondRoundPot = await game.potTotal();
    await game.connect(alice).bid(TICK);
    expect(await game.potTotal()).to.equal(secondRoundPot + TICK);
    expect(await game.round()).to.equal(2n);
  });

  it("owner can update tick / round time / dev wallet", async () => {
    await game.setTick(20_000n);
    expect(await game.tick()).to.equal(20_000n);
    await game.setRoundTime(300n);
    expect(await game.roundTime()).to.equal(300n);
    await game.setDevWallet(alice.address);
    expect(await game.devWallet()).to.equal(alice.address);
  });

  it("renounces nothing can be rescued for the game token", async () => {
    await game.seed(SEED);
    await expect(game.rescueTokens(await racks.getAddress(), 1n)).to.be.revertedWithCustomError(
      game,
      "TransferFailed"
    );
  });

  it("respects pause: no bids while paused", async () => {
    await game.seed(SEED);
    await game.pause();
    await expect(game.connect(alice).bid(TICK)).to.be.revertedWithCustomError(game, "EnforcedPause");
    await game.unpause();
    await game.connect(alice).bid(TICK);
    expect(await game.topBid()).to.equal(TICK);
  });

  it("non-owners cannot seed or change config", async () => {
    await expect(game.connect(alice).seed(SEED)).to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
    await expect(game.connect(alice).setTick(20_000n)).to.be.revertedWithCustomError(game, "OwnableUnauthorizedAccount");
    await expect(game.connect(alice).setDevWallet(alice.address)).to.be.revertedWithCustomError(
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

  it("settles from the actual balance with exact 95/2.5/2.5 (no drift, no stuck pot)", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK * 2n);
    await game.connect(bob).bid(TICK * 4n);

    const pot = await racks.balanceOf(await game.getAddress());
    const winnerAmount = (pot * WINNER_BPS) / 10_000n;
    const devAmount = (pot * DEV_BPS) / 10_000n;
    const nextPot = pot - winnerAmount - devAmount;

    const bobBefore = await racks.balanceOf(bob.address);

    await timeJump(ROUND_TIME + 1n);
    await game.settle();

    expect(await racks.balanceOf(bob.address)).to.equal(bobBefore + afterFee(winnerAmount));
    expect(await racks.balanceOf(dev.address)).to.equal(afterFee(devAmount));
    expect(await game.potTotal()).to.equal(nextPot);
    expect(await racks.balanceOf(await game.getAddress())).to.equal(nextPot);
  });

  it("keeps settling across multiple rounds without bookkeeping drift", async () => {
    await game.seed(SEED);
    await game.connect(alice).bid(TICK);
    await timeJump(ROUND_TIME + 1n);
    await game.settle();

    await game.connect(bob).bid(TICK);
    await timeJump(ROUND_TIME + 1n);
    await game.settle();

    expect(await game.round()).to.equal(3n);
    // Bookkeeping matches reality after every settle.
    expect(await racks.balanceOf(await game.getAddress())).to.equal(await game.potTotal());
    // Round 3 is live and playable off the carried reserve.
    await game.connect(alice).bid(TICK);
    expect(await game.round()).to.equal(3n);
  });
});