import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TestCase, TestMeasures, TestStatus, TestSuite } from "@qualis/schema";
import { parseXml } from "./coverage.js";
import { toPosix } from "./paths.js";

const seconds = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) : 0;
};

/** Parses a TRX duration (`hh:mm:ss.fffffff`) into milliseconds. */
export function trxDuration(value: unknown): number {
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(value ?? ""));
  if (!m) return 0;
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    return (v["message"] as string | undefined) ?? (v["#text"] as string | undefined);
  }
  return String(value);
}

function junitCase(tc: Record<string, any>): TestCase {
  let status: TestStatus = "passed";
  let message: string | undefined;
  if (tc["failure"] !== undefined) {
    status = "failed";
    message = text(tc["failure"]);
  } else if (tc["error"] !== undefined) {
    status = "error";
    message = text(tc["error"]);
  } else if (tc["skipped"] !== undefined) {
    status = "skipped";
  }
  const result: TestCase = { name: String(tc.name ?? ""), status, durationMs: seconds(tc.time) };
  if (tc.classname) result.className = String(tc.classname);
  if (message) result.message = message.slice(0, 2000);
  return result;
}

function junitSuite(name: string, report: string, cases: TestCase[], time: unknown): TestSuite {
  return {
    name,
    report,
    tests: cases.length,
    failed: cases.filter((c) => c.status === "failed").length,
    errors: cases.filter((c) => c.status === "error").length,
    skipped: cases.filter((c) => c.status === "skipped").length,
    durationMs: time !== undefined ? seconds(time) : cases.reduce((s, c) => s + c.durationMs, 0),
    cases,
  };
}

function collectJUnitSuites(node: Record<string, any>, report: string, out: TestSuite[]): void {
  for (const suite of node["testsuite"] ?? []) {
    const cases: TestCase[] = (suite.testcase ?? []).map(junitCase);
    if (cases.length > 0) out.push(junitSuite(String(suite.name ?? ""), report, cases, suite.time));
    // Nested suites (allowed by several JUnit producers).
    collectJUnitSuites(suite, report, out);
  }
}

/**
 * Test cases written straight under `<testsuites>`, as Node's test runner does for top-level tests
 * (`--test-reporter=junit`): one suite per test file (its `file` attribute, relative to `baseDir` when inside it).
 */
function looseJUnitSuites(root: Record<string, any>, report: string, baseDir: string | undefined): TestSuite[] {
  const byFile = new Map<string, TestCase[]>();
  for (const tc of root["testcase"] ?? []) {
    let name = tc.file ? toPosix(String(tc.file)) : path.basename(report);
    if (tc.file && baseDir && path.isAbsolute(String(tc.file))) {
      const rel = path.relative(baseDir, String(tc.file));
      if (!rel.startsWith("..") && !path.isAbsolute(rel)) name = toPosix(rel);
    }
    byFile.set(name, [...(byFile.get(name) ?? []), junitCase(tc)]);
  }
  return [...byFile].map(([name, cases]) => junitSuite(name, report, cases, undefined));
}

/** Parses a JUnit XML report (`<testsuites>` or a single `<testsuite>` root). */
export function parseJUnit(content: string, report: string, baseDir?: string): TestSuite[] {
  const doc = parseXml(content) as Record<string, any>;
  const out: TestSuite[] = [];
  if (doc["testsuites"]) {
    out.push(...looseJUnitSuites(doc["testsuites"], report, baseDir));
    collectJUnitSuites(doc["testsuites"], report, out);
  } else if (doc["testsuite"]) collectJUnitSuites({ testsuite: doc["testsuite"] }, report, out);
  else throw new Error("not a JUnit report (missing <testsuites> or <testsuite>)");
  return out;
}

const TRX_STATUS: Record<string, TestStatus> = {
  Passed: "passed",
  PassedButRunAborted: "passed",
  Failed: "failed",
  NotExecuted: "skipped",
  Inconclusive: "skipped",
  NotRunnable: "skipped",
  Disconnected: "skipped",
  Warning: "passed",
  Completed: "passed",
};

/** Parses a Visual Studio test results file (TRX). */
export function parseTrx(content: string, report: string): TestSuite[] {
  const doc = parseXml(content) as Record<string, any>;
  const run = doc["TestRun"];
  if (!run) throw new Error("not a TRX report (missing <TestRun>)");
  const cases: TestCase[] = (run.Results?.UnitTestResult ?? []).map((r: Record<string, any>) => {
    const status = TRX_STATUS[String(r.outcome)] ?? "error";
    const result: TestCase = { name: String(r.testName ?? ""), status, durationMs: trxDuration(r.duration) };
    const message = text(r.Output?.ErrorInfo?.Message);
    if (message && status !== "passed") result.message = message.slice(0, 2000);
    return result;
  });
  return [
    {
      name: String(run.name ?? path.basename(report)),
      report,
      tests: cases.length,
      failed: cases.filter((c) => c.status === "failed").length,
      errors: cases.filter((c) => c.status === "error").length,
      skipped: cases.filter((c) => c.status === "skipped").length,
      durationMs: cases.reduce((s, c) => s + c.durationMs, 0),
      cases,
    },
  ];
}

export async function importTests(reports: string[], baseDir: string): Promise<{ suites: TestSuite[]; warnings: string[] }> {
  const suites: TestSuite[] = [];
  const warnings: string[] = [];
  for (const report of reports) {
    const rel = toPosix(path.relative(baseDir, report));
    try {
      const content = await readFile(report, "utf8");
      suites.push(...(/<TestRun[\s>]/.test(content) ? parseTrx(content, rel) : parseJUnit(content, rel, baseDir)));
    } catch (error) {
      warnings.push(`Cannot import test report ${rel}: ${(error as Error).message}`);
    }
  }
  return { suites, warnings };
}

export function testMeasures(suites: TestSuite[]): TestMeasures {
  const total = suites.reduce((s, x) => s + x.tests, 0);
  const failed = suites.reduce((s, x) => s + x.failed, 0);
  const errors = suites.reduce((s, x) => s + x.errors, 0);
  const skipped = suites.reduce((s, x) => s + x.skipped, 0);
  const executed = total - skipped;
  const passed = executed - failed - errors;
  return {
    total,
    passed,
    failed,
    errors,
    skipped,
    durationMs: suites.reduce((s, x) => s + x.durationMs, 0),
    successDensity: executed === 0 ? null : Math.round((passed / executed) * 1000) / 10,
  };
}
