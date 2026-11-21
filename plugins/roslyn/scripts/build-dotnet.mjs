// Publishes the .NET helper into bin/ when the .NET SDK is available; skips otherwise.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (spawnSync("dotnet", ["--version"], { stdio: "ignore" }).status !== 0) {
  console.log("@qualis/plugin-roslyn: .NET SDK not found, the Roslyn rule pack is not built.");
  process.exit(0);
}
const result = spawnSync("dotnet", ["publish", path.join(root, "dotnet/Qualis.Roslyn.csproj"), "-c", "Release", "-o", path.join(root, "bin"), "--nologo", "-v", "q"], { stdio: "inherit" });
process.exit(result.status ?? 1);
