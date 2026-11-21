import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  analyze,
  CONFIG_FILE_NAMES,
  DEFAULT_QUALITY_GATE,
  loadConfig,
  loadPlugin,
  resolveRules,
  validate,
  writeReport,
  type ProgressEvent,
} from "@qualis/core";
import type { LogLevel } from "@qualis/plugin-api";
import type { Report } from "@qualis/schema";
import { bold, dim, issueLines, red, summary } from "./format.js";

export const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;

/** Where the bundled plugins are installed (next to the CLI). */
const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));

export const EXIT = { ok: 0, gateFailed: 1, error: 2 } as const;

const HELP = `qualis ${VERSION} – static code analysis with an open report format

Usage:
  qualis analyze [dir]       Analyse a project and evaluate the quality gate
  qualis rules [dir]         List the rules of the configured plugins
  qualis init [dir]          Create a qualis.config.json with the defaults
  qualis validate <report>   Validate a report against the published JSON Schema

Options for analyze:
  -c, --config <file>        Configuration file (default: qualis.config.json in dir)
  -o, --output <dir>         Output directory (default: .qualis)
  -f, --format <list>        Comma-separated output formats: json, sarif (default: json)
      --new-code <ref>       Git reference new code is compared with (default: auto)
      --no-new-code          Disable new-code detection
      --coverage <glob>      Coverage report (LCOV, Cobertura or OpenCover); repeatable
      --tests <glob>         Test report (JUnit XML or TRX); repeatable
      --external <glob>      Linter report to import (SARIF or ESLint JSON); repeatable
      --include-sources      Embed file contents in the report (for viewers)
      --history <n>          Analyses kept in <output>/history (default: 20, 0 = off)
      --issues               Print every issue
      --no-fail              Exit with 0 even when the quality gate fails
      --strict-plugins       Validate in-process plugin results against the schema
  -q, --quiet                Print nothing but errors
  -v, --verbose              Print progress and plugin logs

Options for rules:
      --json                 Print rule definitions as JSON

Exit codes: 0 gate passed, 1 gate failed, 2 error.
`;

function logger(verbose: boolean) {
  return {
    log(level: LogLevel, message: string) {
      if (level === "error") process.stderr.write(red(`error: ${message}`) + "\n");
      else if (verbose) process.stderr.write(dim(`${level}: ${message}`) + "\n");
    },
  };
}

async function runAnalyze(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c" },
      output: { type: "string", short: "o" },
      format: { type: "string", short: "f" },
      "new-code": { type: "string" },
      "no-new-code": { type: "boolean" },
      coverage: { type: "string", multiple: true },
      tests: { type: "string", multiple: true },
      external: { type: "string", multiple: true },
      "include-sources": { type: "boolean" },
      history: { type: "string" },
      issues: { type: "boolean" },
      "no-fail": { type: "boolean" },
      "strict-plugins": { type: "boolean" },
      quiet: { type: "boolean", short: "q" },
      verbose: { type: "boolean", short: "v" },
    },
  });
  const baseDir = path.resolve(positionals[0] ?? ".");
  const verbose = Boolean(values.verbose);
  const quiet = Boolean(values.quiet);
  const progress = (event: ProgressEvent) => {
    if (quiet || !process.stderr.isTTY) return;
    if (event.type === "file-analyzed") process.stderr.write(`\r${dim(`Analysing ${event.done}/${event.total}`)}\x1b[K`);
    else if (event.type === "phase") process.stderr.write(`\r${dim(`Computing ${event.name}…`)}\x1b[K`);
  };
  const overrides: NonNullable<Parameters<typeof analyze>[0]["overrides"]> = {};
  if (values["no-new-code"]) overrides.newCodeReference = null;
  else if (values["new-code"]) overrides.newCodeReference = values["new-code"];
  if (values.coverage) overrides.coverageReports = values.coverage;
  if (values.tests) overrides.testReports = values.tests;
  if (values.external) overrides.externalIssueReports = values.external;
  if (values["include-sources"]) overrides.includeSources = true;

  const report = await analyze({
    baseDir,
    ...(values.config && { configFile: values.config }),
    overrides,
    resolvePluginsFrom: [CLI_DIR],
    strictPlugins: Boolean(values["strict-plugins"]),
    log: logger(verbose),
    onProgress: progress,
  });
  if (!quiet && process.stderr.isTTY) process.stderr.write("\r\x1b[K");

  const config = loadConfig(baseDir, values.config);
  const formats = (values.format?.split(",").map((f) => f.trim()) ?? config.output.formats) as ("json" | "sarif")[];
  for (const f of formats) if (f !== "json" && f !== "sarif") throw new Error(`Unknown format "${String(f)}"`);
  const outputDir = path.resolve(baseDir, values.output ?? config.output.dir);
  const history = values.history === undefined ? config.output.history : Number(values.history);
  if (!Number.isInteger(history) || history < 0) throw new Error("--history must be a non-negative integer");
  const written = await writeReport(report, outputDir, formats, history);

  if (!quiet) {
    if (values.issues && report.issues.length) process.stdout.write(issueLines(report) + "\n");
    process.stdout.write(summary(report, written.map((w) => path.relative(process.cwd(), w))));
  }
  return report.qualityGate.status === "failed" && !values["no-fail"] ? EXIT.gateFailed : EXIT.ok;
}

