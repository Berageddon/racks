const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const tokenAddress = process.env.RACKS_TOKEN_ADDRESS;
  if (!tokenAddress) {
    throw new Error("RACKS_TOKEN_ADDRESS not set in .env");
  }

  const devWallet = process.env.GAME_DEV_WALLET || deployer.address;

  console.log(`Deploying RacksGame to ${hre.network.name} (chainId ${hre.network.config.chainId})`);
  console.log(`  deployer : ${deployer.address}`);
  console.log(`  token    : ${tokenAddress}`);
  console.log(`  devWallet: ${devWallet}`);

  const RacksGame = await hre.ethers.getContractFactory("RacksGame");
  const game = await RacksGame.deploy(tokenAddress, devWallet);
  await game.waitForDeployment();

  const address = await game.getAddress();
  console.log(`RacksGame deployed at: ${address}`);

  // Persist deployment address for the frontend
  const fs = require("fs");
  const out = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    racksGame: address,
    token: tokenAddress,
    devWallet,
    tick: (await game.tick()).toString(),
    roundTime: (await game.roundTime()).toString(),
  };
  const file = `deployed-${hre.network.name}.json`;
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Saved to ${file}`);

  return address;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});