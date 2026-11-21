import { describe, expect, it } from "vitest";
import type { FileAnalysis } from "@qualis/plugin-api";
import { RULES } from "../src/index.js";
import { analyzeSnippet } from "./helpers.js";

const ruleIds = (analysis: FileAnalysis) => analysis.issues.map((i) => i.ruleId);

describe("rule examples", () => {
  const withExamples = RULES.map((r) => r.definition).filter((d) => d.noncompliantExample || d.compliantExample);

  it("every rule has authoritative references and documentation", () => {
    for (const rule of RULES.map((r) => r.definition)) {
      expect(rule.references.length, rule.id).toBeGreaterThan(0);
      for (const ref of rule.references) expect(ref.url, rule.id).toMatch(/^https:\/\//);
      expect(rule.description.length, rule.id).toBeGreaterThan(20);
      expect(rule.rationale.length, rule.id).toBeGreaterThan(40);
    }
  });

  describe.each(withExamples.map((d) => [d.id, d] as const))("%s", (_id, rule) => {
    if (rule.noncompliantExample) {
      it("reports the noncompliant example", async () => {
        const result = await analyzeSnippet(rule.noncompliantExample!, { ext: rule.noncompliantExample!.includes("<") && rule.id.includes("html") ? ".tsx" : ".ts" });
        expect(ruleIds(result)).toContain(rule.id);
      });
    }
    if (rule.compliantExample) {
      it("accepts the compliant example", async () => {
        const result = await analyzeSnippet(rule.compliantExample!);
        expect(ruleIds(result)).not.toContain(rule.id);
      });
    }
  });
});

describe("specific rule behaviour", () => {
  it("function-complexity uses the max parameter", async () => {
    const code = "export function f(a: number) {\n  if (a > 1) return 1;\n  if (a > 2) return 2;\n  return a > 3 ? 3 : 0;\n}\n";
    const strict = await analyzeSnippet(code, { params: { "typescript:function-complexity": { max: 3 } } });
    expect(strict.issues.find((i) => i.ruleId === "typescript:function-complexity")?.message).toContain("is 4 (max 3)");
    const relaxed = await analyzeSnippet(code);
    expect(ruleIds(relaxed)).not.toContain("typescript:function-complexity");
  });

  it("file-too-long counts lines of code only", async () => {
    const code = Array.from({ length: 12 }, (_, i) => `export const v${i} = ${i}; // comment`).join("\n");
    const result = await analyzeSnippet(code, { params: { "typescript:file-too-long": { max: 10 } } });
    expect(ruleIds(result)).toContain("typescript:file-too-long");
  });

  it("does not flag tagged SQL templates or parameterized calls", async () => {
    const code = "declare const sql: any, db: any, table: string, id: string;\nawait sql`SELECT * FROM t WHERE id = ${id}`;\nawait db.query(`SELECT * FROM t WHERE id = $1`, [id]);\n";
    const result = await analyzeSnippet(code);
    expect(ruleIds(result)).not.toContain("typescript:no-sql-injection");
    expect(ruleIds(result)).not.toContain("typescript:dynamic-sql-review");
  });

  it("reports dangerouslySetInnerHTML as a hotspot unless the HTML is a constant string", async () => {
    const result = await analyzeSnippet(
      [
        "const script = `document.documentElement.dataset.theme = 'dark'`;",
        "declare const html: string;",
        "export const A = () => <script dangerouslySetInnerHTML={{ __html: script }} />;",
        "export const B = () => <div dangerouslySetInnerHTML={{ __html: '<b>x</b>' }} />;",
        "export const C = () => <div dangerouslySetInnerHTML={{ __html: html }} />;",
        "",
      ].join("\n"),
      { ext: ".tsx" },
    );
    const byLine = result.issues.map((i) => `${i.range.startLine}:${i.ruleId}`);
    expect(byLine.filter((l) => l.includes("dangerous-html-review"))).toEqual(["5:typescript:dangerous-html-review"]);
    expect(ruleIds(result)).not.toContain("typescript:no-unsafe-html-sink");
    expect(RULES.find((r) => r.definition.id === "typescript:dangerous-html-review")?.definition.type).toBe("security-hotspot");
  });

  it("treats const strings interpolated into SQL as constant text", async () => {
    const result = await analyzeSnippet(
      [
        "declare const db: any, table: string, id: string;",
        "const COLUMNS = 't.hash, t.height';",
        "const ALL = `${COLUMNS}, t.time`;",
        "let mutable = 't.hash';",
        "db.query(`select ${COLUMNS} from txs t where t.height = $1`, [id]);",
        "db.query(`select ${ALL} from txs t`);",
        "db.query('select ' + COLUMNS + ' from txs t');",
        "db.query(`select ${mutable} from txs t`);",
        "db.query(`select ${COLUMNS} from ${table}`);",
        "const NAME = 'admin';",
        "db.query(`select * from users where name = ${NAME}`);",
        "",
      ].join("\n"),
    );
    const byLine = result.issues.filter((i) => i.ruleId.includes("sql")).map((i) => `${i.range.startLine}:${i.ruleId}`);
    expect(byLine).toEqual(["8:typescript:dynamic-sql-review", "9:typescript:dynamic-sql-review"]);
  });

  it("classifies interpolated identifiers as a hotspot and values as a vulnerability", async () => {
    const result = await analyzeSnippet(
      "declare const db: any, table: string, name: string;\ndb.query(`SELECT * FROM ${table}`);\ndb.query(`SELECT * FROM t WHERE name = '${name}'`);\ndb.query(\"DELETE FROM t WHERE id IN (\" + name + \")\");\n",
    );
    const byLine = result.issues.map((i) => `${i.range.startLine}:${i.ruleId}`);
    expect(byLine).toContain("2:typescript:dynamic-sql-review");
    expect(byLine).toContain("3:typescript:no-sql-injection");
    expect(byLine).toContain("4:typescript:no-sql-injection");
  });

  it("only reports child_process functions resolved from the module", async () => {
    const result = await analyzeSnippet("const exec = (s: string) => s;\ndeclare const cmd: string;\nexec(cmd);\n");
    expect(ruleIds(result)).not.toContain("typescript:no-os-command-injection");
    const required = await analyzeSnippet("const cp = require(\"child_process\");\ndeclare const cmd: string;\ncp.execSync(\"ls \" + cmd);\n", { ext: ".js" });
    expect(ruleIds(required)).toContain("typescript:no-os-command-injection");
  });

  it("ignores key names and placeholders in credential rules", async () => {
    const result = await analyzeSnippet('const resetPassword = "reset-password";\nconst apiKey = "...";\nconst label = { password: "Your password" };\n');
    expect(ruleIds(result)).not.toContain("typescript:no-hardcoded-credentials");
  });

  it("accepts documented fall-through and terminating if/else", async () => {
    const code = "declare const x: number;\ndeclare function a(): void;\nswitch (x) {\n  case 1:\n    a();\n    // falls through\n  case 2:\n    if (x) { return; } else { throw new Error(); }\n  case 3:\n    break;\n}\n";
    const result = await analyzeSnippet(code);
    expect(ruleIds(result)).not.toContain("typescript:no-fallthrough");
  });

  it("does not treat prose comments as commented-out code", async () => {
    const result = await analyzeSnippet("// This function returns the total amount, see the spec.\n// eslint-disable-next-line no-console\nexport const total = 1;\n");
    expect(ruleIds(result)).not.toContain("typescript:commented-out-code");
  });

  it("honours suppression comments", async () => {
    const code = "// qualis-ignore-next-line typescript:no-eval -- reviewed\neval(\"1\");\neval(\"2\"); // qualis-ignore-line\neval(\"3\");\n";
    const result = await analyzeSnippet(code);
    expect(result.issues.filter((i) => i.ruleId === "typescript:no-eval").map((i) => i.range.startLine)).toEqual([4]);
  });

  it("reports precise 1-based ranges", async () => {
    const result = await analyzeSnippet("const a = 1;\nif (a == 2) {}\n");
    const issue = result.issues.find((i) => i.ruleId === "typescript:strict-equality")!;
    expect(issue.range).toEqual({ startLine: 2, startColumn: 7, endLine: 2, endColumn: 9 });
  });
});

describe("no-floating-promises and node:test", () => {
  it("accepts top-level test definitions but not unawaited subtests", async () => {
    const code = `import { describe, test } from "node:test";
declare module "node:test" {
  export function test(name: string, fn: (t: { test(name: string, fn: () => void): Promise<void> }) => unknown): Promise<void>;
  export function describe(name: string, fn: () => void): Promise<void>;
  export namespace test { function skip(name: string, fn: () => void): Promise<void>; }
}
describe("suite", () => {});
test.skip("later", () => {});
test("top", async (t) => {
  t.test("sub", () => {});
});
`;
    const result = await analyzeSnippet(code);
    const lines = result.issues.filter((i) => i.ruleId === "typescript:no-floating-promises").map((i) => i.range.startLine);
    expect(lines).toEqual([10]);
  });
});

describe("no-floating-promises and promise chains", () => {
  it("treats catch().finally() as handled and then().finally() as not handled", async () => {
    const code = `declare function main(): Promise<void>;
main().catch(() => undefined).finally(() => undefined);
main().then(() => undefined).finally(() => undefined);
`;
    const result = await analyzeSnippet(code);
    expect(result.issues.filter((i) => i.ruleId === "typescript:no-floating-promises").map((i) => i.range.startLine)).toEqual([3]);
  });
});
