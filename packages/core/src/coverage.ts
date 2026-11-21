import { readFile } from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { CoverageMeasures, FileCoverage } from "@qualis/schema";
import { relativeTo, toPosix } from "./paths.js";

/** Coverage of one line: execution count and branch conditions. */
export interface LineCoverage {
  hits: number;
  conditions: number;
  coveredConditions: number;
  /**
   * The report has branches on this line but no line data (an LCOV `BRDA` without `DA`, an OpenCover branch point
   * without a sequence point): its conditions count, the line itself is not a line to cover.
   */
  branchOnly?: true;
}

/** Coverage per project file (relative path) and per line. */
export type CoverageData = Map<string, Map<number, LineCoverage>>;

export interface CoverageImport {
  data: CoverageData;
  warnings: string[];
}

function mergeLine(target: Map<number, LineCoverage>, line: number, value: LineCoverage): void {
  const existing = target.get(line);
  if (!existing) {
    target.set(line, { ...value });
    return;
  }
  if (!value.branchOnly) delete existing.branchOnly;
  existing.hits += value.hits;
  existing.conditions = Math.max(existing.conditions, value.conditions);
  existing.coveredConditions = Math.max(existing.coveredConditions, value.coveredConditions);
}

/**
 * Maps a path found in a coverage report to a project file. Tries the project
 * root, the report directory and any source roots, then a unique suffix match.
 */
export function createPathResolver(baseDir: string, projectFiles: Set<string>) {
  const bySuffix = new Map<string, string[]>();
  for (const file of projectFiles) {
    const name = file.slice(file.lastIndexOf("/") + 1);
    const list = bySuffix.get(name) ?? [];
    list.push(file);
    bySuffix.set(name, list);
  }
  return (reported: string, roots: string[]): string | null => {
    const normalized = reported.replace(/\\/g, "/");
    const candidates = path.isAbsolute(reported) || /^[a-zA-Z]:\//.test(normalized)
      ? [reported]
      : [...roots, baseDir].map((root) => path.resolve(root, reported));
    for (const candidate of candidates) {
      const rel = relativeTo(baseDir, candidate);
      if (rel && projectFiles.has(rel)) return rel;
    }
    // Reports produced on another machine or in a container: match by suffix.
    const name = normalized.slice(normalized.lastIndexOf("/") + 1);
    const matches = (bySuffix.get(name) ?? []).filter((f) => normalized.endsWith(`/${f}`) || normalized === f);
    return matches.length === 1 ? matches[0]! : null;
  };
}

/** Parses an LCOV tracefile (records SF, DA, BRDA, end_of_record). */
export function parseLcov(content: string): Map<string, Map<number, LineCoverage>> {
  const result = new Map<string, Map<number, LineCoverage>>();
  let current: Map<number, LineCoverage> | null = null;
  const branches = new Map<number, { total: number; covered: number }>();
  const flush = () => {
    if (!current) return;
    for (const [line, b] of branches) {
      const entry = current.get(line) ?? { hits: 0, conditions: 0, coveredConditions: 0, branchOnly: true };
      entry.conditions += b.total;
      entry.coveredConditions += b.covered;
      current.set(line, entry);
    }
    branches.clear();
  };
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      flush();
      const file = line.slice(3);
      current = result.get(file) ?? new Map();
      result.set(file, current);
    } else if (line.startsWith("DA:") && current) {
      const [ln, hits] = line.slice(3).split(",");
      const n = Number(ln);
      if (n > 0) mergeLine(current, n, { hits: Number(hits) || 0, conditions: 0, coveredConditions: 0 });
    } else if (line.startsWith("BRDA:") && current) {
      const [ln, , , taken] = line.slice(5).split(",");
      const n = Number(ln);
      if (n > 0) {
        const b = branches.get(n) ?? { total: 0, covered: 0 };
        b.total++;
        if (taken !== "-" && Number(taken) > 0) b.covered++;
        branches.set(n, b);
      }
    } else if (line === "end_of_record") {
      flush();
      current = null;
    }
  }
  flush();
  return result;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  isArray: (name) =>
    [
      "package",
      "class",
      "line",
      "source",
      "testsuite",
      "testcase",
      "UnitTestResult",
      "Module",
      "File",
      "Class",
      "Method",
      "SequencePoint",
      "BranchPoint",
    ].includes(name),
});

