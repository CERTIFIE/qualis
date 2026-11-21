import { describe, expect, it } from "vitest";
import type { CpdToken, Issue, NewCodeMeasures, OverallMeasures } from "@qualis/schema";
import {
  checkConditions,
  coverageMeasures,
  detectDuplications,
  evaluateGate,
  halsteadMeasures,
  maintainabilityIndex,
  maintainabilityRating,
  parseCobertura,
  parseJUnit,
  parseLcov,
  parseOpenCover,
  parseTrx,
  parseUnifiedDiff,
  resolveConfig,
  resolveRules,
  severityRating,
  testMeasures,
  validate,
} from "../src/index.js";
import { fileCoverage } from "../src/coverage.js";
import { countIssues } from "../src/metrics.js";

const tokens = (text: string, firstLine = 1): CpdToken[] =>
  text.split("\n").flatMap((line, i) =>
    line.split(/\s+/).filter(Boolean).map((image) => ({ image, startLine: firstLine + i, endLine: firstLine + i })),
  );

const block = Array.from({ length: 12 }, (_, i) => `let v${i} = compute ( a${i} , b${i} ) ;`).join("\n");

describe("duplication", () => {
  it("finds a block copied across files and counts its lines", () => {
    const result = detectDuplications(
      [
        { path: "a.ts", tokens: tokens(`unique start here\n${block}\nend a`) },
        { path: "b.ts", tokens: tokens(`other prefix\n${block}`) },
      ],
      50,
      10,
    );
    expect(result.groups).toHaveLength(1);
    const [group] = result.groups;
    expect(group!.occurrences.map((o) => `${o.path}:${o.startLine}-${o.endLine}`)).toEqual(["a.ts:2-13", "b.ts:2-13"]);
    expect(result.duplicatedLines.get("a.ts")?.size).toBe(12);
  });

  it("ignores blocks below the thresholds", () => {
    const small = "x = 1 ;\ny = 2 ;";
    expect(detectDuplications([{ path: "a", tokens: tokens(small) }, { path: "b", tokens: tokens(small) }], 50, 10).groups).toHaveLength(0);
    // Enough tokens but on too few lines.
    const oneLine = block.replace(/\n/g, " ");
    expect(detectDuplications([{ path: "a", tokens: tokens(oneLine) }, { path: "b", tokens: tokens(oneLine) }], 50, 10).groups).toHaveLength(0);
  });

  it("does not report a run of identical tokens overlapping itself", () => {
    const repeated = Array.from({ length: 30 }, () => "0 ,").join("\n");
    expect(detectDuplications([{ path: "a", tokens: tokens(repeated) }], 40, 10).groups.every((g) => g.occurrences.length >= 2)).toBe(true);
  });
});

