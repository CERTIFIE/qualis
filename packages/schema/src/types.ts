/**
 * Qualis public data contracts.
 *
 * These TypeScript types mirror the JSON Schemas shipped in `schemas/`. The JSON
 * Schemas are normative: tools written in other languages should rely on them.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/**
 * Kind of finding. Each type feeds exactly one quality characteristic.
 * A security hotspot is security-sensitive code that needs a manual review: it
 * is reported and counted, but it does not lower the security rating.
 */
export type IssueType = "bug" | "vulnerability" | "security-hotspot" | "code-smell";

/** Quality characteristics (ISO/IEC 25010 terminology). */
export type Characteristic = "reliability" | "security" | "maintainability";

export type Severity = "blocker" | "critical" | "major" | "minor" | "info";

export type Rating = "A" | "B" | "C" | "D" | "E";

export const ISSUE_TYPES: readonly IssueType[] = ["bug", "vulnerability", "security-hotspot", "code-smell"];
export const SEVERITIES: readonly Severity[] = ["blocker", "critical", "major", "minor", "info"];
export const RATINGS: readonly Rating[] = ["A", "B", "C", "D", "E"];

export const CHARACTERISTIC_BY_TYPE: Readonly<Record<IssueType, Characteristic>> = {
  bug: "reliability",
  vulnerability: "security",
  "security-hotspot": "security",
  "code-smell": "maintainability",
};

/**
 * A range of text inside a file. Lines and columns are 1-based; columns are
 * counted in UTF-16 code units and `endColumn` is exclusive (same convention as
 * SARIF 2.1.0).
 */
export interface TextRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** An authoritative source a rule is derived from. */
export interface Reference {
  /** Publisher, e.g. "MITRE CWE", "OWASP", "MDN Web Docs", "Microsoft Learn", "NIST". */
  publisher: string;
  /** Short identifier when the source has one, e.g. "CWE-95" or "CA5351". */
  id?: string;
  title: string;
  url: string;
}

export interface RuleParameter {
  name: string;
  description: string;
  type: "integer" | "number" | "string" | "boolean";
  default: number | string | boolean;
}

/** Code a rule applies to: production code, test code, or both. */
export type RuleScope = "main" | "test" | "all";

/** Static description of a rule, published by a language plugin. */
export interface RuleDefinition {
  /** Globally unique id in the form `<pluginId>:<key>`, e.g. `typescript:no-eval`. */
  id: string;
  /** Short human readable title. */
  name: string;
  /** Language ids this rule applies to. */
  languages: string[];
  type: IssueType;
  /** Default severity. */
  severity: Severity;
  tags: string[];
  /** Whether the rule runs when the configuration does not mention it. */
  enabledByDefault: boolean;
  /** Estimated remediation effort of one issue, in minutes. */
  effortMinutes: number;
  /** What the rule detects. Plain text; `inline code` in backticks; paragraphs separated by blank lines. */
  description: string;
  /** Why it matters, summarising the referenced sources in the plugin author's own words. */
  rationale: string;
  /** Known limitations and accepted exceptions. */
  exceptions?: string;
  noncompliantExample?: string;
  compliantExample?: string;
  params?: RuleParameter[];
  /** Authoritative sources. At least one is required. */
  references: Reference[];
  /**
   * Ids of rules of other plugins that this rule replaces. While this rule is
   * enabled and its plugin prepared successfully, the superseded rules do not run
   * (unless the configuration enables them explicitly).
   */
  supersedes?: string[];
  /** Default code the rule applies to. When absent: `all` for bugs, `main` for the other types. */
  scope?: RuleScope;
}

export interface LanguageDescriptor {
  /** Stable language id, e.g. `typescript`, `javascript`, `csharp`. */
  id: string;
  name: string;
  /** Lower-case file extensions including the dot, e.g. `.ts`. */
  extensions: string[];
}

/**
 * `language`: owns the files with its extensions and returns issues and measures.
 * `rule-pack`: adds rules (issues only) to files of languages owned by language plugins.
 */
export type PluginKind = "language" | "rule-pack";

/** Identity and capabilities of a plugin. */
export interface PluginManifest {
  /** Plugin API version implemented by the plugin. */
  apiVersion: 1;
  /** Defaults to `language`. */
  kind?: PluginKind;
  /** Stable plugin id, lower-case, used as rule id prefix. */
  id: string;
  name: string;
  version: string;
  description?: string;
  homepage?: string;
  languages: LanguageDescriptor[];
  rules: RuleDefinition[];
}

