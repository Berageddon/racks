const { JsonRpcProvider, Contract, getAddress, formatEther } = require("ethers");
require("dotenv").config();

// Usage: node scripts/check-balance.js <token> <address>
async function main() {
  const token = process.argv[2];
  const who = getAddress(process.argv[3]);
  if (!token || !who) throw new Error("usage: node scripts/check-balance.js <token> <address>");

  const rpc = process.env.RH_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
  const provider = new JsonRpcProvider(rpc);

  const native = await provider.getBalance(who);
  console.log("address :", who);
  console.log("ETH     :", formatEther(native));

  const t = new Contract(token, [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
  ], provider);

  const symbol = await t.symbol().catch(() => "?");
  const decimals = await t.decimals().catch(() => 18);
  const bal = await t.balanceOf(who).catch(() => null);
  const fmt = (b) => (b / 10n ** BigInt(decimals)).toString() + "." + (b % 10n ** BigInt(decimals)).toString().padStart(Number(decimals), "0").slice(0, 4);
  console.log(`${symbol}  :`, bal == null ? "?" : fmt(bal));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});