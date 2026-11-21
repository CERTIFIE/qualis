import { describe, expect, it } from "vitest";
import type { FileAnalysis } from "@qualis/plugin-api";
import { RULES } from "../src/rules.js";
import { analyzeSnippet } from "./helpers.js";

const ruleIds = (analysis: FileAnalysis) => analysis.issues.map((i) => i.ruleId);

describe("rule examples", () => {
  it("every rule has authoritative references and documentation", () => {
    for (const rule of RULES.map((r) => r.definition)) {
      expect(rule.references.length, rule.id).toBeGreaterThan(0);
      for (const ref of rule.references) expect(ref.url, rule.id).toMatch(/^https:\/\//);
      expect(rule.rationale.length, rule.id).toBeGreaterThan(40);
    }
  });

  const withExamples = RULES.map((r) => r.definition).filter((d) => d.noncompliantExample || d.compliantExample);
  describe.each(withExamples.map((d) => [d.id, d] as const))("%s", (_id, rule) => {
    if (rule.noncompliantExample) {
      it("reports the noncompliant example", async () => {
        expect(ruleIds(await analyzeSnippet(rule.noncompliantExample!))).toContain(rule.id);
      });
    }
    if (rule.compliantExample) {
      it("accepts the compliant example", async () => {
        expect(ruleIds(await analyzeSnippet(rule.compliantExample!))).not.toContain(rule.id);
      });
    }
  });
});

describe("specific rule behaviour", () => {
  it("classifies SQL by insertion position and resolves file constants", async () => {
    const code = `class Repo {
  const string Published = "published";
  async Task Run(IDbConnection c, string table, string name) {
    await c.QueryAsync<int>($"SELECT id FROM {table} WHERE x = @x", new { x = 1 });
    await c.QueryAsync<int>($"SELECT id FROM t WHERE name = '{name}'");
    await c.QueryAsync<int>($"SELECT id FROM t WHERE status = '{Published}'");
    var cmd = new SqlCommand("SELECT * FROM t WHERE id IN (" + name + ")", conn);
  }
}`;
    const result = await analyzeSnippet(code);
    const found = result.issues.map((i) => `${i.range.startLine}:${i.ruleId}`);
    expect(found).toContain("4:csharp:dynamic-sql-review");
    expect(found).toContain("5:csharp:no-sql-injection");
    expect(found.filter((f) => f.startsWith("6:"))).toEqual([]);
    expect(found).toContain("7:csharp:no-sql-injection");
  });

  it("accepts async void event handlers", async () => {
    const result = await analyzeSnippet("class Form { private async void OnClick(object sender, EventArgs e) { await Task.Delay(1); } }");
    expect(ruleIds(result)).not.toContain("csharp:no-async-void");
  });

  it("only flags throw of the caught variable", async () => {
    const result = await analyzeSnippet("class A { void M() { try { } catch (Exception ex) { var other = new Exception(); throw other; } } }");
    expect(ruleIds(result)).not.toContain("csharp:preserve-stack-on-rethrow");
  });

  it("ignores key names and placeholders in credential rules", async () => {
    const result = await analyzeSnippet('class K { public const string TemporaryPassword = "temporary_password"; string Msg = "use Host=...;Password=...;"; }');
    expect(ruleIds(result)).not.toContain("csharp:no-hardcoded-credentials");
  });

  it("uses the max parameter of function-complexity", async () => {
    const code = "class A { int M(int a) { if (a > 1) return 1; if (a > 2) return 2; return a > 3 ? 3 : 0; } }";
    const strict = await analyzeSnippet(code, { params: { "csharp:function-complexity": { max: 3 } } });
    expect(strict.issues.find((i) => i.ruleId === "csharp:function-complexity")?.message).toContain("is 4 (max 3)");
    expect(ruleIds(await analyzeSnippet(code))).not.toContain("csharp:function-complexity");
  });

  it("reports too many parameters", async () => {
    const result = await analyzeSnippet("class A { void M(int a, int b, int c, int d, int e, int f, int g, int h) { } }");
    expect(ruleIds(result)).toContain("csharp:too-many-parameters");
  });

  it("does not treat prose or XML documentation as commented-out code", async () => {
    const result = await analyzeSnippet("/// <summary>Returns x; see docs.</summary>\n// This method returns the total amount.\nclass A { }\n");
    expect(ruleIds(result)).not.toContain("csharp:commented-out-code");
  });

  it("honours suppression comments", async () => {
    const code = "class A {\n  void M() {\n    // qualis-ignore-next-line csharp:no-weak-hash -- legacy checksum\n    var a = MD5.Create();\n    var b = MD5.Create(); // qualis-ignore-line\n    var c = MD5.Create();\n  }\n}\n";
    const result = await analyzeSnippet(code);
    expect(result.issues.filter((i) => i.ruleId === "csharp:no-weak-hash").map((i) => i.range.startLine)).toEqual([6]);
  });
});
