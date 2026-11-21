import type { FileReport, Issue, IssueType, Rating, Report, Severity } from "@qualis/schema";
import { SEVERITIES } from "./vocab";

// Pure computations on a report shared by the screens.

export function worstSeverity(issues: Issue[], type: IssueType): Severity | null {
  return SEVERITIES.find((s) => issues.some((i) => i.type === type && i.severity === s)) ?? null;
}

export function lineCoverage(file: FileReport): number | null {
  const c = file.coverage;
  if (!c) return null;
  const total = c.coveredLines.length + c.uncoveredLines.length;
  return total ? (c.coveredLines.length / total) * 100 : null;
}

/** Directory used by the issue facet: the first two path segments. */
export function dirKey(path: string): string {
  const s = path.split("/");
  return s.length > 2 ? s.slice(0, 2).join("/") : s.length > 1 ? s[0]! : "(root)";
}

export const RATING_ORDER: readonly Rating[] = ["A", "B", "C", "D", "E"];

/** Position of a debt ratio on the A–E bands (default thresholds 5/10/20/50 %), 0–100 with equally wide bands. */
export function debtBandPosition(ratio: number, thresholds: readonly number[] = [5, 10, 20, 50]): number {
  const t = [0, ...thresholds, Math.max(100, (thresholds[thresholds.length - 1] ?? 50) * 2)];
  let k = t.findIndex((x, i) => i > 0 && ratio <= x);
  if (k < 0) k = t.length - 1;
  const lo = t[k - 1]!;
  const hi = t[k]!;
  return ((k - 1 + Math.min(1, (ratio - lo) / (hi - lo))) / (t.length - 1)) * 100;
}

// ---------------------------------------------------------------------------------------------------- issues facets

export interface IssueFilters {
  type: string[];
  severity: string[];
  rule: string[];
  dir: string[];
  file: string[];
  onlyNew: boolean;
  text: string;
}

export type FacetKey = "type" | "severity" | "rule" | "dir" | "file";

const FACET_VALUE: Record<FacetKey, (i: Issue) => string> = {
  type: (i) => i.type,
  severity: (i) => i.severity,
  rule: (i) => i.ruleId,
  dir: (i) => dirKey(i.path),
  file: (i) => i.path,
};

export function matches(issue: Issue, f: IssueFilters, skip?: FacetKey): boolean {
  if (f.onlyNew && !issue.isNew) return false;
  if (f.text) {
    const t = f.text.toLowerCase();
    if (!issue.message.toLowerCase().includes(t) && !issue.ruleId.toLowerCase().includes(t) && !issue.path.toLowerCase().includes(t)) return false;
  }
  for (const key of Object.keys(FACET_VALUE) as FacetKey[]) {
    if (key === skip) continue;
    const values = f[key];
    if (values.length && !values.includes(FACET_VALUE[key](issue))) return false;
  }
  return true;
}

/** Count per value of a facet among the issues that match every other filter. */
export function facetCounts(issues: Issue[], f: IssueFilters, key: FacetKey): Map<string, number> {
  const counts = new Map<string, number>();
  for (const i of issues) {
    if (!matches(i, f, key)) continue;
    const v = FACET_VALUE[key](i);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

export type IssueSort = "file" | "severity" | "effort";

export function sortIssues(issues: Issue[], sort: IssueSort): Issue[] {
  const byFile = (a: Issue, b: Issue) => a.path.localeCompare(b.path) || a.range.startLine - b.range.startLine;
  return [...issues].sort(
    sort === "severity"
      ? (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || byFile(a, b)
      : sort === "effort"
        ? (a, b) => b.effortMinutes - a.effortMinutes || byFile(a, b)
        : byFile,
  );
}

// ---------------------------------------------------------------------------------------------------- code tree

export interface Aggregate {
  files: number;
  ncloc: number;
  complexity: number;
  cognitive: number;
  minMaintainability: number | null;
  covered: number;
  coverable: number;
  notInReports: number;
  duplicatedLines: number;
  issues: number;
  debt: number;
}

export function aggregate(files: FileReport[]): Aggregate {
  const a: Aggregate = { files: files.length, ncloc: 0, complexity: 0, cognitive: 0, minMaintainability: null, covered: 0, coverable: 0, notInReports: 0, duplicatedLines: 0, issues: 0, debt: 0 };
  for (const f of files) {
    const m = f.measures;
    a.ncloc += m.ncloc;
    a.complexity += m.complexity;
    a.cognitive += m.cognitiveComplexity;
    a.duplicatedLines += m.duplicatedLines;
    a.issues += m.issues;
    a.debt += m.technicalDebtMinutes;
    if (m.maintainabilityIndex !== null) a.minMaintainability = a.minMaintainability === null ? m.maintainabilityIndex : Math.min(a.minMaintainability, m.maintainabilityIndex);
    if (f.coverage) {
      a.covered += f.coverage.coveredLines.length;
      a.coverable += f.coverage.coveredLines.length + f.coverage.uncoveredLines.length;
      if (f.coverage.notInReports) a.notInReports++;
    }
  }
  return a;
}

export const aggregateCoverage = (a: Aggregate): number | null => (a.coverable ? (a.covered / a.coverable) * 100 : null);

export interface TreeRow {
  name: string;
  path: string;
  dir: boolean;
  file?: FileReport;
  agg: Aggregate;
}

/** Children of a directory; chains of single sub-directories are collapsed (`a/b/c`). */
export function treeRows(files: FileReport[], dir: string): TreeRow[] {
  const prefix = dir ? `${dir}/` : "";
  const groups = new Map<string, { files: FileReport[]; dir: boolean }>();
  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length).split("/");
    const key = rest[0]!;
    const g = groups.get(key) ?? { files: [], dir: rest.length > 1 };
    g.files.push(f);
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => {
    let name = key;
    let path = prefix + key;
    if (g.dir) {
      for (;;) {
        const parts = g.files.map((f) => f.path.slice(path.length + 1).split("/"));
        const subdirs = new Set(parts.filter((p) => p.length > 1).map((p) => p[0]!));
        const direct = parts.some((p) => p.length === 1);
        if (subdirs.size !== 1 || direct) break;
        const only = [...subdirs][0]!;
        name += `/${only}`;
        path += `/${only}`;
      }
    }
    return { name, path, dir: g.dir, ...(g.dir ? {} : { file: g.files[0]! }), agg: aggregate(g.files) };
  });
}

/** Number of analyses as a compact delta label against the previous analysis. */
export function deltaLabel(current: number, previous: number | undefined, lowerIsBetter: boolean, fmt: (n: number) => string): { text: string; tone: "good" | "bad" | "flat" } | null {
  if (previous === undefined) return null;
  const d = current - previous;
  if (Math.abs(d) < 1e-9) return { text: "±0", tone: "flat" };
  const good = lowerIsBetter ? d < 0 : d > 0;
  return { text: `${d > 0 ? "▲" : "▼"} ${fmt(Math.abs(d))}`, tone: good ? "good" : "bad" };
}

export function hasSources(report: Report): boolean {
  return report.files.some((f) => typeof f.source === "string");
}
