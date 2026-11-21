import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Report } from "@qualis/schema";
import { discoverProjects } from "../lib/browse";
import { normalizeRegistry, Registry, solutionId } from "../lib/registry";
import { ProjectStore } from "../lib/store";

const fixture = JSON.parse(await readFile(new URL("./fixtures/report.json", import.meta.url), "utf8")) as Report;

function variant(id: string, finishedAt: string, key: string, name: string): Report {
  const copy = structuredClone(fixture);
  copy.analysis.id = id;
  copy.analysis.finishedAt = finishedAt;
  copy.project = { key, name };
  return copy;
}

let tmp: string;
let dataDir: string;
let root: string;

async function put(file: string, content: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
}

/** A project folder below the root with one analysis in .qualis/. */
async function project(rel: string, key: string): Promise<string> {
  const folder = path.join(root, rel);
  await put(path.join(folder, ".qualis", "report.json"), variant(`${key}-1`, "2026-11-01T10:00:00Z", key, key.toUpperCase()));
  return folder;
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "qualis-sol-"));
  dataDir = path.join(tmp, "data");
  root = path.join(tmp, "workspace");
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("registry solutions", () => {
  it("migrates a version 1 projects.json without solutions", async () => {
    await put(path.join(dataDir, "projects.json"), { version: 1, projects: [{ key: "alpha", name: "Alpha", folder: null, createdAt: "2026-01-01T00:00:00Z" }] });
    const reg = new Registry(dataDir);
    expect(await reg.solutions()).toEqual([]);
    expect((await reg.list()).map((p) => p.key)).toEqual(["alpha"]);
    await reg.addSolution({ name: "Group", folder: null, projects: ["alpha"] });
    const saved = JSON.parse(await readFile(path.join(dataDir, "projects.json"), "utf8")) as { version: number; solutions: unknown[] };
    expect(saved.version).toBe(2);
    expect(saved.solutions).toHaveLength(1);
  });

  it("keeps a project in one solution only and drops unknown keys", () => {
    const data = normalizeRegistry({
      projects: [
        { key: "a", name: "A", folder: null, createdAt: "x" },
        { key: "b", name: "B", folder: null, createdAt: "x" },
      ],
      solutions: [
        { id: "one", name: "One", folder: null, projects: ["a", "ghost"], createdAt: "x" },
        { id: "two", name: "Two", folder: null, projects: ["a", "b"], createdAt: "x" },
        { id: "../bad", name: "Bad", projects: [] },
      ],
    });
    expect(data.solutions.map((s) => [s.id, s.projects])).toEqual([
      ["one", ["a"]],
      ["two", ["b"]],
    ]);
  });

  it("creates unique ids, moves projects between solutions and forgets removed projects", async () => {
    const reg = new Registry(dataDir);
    for (const k of ["a", "b", "c"]) await reg.add({ key: k, name: k, folder: null });
    const one = await reg.addSolution({ name: "ACS Academy", folder: null, projects: ["a", "b"] });
    const two = await reg.addSolution({ name: "ACS Academy", folder: null, projects: ["b", "c"] });
    expect([one.id, two.id]).toEqual(["acs-academy", "acs-academy-2"]);
    expect((await reg.solution("acs-academy"))?.projects).toEqual(["a"]);
    await reg.setProjectSolution("a", "acs-academy-2");
    expect((await reg.solutionOf("a"))?.id).toBe("acs-academy-2");
    expect((await reg.solution("acs-academy"))?.projects).toEqual([]);
    await reg.setProjectSolution("a", null);
    expect(await reg.solutionOf("a")).toBeUndefined();
    await reg.remove("b");
    expect((await reg.solution("acs-academy-2"))?.projects).toEqual(["c"]);
    expect(solutionId("  Shop / Suite ")).toBe("shop-suite");
  });
});

describe("discovery", () => {
  it("finds projects up to 4 levels down, skipping dependency, build and hidden folders", async () => {
    await project("suite/web", "web");
    await project("suite/services/orders", "orders");
    await project("suite/a/b/c/d", "deep4");
    await project("suite/a/b/c/d/e", "deep5");
    await project("suite/node_modules/lib", "dep");
    await project("suite/bin/out", "bin");
    await project("suite/.git/x", "hidden");
    const found = await discoverProjects(root, path.join(root, "suite"));
    expect(found.map((f) => f.rel)).toEqual(["a/b/c/d", "services/orders", "web"]);
    expect(await discoverProjects(root, path.join(root, "suite"), { maxDepth: 1 })).toHaveLength(1);
  });

  it("lists the folder itself first, never searches the browse root and stays inside it", async () => {
    await project("mono", "mono");
    await project("mono/packages/sdk", "sdk");
    const outside = path.join(tmp, "outside");
    await project("../outside/escaped", "escaped");
    await symlink(outside, path.join(root, "mono", "link-out"));
    const found = await discoverProjects(root, path.join(root, "mono"));
    expect(found.map((f) => f.rel)).toEqual(["", "packages/sdk"]);
    expect(await discoverProjects(root, root)).toEqual([]);
    expect(await discoverProjects(root, outside)).toEqual([]);
  });
});

describe("ProjectStore solutions", () => {
  it("imports a folder as a solution with the chosen projects, then finds new ones", async () => {
    const web = await project("shop/web", "web");
    const api = await project("shop/api", "api");
    await project("shop/docs", "docs");
    const s = new ProjectStore({ dataDir, ttlMs: 0 });
    const result = await s.importSolution(root, path.join(root, "shop"), "Shop", [web, api, "/etc"]);
    expect(result).toMatchObject({ status: "imported", id: "shop", name: "Shop", projects: 2 });
    const snap = await s.scan(true);
    expect(snap.solutions.map((x) => [x.id, x.folder, [...x.projects].sort()])).toEqual([["shop", await realFolder("shop"), ["api", "web"]]]);
    expect(snap.projects.find((p) => p.key === "web")?.solution).toEqual({ id: "shop", name: "Shop" });

    expect(await s.rescanSolution(root, "shop")).toEqual({ status: "ok", added: 1 });
    expect((await s.solution("shop"))?.projects).toHaveLength(3);
    expect(await s.importSolution(root, root, "All")).toEqual({ status: "root" });
  });

  it("moves projects, and removing a solution keeps its projects and their folders", async () => {
    const a = await project("a", "a");
    await project("b", "b");
    const s = new ProjectStore({ dataDir, ttlMs: 0 });
    await s.importFolder(a);
    await s.importFolder(path.join(root, "b"));
    const sol = await s.createSolution("Pair", ["a", "b"]);
    expect(await s.moveProject("a", { newName: "Solo" })).toEqual({ status: "ok", id: "solo" });
    expect((await s.solution(sol.id))?.projects).toEqual(["b"]);
    expect(await s.moveProject("a", { id: null })).toEqual({ status: "ok", id: null });
    expect((await s.project("a"))?.solution).toBeNull();
    expect(await s.removeSolution(sol.id)).toBe(true);
    expect((await s.scan(true)).projects.map((p) => p.key).sort()).toEqual(["a", "b"]);
    expect((await stat(path.join(a, ".qualis", "report.json"))).isFile()).toBe(true);
    expect(await s.moveProject("ghost", { id: null })).toEqual({ status: "not-found" });
  });
});

async function realFolder(rel: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(path.join(root, rel));
}
