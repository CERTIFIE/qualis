import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validate } from "@qualis/core";
import createTypeScriptPlugin from "@qualis/plugin-typescript";
import createPlugin from "../src/index.js";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const silent = { log: () => undefined };

async function lint(files: Record<string, string>, target: string) {
  const root = mkdtempSync(path.join(tmpdir(), "qualis-eslint-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
  const plugin = createPlugin();
  const file = { path: target, absolutePath: path.join(root, target), language: target.endsWith(".js") ? "javascript" : "typescript" };
  await plugin.prepare?.({ baseDir: root, files: [file], options: {}, log: silent });
  const rules = plugin.rules.filter((r) => r.enabledByDefault).map((r) => ({ id: r.id, params: {} }));
  return plugin.analyzeFile({ file, content: files[target]!, rules });
}

describe("ESLint rule pack", () => {
  const plugin = createPlugin();

  it("publishes a valid rule-pack manifest with a source for every rule", () => {
    const { prepare, analyzeFile, dispose, ...manifest } = plugin;
    expect(validate("plugin-manifest", manifest).errors).toEqual([]);
    expect(manifest.kind).toBe("rule-pack");
    for (const rule of manifest.rules) {
      expect(rule.references[0]!.url, rule.id).toMatch(/^https:\/\/(eslint\.org|typescript-eslint\.io)\//);
    }
  });

  it("supersedes only rules that exist in the TypeScript plugin", () => {
    const ts = new Set(createTypeScriptPlugin().rules.map((r) => r.id));
    const superseded = plugin.rules.flatMap((r) => r.supersedes ?? []);
    expect(superseded.length).toBeGreaterThan(5);
    for (const id of superseded) expect(ts.has(id), id).toBe(true);
  });

  it("classifies eval rules as vulnerabilities with CWE-95", () => {
    const rule = plugin.rules.find((r) => r.id === "eslint:no-eval")!;
    expect(rule).toMatchObject({ type: "vulnerability", severity: "critical", supersedes: ["typescript:no-eval"] });
    expect(rule.references.map((r) => r.id)).toContain("CWE-95");
  });

  it("disables overlapping rules that cannot replace the Qualis rule everywhere", () => {
    for (const id of ["eslint:no-dupe-keys", "eslint:no-new-func", "eslint:ts-no-floating-promises"]) {
      const rule = plugin.rules.find((r) => r.id === id)!;
      expect(rule.enabledByDefault, id).toBe(false);
      expect(rule.supersedes, id).toBeUndefined();
    }
  });

  it("reports JavaScript problems with 1-based ranges", async () => {
    const result = await lint({ "a.js": "const a = 1;\ndebugger;\nfoo();\n" }, "a.js");
    expect(result.issues.map((i) => `${i.ruleId}@${i.range.startLine}:${i.range.startColumn}`)).toEqual(["eslint:no-debugger@2:1", "eslint:no-undef@3:1"]);
  });

  it("runs type-aware rules when a tsconfig.json exists", async () => {
    const files = {
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "NodeNext" }, include: ["src"] }),
      "src/x.ts": "export async function f(): Promise<number> {\n  return 1;\n}\n",
    };
    const typed = await lint(files, "src/x.ts");
    expect(typed.issues.map((i) => i.ruleId)).toContain("eslint:ts-require-await");
    const { "tsconfig.json": _ignored, ...withoutTsconfig } = files;
    const untyped = await lint(withoutTsconfig, "src/x.ts");
    expect(untyped.issues.map((i) => i.ruleId)).not.toContain("eslint:ts-require-await");
  });
});
