import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const fromWebRoot = existsSync(join(root, "web", "dist")) && existsSync(join(root, "web", "worker.js"));

const config = fromWebRoot
  ? {
      name: "racks",
      main: "web/worker.js",
      compatibility_date: "2026-09-11",
      observability: { enabled: true },
      assets: { directory: "web/dist", not_found_handling: "single-page-application" },
    }
  : {
      name: "racks",
      main: "worker.js",
      compatibility_date: "2026-09-11",
      observability: { enabled: true },
      assets: { directory: "dist", not_found_handling: "single-page-application" },
    };

writeFileSync(join(root, "wrangler.jsonc"), `${JSON.stringify(config, null, 2)}\n`);