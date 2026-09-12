import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const fromWebRoot = existsSync(join(root, "web", "dist")) && existsSync(join(root, "web", "worker.js"));

const assets = {
  directory: fromWebRoot ? "web/dist" : "dist",
  binding: "ASSETS",
  not_found_handling: "single-page-application",
  run_worker_first: true,
};

const config = {
  name: "racks",
  main: fromWebRoot ? "web/worker.js" : "worker.js",
  compatibility_date: "2026-09-11",
  observability: { enabled: true },
  assets,
};

writeFileSync(join(root, "wrangler.jsonc"), `${JSON.stringify(config, null, 2)}\n`);