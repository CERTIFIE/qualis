import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Report } from "@qualis/schema";
import { analyze, toSarif, validate, writeReport } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
/** The CLI package depends on the bundled plugins, so they resolve from there. */
const CLI_DIR = path.join(repoRoot, "packages/cli");

const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, stdio: "pipe" }).toString();

function write(root: string, file: string, content: string) {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const shared = Array.from({ length: 14 }, (_, i) => `  total += values[${i}] * weights[${i}] + offsets[${i}];`).join("\n");

describe("analyze (end to end)", () => {
  let root: string;
  let report: Report;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "qualis-e2e-"));
    git(root, "init", "-q", "-b", "main");
    write(root, "src/math.ts", `export function sum(values: number[], weights: number[], offsets: number[]): number {\n  let total = 0;\n${shared}\n  return total;\n}\n`);
    write(root, "src/Service.cs", "namespace Demo;\npublic class Service\n{\n    public int Twice(int x) => x * 2;\n}\n");
    write(root, "config/app.ini", "name = demo\n");
    write(root, "node_modules/ignored/index.js", "eval('x');\n");
    write(root, ".gitignore", "node_modules/\n.qualis/\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "base");
    git(root, "checkout", "-q", "-b", "feature");
    // New code: a vulnerability, a copy of an existing block, an empty INI key.
    write(root, "src/copy.ts", `export function sum2(values: number[], weights: number[], offsets: number[]): number {\n  let total = 0;\n${shared}\n  return total;\n}\n`);
    write(root, "src/run.ts", "export function run(code: string) {\n  return eval(code);\n}\n");
    write(root, "config/app.ini", "name = demo\ntimeout =\n");
    write(root, "coverage/lcov.info", "SF:src/run.ts\nDA:1,1\nDA:2,0\nend_of_record\n");
    write(root, "reports/junit.xml", '<testsuite name="unit"><testcase name="a" time="0.1"/><testcase name="b"><failure message="nope"/></testcase></testsuite>');
    write(
      root,
      "qualis.config.json",
      JSON.stringify({
        project: { key: "demo", name: "Demo" },
        plugins: [
          "@qualis/plugin-typescript",
          "@qualis/plugin-csharp",
          { command: process.execPath, args: [path.join(here, "fixtures/stdio-plugin.mjs")] },
        ],
        coverage: { reports: ["coverage/lcov.info"] },
        tests: { reports: ["reports/*.xml"] },
        duplication: { minTokens: 60, minLines: 10 },
        newCode: { reference: "main" },
      }),
    );
    report = await analyze({ baseDir: root, resolvePluginsFrom: [CLI_DIR], strictPlugins: true });
  }, 120_000);

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("produces a report valid against the published schema", () => {
    const result = validate("report", report);
    expect(result.errors).toEqual([]);
    expect(report.diagnostics.filter((d) => d.level === "error")).toEqual([]);
  });

  it("loads module and process plugins and skips ignored files", () => {
    expect(report.tool.plugins.map((p) => `${p.id}:${p.transport}`)).toEqual(["typescript:module", "csharp:module", "ini:process"]);
    expect(report.files.map((f) => f.path)).toEqual(["config/app.ini", "src/copy.ts", "src/math.ts", "src/run.ts", "src/Service.cs"].sort());
  });

  it("marks issues on new code and computes new-code measures", () => {
    const evalIssue = report.issues.find((i) => i.ruleId === "typescript:no-eval")!;
    expect(evalIssue).toMatchObject({ path: "src/run.ts", type: "vulnerability", characteristic: "security", severity: "critical", isNew: true });
    const ini = report.issues.find((i) => i.ruleId === "ini:empty-value")!;
    expect(ini).toMatchObject({ path: "config/app.ini", isNew: true, range: { startLine: 2 } });
    expect(report.analysis.newCode?.reference).toBe("main");
    expect(report.files.find((f) => f.path === "config/app.ini")!.newLines).toEqual([2]);
    expect(report.measures.newCode!.ratings.security).toBe("D");
  });

  it("detects duplications between files", () => {
    expect(report.duplications).toHaveLength(1);
    expect(report.duplications[0]!.occurrences.map((o) => o.path).sort()).toEqual(["src/copy.ts", "src/math.ts"]);
    expect(report.measures.overall.duplication.duplicatedBlocks).toBe(2);
    expect(report.measures.newCode!.duplicatedLines).toBeGreaterThan(0);
  });

  it("imports coverage and test results", () => {
    // run.ts is in the report (2 lines); math.ts and copy.ts (18 lines of code each) are not,
    // so they count as not covered. C# and INI files are not measured: no report covers them.
    expect(report.measures.overall.coverage).toMatchObject({ linesToCover: 38, coveredLines: 1 });
    expect(report.files.find((f) => f.path === "src/run.ts")!.coverage).toEqual({ coveredLines: [1], uncoveredLines: [2], partialLines: [] });
    expect(report.files.find((f) => f.path === "src/math.ts")!.coverage).toMatchObject({ notInReports: true, coveredLines: [] });
    expect(report.files.find((f) => f.path === "src/Service.cs")!.coverage).toBeUndefined();
    expect(report.measures.overall.tests).toMatchObject({ total: 2, passed: 1, failed: 1 });
  });

  it("can ignore files missing from the reports or exclude files from coverage", async () => {
    const base = JSON.parse(readFileSync(path.join(root, "qualis.config.json"), "utf8"));
    const write = (name: string, coverage: object) => {
      writeFileSync(path.join(root, name), JSON.stringify({ ...base, coverage: { reports: ["coverage/lcov.info"], ...coverage } }));
      return path.join(root, name);
    };
    const ignored = await analyze({ baseDir: root, configFile: write("ignore.json", { missingFiles: "ignore" }), resolvePluginsFrom: [CLI_DIR] });
    expect(ignored.measures.overall.coverage).toMatchObject({ linesToCover: 2, coveredLines: 1, lineCoverage: 50 });
    const excluded = await analyze({ baseDir: root, configFile: write("exclude.json", { exclude: ["src/copy.ts"] }), resolvePluginsFrom: [CLI_DIR] });
    expect(excluded.measures.overall.coverage).toMatchObject({ linesToCover: 20, coveredLines: 1 });
    expect(excluded.files.find((f) => f.path === "src/copy.ts")!.coverage).toBeUndefined();
  }, 120_000);

  it("computes function statistics and hotspots", () => {
    const stats = report.measures.overall.functionStats;
    expect(stats.count).toBe(4);
    expect(stats.averageMaintainabilityIndex).not.toBeNull();
    expect(report.measures.overall.hotspots.complexity[0]).toMatchObject({ value: 1 });
  });

  it("evaluates the default quality gate", () => {
    expect(report.qualityGate.status).toBe("failed");
    const failed = report.qualityGate.conditions.filter((c) => c.status === "failed").map((c) => `${c.scope}:${c.metric}`);
    expect(failed).toEqual(expect.arrayContaining(["new:securityRating", "new:reliabilityRating", "new:coverage", "new:duplicatedLinesDensity", "overall:testFailures"]));
  });

  it("produces stable issue fingerprints", async () => {
    const again = await analyze({ baseDir: root, resolvePluginsFrom: [CLI_DIR] });
    expect(again.issues.map((i) => i.id)).toEqual(report.issues.map((i) => i.id));
  }, 60_000);

  it("writes JSON and SARIF output", async () => {
    const out = path.join(root, ".qualis");
    const written = await writeReport(report, out, ["json", "sarif"]);
    expect(written.map((w) => path.basename(w))).toEqual(["report.json", "report.sarif"]);
    const sarif = JSON.parse(readFileSync(path.join(out, "report.sarif"), "utf8")) as ReturnType<typeof toSarif> & { runs: { results: unknown[] }[] };
    expect(sarif.runs[0]!.results.length).toBe(report.issues.length);
  });
});

