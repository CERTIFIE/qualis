import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { definePlugin, PLUGIN_API_VERSION, type ProcessPluginDescriptor, type RulePackPlugin } from "@qualis/plugin-api";

/** Minimum major version of the .NET runtime needed by the helper. */
const DOTNET_MAJOR = 10;

const HELPER = fileURLToPath(new URL("../bin/Qualis.Roslyn.dll", import.meta.url));
const VERSION: string = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** Why the helper cannot run here, or undefined when it can. */
export function unavailableReason(): string | undefined {
  if (!existsSync(HELPER)) return "the .NET helper is not built (run `pnpm --filter @qualis/plugin-roslyn build:dotnet`)";
  const runtimes = spawnSync("dotnet", ["--list-runtimes"], { encoding: "utf8" });
  if (runtimes.status !== 0) return "the `dotnet` command was not found";
  const majors = [...runtimes.stdout.matchAll(/^Microsoft\.NETCore\.App (\d+)\./gm)].map((m) => Number(m[1]));
  if (!majors.some((m) => m >= DOTNET_MAJOR)) return `the .NET runtime ${DOTNET_MAJOR} or later is required (found ${majors.join(", ") || "none"})`;
  return undefined;
}

/**
 * The Roslyn rule pack runs as a .NET process speaking the stdio protocol. When
 * it cannot run, a stand-in pack reports why during prepare, so that the rules
 * it would supersede keep running.
 */
export default function createPlugin(): ProcessPluginDescriptor | RulePackPlugin {
  const reason = unavailableReason();
  return reason ? unavailablePack(reason) : { command: "dotnet", args: [HELPER] };
}

/** Stand-in rule pack used when the helper cannot run: it fails in prepare with the reason. */
export function unavailablePack(reason: string): RulePackPlugin {
  return definePlugin({
    apiVersion: PLUGIN_API_VERSION,
    kind: "rule-pack",
    id: "roslyn",
    name: "Roslyn (.NET code analysis)",
    version: VERSION,
    description: `Unavailable: ${reason}.`,
    languages: [{ id: "csharp", name: "C#", extensions: [".cs"] }],
    rules: [],
    prepare() {
      throw new Error(`Roslyn rules skipped: ${reason}`);
    },
    analyzeFile() {
      return { issues: [] };
    },
  });
}
