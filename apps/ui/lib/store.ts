import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Ratings, Report } from "@qualis/schema";
import { discoverProjects, inspectQualis, type QualisFolder } from "./browse";
import { isSafeKey, Registry, type RegisteredProject, type RegisteredSolution } from "./registry";
import type { Member } from "./solutions";
import { parseReport } from "./validate";

// The analyses of every registered project. A project's history is the union of
//   <folder>/.qualis/report.json and <folder>/.qualis/history/*.json  (written by `qualis analyze`)
//   <data>/uploads/<key>/*.json                                     (added with "Read analysis")
// deduplicated by analysis id, newest first. Folders are re-read on demand (at most once per `ttlMs`) and parsed
// files are cached by modification time and size; invalid files become diagnostics instead of errors.

export type Origin = "folder" | "upload";

export interface AnalysisSummary {
  id: string;
  /** Absolute path of the report file. */
  file: string;
  fileName: string;
  origin: Origin;
  finishedAt: string;
  branch: string | null;
  revision: string | null;
  gate: "passed" | "failed";
  ratings: Ratings;
  coverage: number | null;
  linesToCover: number | null;
  duplication: number;
  lines: number;
  ncloc: number;
  debtRatio: number;
  files: number;
  issues: number;
  debtMinutes: number;
  hasSources: boolean;
  hasNewCode: boolean;
  projectKey: string;
  projectName: string;
}

export interface StoreDiagnostic {
  file: string;
  message: string;
}

export type FolderState = "ok" | "missing" | "no-qualis";

export interface ProjectView {
  key: string;
  name: string;
  /** The solution the project belongs to, if any. */
  solution: { id: string; name: string } | null;
  folder: string | null;
  folderState: FolderState | null;
  createdAt: string;
  /** Newest first. */
  analyses: AnalysisSummary[];
  folderAnalyses: number;
  /** Analyses whose shown copy is an upload. */
  uploads: number;
  /** Uploaded files Qualis stores for the project (removed with the project), duplicates included. */
  uploadFiles: number;
  diagnostics: StoreDiagnostic[];
}

export interface SolutionView extends RegisteredSolution {
  /** Latest analysis among its projects. */
  latest: string | null;
}

export interface Snapshot {
  dataDir: string;
  projects: ProjectView[];
  solutions: SolutionView[];
  scannedAt: number;
}

export type UploadPreview =
  | { status: "invalid"; errors: string[] }
  | { status: "duplicate"; key: string; name: string; finishedAt: string; branch: string | null; gate: "passed" | "failed" }
  | { status: "adds"; key: string; name: string; analyses: number; finishedAt: string; branch: string | null; gate: "passed" | "failed" }
  | { status: "creates"; key: string; name: string; finishedAt: string; branch: string | null; gate: "passed" | "failed" };

export type ImportResult =
  | { status: "imported" | "linked" | "already"; key: string; name: string }
  | { status: "no-qualis" }
  | { status: "conflict"; key: string; folder: string };

export type SolutionImportResult =
  | { status: "imported" | "updated"; id: string; name: string; projects: number; skipped: Array<{ path: string; reason: string }> }
  | { status: "none" | "root" };

export interface FolderStatus {
  qualis: QualisFolder | null;
  latest?: { key: string; name: string; finishedAt: string };
  imported?: { key: string; name: string };
  linkTo?: { key: string; name: string; uploads: number };
  conflict?: { key: string; folder: string };
}

export interface ProjectStoreOptions {
  dataDir: string;
  /** Minimum time between two scans of the project folders (default 2 s). */
  ttlMs?: number;
  /** Parsed reports kept in memory (default 6). Summaries of all files are always kept. */
  maxReports?: number;
}

interface CachedFile {
  mtimeMs: number;
  size: number;
  summary?: Omit<AnalysisSummary, "origin">;
  error?: string;
}

function summarize(report: Report, file: string): Omit<AnalysisSummary, "origin"> {
  const o = report.measures.overall;
  return {
    id: report.analysis.id,
    file,
    fileName: path.basename(file),
    finishedAt: report.analysis.finishedAt,
    branch: report.analysis.vcs?.branch ?? null,
    revision: report.analysis.vcs?.revision ?? null,
    gate: report.qualityGate.status,
    ratings: o.ratings,
    coverage: o.coverage?.coverage ?? null,
    linesToCover: o.coverage?.linesToCover ?? null,
    duplication: o.duplication.duplicatedLinesDensity,
    lines: o.lines,
    ncloc: o.ncloc,
    debtRatio: o.debtRatio,
    files: o.files,
    issues: o.issues.total,
    debtMinutes: o.technicalDebtMinutes,
    hasSources: report.files.some((f) => typeof f.source === "string"),
    hasNewCode: report.measures.newCode !== null,
    projectKey: report.project.key,
    projectName: report.project.name,
  };
}

