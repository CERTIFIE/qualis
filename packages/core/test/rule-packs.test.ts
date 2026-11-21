import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { QualisConfig } from "@qualis/schema";
import { analyze, validate } from "../src/index.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

async function run(config: QualisConfig, files: Record<string, string> = { "notes.txt": "first\nTODO second\n" }) {
  const root = mkdtempSync(path.join(tmpdir(), "qualis-pack-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(root, name), content);
  writeFileSync(path.join(root, "qualis.config.json"), JSON.stringify({ newCode: { reference: null }, ...config }));
  return analyze({ baseDir: root, strictPlugins: true });
}

const language = path.join(fixtures, "txt-language.mjs");
const pack = path.join(fixtures, "txt-pack.mjs");

describe("rule packs", () => {
  it("add issues to files owned by a language plugin and supersede equivalent rules", async () => {
    const report = await run({ plugins: [language, pack] });
    expect(validate("report", report).errors).toEqual([]);
    expect(report.tool.plugins.map((p) => `${p.id}:${p.kind}`)).toEqual(["txt:language", "pack:rule-pack"]);
    expect(report.issues.map((i) => `${i.ruleId}@${i.range.startLine}`)).toEqual(["pack:todo@2"]);
    expect(report.rules.map((r) => r.id)).toEqual(["pack:todo"]);
    expect(report.diagnostics.some((d) => d.message === "Rule txt:todo is superseded by pack:todo")).toBe(true);
  });

  it("keep the superseded rules when the pack cannot prepare", async () => {
    const report = await run({ plugins: [language, { module: pack, options: { fail: true } }] });
    expect(report.issues.map((i) => i.ruleId)).toEqual(["txt:todo"]);
    expect(report.diagnostics.find((d) => d.level === "warning")?.message).toMatch(/prepare failed, its rules are skipped: project cannot be loaded/);
  });

  it("keep a superseded rule that the configuration enables explicitly", async () => {
    const report = await run({ plugins: [language, pack], rules: { "txt:todo": "on" } });
    expect(report.issues.map((i) => i.ruleId).sort()).toEqual(["pack:todo", "txt:todo"]);
  });

  it("do not own file extensions", async () => {
    const report = await run({ plugins: [pack] });
    expect(report.files).toEqual([]);
    expect(report.issues).toEqual([]);
  });
});

describe("process plugins published as modules", () => {
  it("start the process declared by the module", async () => {
    const report = await run({ plugins: [path.join(fixtures, "process-descriptor.mjs")] }, { "app.ini": "name =\n" });
    expect(report.tool.plugins.map((p) => `${p.id}:${p.transport}`)).toEqual(["ini:process"]);
    expect(report.issues.map((i) => i.ruleId)).toEqual(["ini:empty-value"]);
  });
});