describe("test code", () => {
  let root: string;
  const run = (config: object) => {
    writeFileSync(path.join(root, "qualis.config.json"), JSON.stringify({ plugins: ["@qualis/plugin-typescript"], newCode: { reference: null }, ...config }));
    return analyze({ baseDir: root, resolvePluginsFrom: [CLI_DIR] });
  };

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "qualis-tests-"));
    write(root, "src/app.ts", "export function run(code: string) {\n  return eval(code);\n}\n");
    write(root, "src/app.test.ts", "declare const x: number;\neval('1');\nexport const bad = x === NaN;\n");
    write(root, "src/testing/support.ts", "export function check(code: string) {\n  return eval(code);\n}\n");
    write(root, "coverage/lcov.info", "SF:src/app.ts\nDA:1,1\nDA:2,1\nend_of_record\n");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("leaves test files out of the measures and applies only bug rules to them by default", async () => {
    const report = await run({ coverage: { reports: ["coverage/lcov.info"] }, tests: { sources: ["**/*.test.*", "**/testing/**"] } });
    expect(validate("report", report).errors).toEqual([]);
    expect(report.files.filter((f) => f.test).map((f) => f.path)).toEqual(["src/app.test.ts", "src/testing/support.ts"]);
    expect(report.measures.overall.files).toBe(1);
    expect(report.measures.overall.ncloc).toBe(report.files.find((f) => f.path === "src/app.ts")!.measures.ncloc);
    expect(report.measures.overall.testCode).toMatchObject({ files: 2 });
    expect(report.measures.overall.functionStats.count).toBe(1);
    // Test files are not counted as uncovered.
    expect(report.measures.overall.coverage).toMatchObject({ linesToCover: 2, coveredLines: 2 });
    const issues = report.issues.map((i) => `${i.path}:${i.ruleId}`);
    expect(issues).toContain("src/app.ts:typescript:no-eval");
    expect(issues).toContain("src/app.test.ts:typescript:no-compare-nan");
    expect(issues.filter((i) => i.includes("no-eval"))).toEqual(["src/app.ts:typescript:no-eval"]);
    expect(report.rules.find((r) => r.id === "typescript:no-eval")!.scope).toBe("main");
    expect(report.rules.find((r) => r.id === "typescript:no-compare-nan")!.scope).toBe("all");
  }, 60_000);

  it("follows the configured test sources and rule scopes", async () => {
    const scoped = await run({ rules: { "typescript:no-eval": { scope: "all" } }, tests: { sources: ["**/*.test.*", "**/testing/**"] } });
    expect(scoped.issues.filter((i) => i.ruleId === "typescript:no-eval").map((i) => i.path)).toEqual(["src/app.test.ts", "src/app.ts", "src/testing/support.ts"]);
    const onlyTests = await run({ rules: { "typescript:no-eval": { scope: "test" } }, tests: { sources: ["**/*.test.ts"] } });
    expect(onlyTests.files.filter((f) => f.test).map((f) => f.path)).toEqual(["src/app.test.ts"]);
    expect(onlyTests.issues.filter((i) => i.ruleId === "typescript:no-eval").map((i) => i.path)).toEqual(["src/app.test.ts"]);
    const none = await run({ tests: { sources: [] } });
    expect(none.files.some((f) => f.test)).toBe(false);
    expect(none.measures.overall.testCode).toEqual({ files: 0, lines: 0, ncloc: 0 });
  }, 60_000);
});

