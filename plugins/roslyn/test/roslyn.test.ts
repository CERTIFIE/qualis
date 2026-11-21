import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { analyze, loadPlugin, validate } from "@qualis/core";
import { unavailablePack, unavailableReason } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI_DIR = path.resolve(here, "../../../packages/cli");
const reason = unavailableReason();
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const silent = { log: () => undefined };

describe("Roslyn rule pack when .NET is not available", () => {
  it("fails in prepare with the reason, so superseded rules keep running", async () => {
    const pack = unavailablePack("the `dotnet` command was not found");
    expect(pack.kind).toBe("rule-pack");
    expect(() => pack.prepare?.({ baseDir: ".", files: [], options: {}, rules: [], log: silent })).toThrow(/dotnet/);
  });
});

describe.runIf(!reason)("Roslyn rule pack (.NET helper over stdio)", () => {
  it("publishes the Microsoft CA rules with Microsoft Learn references", async () => {
    const plugin = await loadPlugin(path.resolve(here, ".."), { baseDir: here, log: silent });
    try {
      expect(plugin.transport).toBe("process");
      expect(validate("plugin-manifest", plugin.manifest).errors).toEqual([]);
      const rules = plugin.manifest.rules;
      expect(rules.length).toBeGreaterThan(200);
      const ca5351 = rules.find((r) => r.id === "roslyn:ca5351")!;
      expect(ca5351).toMatchObject({ type: "vulnerability", enabledByDefault: true });
      expect(ca5351.references[0]!.url).toMatch(/^https:\/\/learn\.microsoft\.com\/.*ca5351$/i);
      expect(ca5351.supersedes).toContain("csharp:no-weak-hash");
      expect(rules.find((r) => r.id === "roslyn:ca2007")!.enabledByDefault).toBe(false);
      expect(rules.find((r) => r.id === "roslyn:ca2100")!.enabledByDefault).toBe(false);
    } finally {
      await plugin.dispose();
    }
  }, 60_000);

  it("analyses a project with semantic rules and supersedes the syntactic ones", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qualis-roslyn-"));
    roots.push(root);
    writeFileSync(
      path.join(root, "Demo.csproj"),
      '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Library</OutputType><TargetFramework>net10.0</TargetFramework><Nullable>enable</Nullable></PropertyGroup></Project>',
    );
    writeFileSync(
      path.join(root, "Hasher.cs"),
      "using System.Security.Cryptography;\n\nnamespace Demo;\n\npublic static class Hasher\n{\n    public static byte[] Hash(byte[] data)\n    {\n        using var md5 = MD5.Create();\n        return md5.ComputeHash(data);\n    }\n}\n",
    );
    writeFileSync(path.join(root, "qualis.config.json"), JSON.stringify({ plugins: ["@qualis/plugin-csharp", "@qualis/plugin-roslyn"], newCode: { reference: null } }));
    const report = await analyze({ baseDir: root, resolvePluginsFrom: [CLI_DIR] });
    expect(validate("report", report).errors).toEqual([]);
    expect(report.tool.plugins.map((p) => `${p.id}:${p.transport}:${p.kind}`)).toEqual(["csharp:module:language", "roslyn:process:rule-pack"]);
    const ids = report.issues.map((i) => `${i.ruleId}@${i.range.startLine}`);
    expect(ids).toContain("roslyn:ca5351@9");
    expect(ids.some((i) => i.startsWith("csharp:no-weak-hash"))).toBe(false);
    expect(report.diagnostics.map((d) => d.message)).toContain("Rule csharp:no-weak-hash is superseded by roslyn:ca5351");
  }, 300_000);
});
