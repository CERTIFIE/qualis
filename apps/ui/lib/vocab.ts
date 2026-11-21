import type { GateMetric, IssueType, Severity } from "@qualis/schema";

// Labels and colours of the report vocabulary.

export const ISSUE_TYPES: readonly IssueType[] = ["bug", "vulnerability", "security-hotspot", "code-smell"];
export const SEVERITIES: readonly Severity[] = ["blocker", "critical", "major", "minor", "info"];

export const TYPE_LABEL: Record<IssueType, { label: string; plural: string; badge: string; characteristic: string }> = {
  bug: { label: "Bug", plural: "Bugs", badge: "Bug", characteristic: "Reliability" },
  vulnerability: { label: "Vulnerability", plural: "Vulnerabilities", badge: "Vulnerability", characteristic: "Security" },
  "security-hotspot": { label: "Security hotspot", plural: "Security hotspots", badge: "Hotspot", characteristic: "Security" },
  "code-smell": { label: "Code smell", plural: "Code smells", badge: "Code smell", characteristic: "Maintainability" },
};

export const TYPE_COUNT_KEY = {
  bug: "bugs",
  vulnerability: "vulnerabilities",
  "security-hotspot": "securityHotspots",
  "code-smell": "codeSmells",
} as const satisfies Record<IssueType, string>;

export const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: "Blocker",
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  info: "Info",
};

/** Muted, flat colours of the stacked bars. */
export const TYPE_COLOR: Record<IssueType, string> = {
  bug: "#4f7bab",
  vulnerability: "#a32d2d",
  "security-hotspot": "#c49a2c",
  "code-smell": "#b9b7ad",
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  blocker: "#5e1a1a",
  critical: "#a32d2d",
  major: "#c98a4b",
  minor: "#b9b7ad",
  info: "#dcdad2",
};

export type MetricKind = "rating" | "int" | "pct" | "debt";

export const METRIC: Record<GateMetric, { label: string; kind: MetricKind }> = {
  reliabilityRating: { label: "Reliability rating", kind: "rating" },
  securityRating: { label: "Security rating", kind: "rating" },
  maintainabilityRating: { label: "Maintainability rating", kind: "rating" },
  issues: { label: "Issues", kind: "int" },
  blockerIssues: { label: "Blocker issues", kind: "int" },
  criticalIssues: { label: "Critical issues", kind: "int" },
  majorIssues: { label: "Major issues", kind: "int" },
  bugs: { label: "Bugs", kind: "int" },
  vulnerabilities: { label: "Vulnerabilities", kind: "int" },
  securityHotspots: { label: "Security hotspots", kind: "int" },
  codeSmells: { label: "Code smells", kind: "int" },
  technicalDebtMinutes: { label: "Technical debt", kind: "debt" },
  debtRatio: { label: "Debt ratio", kind: "pct" },
  coverage: { label: "Coverage", kind: "pct" },
  lineCoverage: { label: "Line coverage", kind: "pct" },
  branchCoverage: { label: "Branch coverage", kind: "pct" },
  duplicatedLinesDensity: { label: "Duplicated lines", kind: "pct" },
  testFailures: { label: "Test failures", kind: "int" },
  testSuccessDensity: { label: "Test success", kind: "pct" },
};

export const LANGUAGE: Record<string, { name: string; color: string }> = {
  typescript: { name: "TypeScript", color: "#185fa5" },
  javascript: { name: "JavaScript", color: "#d9b04a" },
  csharp: { name: "C#", color: "#7a6fb0" },
};

const EXTENSION_MARK: Record<string, string> = { ts: "TS", tsx: "TSX", mts: "TS", cts: "TS", js: "JS", jsx: "JSX", mjs: "JS", cjs: "JS", cs: "C#" };

export function fileMark(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MARK[ext] ?? (ext.slice(0, 3).toUpperCase() || "•");
}