describe("coverage import", () => {
  it("counts LCOV branches on lines without DA as conditions only", () => {
    // Vitest (v8 converted to istanbul) writes BRDA records on JSX lines that have no DA record.
    const data = parseLcov("SF:src/a.tsx\nDA:1,1\nDA:2,0\nBRDA:3,0,0,1\nBRDA:3,0,1,0\nend_of_record\n");
    const m = coverageMeasures(data)!;
    expect(m).toMatchObject({ linesToCover: 2, coveredLines: 1, conditionsToCover: 2, coveredConditions: 1 });
    expect(fileCoverage(data.get("src/a.tsx")!)).toEqual({ coveredLines: [1], uncoveredLines: [2], partialLines: [{ line: 3, covered: 1, total: 2 }] });
    // Line data from another report makes it a line to cover again.
    const merged = parseLcov("SF:src/a.tsx\nBRDA:3,0,0,1\nend_of_record\nSF:src/a.tsx\nDA:3,0\nend_of_record\n");
    expect(coverageMeasures(merged)!.linesToCover).toBe(1);
  });

  it("parses LCOV lines and branches", () => {
    const data = parseLcov("TN:\nSF:src/a.ts\nDA:1,3\nDA:2,0\nBRDA:1,0,0,2\nBRDA:1,0,1,-\nend_of_record\n");
    const lines = data.get("src/a.ts")!;
    expect(lines.get(1)).toEqual({ hits: 3, conditions: 2, coveredConditions: 1 });
    expect(lines.get(2)).toEqual({ hits: 0, conditions: 0, coveredConditions: 0 });
  });

  it("parses Cobertura line and condition coverage", () => {
    const xml = `<?xml version="1.0"?><coverage><sources><source>/src</source></sources><packages><package><classes>
      <class filename="Demo/A.cs"><lines><line number="10" hits="1" branch="true" condition-coverage="50% (1/2)"/><line number="11" hits="0"/></lines></class>
    </classes></package></packages></coverage>`;
    const { sources, files } = parseCobertura(xml);
    expect(sources).toEqual(["/src"]);
    expect(files.get("Demo/A.cs")!.get(10)).toEqual({ hits: 1, conditions: 2, coveredConditions: 1 });
  });

  it("parses OpenCover sequence and branch points", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?><CoverageSession><Modules>
      <Module hash="x"><Files><File uid="1" fullPath="/build/src/A.cs" /><File uid="2" fullPath="/build/src/B.cs" /></Files>
      <Classes><Class><Methods><Method>
        <SequencePoints>
          <SequencePoint vc="2" sl="10" sc="1" el="11" ec="5" fileid="1" />
          <SequencePoint vc="0" sl="12" sc="1" el="12" ec="5" fileid="1" />
          <SequencePoint vc="1" sl="3" sc="1" el="3" ec="5" fileid="2" />
        </SequencePoints>
        <BranchPoints>
          <BranchPoint vc="1" sl="10" path="0" fileid="1" />
          <BranchPoint vc="0" sl="10" path="1" fileid="1" />
        </BranchPoints>
      </Method></Methods></Class></Classes></Module>
      <Module hash="y" skippedDueTo="Filter"><Files><File uid="1" fullPath="/build/src/Skipped.cs" /></Files></Module>
    </Modules></CoverageSession>`;
    const files = parseOpenCover(xml);
    expect([...files.keys()]).toEqual(["/build/src/A.cs", "/build/src/B.cs"]);
    const a = files.get("/build/src/A.cs")!;
    expect(a.get(10)).toEqual({ hits: 2, conditions: 2, coveredConditions: 1 });
    expect(a.get(11)).toEqual({ hits: 2, conditions: 0, coveredConditions: 0 });
    expect(a.get(12)).toEqual({ hits: 0, conditions: 0, coveredConditions: 0 });
    expect(files.get("/build/src/B.cs")!.get(3)?.hits).toBe(1);
  });

  it("aggregates line, branch and combined coverage", () => {
    const data = new Map([["a", new Map([[1, { hits: 1, conditions: 2, coveredConditions: 1 }], [2, { hits: 0, conditions: 0, coveredConditions: 0 }]])]]);
    const m = coverageMeasures(data)!;
    expect(m.lineCoverage).toBe(50);
    expect(m.branchCoverage).toBe(50);
    expect(m.coverage).toBe(50); // (1 + 1) / (2 + 2)
    expect(coverageMeasures(data, new Map([["a", new Set([1])]]))!.lineCoverage).toBe(100);
  });
});

describe("test report import", () => {
  it("parses JUnit XML", () => {
    const suites = parseJUnit(`<testsuites><testsuite name="s" time="1.5">
      <testcase name="ok" classname="C" time="0.5"/>
      <testcase name="ko" time="1"><failure message="boom">trace</failure></testcase>
      <testcase name="skip"><skipped/></testcase>
    </testsuite></testsuites>`, "junit.xml");
    expect(suites[0]).toMatchObject({ name: "s", tests: 3, failed: 1, skipped: 1, durationMs: 1500 });
    expect(suites[0]!.cases[1]).toMatchObject({ status: "failed", message: "boom" });
    expect(testMeasures(suites)).toMatchObject({ total: 3, passed: 1, failed: 1, skipped: 1, successDensity: 50 });
  });

  it("parses JUnit test cases written straight under <testsuites> (Node's test runner)", () => {
    const suites = parseJUnit(`<testsuites>
      <testcase name="a" time="0.25" file="/repo/src/a.test.ts"/>
      <testcase name="b" time="0.5" file="/repo/src/a.test.ts"><failure message="no">x</failure></testcase>
      <testcase name="c" time="0.1" file="/elsewhere/c.test.ts"/>
      <testsuite name="group" time="1"><testcase name="d" time="1" file="/repo/src/a.test.ts"/></testsuite>
    </testsuites>`, "junit.xml", "/repo");
    expect(suites.map((s) => [s.name, s.tests, s.failed])).toEqual([["src/a.test.ts", 2, 1], ["/elsewhere/c.test.ts", 1, 0], ["group", 1, 0]]);
    expect(suites[0]!.durationMs).toBe(750);
    expect(testMeasures(suites)).toMatchObject({ total: 4, passed: 3, failed: 1 });
  });

  it("parses TRX", () => {
    const suites = parseTrx(`<TestRun name="run"><Results>
      <UnitTestResult testName="A" outcome="Passed" duration="00:00:01.2500000"/>
      <UnitTestResult testName="B" outcome="Failed" duration="00:00:00.1000000"><Output><ErrorInfo><Message>bad</Message></ErrorInfo></Output></UnitTestResult>
      <UnitTestResult testName="C" outcome="NotExecuted"/>
    </Results></TestRun>`, "r.trx");
    expect(suites[0]).toMatchObject({ tests: 3, failed: 1, skipped: 1, durationMs: 1350 });
    expect(suites[0]!.cases[1]!.message).toBe("bad");
  });
});

describe("metrics", () => {
  it("derives Halstead measures", () => {
    const h = halsteadMeasures({ distinctOperators: 10, distinctOperands: 6, totalOperators: 20, totalOperands: 12 });
    expect(h.vocabulary).toBe(16);
    expect(h.length).toBe(32);
    expect(h.volume).toBe(128); // 32 × log2(16)
    expect(h.difficulty).toBe(10); // (10/2) × (12/6)
    expect(h.effort).toBe(1280);
    expect(h.deliveredBugs).toBeCloseTo(Math.pow(1280, 2 / 3) / 3000, 4);
  });

  it("computes the Visual Studio maintainability index", () => {
    // (171 − 5.2 ln 128 − 0.23 × 3 − 16.2 ln 10) × 100 / 171
    const expected = Math.round(((171 - 5.2 * Math.log(128) - 0.23 * 3 - 16.2 * Math.log(10)) * 100) / 171);
    expect(maintainabilityIndex(128, 3, 10)).toBe(expected);
    expect(maintainabilityIndex(1e12, 500, 1e6)).toBe(0);
  });

  it("rates by worst severity and by debt ratio", () => {
    const issue = (severity: Issue["severity"]) => ({ severity, type: "bug" }) as Issue;
    expect(severityRating([])).toBe("A");
    expect(severityRating([issue("info")])).toBe("A");
    expect(severityRating([issue("minor"), issue("critical")])).toBe("D");
    expect(maintainabilityRating(5, [5, 10, 20, 50])).toBe("A");
    expect(maintainabilityRating(5.01, [5, 10, 20, 50])).toBe("B");
    expect(maintainabilityRating(51, [5, 10, 20, 50])).toBe("E");
  });

  it("counts hotspots separately from vulnerabilities", () => {
    const counts = countIssues([{ severity: "major", type: "security-hotspot" } as Issue, { severity: "major", type: "vulnerability" } as Issue]);
    expect(counts).toMatchObject({ total: 2, vulnerabilities: 1, securityHotspots: 1, major: 2 });
  });
});

describe("quality gate", () => {
  const overall = {
    ratings: { reliability: "A", security: "C", maintainability: "A" },
    issues: { total: 3, blocker: 0, critical: 0, major: 3, minor: 0, info: 0, bugs: 0, vulnerabilities: 3, securityHotspots: 0, codeSmells: 0 },
    technicalDebtMinutes: 0,
    debtRatio: 0,
    coverage: null,
    tests: null,
    duplication: { duplicatedLines: 0, duplicatedBlocks: 0, duplicatedFiles: 0, duplicatedLinesDensity: 4 },
  } as unknown as OverallMeasures;

  it("evaluates rating and numeric conditions and reports missing data", () => {
    const result = evaluateGate(
      {
        name: "g",
        conditions: [
          { metric: "securityRating", operator: "gt", threshold: "B" },
          { metric: "duplicatedLinesDensity", operator: "gt", threshold: 5 },
          { metric: "coverage", operator: "lt", threshold: 80 },
          { metric: "bugs", scope: "new", operator: "gt", threshold: 0 },
        ],
      },
      overall,
      null as NewCodeMeasures | null,
    );
    expect(result.status).toBe("failed");
    expect(result.conditions.map((c) => c.status)).toEqual(["failed", "passed", "no-data", "no-data"]);
  });

  it("rejects inconsistent conditions", () => {
    expect(() => checkConditions([{ metric: "coverage", operator: "lt", threshold: "A" }])).toThrow(/numeric/);
    expect(() => checkConditions([{ metric: "testFailures", scope: "new", operator: "gt", threshold: 0 }])).toThrow(/new code/);
  });
});

describe("git diff parsing", () => {
  it("collects added and changed lines of the new version", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3,0 +4,2 @@",
      "+x",
      "+y",
      "@@ -10 +12 @@",
      "-old",
      "+new",
      "@@ -20,3 +23,0 @@",
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
    ].join("\n");
    const changed = parseUnifiedDiff(diff);
    expect(changed.get("src/a.ts")).toEqual([4, 5, 12]);
    expect(changed.has("gone.ts")).toBe(false);
  });
});

describe("configuration and rules", () => {
  it("validates configuration files against the schema", () => {
    expect(validate("config", { rules: { "typescript:no-eval": "off" } }).valid).toBe(true);
    const bad = validate("config", { rules: { "not a rule": "off" }, unknown: 1 });
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it("applies defaults", () => {
    const config = resolveConfig("/tmp/My Project", {}, null);
    expect(config.project).toEqual({ key: "my-project", name: "My Project" });
    expect(config.duplication).toMatchObject({ minTokens: 100, minLines: 10 });
    expect(config.newCodeReference).toBe("auto");
  });

  it("resolves rule settings, parameters and warnings", () => {
    const manifest = {
      apiVersion: 1 as const,
      id: "x",
      name: "X",
      version: "1",
      languages: [{ id: "x", name: "X", extensions: [".x"] }],
      rules: [
        { id: "x:a", name: "A", languages: ["x"], type: "bug" as const, severity: "major" as const, tags: [], enabledByDefault: true, effortMinutes: 1, description: "d", rationale: "r", references: [], params: [{ name: "max", description: "", type: "integer" as const, default: 3 }] },
        { id: "x:b", name: "B", languages: ["x"], type: "bug" as const, severity: "minor" as const, tags: [], enabledByDefault: false, effortMinutes: 1, description: "d", rationale: "r", references: [] },
      ],
    };
    const { active, excludes, warnings } = resolveRules([manifest], {
      "x:a": { severity: "blocker", params: { max: 5, nope: 1 }, exclude: ["tests/**"] },
      "x:b": "critical",
      "x:zzz": "off",
    });
    expect(active.get("x:a")).toMatchObject({ severity: "blocker", defaultSeverity: "major", paramValues: { max: 5 } });
    expect(active.get("x:b")?.severity).toBe("critical");
    expect(excludes.get("x:a")).toEqual(["tests/**"]);
    expect(warnings).toEqual(['Rule x:a has no parameter "nope"; ignored', 'Unknown rule "x:zzz" in configuration']);
  });
});