export function parseXml(content: string): Record<string, unknown> {
  return xml.parse(content) as Record<string, unknown>;
}

/** Parses a Cobertura XML report. Returns file paths as written in the report plus its source roots. */
export function parseCobertura(content: string): { sources: string[]; files: Map<string, Map<number, LineCoverage>> } {
  const doc = parseXml(content) as { coverage?: Record<string, any> };
  const root = doc.coverage;
  if (!root) throw new Error("not a Cobertura report (missing <coverage>)");
  const sources: string[] = (root["sources"]?.source ?? []).map((s: unknown) => String(s).trim()).filter(Boolean);
  const files = new Map<string, Map<number, LineCoverage>>();
  for (const pkg of root["packages"]?.package ?? []) {
    for (const cls of pkg.classes?.class ?? []) {
      const filename = String(cls.filename ?? "");
      if (!filename) continue;
      const lines = files.get(filename) ?? new Map<number, LineCoverage>();
      files.set(filename, lines);
      for (const l of cls.lines?.line ?? []) {
        const n = Number(l.number);
        if (!(n > 0)) continue;
        let conditions = 0;
        let covered = 0;
        if (String(l.branch) === "true") {
          const m = /\((\d+)\/(\d+)\)/.exec(String(l["condition-coverage"] ?? ""));
          if (m) {
            covered = Number(m[1]);
            conditions = Number(m[2]);
          }
        }
        mergeLine(lines, n, { hits: Number(l.hits) || 0, conditions, coveredConditions: covered });
      }
    }
  }
  return { sources, files };
}

/**
 * Parses an OpenCover XML report (also produced by coverlet with `Format=opencover`).
 * A sequence point marks the lines from `sl` to `el` with its visit count `vc`; each
 * branch point is one condition of its line `sl`, covered when visited.
 */
export function parseOpenCover(content: string): Map<string, Map<number, LineCoverage>> {
  const doc = parseXml(content) as { CoverageSession?: Record<string, any> };
  const session = doc.CoverageSession;
  if (!session) throw new Error("not an OpenCover report (missing <CoverageSession>)");
  const files = new Map<string, Map<number, LineCoverage>>();
  for (const module of session["Modules"]?.Module ?? []) {
    if (module.skippedDueTo) continue;
    const paths = new Map<string, string>();
    for (const file of module.Files?.File ?? []) paths.set(String(file.uid), String(file.fullPath));
    const linesOf = (fileId: unknown) => {
      const path = paths.get(String(fileId));
      if (!path) return undefined;
      let lines = files.get(path);
      if (!lines) files.set(path, (lines = new Map()));
      return lines;
    };
    for (const cls of module.Classes?.Class ?? []) {
      for (const method of cls.Methods?.Method ?? []) {
        const branches = new Map<string, { total: number; covered: number; line: number; fileId: string }>();
        for (const bp of method.BranchPoints?.BranchPoint ?? []) {
          const line = Number(bp.sl);
          if (!(line > 0)) continue;
          const key = `${bp.fileid}:${line}`;
          const b = branches.get(key) ?? { total: 0, covered: 0, line, fileId: String(bp.fileid) };
          b.total++;
          if (Number(bp.vc) > 0) b.covered++;
          branches.set(key, b);
        }
        for (const sp of method.SequencePoints?.SequencePoint ?? []) {
          const start = Number(sp.sl);
          const end = Math.max(start, Number(sp.el) || start);
          const lines = linesOf(sp.fileid);
          if (!lines || !(start > 0)) continue;
          for (let line = start; line <= end; line++) mergeLine(lines, line, { hits: Number(sp.vc) || 0, conditions: 0, coveredConditions: 0 });
        }
        for (const b of branches.values()) {
          const lines = linesOf(b.fileId);
          if (!lines) continue;
          const entry = lines.get(b.line) ?? { hits: 0, conditions: 0, coveredConditions: 0, branchOnly: true };
          entry.conditions = Math.max(entry.conditions, b.total);
          entry.coveredConditions = Math.max(entry.coveredConditions, b.covered);
          lines.set(b.line, entry);
        }
      }
    }
  }
  return files;
}