// ---------------------------------------------------------------------------
// Plugin results (per file)
// ---------------------------------------------------------------------------

/** Size and complexity measures of a single file, computed by its plugin. */
export interface FileMeasures {
  /** Physical lines. A trailing line break does not start a new line. */
  lines: number;
  /** Non-comment lines of code: lines containing at least one token that is not a comment. */
  ncloc: number;
  /** Lines containing comment text. */
  commentLines: number;
  functions: number;
  classes: number;
  statements: number;
  /** McCabe cyclomatic complexity (sum over the file). */
  complexity: number;
  /** Cognitive complexity (sum over the file). */
  cognitiveComplexity: number;
}

export interface SecondaryLocation {
  range: TextRange;
  message?: string;
}

/** An issue as reported by a plugin, before the core enriches it. */
export interface PluginIssue {
  ruleId: string;
  message: string;
  range: TextRange;
  secondaryLocations?: SecondaryLocation[];
  /** Overrides the rule's `effortMinutes` for this issue. */
  effortMinutes?: number;
}

/** A token used for duplication detection. */
export interface CpdToken {
  /** Normalised token text. Two tokens are equal when their images are equal. */
  image: string;
  startLine: number;
  endLine: number;
}

export interface PluginDiagnostic {
  level: "error" | "warning" | "info";
  message: string;
}

/** Raw Halstead counts (M. H. Halstead, Elements of Software Science, 1977). */
export interface HalsteadCounts {
  /** n1: number of distinct operators. */
  distinctOperators: number;
  /** n2: number of distinct operands. */
  distinctOperands: number;
  /** N1: total occurrences of operators. */
  totalOperators: number;
  /** N2: total occurrences of operands. */
  totalOperands: number;
}

/** Measures of one function-like element (function, method, constructor, accessor, lambda). */
export interface FunctionMetrics {
  /** Display name, e.g. `UserService.save` or `<anonymous>`. */
  name: string;
  kind: "function" | "method" | "constructor" | "accessor" | "lambda" | "local-function";
  range: TextRange;
  ncloc: number;
  parameters: number;
  complexity: number;
  cognitiveComplexity: number;
  /** Deepest nesting of control structures inside the body (0 = flat). */
  maxNestingDepth: number;
  halstead?: HalsteadCounts;
}

/** Result of a rule pack for one file. */
export interface RulePackAnalysis {
  issues: PluginIssue[];
  diagnostics?: PluginDiagnostic[];
}

export interface FileAnalysis {
  issues: PluginIssue[];
  measures: FileMeasures;
  /** Per-function measures. Optional, but required for function statistics and the maintainability index. */
  functions?: FunctionMetrics[];
  /** Halstead counts of the whole file. */
  halstead?: HalsteadCounts;
  /** Line numbers (1-based) that contain code. Used for new-code measures. */
  codeLines?: number[];
  /**
   * Lines a coverage tool would count as executable (statements, initializers).
   * Used as the lines to cover of files missing from the coverage reports; `codeLines` otherwise.
   */
  executableLines?: number[];
  /** Token stream for duplication detection, in source order. Omit to skip the file. */
  cpdTokens?: CpdToken[];
  diagnostics?: PluginDiagnostic[];
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export const REPORT_SCHEMA_VERSION = "1.0.0";

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  /** `module` for in-process JavaScript plugins, `process` for stdio plugins. */
  transport: "module" | "process";
  kind: PluginKind;
  languages: string[];
}

export interface IssueCounts {
  total: number;
  blocker: number;
  critical: number;
  major: number;
  minor: number;
  info: number;
  bugs: number;
  vulnerabilities: number;
  securityHotspots: number;
  codeSmells: number;
}

export interface Ratings {
  reliability: Rating;
  security: Rating;
  maintainability: Rating;
}

export interface DuplicationMeasures {
  duplicatedLines: number;
  duplicatedBlocks: number;
  duplicatedFiles: number;
  /** Percentage of duplicated lines over all lines, 0-100. */
  duplicatedLinesDensity: number;
}

export interface CoverageMeasures {
  linesToCover: number;
  coveredLines: number;
  uncoveredLines: number;
  conditionsToCover: number;
  coveredConditions: number;
  uncoveredConditions: number;
  /** Percentage 0-100, null when there is nothing to cover. */
  lineCoverage: number | null;
  /** Percentage 0-100, null when no branch data is available. */
  branchCoverage: number | null;
  /** Combined line + condition coverage, percentage 0-100. */
  coverage: number | null;
}

