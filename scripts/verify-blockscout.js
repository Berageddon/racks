const fs = require("fs");
const { Interface, getAddress } = require("ethers");

// Usage: node scripts/verify-blockscout.js <network> <flattened-source-filename>
// e.g.  node scripts/verify-blockscout.js rhMainnet 40/Flattened.sol
async function main() {
  const network = process.argv[2];
  const flattenedFile = process.argv[3];
  if (!network || !flattenedFile) throw new Error("usage: node scripts/verify-blockscout.js <network> <flattened-source>");

  const file = `deployed-${network}.json`;
  if (!fs.existsSync(file)) throw new Error(`${file} not found`);
  const { racksGame, token, devWallet } = JSON.parse(fs.readFileSync(file, "utf8"));

  const source = fs.readFileSync(flattenedFile, "utf8");
  const ctorArgs = new Interface([
    "constructor(address racks_, address devWallet_)",
  ]).encodeDeploy([getAddress(token), getAddress(devWallet)]).slice(2);

  const body = new URLSearchParams({
    module: "contract",
    action: "verify",
    apikey: "empty",
    contractaddress: racksGame,
    sourceCode: source,
    codeformat: "solidity-single-file",
    contractname: "RacksGame",
    compilerversion: "v0.8.24+commit.e11b9ed9",
    optimizationUsed: "true",
    runs: "200",
    evmVersion: "paris",
    constructorArguments: ctorArgs,
    licenseType: "3",
  });

  const rpc = new URL(process.env.RH_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com");
  const host = process.env.BLOCKSCOUT_URL || "https://robinhoodchain.blockscout.com";
  const res = await fetch(`${host}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    console.error(`HTTP ${res.status}; non-JSON response:`);
    console.error(raw.slice(0, 800));
    process.exit(1);
  }
  console.log("verify response:", JSON.stringify(json));
  if (json.status === "1") {
    console.log("GUID:", json.result);
    // Poll status
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await fetch(`${host}/api?module=contract&action=checkverifystatus&guid=${json.result}`);
      const sj = await s.json();
      console.log("status poll:", JSON.stringify(sj));
      if (sj.result !== "Pending in queue" && sj.result !== "Verifying...") break;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});