const byNewest = (a: AnalysisSummary, b: AnalysisSummary) => b.finishedAt.localeCompare(a.finishedAt) || a.fileName.localeCompare(b.fileName);

/** A project as a member of a solution, for the pure aggregation in solutions.ts. */
export function memberOf(p: ProjectView): Member {
  const a = p.analyses[0];
  return {
    key: p.key,
    name: p.name,
    analyses: p.analyses.length,
    latest: a
      ? { finishedAt: a.finishedAt, branch: a.branch, gate: a.gate, ratings: a.ratings, coverage: a.coverage, linesToCover: a.linesToCover, duplication: a.duplication, lines: a.lines, ncloc: a.ncloc, issues: a.issues, debtMinutes: a.debtMinutes, debtRatio: a.debtRatio }
      : null,
    history: [...p.analyses].reverse().map((x) => ({ date: x.finishedAt, issues: x.issues, failed: x.gate === "failed" })),
  };
}

/** A folder name as a project key: letters, digits, dot, dash and underscore. */
export function keyFromName(name: string): string {
  const key = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 128);
  return key || "project";
}

export class ProjectStore {
  readonly registry: Registry;
  private readonly ttlMs: number;
  private readonly maxReports: number;
  private readonly files = new Map<string, CachedFile>();
  /** Parsed reports, least recently used first. */
  private readonly reports = new Map<string, Report>();
  private snapshot: Snapshot | undefined;
  private scanning: Promise<Snapshot> | undefined;
  /** Number of files parsed so far (for tests and diagnostics). */
  parseCount = 0;

  constructor(options: ProjectStoreOptions) {
    this.registry = new Registry(options.dataDir);
    this.ttlMs = options.ttlMs ?? 2000;
    this.maxReports = Math.max(1, options.maxReports ?? 6);
  }

  get dataDir(): string {
    return this.registry.dataDir;
  }

  /** Current view of every project, re-read when older than the TTL (or always with `force`). */
  async scan(force = false): Promise<Snapshot> {
    if (!force && this.snapshot && Date.now() - this.snapshot.scannedAt < this.ttlMs) return this.snapshot;
    if (force) this.registry.invalidate();
    if (!this.scanning) {
      this.scanning = this.doScan().finally(() => {
        this.scanning = undefined;
      });
    }
    return this.scanning;
  }

  async project(key: string): Promise<ProjectView | undefined> {
    return (await this.scan()).projects.find((p) => p.key === key);
  }

  /** The full report of an analysis (the newest when `id` is omitted). */
  async report(key: string, id?: string): Promise<{ project: ProjectView; analysis: AnalysisSummary; report: Report } | undefined> {
    const project = await this.project(key);
    if (!project) return undefined;
    const analysis = id ? project.analyses.find((a) => a.id === id) : project.analyses[0];
    if (!analysis) return undefined;
    const report = await this.load(analysis.file);
    return report ? { project, analysis, report } : undefined;
  }

  // ------------------------------------------------------------------------------------------- Read analysis

  /** What adding this report would do, without saving anything. */
  async preview(text: string): Promise<UploadPreview> {
    const check = parseReport(text);
    if (!check.ok) return { status: "invalid", errors: check.errors };
    const r = check.report;
    const key = r.project.key;
    if (!isSafeKey(key)) return { status: "invalid", errors: [`/project/key "${key}" cannot be used as a project key (letters, digits, ".", "-" and "_")`] };
    const meta = { finishedAt: r.analysis.finishedAt, branch: r.analysis.vcs?.branch ?? null, gate: r.qualityGate.status };
    const registered = await this.registry.get(key);
    if (!registered) return { status: "creates", key, name: r.project.name, ...meta };
    const project = await this.project(key);
    if (project?.analyses.some((a) => a.id === r.analysis.id)) return { status: "duplicate", key, name: project.name, ...meta };
    return { status: "adds", key, name: project?.name ?? registered.name, analyses: (project?.analyses.length ?? 0) + 1, ...meta };
  }