describe("external issues", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "qualis-external-"));
    write(root, "src/app.ts", "export function run(code: string) {\n  return eval(code);\n}\n");
    write(root, "src/app.test.ts", "export const value = 1;\n");
    write(root, "src/tool.py", "print(1)\n");
    const abs = (file: string) => path.join(root, file);
    write(root, "reports/eslint.json", JSON.stringify([
      {
        filePath: abs("src/app.ts"),
        messages: [
          { ruleId: "react-hooks/exhaustive-deps", severity: 1, message: "Missing dependency", line: 1, column: 8, endLine: 1, endColumn: 11 },
          { ruleId: "no-console", severity: 2, message: "Unexpected console statement", line: 2, column: 3 },
          { ruleId: "no-eval", severity: 2, message: "eval can be harmful", line: 2, column: 10 },
          { ruleId: "@next/next/no-img-element", severity: 2, message: "Definition for rule '@next/next/no-img-element' was not found.", line: 3, column: 1 },
        ],
      },
      { filePath: abs("src/app.test.ts"), messages: [{ ruleId: "no-console", severity: 2, message: "Unexpected console statement", line: 1, column: 1 }, { ruleId: null, fatal: true, severity: 2, message: "Parsing error", line: 1, column: 1 }] },
      { filePath: abs("src/tool.py"), messages: [{ ruleId: "no-console", severity: 2, message: "x", line: 1, column: 1 }] },
      { filePath: "/elsewhere/other.ts", messages: [{ ruleId: "no-console", severity: 2, message: "x", line: 1, column: 1 }] },
    ]));
    write(root, "reports/semgrep.sarif", JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "Semgrep OSS", rules: [{ id: "js.eval-injection", shortDescription: { text: "Eval with user input" }, helpUri: "https://semgrep.dev/r/js.eval-injection", properties: { tags: ["security", "CWE-95"] }, messageStrings: { default: { text: "Input {0} reaches eval" } } }] } },
          originalUriBaseIds: { SRCROOT: { uri: pathToFileURL(root + "/").href } },
          results: [
            { ruleId: "js.eval-injection", ruleIndex: 0, level: "error", message: { id: "default", arguments: ["code"] }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/app.ts", uriBaseId: "SRCROOT" }, region: { startLine: 2, startColumn: 10, endColumn: 20 } } }] },
            { ruleId: "js.eval-injection", level: "error", message: { text: "suppressed" }, suppressions: [{ kind: "inSource" }], locations: [{ physicalLocation: { artifactLocation: { uri: "src/app.ts", uriBaseId: "SRCROOT" }, region: { startLine: 1 } } }] },
            { ruleId: "js.eval-injection", level: "error", message: { text: "stale" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/app.ts", uriBaseId: "SRCROOT" }, region: { startLine: 99 } } }] },
          ],
        },
      ],
    }));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const run = (config: object) => {
    writeFileSync(path.join(root, "qualis.config.json"), JSON.stringify({ plugins: ["@qualis/plugin-typescript"], newCode: { reference: null }, ...config }));
    return analyze({ baseDir: root, resolvePluginsFrom: [CLI_DIR] });
  };

  it("imports SARIF and ESLint JSON reports as issues of external rules", async () => {
    const report = await run({
      externalIssues: { reports: ["reports/*"], types: { "external:eslint:no-con*": "bug" } },
      rules: { "external:eslint:react-hooks/exhaustive-deps": "critical" },
    });
    expect(validate("report", report).errors).toEqual([]);
    expect(report.externalIssueReports).toEqual(["reports/eslint.json", "reports/semgrep.sarif"]);
    const external = report.issues.filter((i) => i.ruleId.startsWith("external:")).map((i) => `${i.path}:${i.range.startLine}:${i.ruleId}:${i.type}:${i.severity}`);
    expect(external).toEqual([
      "src/app.test.ts:1:external:eslint:no-console:bug:major",
      "src/app.ts:1:external:eslint:react-hooks/exhaustive-deps:code-smell:critical",
      "src/app.ts:2:external:eslint:no-console:bug:major",
      "src/app.ts:2:external:semgrep-oss:js.eval-injection:security-hotspot:major",
    ]);
    // no-eval is reported by Qualis on the same line: the ESLint copy is dropped.
    expect(report.issues.filter((i) => i.path === "src/app.ts" && i.range.startLine === 2).map((i) => i.ruleId)).toContain("typescript:no-eval");
    expect(report.issues.find((i) => i.ruleId.endsWith("js.eval-injection"))!.message).toBe("Input code reaches eval");
    const semgrep = report.rules.find((r) => r.id === "external:semgrep-oss:js.eval-injection")!;
    expect(semgrep).toMatchObject({ plugin: "external", name: "Eval with user input", languages: ["typescript"], external: { tool: "Semgrep OSS", ruleId: "js.eval-injection" } });
    expect(semgrep.references[0]!.url).toBe("https://semgrep.dev/r/js.eval-injection");
    expect(report.rules.find((r) => r.id === "external:eslint:no-console")!.scope).toBe("all");
    const messages = report.diagnostics.map((d) => d.message).join("\n");
    expect(messages).toContain("ESLint could not parse 1 file(s)");
    expect(messages).toContain("ESLint rules the configuration does not define (@next/next/no-img-element)");
    expect(messages).toContain("Imported 4 external issue(s) from 2 report(s); left out: 1 already reported by Qualis");
    expect(messages).toContain("1 external issue(s) on files that are not analysed were ignored");
    expect(messages).toContain("1 external issue(s) on files outside the project were ignored");
    expect(messages).toContain("1 external issue(s) point past the end of their file");
  }, 60_000);

  it("applies rule settings and scopes to external rules", async () => {
    const report = await run({
      externalIssues: { reports: ["reports/eslint.json"], effortMinutes: 2 },
      rules: { "external:eslint:react-hooks/exhaustive-deps": "off", "external:eslint:no-console": { exclude: ["src/app.ts"], scope: "all" } },
    });
    expect(report.diagnostics.some((d) => d.message.includes("Unknown rule"))).toBe(false);
    const external = report.issues.filter((i) => i.ruleId.startsWith("external:"));
    expect(external.map((i) => `${i.path}:${i.ruleId}:${i.effortMinutes}`)).toEqual(["src/app.test.ts:external:eslint:no-console:2"]);
    expect(report.rules.some((r) => r.id === "external:eslint:react-hooks/exhaustive-deps")).toBe(false);
    // By default code smells of external tools, like those of Qualis, skip test code.
    const defaults = await run({ externalIssues: { reports: ["reports/eslint.json"] } });
    expect(defaults.issues.filter((i) => i.ruleId === "external:eslint:no-console").map((i) => i.path)).toEqual(["src/app.ts"]);
  }, 60_000);
});

