import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Report } from "@qualis/schema";
import { listFolder, resolveInRoot } from "../lib/browse";
import { Registry } from "../lib/registry";
import { contentHash, resolveSource } from "../lib/source";
import { ProjectStore } from "../lib/store";
import { parseReport } from "../lib/validate";

const fixture = JSON.parse(await readFile(new URL("./fixtures/report.json", import.meta.url), "utf8")) as Report;

function variant(id: string, finishedAt: string, key = "tiny", name = "Tiny"): Report {
  const copy = structuredClone(fixture);
  copy.analysis.id = id;
  copy.analysis.finishedAt = finishedAt;
  copy.project = { key, name };
  return copy;
}

let tmp: string;
let dataDir: string;
let root: string;

async function put(file: string, content: unknown): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

/** A project folder as `qualis analyze` leaves it: .qualis/report.json plus history copies. */
async function projectFolder(name: string, reports: Report[]): Promise<string> {
  const folder = path.join(root, name);
  await mkdir(folder, { recursive: true });
  const latest = [...reports].sort((a, b) => b.analysis.finishedAt.localeCompare(a.analysis.finishedAt))[0];
  if (latest) await put(path.join(folder, ".qualis", "report.json"), latest);
  for (const r of reports) await put(path.join(folder, ".qualis", "history", `${r.analysis.finishedAt.replace(/[-:.]/g, "")}.json`), r);
  return folder;
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "qualis-ui-"));
  dataDir = path.join(tmp, "data");
  root = path.join(tmp, "workspace");
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("validation", () => {
  it("accepts a report produced by the CLI and rejects anything else", () => {
    expect(parseReport(JSON.stringify(fixture)).ok).toBe(true);
    const bad = parseReport("{ nope");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toMatch(/Not valid JSON/);
    expect(parseReport(JSON.stringify({ schemaVersion: "1.0.0" })).ok).toBe(false);
  });
});

