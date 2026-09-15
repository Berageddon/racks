const hre = require("hardhat");
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const tokenAddress = process.env.RACKS_TOKEN_ADDRESS;
  if (!tokenAddress) {
    throw new Error("RACKS_TOKEN_ADDRESS not set in .env");
  }

  const devWallet = process.env.GAME_DEV_WALLET || deployer.address;
  const ticketPrice = process.env.LOTTERY_TICKET_PRICE || "10000000000000000000000"; // 10,000 $RACKS

  console.log(`Deploying RackLotto to ${hre.network.name} (chainId ${hre.network.config.chainId})`);
  console.log(`  deployer   : ${deployer.address}`);
  console.log(`  token      : ${tokenAddress}`);
  console.log(`  devWallet  : ${devWallet}`);
  console.log(`  ticketPrice: ${ethers.formatEther(ticketPrice)} $RACKS`);

  const RackLotto = await hre.ethers.getContractFactory("RackLotto");
  const lotto = await RackLotto.deploy(tokenAddress, devWallet, ticketPrice);
  await lotto.waitForDeployment();

  const address = await lotto.getAddress();
  console.log(`RackLotto deployed at: ${address}`);

  const fs = require("fs");
  const out = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    rackLotto: address,
    token: tokenAddress,
    devWallet,
    ticketPrice: ticketPrice.toString(),
  };
  const file = `deployed-lottery-${hre.network.name}.json`;
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Saved to ${file}`);

  return address;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});