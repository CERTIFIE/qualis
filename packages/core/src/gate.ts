import {
  NEW_CODE_GATE_METRICS,
  RATINGS,
  type GateCondition,
  type GateMetric,
  type NewCodeMeasures,
  type OverallMeasures,
  type QualityGateConditionResult,
  type QualityGateResult,
  type Rating,
} from "@qualis/schema";

type MetricValue = number | Rating | null;

/** Measures available both overall and on new code. */
type CommonMeasures = Pick<OverallMeasures, "issues" | "ratings" | "technicalDebtMinutes" | "debtRatio" | "coverage">;

function commonValue(metric: GateMetric, m: CommonMeasures): MetricValue | undefined {
  switch (metric) {
    case "reliabilityRating":
      return m.ratings.reliability;
    case "securityRating":
      return m.ratings.security;
    case "maintainabilityRating":
      return m.ratings.maintainability;
    case "issues":
      return m.issues.total;
    case "blockerIssues":
      return m.issues.blocker;
    case "criticalIssues":
      return m.issues.critical;
    case "majorIssues":
      return m.issues.major;
    case "bugs":
      return m.issues.bugs;
    case "vulnerabilities":
      return m.issues.vulnerabilities;
    case "securityHotspots":
      return m.issues.securityHotspots;
    case "codeSmells":
      return m.issues.codeSmells;
    case "technicalDebtMinutes":
      return m.technicalDebtMinutes;
    case "debtRatio":
      return m.debtRatio;
    case "coverage":
      return m.coverage?.coverage ?? null;
    case "lineCoverage":
      return m.coverage?.lineCoverage ?? null;
    case "branchCoverage":
      return m.coverage?.branchCoverage ?? null;
    default:
      return undefined;
  }
}

function overallValue(metric: GateMetric, m: OverallMeasures): MetricValue {
  const common = commonValue(metric, m);
  if (common !== undefined) return common;
  if (metric === "duplicatedLinesDensity") return m.duplication.duplicatedLinesDensity;
  if (metric === "testFailures") return m.tests ? m.tests.failed + m.tests.errors : null;
  if (metric === "testSuccessDensity") return m.tests?.successDensity ?? null;
  return null;
}

function newCodeValue(metric: GateMetric, m: NewCodeMeasures): MetricValue {
  const common = commonValue(metric, m);
  if (common !== undefined) return common;
  if (metric === "duplicatedLinesDensity") return m.ncloc === 0 ? null : m.duplicatedLinesDensity;
  return null;
}

const isRatingMetric = (metric: GateMetric) => metric.endsWith("Rating");

function toNumber(value: number | Rating): number {
  return typeof value === "number" ? value : RATINGS.indexOf(value) + 1;
}

export class GateConfigError extends Error {}

/** Checks that conditions are consistent (scope supported, rating thresholds on rating metrics). */
export function checkConditions(conditions: GateCondition[]): void {
  for (const c of conditions) {
    if ((c.scope ?? "overall") === "new" && !NEW_CODE_GATE_METRICS.includes(c.metric)) {
      throw new GateConfigError(`Quality gate metric "${c.metric}" is not available on new code`);
    }
    if (isRatingMetric(c.metric) !== (typeof c.threshold === "string")) {
      throw new GateConfigError(
        isRatingMetric(c.metric)
          ? `Quality gate metric "${c.metric}" needs a rating threshold (A-E)`
          : `Quality gate metric "${c.metric}" needs a numeric threshold`,
      );
    }
  }
}

/**
 * Evaluates the quality gate. A condition without data (e.g. coverage without
 * reports, or new code without a reference) is reported as `no-data` and does
 * not fail the gate.
 */
export function evaluateGate(
  gate: { name: string; conditions: GateCondition[] },
  overall: OverallMeasures,
  newCode: NewCodeMeasures | null,
): QualityGateResult {
  const conditions: QualityGateConditionResult[] = gate.conditions.map((c) => {
    const scope = c.scope ?? "overall";
    const actual = scope === "overall" ? overallValue(c.metric, overall) : newCode ? newCodeValue(c.metric, newCode) : null;
    let status: QualityGateConditionResult["status"] = "no-data";
    if (actual !== null) {
      const a = toNumber(actual);
      const t = toNumber(c.threshold);
      const failed = c.operator === "gt" ? a > t : a < t;
      status = failed ? "failed" : "passed";
    }
    return { metric: c.metric, scope, operator: c.operator, threshold: c.threshold, actual, status };
  });
  return {
    name: gate.name,
    status: conditions.some((c) => c.status === "failed") ? "failed" : "passed",
    conditions,
  };
}