describe("Registry", () => {
  it("persists projects atomically and reloads them", async () => {
    const reg = new Registry(dataDir);
    await reg.add({ key: "alpha", name: "Alpha", folder: "/work/alpha" });
    await reg.add({ key: "beta", name: "Beta", folder: null });
    await expect(reg.add({ key: "alpha", name: "Again", folder: null })).rejects.toThrow(/already exists/);
    await expect(reg.add({ key: "../evil", name: "Evil", folder: null })).rejects.toThrow(/Invalid project key/);

    const again = new Registry(dataDir);
    expect((await again.list()).map((p) => [p.key, p.folder])).toEqual([
      ["alpha", "/work/alpha"],
      ["beta", null],
    ]);
    expect((await readdir(dataDir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("ProjectStore history", () => {
  it("unites the folder history with the uploads, deduplicated by analysis id, newest first", async () => {
    const a = variant("a", "2026-11-01T10:00:00.000Z");
    const b = variant("b", "2026-11-03T10:00:00.000Z");
    const c = variant("c", "2026-11-05T10:00:00.000Z");
    const folder = await projectFolder("tiny", [a, b]);
    const store = new ProjectStore({ dataDir, ttlMs: 0 });
    expect(await store.importFolder(folder)).toEqual({ status: "imported", key: "tiny", name: "Tiny" });

    expect((await store.upload(JSON.stringify(c))).status).toBe("adds");
    expect((await store.upload(JSON.stringify(a))).status).toBe("duplicate");

    const project = (await store.project("tiny"))!;
    expect(project.analyses.map((x) => [x.id, x.origin])).toEqual([
      ["c", "upload"],
      ["b", "folder"],
      ["a", "folder"],
    ]);
    expect([project.folderAnalyses, project.uploads]).toEqual([2, 1]);
    expect((await store.report("tiny"))?.analysis.id).toBe("c");
    expect((await store.report("tiny", "a"))?.report.analysis.id).toBe("a");
  });

  it("re-reads .qualis when a new analysis is written, parsing unchanged files once", async () => {
    const folder = await projectFolder("tiny", [variant("a", "2026-11-01T10:00:00.000Z")]);
    const store = new ProjectStore({ dataDir, ttlMs: 0 });
    await store.importFolder(folder);
    const parsed = store.parseCount;
    await store.scan();
    expect(store.parseCount).toBe(parsed);

    const next = variant("b", "2026-11-02T10:00:00.000Z");
    await put(path.join(folder, ".qualis", "report.json"), next);
    const later = new Date(Date.now() + 5000);
    await utimes(path.join(folder, ".qualis", "report.json"), later, later);
    await put(path.join(folder, ".qualis", "history", "20261102T100000000Z.json"), next);
    expect((await store.project("tiny"))!.analyses.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("reports invalid files and unreachable folders as diagnostics", async () => {
    const folder = await projectFolder("tiny", [variant("a", "2026-11-01T10:00:00.000Z")]);
    await put(path.join(folder, ".qualis", "history", "broken.json"), "{ nope");
    const store = new ProjectStore({ dataDir, ttlMs: 0 });
    await store.importFolder(folder);
    let project = (await store.project("tiny"))!;
    expect(project.analyses).toHaveLength(1);
    expect(project.diagnostics.map((d) => path.basename(d.file))).toEqual(["broken.json"]);

    await rm(folder, { recursive: true });
    project = (await store.project("tiny"))!;
    expect(project.folderState).toBe("missing");
  });
});

describe("Read analysis", () => {
  it("creates a project, then adds to it, and refuses invalid files", async () => {
    const store = new ProjectStore({ dataDir, ttlMs: 0 });
    const invalid = await store.upload(JSON.stringify({ hello: 1 }));
    expect(invalid.status).toBe("invalid");

    const preview = await store.preview(JSON.stringify(variant("x1", "2026-11-01T10:00:00.000Z", "pay", "Payments")));
    expect(preview.status).toBe("creates");
    expect(await new Registry(dataDir).list()).toEqual([]);

    expect((await store.upload(JSON.stringify(variant("x1", "2026-11-01T10:00:00.000Z", "pay", "Payments")))).status).toBe("creates");
    const added = await store.upload(JSON.stringify(variant("x2", "2026-11-02T10:00:00.000Z", "pay", "Payments")));
    expect(added).toMatchObject({ status: "adds", key: "pay", analyses: 2 });
    expect(await readdir(path.join(dataDir, "uploads", "pay"))).toHaveLength(2);
    const unsafe = await store.preview(JSON.stringify(variant("x3", "2026-11-02T10:00:00.000Z", "../../etc", "Evil")));
    expect(unsafe.status).toBe("invalid");
  });

  it("links a folder to the uploaded project with the same key", async () => {
    const store = new ProjectStore({ dataDir, ttlMs: 0 });
    await store.upload(JSON.stringify(variant("u", "2026-11-04T10:00:00.000Z")));
    const folder = await projectFolder("tiny", [variant("f", "2026-11-01T10:00:00.000Z")]);
    expect((await store.folderStatus(folder)).linkTo).toMatchObject({ key: "tiny", uploads: 1 });
    expect(await store.importFolder(folder)).toMatchObject({ status: "linked", key: "tiny" });
    expect(await store.importFolder(folder)).toMatchObject({ status: "already", key: "tiny" });
    expect((await store.project("tiny"))!.analyses.map((a) => a.id)).toEqual(["u", "f"]);
  });

  it("removes a project and its uploads without touching the project folder", async () => {
    const folder = await projectFolder("tiny", [variant("a", "2026-11-01T10:00:00.000Z")]);
    const store = new ProjectStore({ dataDir, ttlMs: 0 });
    await store.importFolder(folder);
    await store.upload(JSON.stringify(variant("u", "2026-11-04T10:00:00.000Z")));
    expect(await store.remove("tiny")).toBe(true);
    expect((await store.scan()).projects).toEqual([]);
    await expect(stat(path.join(dataDir, "uploads", "tiny"))).rejects.toThrow();
    expect((await stat(path.join(folder, ".qualis", "report.json"))).isFile()).toBe(true);
    expect(await readdir(path.join(folder, ".qualis", "history"))).toHaveLength(1);
  });

  it("does not import a folder without .qualis", async () => {
    const store = new ProjectStore({ dataDir, ttlMs: 0 });
    await mkdir(path.join(root, "plain"));
    expect(await store.importFolder(path.join(root, "plain"))).toEqual({ status: "no-qualis" });
  });
});

describe("folder browser", () => {
  it("stays inside the root and rejects traversal and symbolic links that leave it", async () => {
    await mkdir(path.join(root, "a", "b"), { recursive: true });
    const outside = path.join(tmp, "secret");
    await mkdir(outside);
    await symlink(outside, path.join(root, "escape"));

    expect(await resolveInRoot(root, "a/b")).toMatchObject({ ok: true });
    expect(await resolveInRoot(root, "")).toMatchObject({ ok: true });
    expect(await resolveInRoot(root, "../secret")).toEqual({ ok: false, reason: "outside" });
    expect(await resolveInRoot(root, "a/../../secret")).toEqual({ ok: false, reason: "outside" });
    expect(await resolveInRoot(root, outside)).toEqual({ ok: false, reason: "outside" });
    expect(await resolveInRoot(root, "/etc")).toEqual({ ok: false, reason: "outside" });
    expect(await resolveInRoot(root, "escape")).toEqual({ ok: false, reason: "outside" });
    expect(await resolveInRoot(root, "missing")).toEqual({ ok: false, reason: "not-found" });

    const resolved = await resolveInRoot(root, "");
    const names = (await listFolder(root, (resolved as { path: string }).path)).map((e) => e.name);
    expect(names).toEqual(["a"]);
  });

  it("marks folders that contain .qualis with their analysis count", async () => {
    await projectFolder("proj", [variant("a", "2026-11-01T10:00:00.000Z"), variant("b", "2026-11-02T10:00:00.000Z")]);
    await mkdir(path.join(root, "plain"));
    const real = (await resolveInRoot(root, "")) as { path: string };
    const entries = await listFolder(root, real.path);
    expect(entries.map((e) => [e.name, e.qualis?.analyses ?? null])).toEqual([
      ["plain", null],
      ["proj", 2],
    ]);
  });
});

describe("source from the project folder", () => {
  const sourceFile = (sha256: string | undefined) => ({ ...structuredClone(fixture.files[0]!), path: "src/a.ts", source: undefined, ...(sha256 ? { sha256 } : {}) });

  it("hashes like the analyzer: UTF-8 without a byte order mark", () => {
    expect(contentHash("const a = 1;\n")).toBe(contentHash("﻿const a = 1;\n"));
    expect(contentHash("const a = 1;\n")).not.toBe(contentHash("const a = 2;\n"));
  });

  it("reads the file, detects changes and refuses paths outside the folder", async () => {
    const folder = path.join(root, "proj");
    const text = "export const a = 1;\n";
    await put(path.join(folder, "src", "a.ts"), "﻿" + text);
    const hash = contentHash(text);

    expect(await resolveSource(sourceFile(hash), folder)).toMatchObject({ mode: "disk", text });
    expect(await resolveSource(sourceFile(contentHash("old")), folder)).toMatchObject({ mode: "changed", text });
    expect(await resolveSource(sourceFile(undefined), folder)).toMatchObject({ mode: "disk-unverified" });
    expect(await resolveSource({ ...sourceFile(hash), path: "src/missing.ts" }, folder)).toMatchObject({ mode: "missing", reason: "not-found" });
    await put(path.join(tmp, "outside.ts"), text);
    expect(await resolveSource({ ...sourceFile(hash), path: "../../outside.ts" }, folder)).toMatchObject({ mode: "missing", reason: "outside" });
    expect(await resolveSource(sourceFile(hash), null)).toEqual({ mode: "no-folder" });
    expect(await resolveSource({ ...sourceFile(hash), source: "embedded" }, folder)).toEqual({ mode: "embedded", text: "embedded" });
  });
});
