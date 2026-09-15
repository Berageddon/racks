// Extracts ABIs from Hardhat artifacts into web/src/contracts for the frontend.
const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "..", "web", "src", "contracts");
fs.mkdirSync(outDir, { recursive: true });

const sources = [
  ["artifacts/contracts/RacksGame.sol/RacksGame.json", "RacksGameABI.json"],
  ["artifacts/contracts/RackLotto.sol/RackLotto.json", "RackLottoABI.json"],
];

for (const [artifactPath, outName] of sources) {
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  fs.writeFileSync(path.join(outDir, outName), JSON.stringify(artifact.abi, null, 2));
  console.log(`Exported ${outName}`);
}