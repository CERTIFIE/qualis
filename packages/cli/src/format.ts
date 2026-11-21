import type { QualityGateConditionResult, Rating, Report } from "@qualis/schema";

const useColor = process.stdout.isTTY && !process.env["NO_COLOR"];
const paint = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = paint(1);
export const dim = paint(2);
export const red = paint(31);
export const green = paint(32);
export const yellow = paint(33);

const ratingColor: Record<Rating, (s: string) => string> = { A: green, B: green, C: yellow, D: red, E: red };
const rating = (r: Rating) => ratingColor[r](bold(r));

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v.toFixed(1)}%`);

function duration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}min`;
  const hours = minutes / 60;
  if (hours < 8) return `${hours.toFixed(1)}h`;
  return `${(hours / 8).toFixed(1)}d`;
}

const OPERATOR: Record<string, string> = { gt: ">", lt: "<" };

function condition(c: QualityGateConditionResult): string {
  const mark = c.status === "failed" ? red("✗") : c.status === "passed" ? green("✓") : dim("–");
  const actual = c.actual === null ? "no data" : typeof c.actual === "number" ? String(Math.round(c.actual * 10) / 10) : c.actual;
  const scope = c.scope === "new" ? "new code" : "overall";
  return `  ${mark} ${c.metric} (${scope}) = ${actual}  ${dim(`fails when ${OPERATOR[c.operator]} ${c.threshold}`)}`;
}

/** Human-readable summary of a report for the terminal. */
export function summary(report: Report, written: string[]): string {
  const m = report.measures.overall;
  const n = report.measures.newCode;
  const out: string[] = [];
  const gate = report.qualityGate.status === "passed" ? green(bold("PASSED")) : red(bold("FAILED"));
  out.push("");
  const testCode = m.testCode && m.testCode.files > 0 ? ` (+ ${m.testCode.files} test files, ${m.testCode.ncloc} lines)` : "";
  out.push(`${bold(report.project.name)}  ${dim(`${m.files} files, ${m.ncloc} lines of code${testCode}, ${report.analysis.durationMs} ms`)}`);
  out.push("");
  out.push(`Quality gate "${report.qualityGate.name}": ${gate}`);
  for (const c of report.qualityGate.conditions) out.push(condition(c));
  out.push("");
  out.push(bold("Overall code"));
  out.push(`  Security        ${rating(m.ratings.security)}  ${m.issues.vulnerabilities} vulnerabilities${m.issues.securityHotspots ? dim(`, ${m.issues.securityHotspots} security hotspots to review`) : ""}`);
  out.push(`  Reliability     ${rating(m.ratings.reliability)}  ${m.issues.bugs} bugs`);
  out.push(`  Maintainability ${rating(m.ratings.maintainability)}  ${m.issues.codeSmells} code smells, debt ${duration(m.technicalDebtMinutes)} (${m.debtRatio}%)`);
  out.push(`  Coverage        ${pct(m.coverage?.coverage)}${m.coverage ? dim(`  lines ${pct(m.coverage.lineCoverage)}, branches ${pct(m.coverage.branchCoverage)}`) : dim("  no coverage report")}`);
  out.push(`  Duplications   ${pct(m.duplication.duplicatedLinesDensity).padStart(6)}  ${dim(`${m.duplication.duplicatedBlocks} blocks, ${m.duplication.duplicatedLines} lines`)}`);
  if (m.tests) out.push(`  Tests           ${m.tests.passed}/${m.tests.total - m.tests.skipped} passed${m.tests.failed + m.tests.errors > 0 ? red(`, ${m.tests.failed + m.tests.errors} failing`) : ""}${m.tests.skipped ? dim(`, ${m.tests.skipped} skipped`) : ""}`);
  out.push("");
  out.push(bold("Complexity"));
  const fs = m.functionStats;
  out.push(`  Cyclomatic      ${m.complexity} total, ${fs.averageComplexity} avg/function, max ${fs.maxComplexity}`);
  out.push(`  Cognitive       ${m.cognitiveComplexity} total, ${fs.averageCognitiveComplexity} avg/function, max ${fs.maxCognitiveComplexity}`);
  out.push(`  Functions       ${fs.count}  ${dim(`low ${fs.complexityDistribution.low} · moderate ${fs.complexityDistribution.moderate} · high ${fs.complexityDistribution.high} · very high ${fs.complexityDistribution.veryHigh}`)}`);
  if (fs.averageMaintainabilityIndex !== null) {
    out.push(`  Maint. index    ${fs.averageMaintainabilityIndex} avg, min ${fs.minMaintainabilityIndex}`);
  }
  if (m.hotspots.complexity.length > 0) {
    out.push(dim("  Most complex functions:"));
    for (const h of m.hotspots.complexity.slice(0, 5)) out.push(dim(`    ${String(h.value).padStart(3)}  ${h.name}  ${h.path}:${h.startLine}`));
  }
  if (n) {
    out.push("");
    out.push(bold(`New code`) + dim(` since ${report.analysis.newCode?.reference} (${n.lines} changed lines)`));
    out.push(`  Security ${rating(n.ratings.security)}  Reliability ${rating(n.ratings.reliability)}  Maintainability ${rating(n.ratings.maintainability)}  Coverage ${pct(n.coverage?.coverage)}  Duplications ${pct(n.duplicatedLinesDensity)}  Issues ${n.issues.total}`);
  }
  const errors = report.diagnostics.filter((d) => d.level === "error");
  const warnings = report.diagnostics.filter((d) => d.level === "warning");
  if (errors.length || warnings.length) {
    out.push("");
    if (errors.length) out.push(red(`${errors.length} analysis error(s)`) + dim(" – see diagnostics in the report"));
    if (warnings.length) out.push(yellow(`${warnings.length} warning(s)`) + dim(" – see diagnostics in the report"));
  }
  if (written.length) {
    out.push("");
    for (const file of written) out.push(dim(`Report: ${file}`));
  }
  out.push("");
  return out.join("\n");
}

/** One line per issue, compiler style. */
export function issueLines(report: Report): string {
  return report.issues
    .map((i) => `${i.path}:${i.range.startLine}:${i.range.startColumn}  ${i.severity.padEnd(8)} ${i.message}  ${dim(i.ruleId)}`)
    .join("\n");
}