describe(".NET build error logs", () => {
  let root: string;
  const cs = (name: string) => `namespace Demo;\npublic class ${name}\n{\n    public int Twice(int x) => x * 2;\n}\n`;
  const v1Result = (file: string, line: number, id = "CA1822") => ({
    ruleId: id,
    level: "warning",
    message: `${id} in ${path.basename(file)}`,
    locations: [{ resultFile: { uri: pathToFileURL(path.join(root, file)).href, region: { startLine: line, startColumn: 5, endLine: line, endColumn: 15 } } }],
  });
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "qualis-dotnet-"));
    write(root, "src/A/A.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\" />\n");
    write(root, "src/A/Foo.cs", cs("Foo"));
    write(root, "src/A/Nested/Nested.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\" />\n");
    write(root, "src/A/Nested/Baz.cs", cs("Baz"));
    write(root, "src/B/B.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\" />\n");
    write(root, "src/B/Bar.cs", cs("Bar"));
    write(root, "src/B/Directory.Build.props", "<Project>\n  <PropertyGroup>\n    <!-- <ErrorLog>ignored.sarif</ErrorLog> -->\n    <ErrorLog>$(MSBuildThisFileDirectory)../../artifacts/$(MSBuildProjectName).sarif,version=2.1</ErrorLog>\n  </PropertyGroup>\n</Project>\n");
    // SARIF 1.0, the default of ErrorLog, written by `dotnet build -p:ErrorLog=build.sarif` in the project folder.
    write(root, "src/A/build.sarif", JSON.stringify({
      version: "1.0.0",
      runs: [{
        tool: { name: "Compilatore Microsoft (R) Visual C#" },
        results: [v1Result("src/A/Foo.cs", 4), v1Result("src/A/Nested/Baz.cs", 4), v1Result("src/B/Bar.cs", 4), { ...v1Result("src/A/Foo.cs", 2, "CA1050"), suppressionStates: ["suppressedInSource"] }],
        rules: { CA1822: { id: "CA1822", shortDescription: "Mark members as static", helpUri: "https://learn.microsoft.com/dotnet/fundamentals/code-analysis/quality-rules/ca1822", properties: { category: "Performance" } } },
      }],
    }));
    write(root, "artifacts/B.sarif", JSON.stringify({
      version: "2.1.0",
      runs: [
        { tool: { driver: { name: "Microsoft (R) Visual C# Compiler", rules: [{ id: "CS0219", shortDescription: { text: "Variable is assigned but its value is never used" } }] } }, results: [{ ruleId: "CS0219", level: "warning", message: { text: "unused" }, locations: [{ physicalLocation: { artifactLocation: { uri: pathToFileURL(path.join(root, "src/B/Bar.cs")).href }, region: { startLine: 4 } } }] }] },
        { tool: { driver: { name: "Semgrep OSS" } }, results: [{ ruleId: "x", message: { text: "not a compiler" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/B/Bar.cs" }, region: { startLine: 1 } } }] }] },
      ],
    }));
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(path.join(root, "src/A/build.sarif"), old, old);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const run = (config: object) => {
    writeFileSync(path.join(root, "qualis.config.json"), JSON.stringify({ plugins: ["@qualis/plugin-csharp"], newCode: { reference: null }, ...config }));
    return analyze({ baseDir: root, resolvePluginsFrom: [CLI_DIR] });
  };

  it("imports each project's error log for the files of that project only", async () => {
    const report = await run({});
    expect(validate("report", report).errors).toEqual([]);
    expect(report.externalIssueReports).toEqual(["src/A/build.sarif", "artifacts/B.sarif"]);
    const external = report.issues.filter((i) => i.ruleId.startsWith("external:")).map((i) => `${i.path}:${i.range.startLine}:${i.ruleId}`);
    expect(external).toEqual(["src/A/Foo.cs:4:external:roslyn:CA1822", "src/B/Bar.cs:4:external:roslyn:CS0219"]);
    expect(report.rules.find((r) => r.id === "external:roslyn:CA1822")).toMatchObject({ name: "Mark members as static", external: { tool: "Compilatore Microsoft (R) Visual C#" } });
    const messages = report.diagnostics.map((d) => d.message).join("\n");
    expect(messages).toContain("Build error log of src/B/B.csproj: artifacts/B.sarif");
    expect(messages).toContain("2 issue(s) of build error logs on files of other projects were ignored");
    expect(messages).toContain("src/A/build.sarif is older than 1 source file(s) of src/A/A.csproj");
    expect(messages).not.toContain("older than 1 source file(s) of src/B/B.csproj");
  }, 60_000);

  it("can be turned off, and does not import a configured error log twice", async () => {
    const off = await run({ externalIssues: { dotnetErrorLogs: false } });
    expect(off.issues.filter((i) => i.ruleId.startsWith("external:"))).toEqual([]);
    const both = await run({ externalIssues: { reports: ["**/*.sarif"] } });
    expect(both.issues.filter((i) => i.ruleId.startsWith("external:")).map((i) => i.path)).toEqual(["src/A/Foo.cs", "src/B/Bar.cs"]);
  }, 60_000);
});

const hasPython = spawnSync("python3", ["--version"]).status === 0;

describe.runIf(hasPython)("example Python plugin (stdio protocol, another language)", () => {
  it("analyses Python files through the open connector", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qualis-py-"));
    try {
      write(root, "app.py", "# app\n\ndef load(path, retries=3):\n    try:\n        return open(path).read()\n    except:\n        return None if retries else ''\n");
      write(root, "qualis.config.json", JSON.stringify({ plugins: [{ command: "python3", args: [path.join(repoRoot, "examples/python-plugin/qualis_python.py")] }], newCode: { reference: null } }));
      const report = await analyze({ baseDir: root });
      expect(validate("report", report).errors).toEqual([]);
      expect(report.issues.map((i) => `${i.ruleId}@${i.range.startLine}`)).toEqual(["python:bare-except@6"]);
      const load = report.files[0]!.functions[0]!;
      expect(load).toMatchObject({ name: "load", parameters: 2, complexity: 3 });
      expect(report.files[0]!.measures).toMatchObject({ lines: 7, ncloc: 5, commentLines: 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
