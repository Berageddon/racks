const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const network = hre.network.name;
  const file = `deployed-${network}.json`;
  if (!fs.existsSync(file)) {
    throw new Error(`No deployment output found. Run deploy first (${file}).`);
  }

  const { racksGame, token, devWallet } = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`Verifying RacksGame at ${racksGame} on ${network}...`);

  try {
    await hre.run("verify:verify", {
      address: racksGame,
      constructorArguments: [token, devWallet],
    });
    console.log("Verified.");
  } catch (err) {
    console.error("Verification failed (already verified or API hiccup):", err.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});