/** Reads coverage reports (LCOV, Cobertura XML or OpenCover XML, detected from content). */
export async function importCoverage(reports: string[], baseDir: string, projectFiles: Set<string>): Promise<CoverageImport> {
  const resolvePath = createPathResolver(baseDir, projectFiles);
  const data: CoverageData = new Map();
  const warnings: string[] = [];
  for (const report of reports) {
    let content: string;
    try {
      content = await readFile(report, "utf8");
    } catch (error) {
      warnings.push(`Cannot read coverage report ${report}: ${(error as Error).message}`);
      continue;
    }
    const reportDir = path.dirname(report);
    let parsed: { sources: string[]; files: Map<string, Map<number, LineCoverage>> };
    try {
      if (!content.trimStart().startsWith("<")) parsed = { sources: [], files: parseLcov(content) };
      else if (/<CoverageSession[\s>]/.test(content)) parsed = { sources: [], files: parseOpenCover(content) };
      else parsed = parseCobertura(content);
    } catch (error) {
      warnings.push(`Cannot parse coverage report ${report}: ${(error as Error).message}`);
      continue;
    }
    const roots = [...parsed.sources.map((s) => path.resolve(reportDir, s)), reportDir];
    let unmatched = 0;
    for (const [reported, lines] of parsed.files) {
      const file = resolvePath(reported, roots);
      if (!file) {
        unmatched++;
        continue;
      }
      const target = data.get(file) ?? new Map();
      data.set(file, target);
      for (const [line, value] of lines) mergeLine(target, line, value);
    }
    if (unmatched > 0) {
      warnings.push(`${unmatched} file(s) of coverage report ${toPosix(path.relative(baseDir, report))} do not match analysed files`);
    }
  }
  return { data, warnings };
}

const percent = (part: number, total: number): number | null =>
  total === 0 ? null : Math.round((part / total) * 1000) / 10;

/** Aggregates coverage, optionally restricted to some lines per file. */
export function coverageMeasures(
  data: CoverageData,
  restrictTo?: Map<string, Set<number>>,
): CoverageMeasures | null {
  let linesToCover = 0;
  let coveredLines = 0;
  let conditionsToCover = 0;
  let coveredConditions = 0;
  for (const [file, lines] of data) {
    const allowed = restrictTo?.get(file);
    if (restrictTo && !allowed) continue;
    for (const [line, c] of lines) {
      if (allowed && !allowed.has(line)) continue;
      if (!c.branchOnly) {
        linesToCover++;
        if (c.hits > 0) coveredLines++;
      }
      conditionsToCover += c.conditions;
      coveredConditions += c.coveredConditions;
    }
  }
  if (data.size === 0) return null;
  return {
    linesToCover,
    coveredLines,
    uncoveredLines: linesToCover - coveredLines,
    conditionsToCover,
    coveredConditions,
    uncoveredConditions: conditionsToCover - coveredConditions,
    lineCoverage: percent(coveredLines, linesToCover),
    branchCoverage: percent(coveredConditions, conditionsToCover),
    coverage: percent(coveredLines + coveredConditions, linesToCover + conditionsToCover),
  };
}

export function fileCoverage(lines: Map<number, LineCoverage>): FileCoverage {
  const covered: number[] = [];
  const uncovered: number[] = [];
  const partial: { line: number; covered: number; total: number }[] = [];
  for (const [line, c] of [...lines].sort((a, b) => a[0] - b[0])) {
    // A branch-only line is no line to cover: only its conditions show (as partial).
    if (!c.branchOnly) (c.hits > 0 ? covered : uncovered).push(line);
    if (c.conditions > 0 && c.coveredConditions < c.conditions) {
      partial.push({ line, covered: c.coveredConditions, total: c.conditions });
    }
  }
  return { coveredLines: covered, uncoveredLines: uncovered, partialLines: partial };
}