  /** Validates and stores an uploaded report, creating the project of its key when needed. */
  async upload(text: string): Promise<UploadPreview> {
    const preview = await this.preview(text);
    if (preview.status === "invalid" || preview.status === "duplicate") return preview;
    const report = (parseReport(text) as { ok: true; report: Report }).report;
    if (preview.status === "creates") await this.registry.add({ key: preview.key, name: report.project.name, folder: null });
    await this.registry.saveUpload(preview.key, report, text);
    await this.scan(true);
    return preview;
  }

  // ------------------------------------------------------------------------------------------- Import project

  /** The analysis keys and registration state of a candidate project folder (already resolved inside the root). */
  async folderStatus(folder: string): Promise<FolderStatus> {
    const qualis = await inspectQualis(folder);
    const status: FolderStatus = { qualis };
    const imported = await this.registry.byFolder(folder);
    if (imported) status.imported = { key: imported.key, name: imported.name };
    if (!qualis) return status;
    const latest = await this.latestInFolder(folder);
    if (latest) status.latest = { key: latest.projectKey, name: latest.projectName, finishedAt: latest.finishedAt };
    if (imported) return status;
    const key = latest?.projectKey ?? keyFromName(path.basename(folder));
    const same = await this.registry.get(key);
    if (same && !same.folder) {
      const project = await this.project(key);
      status.linkTo = { key, name: project?.name ?? same.name, uploads: project?.uploads ?? 0 };
    } else if (same?.folder) {
      status.conflict = { key, folder: same.folder };
    }
    return status;
  }

  /** Registers a project folder, or links it to the uploaded-only project with the same key. */
  async importFolder(folder: string): Promise<ImportResult> {
    const status = await this.folderStatus(folder);
    if (status.imported) return { status: "already", ...status.imported };
    if (!status.qualis) return { status: "no-qualis" };
    if (status.conflict) return { status: "conflict", ...status.conflict };
    if (status.linkTo) {
      await this.registry.linkFolder(status.linkTo.key, folder);
      await this.scan(true);
      return { status: "linked", key: status.linkTo.key, name: status.linkTo.name };
    }
    const key = status.latest?.key && isSafeKey(status.latest.key) ? status.latest.key : keyFromName(path.basename(folder));
    const name = status.latest?.name ?? path.basename(folder);
    await this.registry.add({ key, name, folder });
    await this.scan(true);
    return { status: "imported", key, name };
  }

  // ------------------------------------------------------------------------------------------- solutions

  async solution(id: string): Promise<SolutionView | undefined> {
    return (await this.scan()).solutions.find((s) => s.id === id);
  }

  /** A solution put together by hand from registered projects (they leave any other solution). */
  async createSolution(name: string, keys: string[]): Promise<RegisteredSolution> {
    const created = await this.registry.addSolution({ name, folder: null, projects: keys });
    await this.scan(true);
    return created;
  }

  /**
   * Import as solution: imports the chosen project folders found below `folder` (or all of them) and groups them.
   * Folders already imported join the solution; a folder already imported as a solution gets the new projects.
   * Only folders that discovery finds are accepted, so `include` cannot reach anything else.
   */
  async importSolution(root: string, input: string, name: string, include?: string[]): Promise<SolutionImportResult> {
    if (await this.isRoot(root, input)) return { status: "root" };
    const folder = await realpath(input).catch(() => input);
    const found = await discoverProjects(root, folder);
    if (!found.length) return { status: "none" };
    const wanted = include ? new Set(await Promise.all(include.map((p) => realpath(p).catch(() => p)))) : null;
    const chosen = wanted ? found.filter((d) => wanted.has(d.path)) : found;
    const keys: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    for (const d of chosen) {
      const result = await this.importFolder(d.path);
      if (result.status === "imported" || result.status === "linked" || result.status === "already") keys.push(result.key);
      else skipped.push({ path: d.path, reason: result.status === "conflict" ? `the key ${result.key} is used by ${result.folder}` : "no .qualis folder" });
    }
    const existing = await this.registry.solutionByFolder(folder);
    let id: string;
    let solutionName: string;
    if (existing) {
      await this.registry.addToSolution(existing.id, keys);
      id = existing.id;
      solutionName = existing.name;
    } else {
      const created = await this.registry.addSolution({ name: name.trim() || path.basename(folder), folder, projects: keys });
      id = created.id;
      solutionName = created.name;
    }
    await this.scan(true);
    return { status: existing ? "updated" : "imported", id, name: solutionName, projects: keys.length, skipped };
  }