export interface TestMeasures {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  durationMs: number;
  /** Passed tests over executed tests, percentage 0-100. */
  successDensity: number | null;
}

/** Derived Halstead measures. */
export interface HalsteadMeasures extends HalsteadCounts {
  /** n = n1 + n2 */
  vocabulary: number;
  /** N = N1 + N2 */
  length: number;
  /** V = N × log2(n) */
  volume: number;
  /** D = (n1 / 2) × (N2 / n2) */
  difficulty: number;
  /** E = D × V */
  effort: number;
  /** T = E / 18 seconds */
  timeSeconds: number;
  /** B = E^(2/3) / 3000 */
  deliveredBugs: number;
}

export interface FunctionReport extends Omit<FunctionMetrics, "halstead"> {
  halstead: HalsteadMeasures | null;
  /**
   * Maintainability index 0-100 (Microsoft Visual Studio variant):
   * max(0, (171 − 5.2 ln V − 0.23 CC − 16.2 ln LOC) × 100 / 171). Null without Halstead data.
   */
  maintainabilityIndex: number | null;
}

/** Number of functions per cyclomatic complexity band. */
export interface ComplexityDistribution {
  /** 1-10 */
  low: number;
  /** 11-20 */
  moderate: number;
  /** 21-50 */
  high: number;
  /** above 50 */
  veryHigh: number;
}

/** Number of functions per maintainability index band (Microsoft Visual Studio bands). */
export interface MaintainabilityDistribution {
  /** 20-100 */
  high: number;
  /** 10-19 */
  moderate: number;
  /** 0-9 */
  low: number;
}

export interface FunctionStatistics {
  count: number;
  averageComplexity: number;
  maxComplexity: number;
  averageCognitiveComplexity: number;
  maxCognitiveComplexity: number;
  averageNcloc: number;
  averageParameters: number;
  maxNestingDepth: number;
  complexityDistribution: ComplexityDistribution;
  /** Null when no plugin provides Halstead data. */
  averageMaintainabilityIndex: number | null;
  minMaintainabilityIndex: number | null;
  maintainabilityDistribution: MaintainabilityDistribution | null;
}

export interface FunctionRef {
  path: string;
  name: string;
  startLine: number;
  value: number;
}

export interface OverallMeasures {
  files: number;
  lines: number;
  ncloc: number;
  commentLines: number;
  /** commentLines / (ncloc + commentLines), percentage 0-100. */
  commentLinesDensity: number;
  functions: number;
  classes: number;
  statements: number;
  complexity: number;
  cognitiveComplexity: number;
  /** Cyclomatic complexity per 1000 lines of code. */
  complexityDensity: number;
  functionStats: FunctionStatistics;
  /** Sum of the file-level Halstead volume, effort and delivered-bug estimates. Null without Halstead data. */
  halstead: { volume: number; effort: number; deliveredBugs: number } | null;
  /** The functions with the highest values, for quick human triage (max 10 each). */
  hotspots: {
    complexity: FunctionRef[];
    cognitiveComplexity: FunctionRef[];
    /** Lowest maintainability index first. */
    maintainabilityIndex: FunctionRef[];
  };
  issues: IssueCounts;
  ratings: Ratings;
  technicalDebtMinutes: number;
  /** Remediation cost over development cost, percentage 0-100+. */
  debtRatio: number;
  duplication: DuplicationMeasures;
  coverage: CoverageMeasures | null;
  tests: TestMeasures | null;
  /** Size of the test code (`tests.sources`), which the other measures leave out. */
  testCode?: { files: number; lines: number; ncloc: number };
}

export interface NewCodeMeasures {
  /** Lines added or changed since the reference. */
  lines: number;
  /** Added or changed lines that contain code. */
  ncloc: number;
  issues: IssueCounts;
  ratings: Ratings;
  technicalDebtMinutes: number;
  debtRatio: number;
  duplicatedLines: number;
  duplicatedLinesDensity: number;
  coverage: CoverageMeasures | null;
}

export interface FileCoverage {
  /**
   * True when no coverage report mentions the file and it is counted as not
   * covered (`coverage.missingFiles: "uncovered"`); its lines of code are the lines to cover.
   */
  notInReports?: boolean;
  coveredLines: number[];
  uncoveredLines: number[];
  /** Lines with branches where not every condition was covered. */
  partialLines: { line: number; covered: number; total: number }[];
}

