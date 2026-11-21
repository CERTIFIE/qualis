import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { GateCondition, IssueType, PluginReference, QualisConfig, RuleSetting } from "@qualis/schema";
import { validate } from "./validation.js";

export const CONFIG_FILE_NAMES = ["qualis.config.json", ".qualis.json"] as const;

export const DEFAULT_PLUGINS: PluginReference[] = [
  "@qualis/plugin-typescript",
  "@qualis/plugin-csharp",
  "@qualis/plugin-eslint",
  "@qualis/plugin-roslyn",
];

/** Always excluded, in addition to `exclude` from the configuration. */
export const BUILT_IN_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.qualis/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/bin/**",
  "**/obj/**",
  "**/*.min.js",
  "**/*.Designer.cs",
  "**/*.g.cs",
  "**/*.g.i.cs",
];

/**
 * Test code: test files, test folders and test projects, and their helpers.
 * Analysed and listed, but left out of the size, complexity, duplication and
 * coverage measures; rules apply to it according to their scope.
 */
export const DEFAULT_TEST_SOURCES = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/test/**",
  "**/tests/**",
  "**/*.Tests/**",
  "**/*.UnitTests/**",
  "**/*.IntegrationTests/**",
  "**/*Tests.cs",
];

/** Files not expected to appear in coverage reports, besides the test code: declarations and configuration files. */
export const DEFAULT_COVERAGE_EXCLUDES = ["**/*.d.ts", "**/*.config.{js,cjs,mjs,ts,cts,mts}"];

/**
 * Default quality gate. Conditions on new code focus the gate on what the
 * current change introduces; the overall conditions stop releases with
 * blocker issues or failing tests.
 */
export const DEFAULT_QUALITY_GATE: { name: string; conditions: GateCondition[] } = {
  name: "Qualis default",
  conditions: [
    { metric: "reliabilityRating", scope: "new", operator: "gt", threshold: "A" },
    { metric: "securityRating", scope: "new", operator: "gt", threshold: "A" },
    { metric: "maintainabilityRating", scope: "new", operator: "gt", threshold: "A" },
    { metric: "coverage", scope: "new", operator: "lt", threshold: 80 },
    { metric: "duplicatedLinesDensity", scope: "new", operator: "gt", threshold: 3 },
    { metric: "blockerIssues", scope: "overall", operator: "gt", threshold: 0 },
    { metric: "testFailures", scope: "overall", operator: "gt", threshold: 0 },
  ],
};

export interface ResolvedConfig {
  baseDir: string;
  configFile: string | null;
  project: { key: string; name: string };
  include: string[];
  exclude: string[];
  respectGitignore: boolean;
  plugins: PluginReference[];
  rules: Record<string, RuleSetting>;
  coverageReports: string[];
  coverageMissingFiles: "uncovered" | "ignore";
  coverageExclude: string[];
  testReports: string[];
  testSources: string[];
  externalIssues: { reports: string[]; types: Record<string, IssueType>; effortMinutes: number; dotnetErrorLogs: boolean };
  duplication: { enabled: boolean; minTokens: number; minLines: number; exclude: string[] };
  newCodeReference: string | null;
  qualityGate: { name: string; conditions: GateCondition[] };
  ratings: { developmentCostMinutesPerLine: number; maintainabilityThresholds: [number, number, number, number] };
  output: { dir: string; formats: ("json" | "sarif")[]; includeSources: boolean; history: number };
}

export class ConfigError extends Error {}

/** Finds the configuration file of a project, if any. */
export function findConfigFile(baseDir: string): string | null {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(baseDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Reads and validates a configuration file. */
export function readConfigFile(file: string): QualisConfig {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ConfigError(`Cannot read ${file}: ${(error as Error).message}`);
  }
  const result = validate("config", data);
  if (!result.valid) {
    throw new ConfigError(`Invalid configuration ${file}:\n  ${result.errors.join("\n  ")}`);
  }
  return data as QualisConfig;
}

function sanitizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

/** Merges a configuration with the defaults. */
export function resolveConfig(baseDir: string, config: QualisConfig, configFile: string | null): ResolvedConfig {
  const absoluteBase = path.resolve(baseDir);
  const folderName = path.basename(absoluteBase);
  const thresholds = config.ratings?.maintainabilityThresholds ?? [5, 10, 20, 50];
  for (let i = 1; i < thresholds.length; i++) {
    if (thresholds[i]! < thresholds[i - 1]!) {
      throw new ConfigError("ratings.maintainabilityThresholds must be in ascending order");
    }
  }
  return {
    baseDir: absoluteBase,
    configFile,
    project: {
      key: config.project?.key ?? sanitizeKey(config.project?.name ?? folderName),
      name: config.project?.name ?? folderName,
    },
    include: config.include ?? ["**/*"],
    exclude: [...BUILT_IN_EXCLUDES, ...(config.exclude ?? [])],
    respectGitignore: config.respectGitignore ?? true,
    plugins: config.plugins ?? DEFAULT_PLUGINS,
    rules: config.rules ?? {},
    coverageReports: config.coverage?.reports ?? [],
    coverageMissingFiles: config.coverage?.missingFiles ?? "uncovered",
    coverageExclude: config.coverage?.exclude ?? DEFAULT_COVERAGE_EXCLUDES,
    testReports: config.tests?.reports ?? [],
    testSources: config.tests?.sources ?? DEFAULT_TEST_SOURCES,
    externalIssues: {
      reports: config.externalIssues?.reports ?? [],
      types: config.externalIssues?.types ?? {},
      effortMinutes: config.externalIssues?.effortMinutes ?? 5,
      dotnetErrorLogs: config.externalIssues?.dotnetErrorLogs ?? true,
    },
    duplication: {
      enabled: config.duplication?.enabled ?? true,
      minTokens: config.duplication?.minTokens ?? 100,
      minLines: config.duplication?.minLines ?? 10,
      exclude: config.duplication?.exclude ?? [],
    },
    newCodeReference: config.newCode?.reference === undefined ? "auto" : config.newCode.reference,
    qualityGate: {
      name: config.qualityGate?.name ?? (config.qualityGate?.conditions ? "Custom" : DEFAULT_QUALITY_GATE.name),
      conditions: config.qualityGate?.conditions ?? DEFAULT_QUALITY_GATE.conditions,
    },
    ratings: {
      developmentCostMinutesPerLine: config.ratings?.developmentCostMinutesPerLine ?? 30,
      maintainabilityThresholds: thresholds as [number, number, number, number],
    },
    output: {
      dir: config.output?.dir ?? ".qualis",
      formats: config.output?.formats ?? ["json"],
      includeSources: config.output?.includeSources ?? false,
      history: config.output?.history ?? 20,
    },
  };
}

/** Loads the configuration of a project (explicit file, discovered file, or defaults). */
export function loadConfig(baseDir: string, explicitFile?: string): ResolvedConfig {
  const file = explicitFile ? path.resolve(explicitFile) : findConfigFile(baseDir);
  if (explicitFile && !existsSync(file!)) throw new ConfigError(`Configuration file not found: ${explicitFile}`);
  const config = file ? readConfigFile(file) : {};
  return resolveConfig(baseDir, config, file);
}