  /** "Look for new projects": imports project folders that appeared below the solution's folder. */
  async rescanSolution(root: string, id: string): Promise<{ status: "ok"; added: number } | { status: "manual" | "not-found" | "missing" }> {
    const solution = await this.registry.solution(id);
    if (!solution) return { status: "not-found" };
    if (!solution.folder) return { status: "manual" };
    const found = await discoverProjects(root, solution.folder);
    if (!found.length) return { status: "missing" };
    let added = 0;
    for (const d of found) {
      const registered = await this.registry.byFolder(d.path);
      if (registered) {
        // Already known: it joins only when it is in no solution yet.
        if (!(await this.registry.solutionOf(registered.key))) {
          await this.registry.addToSolution(id, [registered.key]);
          added++;
        }
        continue;
      }
      const result = await this.importFolder(d.path);
      if (result.status === "imported" || result.status === "linked") {
        if (!(await this.registry.solutionOf(result.key))) await this.registry.addToSolution(id, [result.key]);
        added++;
      }
    }
    await this.scan(true);
    return { status: "ok", added };
  }

  async renameSolution(id: string, name: string): Promise<boolean> {
    const done = await this.registry.renameSolution(id, name);
    if (done) await this.scan(true);
    return done;
  }

  /** Forgets the solution; its projects stay, and no file is touched. */
  async removeSolution(id: string): Promise<boolean> {
    const done = await this.registry.removeSolution(id);
    if (done) await this.scan(true);
    return done;
  }

  async addToSolution(id: string, keys: string[]): Promise<boolean> {
    const done = await this.registry.addToSolution(id, keys);
    if (done) await this.scan(true);
    return done;
  }

  /** Moves a project to a solution, out of its solution (`id` null), or to a new solution (`newName`). */
  async moveProject(key: string, target: { id: string | null } | { newName: string }): Promise<{ status: "ok"; id: string | null } | { status: "not-found" }> {
    if (!(await this.registry.get(key))) return { status: "not-found" };
    if ("newName" in target) {
      const created = await this.registry.addSolution({ name: target.newName, folder: null, projects: [key] });
      await this.scan(true);
      return { status: "ok", id: created.id };
    }
    const done = await this.registry.setProjectSolution(key, target.id);
    if (!done) return { status: "not-found" };
    await this.scan(true);
    return { status: "ok", id: target.id };
  }

  private async isRoot(root: string, folder: string): Promise<boolean> {
    try {
      return (await realpath(root)) === (await realpath(folder));
    } catch {
      return false;
    }
  }

  /** Forgets a project and deletes only Qualis' uploaded copies of its analyses. */
  async remove(key: string): Promise<boolean> {
    const removed = await this.registry.remove(key);
    if (removed) await this.scan(true);
    return removed;
  }

  // ------------------------------------------------------------------------------------------- internals

  /** Project name and key of a folder's latest analysis (cached by file time and size). */
  async folderProject(folder: string): Promise<{ key: string; name: string } | null> {
    const latest = await this.latestInFolder(folder);
    return latest ? { key: latest.projectKey, name: latest.projectName } : null;
  }

  /** The latest analysis of a folder: report.json, or the newest history file (names sort chronologically). */
  private async latestInFolder(folder: string): Promise<AnalysisSummary | undefined> {
    const files = await this.folderFiles(folder);
    const report = files.find((f) => path.basename(f) === "report.json");
    const history = files.filter((f) => f !== report).sort().reverse();
    for (const file of [...(report ? [report] : []), ...history]) {
      const entry = await this.inspect(file);
      if (entry?.summary) return { ...entry.summary, origin: "folder" };
    }
    return undefined;
  }

  private async folderFiles(folder: string): Promise<string[]> {
    const dir = path.join(/*turbopackIgnore: true*/ folder, ".qualis");
    const out: string[] = [];
    try {
      if ((await stat(path.join(dir, "report.json"))).isFile()) out.push(path.join(dir, "report.json"));
    } catch {
      // no latest report
    }
    try {
      const history = path.join(dir, "history");
      for (const e of await readdir(history, { withFileTypes: true })) if (e.isFile() && e.name.endsWith(".json")) out.push(path.join(history, e.name));
    } catch {
      // no history
    }
    return out;
  }

  private remember(file: string, report: Report): void {
    this.reports.delete(file);
    this.reports.set(file, report);
    while (this.reports.size > this.maxReports) this.reports.delete(this.reports.keys().next().value as string);
  }

