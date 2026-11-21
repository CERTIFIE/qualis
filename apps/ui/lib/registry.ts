import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Report } from "@qualis/schema";

// The projects the UI knows about, persisted in QUALIS_DATA_DIR:
//   projects.json                 registered projects (key, name, folder, dates) and solutions (groups of projects)
//   uploads/<key>/<timestamp>.json analyses added with "Read analysis"
// Only files inside the data folder are ever written or deleted; project folders are read-only.

export interface RegisteredProject {
  /** Identity of the project; analyses read with "Read analysis" attach by `project.key`. */
  key: string;
  name: string;
  /** Absolute project folder whose `.qualis/` is read on every visit, or null for uploaded-only projects. */
  folder: string | null;
  createdAt: string;
  linkedAt?: string;
}

/** A group of projects: imported from a folder with several projects, or put together by hand. */
export interface RegisteredSolution {
  id: string;
  name: string;
  /** Folder the solution was imported from (searched again by "Look for new projects"), or null for a manual one. */
  folder: string | null;
  /** Keys of its projects; a project belongs to at most one solution. */
  projects: string[];
  createdAt: string;
}

interface RegistryFile {
  version: 2;
  projects: RegisteredProject[];
  solutions: RegisteredSolution[];
}

/** A solution name as an id: lower-case letters, digits and dashes. */
export function solutionId(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "solution"
  );
}

/**
 * Brings a projects.json of any version to the current shape: version 1 files have no solutions; unknown project keys
 * are dropped from solutions, and a project listed by more than one solution stays in the first one only.
 */
export function normalizeRegistry(raw: unknown): RegistryFile {
  const data = (raw && typeof raw === "object" ? raw : {}) as { projects?: unknown; solutions?: unknown };
  const projects = (Array.isArray(data.projects) ? data.projects : []).filter((p): p is RegisteredProject => !!p && typeof (p as RegisteredProject).key === "string" && isSafeKey((p as RegisteredProject).key));
  const keys = new Set(projects.map((p) => p.key));
  const taken = new Set<string>();
  const ids = new Set<string>();
  const solutions: RegisteredSolution[] = [];
  for (const s of Array.isArray(data.solutions) ? data.solutions : []) {
    const x = s as Partial<RegisteredSolution> | null;
    if (!x || typeof x.id !== "string" || !SAFE_ID.test(x.id) || ids.has(x.id) || typeof x.name !== "string") continue;
    ids.add(x.id);
    const members = (Array.isArray(x.projects) ? x.projects : []).filter((k): k is string => typeof k === "string" && keys.has(k) && !taken.has(k));
    members.forEach((k) => taken.add(k));
    solutions.push({ id: x.id, name: x.name, folder: typeof x.folder === "string" ? x.folder : null, projects: members, createdAt: typeof x.createdAt === "string" ? x.createdAt : new Date(0).toISOString() });
  }
  return { version: 2, projects, solutions };
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** Writes through a temporary file and a rename, so a crash never leaves a half-written file. */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, content);
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** File name of an uploaded analysis: its finish time, sortable, plus the analysis id to keep names unique. */
export function uploadFileName(report: Report): string {
  const stamp = report.analysis.finishedAt.replace(/[-:.]/g, "");
  const id = report.analysis.id.replace(/[^A-Za-z0-9-]/g, "").slice(0, 36);
  return `${stamp}-${id}.json`;
}

/** Keys become folder names under uploads/: keep them to a safe character set. */
export function isSafeKey(key: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key) && key !== "." && key !== "..";
}

export class Registry {
  readonly dataDir: string;
  private cache: RegistryFile | undefined;

  constructor(dataDir: string) {
    this.dataDir = path.resolve(/*turbopackIgnore: true*/ dataDir);
  }

  get file(): string {
    return path.join(this.dataDir, "projects.json");
  }

  uploadsDir(key: string): string {
    if (!isSafeKey(key)) throw new Error(`Invalid project key: ${key}`);
    return path.join(this.dataDir, "uploads", key);
  }

  private async load(): Promise<RegistryFile> {
    if (this.cache) return this.cache;
    try {
      this.cache = normalizeRegistry(JSON.parse(await readFile(this.file, "utf8")));
    } catch {
      this.cache = { version: 2, projects: [], solutions: [] };
    }
    return this.cache;
  }

  /** Saves a change; solutions always keep only registered projects, each in one solution at most. */
  private async save(change: { projects?: RegisteredProject[]; solutions?: RegisteredSolution[] }): Promise<void> {
    const current = await this.load();
    const data = normalizeRegistry({ projects: change.projects ?? current.projects, solutions: change.solutions ?? current.solutions });
    this.cache = data;
    await writeFileAtomic(this.file, JSON.stringify(data, null, 2) + "\n");
  }

  /** Drops the in-memory copy, so the next read sees changes made by another process. */
  invalidate(): void {
    this.cache = undefined;
  }

  // ------------------------------------------------------------------------------------------- solutions

  async solutions(): Promise<RegisteredSolution[]> {
    return (await this.load()).solutions.map((s) => ({ ...s, projects: [...s.projects] }));
  }

  async solution(id: string): Promise<RegisteredSolution | undefined> {
    return (await this.solutions()).find((s) => s.id === id);
  }

  async solutionOf(key: string): Promise<RegisteredSolution | undefined> {
    return (await this.solutions()).find((s) => s.projects.includes(key));
  }

