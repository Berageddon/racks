const { JsonRpcProvider, Contract } = require("ethers");
require("dotenv").config();

const TOKEN = process.argv[2] || "0xe88AC3eb472f7b6fe1e8Ae4fCb53dF48A731b352";

async function main() {
  const rpc = process.env.RH_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
  const provider = new JsonRpcProvider(rpc);
  const { chainId } = await provider.getNetwork();
  console.log("chainId:", chainId);

  const code = await provider.getCode(TOKEN);
  console.log("hasCode:", code !== "0x" && code.length > 2);

  const t = new Contract(TOKEN, [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
  ], provider);

  const [name, symbol, decimals, totalSupply] = await Promise.all([
    t.name().catch(() => null),
    t.symbol().catch(() => null),
    t.decimals().catch(() => null),
    t.totalSupply().catch(() => null),
  ]);
  console.log("name:", name);
  console.log("symbol:", symbol);
  console.log("decimals:", decimals);
  console.log("totalSupply:", totalSupply?.toString(), "(" + (totalSupply / 10n ** BigInt(decimals || 18)) + " tokens)");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});