  private async load(file: string): Promise<Report | undefined> {
    const cached = this.reports.get(file);
    if (cached) {
      this.remember(file, cached);
      return cached;
    }
    const result = await this.readReport(file);
    if (!result.ok) return undefined;
    this.remember(file, result.report);
    return result.report;
  }

  private async readReport(file: string): Promise<{ ok: true; report: Report } | { ok: false; error: string }> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      return { ok: false, error: `Cannot read the file: ${(error as Error).message}` };
    }
    this.parseCount++;
    const check = parseReport(text);
    return check.ok ? { ok: true, report: check.report } : { ok: false, error: `Not a valid Qualis report: ${check.errors.join("; ")}` };
  }

  /** Summary of one file, from the cache when its modification time and size did not change. */
  private async inspect(file: string): Promise<CachedFile | undefined> {
    let info;
    try {
      info = await stat(file);
    } catch {
      return undefined;
    }
    if (!info.isFile()) return undefined;
    const cached = this.files.get(file);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;
    this.reports.delete(file);
    const result = await this.readReport(file);
    const entry: CachedFile = { mtimeMs: info.mtimeMs, size: info.size };
    if (result.ok) {
      entry.summary = summarize(result.report, file);
      this.remember(file, result.report);
    } else {
      entry.error = result.error;
    }
    this.files.set(file, entry);
    return entry;
  }

  private async projectView(p: RegisteredProject, seen: Set<string>): Promise<ProjectView> {
    const view: ProjectView = { key: p.key, name: p.name, solution: null, folder: p.folder, folderState: null, createdAt: p.createdAt, analyses: [], folderAnalyses: 0, uploads: 0, uploadFiles: 0, diagnostics: [] };
    const sources: Array<{ file: string; origin: Origin }> = [];
    if (p.folder) {
      let exists = false;
      try {
        exists = (await stat(p.folder)).isDirectory();
      } catch {
        exists = false;
      }
      if (!exists) {
        view.folderState = "missing";
        view.diagnostics.push({ file: p.folder, message: "The project folder is not reachable (moved, deleted or not mounted)." });
      } else {
        const files = await this.folderFiles(p.folder);
        view.folderState = (await inspectQualis(p.folder)) ? "ok" : "no-qualis";
        sources.push(...files.map((file) => ({ file, origin: "folder" as const })));
      }
    }
    const uploads = await this.registry.uploadFiles(p.key);
    view.uploadFiles = uploads.length;
    sources.push(...uploads.map((file) => ({ file, origin: "upload" as const })));

    const byId = new Map<string, AnalysisSummary>();
    for (const s of sources) {
      seen.add(s.file);
      const entry = await this.inspect(s.file);
      if (!entry) continue;
      if (!entry.summary) {
        view.diagnostics.push({ file: s.file, message: entry.error ?? "Unreadable file" });
        continue;
      }
      // The same analysis can be in report.json, in history/ and in uploads: the first one found wins
      // (folder before uploads, report.json before history).
      if (!byId.has(entry.summary.id)) byId.set(entry.summary.id, { ...entry.summary, origin: s.origin });
    }
    view.analyses = [...byId.values()].sort(byNewest);
    view.folderAnalyses = view.analyses.filter((a) => a.origin === "folder").length;
    view.uploads = view.analyses.filter((a) => a.origin === "upload").length;
    if (view.analyses[0]) view.name = view.analyses[0].projectName;
    return view;
  }

  private async doScan(): Promise<Snapshot> {
    const seen = new Set<string>();
    const projects: ProjectView[] = [];
    for (const p of await this.registry.list()) projects.push(await this.projectView(p, seen));
    for (const file of [...this.files.keys()]) {
      if (!seen.has(file)) {
        this.files.delete(file);
        this.reports.delete(file);
      }
    }
    projects.sort((a, b) => (b.analyses[0]?.finishedAt ?? "").localeCompare(a.analyses[0]?.finishedAt ?? "") || a.name.localeCompare(b.name));
    const solutions: SolutionView[] = [];
    for (const s of await this.registry.solutions()) {
      const members = projects.filter((p) => s.projects.includes(p.key));
      for (const m of members) m.solution = { id: s.id, name: s.name };
      solutions.push({ ...s, latest: members.map((m) => m.analyses[0]?.finishedAt ?? "").sort().pop() || null });
    }
    this.snapshot = { dataDir: this.dataDir, projects, solutions, scannedAt: Date.now() };
    return this.snapshot;
  }
}