export interface FileReport {
  /** Path relative to the project root, with forward slashes. */
  path: string;
  language: string;
  plugin: string;
  /** True for test code (`tests.sources`). */
  test?: boolean;
  measures: FileMeasures & {
    issues: number;
    duplicatedLines: number;
    technicalDebtMinutes: number;
    halstead: HalsteadMeasures | null;
    /** Lowest maintainability index among the file's functions; null without data. */
    maintainabilityIndex: number | null;
  };
  functions: FunctionReport[];
  /** Lines added or changed since the new-code reference; absent when no reference is available. */
  newLines?: number[];
  coverage?: FileCoverage;
  /** File content, only when `output.includeSources` is enabled. */
  source?: string;
  /** SHA-256 (hex) of the analysed content (UTF-8, without byte order mark), to detect later changes. */
  sha256?: string;
}

export interface Issue {
  /** Stable fingerprint: survives line shifts as long as the offending line is unchanged. */
  id: string;
  ruleId: string;
  type: IssueType;
  characteristic: Characteristic;
  severity: Severity;
  message: string;
  path: string;
  range: TextRange;
  secondaryLocations?: SecondaryLocation[];
  effortMinutes: number;
  tags: string[];
  /** True when the issue is on new code. False when no reference is available. */
  isNew: boolean;
}

export interface ActiveRule extends RuleDefinition {
  plugin: string;
  /** Severity defined by the plugin, before configuration overrides. */
  defaultSeverity: Severity;
  /** Effective parameter values. */
  paramValues: Record<string, number | string | boolean>;
  /** Effective scope in this analysis. */
  scope?: RuleScope;
  /** Set on rules of other tools whose issues were imported (`plugin` is then `external`). */
  external?: ExternalRuleOrigin;
}

/** Where an external rule comes from. */
export interface ExternalRuleOrigin {
  /** Tool name as written in the report, e.g. `ESLint`. */
  tool: string;
  /** Rule id in the tool, e.g. `react-hooks/exhaustive-deps`. */
  ruleId: string;
  helpUri?: string;
}

export interface DuplicationOccurrence {
  path: string;
  startLine: number;
  endLine: number;
}

export interface DuplicationGroup {
  id: string;
  /** Number of duplicated tokens. */
  tokens: number;
  occurrences: DuplicationOccurrence[];
}

export type TestStatus = "passed" | "failed" | "error" | "skipped";

export interface TestCase {
  name: string;
  className?: string;
  status: TestStatus;
  durationMs: number;
  message?: string;
}

export interface TestSuite {
  name: string;
  /** Report file the suite was read from. */
  report: string;
  tests: number;
  failed: number;
  errors: number;
  skipped: number;
  durationMs: number;
  cases: TestCase[];
}

export type MetricScope = "overall" | "new";
export type GateOperator = "gt" | "lt";

export interface QualityGateConditionResult {
  metric: GateMetric;
  scope: MetricScope;
  operator: GateOperator;
  threshold: number | Rating;
  actual: number | Rating | null;
  status: "passed" | "failed" | "no-data";
}

export interface QualityGateResult {
  name: string;
  status: "passed" | "failed";
  conditions: QualityGateConditionResult[];
}

export interface Diagnostic {
  level: "error" | "warning" | "info";
  /** `core` or the id of the plugin that produced the diagnostic. */
  source: string;
  message: string;
  path?: string;
}

export interface VcsInfo {
  type: "git";
  revision: string | null;
  branch: string | null;
  /** True when the working tree has uncommitted changes. */
  dirty: boolean;
}

export interface NewCodeInfo {
  /** Reference as configured or detected, e.g. `origin/main`. */
  reference: string;
  /** Commit the diff was computed against (merge base). */
  baseRevision: string;
}

