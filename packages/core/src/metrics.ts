import { compareStrings } from "./paths.js";
import type {
  ComplexityDistribution,
  FunctionMetrics,
  FunctionRef,
  FunctionReport,
  FunctionStatistics,
  HalsteadCounts,
  HalsteadMeasures,
  Issue,
  IssueCounts,
  MaintainabilityDistribution,
  Rating,
  Ratings,
  Severity,
} from "@qualis/schema";

const round = (value: number, digits = 1): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/**
 * Derived Halstead measures (Halstead, Elements of Software Science, 1977;
 * delivered-bug estimate as documented by IBM: B = E^(2/3) / 3000).
 */
export function halsteadMeasures(c: HalsteadCounts): HalsteadMeasures {
  const vocabulary = c.distinctOperators + c.distinctOperands;
  const length = c.totalOperators + c.totalOperands;
  const volume = vocabulary > 1 ? length * Math.log2(vocabulary) : 0;
  const difficulty = c.distinctOperands > 0 ? (c.distinctOperators / 2) * (c.totalOperands / c.distinctOperands) : 0;
  const effort = difficulty * volume;
  return {
    ...c,
    vocabulary,
    length,
    volume: round(volume, 2),
    difficulty: round(difficulty, 2),
    effort: round(effort, 2),
    timeSeconds: round(effort / 18, 2),
    deliveredBugs: round(Math.pow(effort, 2 / 3) / 3000, 4),
  };
}

/**
 * Maintainability index, Microsoft Visual Studio variant:
 * max(0, (171 − 5.2·ln(V) − 0.23·CC − 16.2·ln(LOC)) × 100 / 171).
 */
export function maintainabilityIndex(volume: number, complexity: number, loc: number): number {
  const raw = 171 - 5.2 * Math.log(Math.max(volume, 1)) - 0.23 * complexity - 16.2 * Math.log(Math.max(loc, 1));
  return Math.min(100, Math.max(0, Math.round((raw * 100) / 171)));
}

export function functionReport(fn: FunctionMetrics): FunctionReport {
  const { halstead, ...rest } = fn;
  const derived = halstead ? halsteadMeasures(halstead) : null;
  return {
    ...rest,
    halstead: derived,
    maintainabilityIndex: derived ? maintainabilityIndex(derived.volume, fn.complexity, fn.ncloc) : null,
  };
}

/** Cyclomatic complexity bands (SEI, C4 Software Technology Reference Guide, 1997). */
export function complexityBand(complexity: number): keyof ComplexityDistribution {
  if (complexity <= 10) return "low";
  if (complexity <= 20) return "moderate";
  if (complexity <= 50) return "high";
  return "veryHigh";
}

/** Maintainability index bands used by Visual Studio. */
export function maintainabilityBand(index: number): keyof MaintainabilityDistribution {
  if (index >= 20) return "high";
  if (index >= 10) return "moderate";
  return "low";
}

export function functionStatistics(functions: FunctionReport[]): FunctionStatistics {
  const count = functions.length;
  const avg = (pick: (f: FunctionReport) => number) =>
    count === 0 ? 0 : round(functions.reduce((s, f) => s + pick(f), 0) / count, 2);
  const max = (pick: (f: FunctionReport) => number) => functions.reduce((m, f) => Math.max(m, pick(f)), 0);
  const complexityDistribution: ComplexityDistribution = { low: 0, moderate: 0, high: 0, veryHigh: 0 };
  for (const f of functions) complexityDistribution[complexityBand(f.complexity)]++;
  const withIndex = functions.filter((f) => f.maintainabilityIndex !== null);
  let maintainabilityDistribution: MaintainabilityDistribution | null = null;
  if (withIndex.length > 0) {
    maintainabilityDistribution = { high: 0, moderate: 0, low: 0 };
    for (const f of withIndex) maintainabilityDistribution[maintainabilityBand(f.maintainabilityIndex!)]++;
  }
  return {
    count,
    averageComplexity: avg((f) => f.complexity),
    maxComplexity: max((f) => f.complexity),
    averageCognitiveComplexity: avg((f) => f.cognitiveComplexity),
    maxCognitiveComplexity: max((f) => f.cognitiveComplexity),
    averageNcloc: avg((f) => f.ncloc),
    averageParameters: avg((f) => f.parameters),
    maxNestingDepth: max((f) => f.maxNestingDepth),
    complexityDistribution,
    averageMaintainabilityIndex:
      withIndex.length === 0
        ? null
        : round(withIndex.reduce((s, f) => s + f.maintainabilityIndex!, 0) / withIndex.length),
    minMaintainabilityIndex:
      withIndex.length === 0 ? null : withIndex.reduce((m, f) => Math.min(m, f.maintainabilityIndex!), 100),
    maintainabilityDistribution,
  };
}

