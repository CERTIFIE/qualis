// `pnpm ui` from a checkout of the repository: serves the web UI. Projects and uploaded analyses are kept in
// <repo>/.qualis-ui (QUALIS_DATA_DIR); "Import project" browses the home directory (QUALIS_BROWSE_ROOT).
// `pnpm ui --dev` runs the development server instead. Builds the UI the first time.
import { spawnSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = path.join(root, "apps/ui");
const dev = process.argv.includes("--dev");
const dataDir = process.env.QUALIS_DATA_DIR ?? path.join(root, ".qualis-ui");
const browseRoot = process.env.QUALIS_BROWSE_ROOT ?? os.homedir();
const port = process.env.PORT ?? "3000";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const run = (args, cwd = root) => spawnSync(pnpm, args, { cwd, stdio: "inherit" }).status ?? 1;

if (dev) {
  if (run(["exec", "tsc", "-b", "packages/schema"]) !== 0) process.exit(1);
} else if (!existsSync(path.join(ui, ".next", "BUILD_ID"))) {
  console.log("Building the web UI (first run)…");
  if (run(["ui:build"]) !== 0) process.exit(1);
}
// The documentation under /docs: the pages pnpm docs:build writes in docs/site/app.
if (!existsSync(path.join(root, "docs/site/app/nav.json"))) {
  console.log("Building the documentation (first run)…");
  if (run(["docs:build"]) !== 0) console.warn("The documentation could not be built: /docs explains how to build it.");
}
mkdirSync(dataDir, { recursive: true });
console.log(`Qualis web UI: http://localhost:${port}  (data: ${dataDir}, import from: ${browseRoot})`);
const server = spawn(pnpm, ["exec", "next", dev ? "dev" : "start", "-p", port], {
  cwd: ui,
  stdio: "inherit",
  env: { ...process.env, QUALIS_DATA_DIR: dataDir, QUALIS_BROWSE_ROOT: browseRoot },
});
server.on("exit", (code) => process.exit(code ?? 0));