export interface Report {
  $schema?: string;
  schemaVersion: string;
  tool: {
    name: "qualis";
    version: string;
    plugins: PluginInfo[];
  };
  project: { key: string; name: string };
  analysis: {
    id: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    vcs: VcsInfo | null;
    newCode: NewCodeInfo | null;
  };
  qualityGate: QualityGateResult;
  measures: {
    overall: OverallMeasures;
    newCode: NewCodeMeasures | null;
  };
  files: FileReport[];
  issues: Issue[];
  rules: ActiveRule[];
  duplications: DuplicationGroup[];
  tests: { reports: string[]; suites: TestSuite[] } | null;
  coverageReports: string[];
  /** External issue reports that were imported. */
  externalIssueReports?: string[];
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Configuration (qualis.config.json)
// ---------------------------------------------------------------------------

export const GATE_METRICS = [
  "reliabilityRating",
  "securityRating",
  "maintainabilityRating",
  "issues",
  "blockerIssues",
  "criticalIssues",
  "majorIssues",
  "bugs",
  "vulnerabilities",
  "securityHotspots",
  "codeSmells",
  "technicalDebtMinutes",
  "debtRatio",
  "coverage",
  "lineCoverage",
  "branchCoverage",
  "duplicatedLinesDensity",
  "testFailures",
  "testSuccessDensity",
] as const;

export type GateMetric = (typeof GATE_METRICS)[number];

/** Metrics that also exist on new code. */
export const NEW_CODE_GATE_METRICS: readonly GateMetric[] = [
  "reliabilityRating",
  "securityRating",
  "maintainabilityRating",
  "issues",
  "blockerIssues",
  "criticalIssues",
  "majorIssues",
  "bugs",
  "vulnerabilities",
  "securityHotspots",
  "codeSmells",
  "technicalDebtMinutes",
  "debtRatio",
  "coverage",
  "lineCoverage",
  "branchCoverage",
  "duplicatedLinesDensity",
];

export interface GateCondition {
  metric: GateMetric;
  /** Defaults to `overall`. */
  scope?: MetricScope;
  /** `gt`: fails when the value is greater (worse rating) than the threshold. `lt`: fails when lower. */
  operator: GateOperator;
  threshold: number | Rating;
}

export type ModulePluginReference = string | { module: string; options?: Record<string, unknown> };

export interface ProcessPluginReference {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  options?: Record<string, unknown>;
}

export type PluginReference = ModulePluginReference | ProcessPluginReference;

export type RuleSetting =
  | "off"
  | "on"
  | Severity
  | {
      enabled?: boolean;
      severity?: Severity;
      params?: Record<string, number | string | boolean>;
      /** Glob patterns of files where the rule does not apply (e.g. test fixtures). */
      exclude?: string[];
      /** Code the rule applies to; overrides the rule's default. */
      scope?: RuleScope;
    };

export interface QualisConfig {
  $schema?: string;
  project?: { key?: string; name?: string };
  /** Glob patterns of files to analyse, relative to the project root. */
  include?: string[];
  /** Glob patterns of files to skip. */
  exclude?: string[];
  /** Skip files ignored by git (default true). */
  respectGitignore?: boolean;
  /** Language plugins. Defaults to the bundled TypeScript/JavaScript and C# plugins. */
  plugins?: PluginReference[];
  rules?: Record<string, RuleSetting>;
  coverage?: {
    reports?: string[];
    /**
     * Source files that no report mentions: `uncovered` (default) counts their lines
     * of code as not covered, for every language present in the reports; `ignore` leaves them out.
     */
    missingFiles?: "uncovered" | "ignore";
    /** Files not expected to be covered, in addition to the test code. Replaces the default list. */
    exclude?: string[];
  };
  tests?: {
    /** JUnit XML or TRX reports. */
    reports?: string[];
    /** Glob patterns of test code. Replaces the default list. */
    sources?: string[];
  };
  /** Issues of other linters and analyzers, imported from their reports. */
  externalIssues?: {
    /** SARIF 2.1.0 or ESLint JSON reports. */
    reports?: string[];
    /** Issue type per external rule id (`external:<tool>:<rule>`, `*` matches any text). */
    types?: Record<string, IssueType>;
    /** Remediation effort of one issue, in minutes (default 5). */
    effortMinutes?: number;
    /** Import the build error log (SARIF) of each .NET project for its own files (default true). */
    dotnetErrorLogs?: boolean;
  };
  duplication?: { enabled?: boolean; minTokens?: number; minLines?: number; exclude?: string[] };
  /** `auto` (default), a git ref, or null to disable new-code detection. */
  newCode?: { reference?: string | null };
  qualityGate?: { name?: string; conditions?: GateCondition[] };
  ratings?: {
    /** Development cost of one line of code, in minutes (default 30). */
    developmentCostMinutesPerLine?: number;
    /** Upper debt-ratio bounds (percent) for ratings A, B, C, D (default [5, 10, 20, 50]). */
    maintainabilityThresholds?: [number, number, number, number];
  };
  output?: {
    dir?: string;
    formats?: ("json" | "sarif")[];
    includeSources?: boolean;
    /** Analyses kept in `<dir>/history`, the latest included (default 20; 0 disables the history). */
    history?: number;
  };
}