/** Top `limit` functions by a measure. */
export function hotspots(
  functions: { path: string; fn: FunctionReport }[],
  pick: (f: FunctionReport) => number | null,
  order: "desc" | "asc",
  limit = 10,
): FunctionRef[] {
  return functions
    .map(({ path, fn }) => ({ path, name: fn.name, startLine: fn.range.startLine, value: pick(fn) }))
    .filter((f): f is FunctionRef => f.value !== null)
    .sort((a, b) => (order === "desc" ? b.value - a.value : a.value - b.value) || compareStrings(a.path, b.path) || a.startLine - b.startLine)
    .slice(0, limit);
}

export function countIssues(issues: Issue[]): IssueCounts {
  const counts: IssueCounts = {
    total: issues.length,
    blocker: 0,
    critical: 0,
    major: 0,
    minor: 0,
    info: 0,
    bugs: 0,
    vulnerabilities: 0,
    securityHotspots: 0,
    codeSmells: 0,
  };
  for (const issue of issues) {
    counts[issue.severity]++;
    if (issue.type === "bug") counts.bugs++;
    else if (issue.type === "vulnerability") counts.vulnerabilities++;
    else if (issue.type === "security-hotspot") counts.securityHotspots++;
    else counts.codeSmells++;
  }
  return counts;
}

const SEVERITY_RATING: Record<Severity, Rating> = {
  blocker: "E",
  critical: "D",
  major: "C",
  minor: "B",
  info: "A",
};

/** Rating driven by the worst severity among issues (A when there are none). Hotspots are not passed in. */
export function severityRating(issues: Issue[]): Rating {
  let worst: Rating = "A";
  for (const issue of issues) {
    const r = SEVERITY_RATING[issue.severity];
    if (r > worst) worst = r;
  }
  return worst;
}

/** Technical debt: remediation effort of maintainability issues, in minutes. */
export function technicalDebt(issues: Issue[]): number {
  return issues.filter((i) => i.type === "code-smell").reduce((s, i) => s + i.effortMinutes, 0);
}

/** Debt ratio in percent: remediation cost over the estimated development cost. */
export function debtRatio(debtMinutes: number, ncloc: number, costPerLine: number): number {
  if (ncloc === 0) return 0;
  return round((debtMinutes / (ncloc * costPerLine)) * 100, 2);
}

export function maintainabilityRating(ratio: number, thresholds: [number, number, number, number]): Rating {
  if (ratio <= thresholds[0]) return "A";
  if (ratio <= thresholds[1]) return "B";
  if (ratio <= thresholds[2]) return "C";
  if (ratio <= thresholds[3]) return "D";
  return "E";
}

export function ratings(
  issues: Issue[],
  ncloc: number,
  options: { developmentCostMinutesPerLine: number; maintainabilityThresholds: [number, number, number, number] },
): { ratings: Ratings; technicalDebtMinutes: number; debtRatio: number } {
  const debt = technicalDebt(issues);
  const ratio = debtRatio(debt, ncloc, options.developmentCostMinutesPerLine);
  return {
    ratings: {
      reliability: severityRating(issues.filter((i) => i.type === "bug")),
      security: severityRating(issues.filter((i) => i.type === "vulnerability")),
      maintainability: maintainabilityRating(ratio, options.maintainabilityThresholds),
    },
    technicalDebtMinutes: debt,
    debtRatio: ratio,
  };
}

export { round };
