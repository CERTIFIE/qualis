import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { EXIT, main } from "../src/cli.js";

const root = mkdtempSync(path.join(tmpdir(), "qualis-cli-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
writeFileSync(path.join(root, "index.js"), "export const run = (code) => eval(code);\n");
writeFileSync(
  path.join(root, "qualis.config.json"),
  JSON.stringify({ qualityGate: { conditions: [{ metric: "vulnerabilities", operator: "gt", threshold: 0 }] }, newCode: { reference: null } }),
);

const quiet = () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
};

describe("qualis CLI", () => {
  it("exits with 1 when the quality gate fails and writes the report", async () => {
    quiet();
    expect(await main(["analyze", root, "-q"])).toBe(EXIT.gateFailed);
    const report = JSON.parse(readFileSync(path.join(root, ".qualis/report.json"), "utf8"));
    expect(report.qualityGate.status).toBe("failed");
    vi.restoreAllMocks();
  }, 60_000);

  it("exits with 0 with --no-fail", async () => {
    quiet();
    expect(await main(["analyze", root, "-q", "--no-fail", "-f", "sarif"])).toBe(EXIT.ok);
    vi.restoreAllMocks();
  }, 60_000);

  it("validates reports", async () => {
    quiet();
    expect(await main(["validate", path.join(root, ".qualis/report.json")])).toBe(EXIT.ok);
    writeFileSync(path.join(root, "bad.json"), JSON.stringify({ schemaVersion: "1.0.0" }));
    expect(await main(["validate", path.join(root, "bad.json")])).toBe(EXIT.error);
    vi.restoreAllMocks();
  });

  it("exits with 2 on errors", async () => {
    quiet();
    expect(await main(["unknown"])).toBe(EXIT.error);
    expect(await main(["analyze", root, "--config", "missing.json"])).toBe(EXIT.error);
    vi.restoreAllMocks();
  });
});


describe("qualis analyze history", () => {
  it("keeps previous analyses in .qualis/history, pruned to --history", async () => {
    quiet();
    try {
      for (let i = 0; i < 3; i++) expect(await main(["analyze", root, "-q", "--no-fail", "--history", "2"])).toBe(EXIT.ok);
      const files = readdirSync(path.join(root, ".qualis/history"));
      expect(files).toHaveLength(2);
      for (const f of files) expect(f).toMatch(/^\d{8}T\d{6}(\d{3})?Z\.json$/);
      const latest = JSON.parse(readFileSync(path.join(root, ".qualis/report.json"), "utf8"));
      expect(latest.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      vi.restoreAllMocks();
    }
  }, 120_000);
});