async function runRules(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { json: { type: "boolean" }, config: { type: "string", short: "c" } } });
  const baseDir = path.resolve(positionals[0] ?? ".");
  const config = loadConfig(baseDir, values.config);
  const log = logger(false);
  const manifests = [];
  for (const reference of config.plugins) {
    const plugin = await loadPlugin(reference, { baseDir, resolveFrom: [CLI_DIR], log });
    manifests.push(plugin.manifest);
    await plugin.dispose();
  }
  const { active } = resolveRules(manifests, config.rules);
  if (values.json) {
    process.stdout.write(JSON.stringify(manifests.flatMap((m) => m.rules.map((r) => ({ ...r, enabled: active.has(r.id) }))), null, 2) + "\n");
    return EXIT.ok;
  }
  for (const m of manifests) {
    process.stdout.write(`\n${bold(m.name)} ${dim(`(${m.id} ${m.version}, ${m.rules.length} rules)`)}\n`);
    for (const r of m.rules) {
      const state = active.has(r.id) ? " " : dim("off");
      process.stdout.write(`  ${state.padEnd(3)} ${r.id.padEnd(42)} ${r.type.padEnd(13)} ${(active.get(r.id)?.severity ?? r.severity).padEnd(8)} ${r.name}\n`);
    }
  }
  process.stdout.write("\n");
  return EXIT.ok;
}

function runInit(args: string[]): number {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const baseDir = path.resolve(positionals[0] ?? ".");
  const existing = CONFIG_FILE_NAMES.map((n) => path.join(baseDir, n)).find((f) => existsSync(f));
  if (existing) {
    process.stderr.write(`${existing} already exists.\n`);
    return EXIT.error;
  }
  const file = path.join(baseDir, CONFIG_FILE_NAMES[0]);
  const config = {
    $schema: "./node_modules/@qualis/schema/schemas/config.schema.json",
    project: { name: path.basename(baseDir) },
    exclude: [],
    coverage: { reports: ["coverage/lcov.info", "**/coverage.cobertura.xml", "**/coverage.opencover.xml"] },
    tests: { reports: ["**/junit.xml", "**/TestResults/*.trx"] },
    newCode: { reference: "auto" },
    rules: {},
    qualityGate: DEFAULT_QUALITY_GATE,
    output: { dir: ".qualis", formats: ["json", "sarif"] },
  };
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  process.stdout.write(`Created ${path.relative(process.cwd(), file)}\n`);
  return EXIT.ok;
}

function runValidate(args: string[]): number {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const file = positionals[0];
  if (!file) throw new Error("Usage: qualis validate <report.json>");
  const report = JSON.parse(readFileSync(file, "utf8")) as Report;
  const result = validate("report", report);
  if (result.valid) {
    process.stdout.write(`${file}: valid Qualis report (schema ${report.schemaVersion})\n`);
    return EXIT.ok;
  }
  process.stderr.write(`${file}: invalid report\n  ${result.errors.join("\n  ")}\n`);
  return EXIT.error;
}

/** Entry point; returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "analyze":
        return await runAnalyze(rest);
      case "rules":
        return await runRules(rest);
      case "init":
        return runInit(rest);
      case "validate":
        return runValidate(rest);
      case "--version":
      case "-V":
        process.stdout.write(VERSION + "\n");
        return EXIT.ok;
      case undefined:
      case "help":
      case "--help":
      case "-h":
        process.stdout.write(HELP);
        return EXIT.ok;
      default:
        process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
        return EXIT.error;
    }
  } catch (error) {
    process.stderr.write(red(`error: ${(error as Error).message}`) + "\n");
    return EXIT.error;
  }
}
