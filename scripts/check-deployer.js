const { Wallet } = require("ethers");

// Prints the wallet address derived from the PRIVATE_KEY in .env, without
// ever printing the key itself. Use it to confirm the deployer == your dev wallet.
require("dotenv").config();

const key = process.env.PRIVATE_KEY;
if (!key) {
  console.error("PRIVATE_KEY not set in .env");
  process.exit(1);
}
if (/^0*$/.test(key)) {
  console.error("PRIVATE_KEY is empty/placeholder in .env");
  process.exit(1);
}

try {
  console.log("deployer address:", new Wallet(key).address);
} catch (e) {
  console.error("PRIVATE_KEY is not a valid key:", e.message.split("\n")[0]);
  process.exit(1);
}