  async solutionByFolder(folder: string): Promise<RegisteredSolution | undefined> {
    return (await this.solutions()).find((s) => s.folder === folder);
  }

  /** Creates a solution; its projects leave any other solution. */
  async addSolution(input: { name: string; folder: string | null; projects: string[] }): Promise<RegisteredSolution> {
    const name = input.name.trim();
    if (!name) throw new Error("A solution needs a name");
    const data = await this.load();
    const base = solutionId(name);
    let id = base;
    for (let i = 2; data.solutions.some((s) => s.id === id); i++) id = `${base}-${i}`;
    const keys = [...new Set(input.projects)].filter((k) => data.projects.some((p) => p.key === k));
    const entry: RegisteredSolution = { id, name, folder: input.folder, projects: keys, createdAt: new Date().toISOString() };
    await this.save({ solutions: [...data.solutions.map((s) => ({ ...s, projects: s.projects.filter((k) => !keys.includes(k)) })), entry] });
    return entry;
  }

  async renameSolution(id: string, name: string): Promise<boolean> {
    const data = await this.load();
    if (!name.trim() || !data.solutions.some((s) => s.id === id)) return false;
    await this.save({ solutions: data.solutions.map((s) => (s.id === id ? { ...s, name: name.trim() } : s)) });
    return true;
  }

  /** Forgets the solution only: its projects stay registered as standalone projects. */
  async removeSolution(id: string): Promise<boolean> {
    const data = await this.load();
    if (!data.solutions.some((s) => s.id === id)) return false;
    await this.save({ solutions: data.solutions.filter((s) => s.id !== id) });
    return true;
  }

  /** Puts projects in a solution (moving them out of any other one). */
  async addToSolution(id: string, keys: string[]): Promise<boolean> {
    const data = await this.load();
    if (!data.solutions.some((s) => s.id === id)) return false;
    const known = keys.filter((k) => data.projects.some((p) => p.key === k));
    await this.save({
      solutions: data.solutions.map((s) => (s.id === id ? { ...s, projects: [...s.projects, ...known.filter((k) => !s.projects.includes(k))] } : { ...s, projects: s.projects.filter((k) => !known.includes(k)) })),
    });
    return true;
  }

  /** Moves a project to a solution, or out of its solution with `id` null. */
  async setProjectSolution(key: string, id: string | null): Promise<boolean> {
    const data = await this.load();
    if (!data.projects.some((p) => p.key === key) || (id !== null && !data.solutions.some((s) => s.id === id))) return false;
    await this.save({ solutions: data.solutions.map((s) => ({ ...s, projects: s.id === id ? [...s.projects.filter((k) => k !== key), key] : s.projects.filter((k) => k !== key) })) });
    return true;
  }

  // ------------------------------------------------------------------------------------------- projects

  async list(): Promise<RegisteredProject[]> {
    return [...(await this.load()).projects];
  }

  async get(key: string): Promise<RegisteredProject | undefined> {
    return (await this.load()).projects.find((p) => p.key === key);
  }

  async byFolder(folder: string): Promise<RegisteredProject | undefined> {
    return (await this.load()).projects.find((p) => p.folder === folder);
  }

  async add(project: { key: string; name: string; folder: string | null }): Promise<RegisteredProject> {
    if (!isSafeKey(project.key)) throw new Error(`Invalid project key: ${project.key}`);
    const data = await this.load();
    if (data.projects.some((p) => p.key === project.key)) throw new Error(`A project with the key ${project.key} already exists`);
    const now = new Date().toISOString();
    const entry: RegisteredProject = { key: project.key, name: project.name, folder: project.folder, createdAt: now, ...(project.folder ? { linkedAt: now } : {}) };
    await this.save({ projects: [...data.projects, entry] });
    return entry;
  }

  async linkFolder(key: string, folder: string): Promise<RegisteredProject> {
    const data = await this.load();
    const current = data.projects.find((p) => p.key === key);
    if (!current) throw new Error(`Unknown project ${key}`);
    const updated = { ...current, folder, linkedAt: new Date().toISOString() };
    await this.save({ projects: data.projects.map((p) => (p.key === key ? updated : p)) });
    return updated;
  }

  async rename(key: string, name: string): Promise<void> {
    const data = await this.load();
    if (!data.projects.some((p) => p.key === key && p.name !== name)) return;
    await this.save({ projects: data.projects.map((p) => (p.key === key ? { ...p, name } : p)) });
  }

  /** Forgets a project and deletes its uploaded copies. The project folder is never touched. */
  async remove(key: string): Promise<boolean> {
    const data = await this.load();
    if (!data.projects.some((p) => p.key === key)) return false;
    await this.save({ projects: data.projects.filter((p) => p.key !== key) });
    await rm(this.uploadsDir(key), { recursive: true, force: true });
    return true;
  }

  /** Stores an uploaded analysis and returns its path. */
  async saveUpload(key: string, report: Report, text: string): Promise<string> {
    const file = path.join(this.uploadsDir(key), uploadFileName(report));
    await writeFileAtomic(file, text);
    return file;
  }

  async uploadFiles(key: string): Promise<string[]> {
    try {
      const dir = this.uploadsDir(key);
      return (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith(".json"))
        .map((e) => path.join(dir, e.name))
        .sort();
    } catch {
      return [];
    }
  }
}
