const { JsonRpcProvider, Contract, Wallet, parseUnits } = require("ethers");
require("dotenv").config();
const fs = require("fs");

// Usage: node scripts/seed.js <network> <amount-in-tokens>
// e.g. node scripts/seed.js rhMainnet 50000
async function main() {
  const network = process.argv[2];
  const amountTokens = process.argv[3];
  if (!network || !amountTokens) throw new Error("usage: node scripts/seed.js <network> <amount-in-tokens>");

  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set in .env");
  const file = `deployed-${network}.json`;
  if (!fs.existsSync(file)) throw new Error(`${file} not found — deploy first`);
  const { racksGame: gameAddress, token } = JSON.parse(fs.readFileSync(file, "utf8"));

  const rpc = process.env.RH_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  const amount = parseUnits(amountTokens, 18);

  const erc20 = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ];
  const gameAbi = [
    "function seed(uint256 amount)",
    "function potTotal() view returns (uint256)",
    "function effectiveRound() view returns (uint256)",
  ];

  const tok = new Contract(token, erc20, wallet);

  const allowance = await tok.allowance(wallet.address, gameAddress);
  if (allowance < amount) {
    console.log(`approving ${amountTokens} RACKS for the game...`);
    const tx = await tok.approve(gameAddress, amount);
    await tx.wait();
    console.log("approve tx:", tx.hash);
  }

  const game = new Contract(gameAddress, gameAbi, wallet);
  console.log(`seeding ${amountTokens} RACKS into round 1...`);
  const tx = await game.seed(amount);
  await tx.wait();
  console.log("seed tx:", tx.hash);
  console.log("effectiveRound:", (await game.effectiveRound()).toString());
  console.log("potTotal      :", (await game.potTotal()).toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});