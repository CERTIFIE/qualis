import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

// Server-side folder browser for "Import project": lists directories below QUALIS_BROWSE_ROOT only.
// Every path is resolved with realpath, so `..` segments and symbolic links cannot escape the root.

export type Resolved = { ok: true; path: string } | { ok: false; reason: "outside" | "not-found" | "not-a-folder" };

const isInside = (root: string, target: string) => target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** Resolves `input` (absolute, or relative to the root) to a real directory inside the root. */
export async function resolveInRoot(root: string, input: string | undefined): Promise<Resolved> {
  const realRoot = await realpath(/*turbopackIgnore: true*/ root);
  const raw = (input ?? "").trim();
  const candidate = raw ? path.resolve(/*turbopackIgnore: true*/ realRoot, raw) : realRoot;
  // A literal path outside the root is rejected before touching the disk.
  if (!isInside(realRoot, candidate) && !isInside(path.resolve(root), candidate)) return { ok: false, reason: "outside" };
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  if (!isInside(realRoot, real)) return { ok: false, reason: "outside" };
  const info = await stat(real);
  if (!info.isDirectory()) return { ok: false, reason: "not-a-folder" };
  return { ok: true, path: real };
}

export interface QualisFolder {
  hasReport: boolean;
  historyFiles: number;
  /** Analyses as the listing shows them: the history (which includes the latest), or the report alone. */
  analyses: number;
}

const HISTORY_FILE = /\.json$/i;

/** What a project folder's `.qualis/` contains, without parsing the reports; null when there is no `.qualis/`. */
export async function inspectQualis(folder: string): Promise<QualisFolder | null> {
  const dir = path.join(/*turbopackIgnore: true*/ folder, ".qualis");
  try {
    if (!(await stat(dir)).isDirectory()) return null;
  } catch {
    return null;
  }
  let hasReport = false;
  try {
    hasReport = (await stat(path.join(dir, "report.json"))).isFile();
  } catch {
    hasReport = false;
  }
  let historyFiles = 0;
  try {
    historyFiles = (await readdir(path.join(dir, "history"), { withFileTypes: true })).filter((e) => e.isFile() && HISTORY_FILE.test(e.name)).length;
  } catch {
    historyFiles = 0;
  }
  return { hasReport, historyFiles, analyses: historyFiles || (hasReport ? 1 : 0) };
}

export interface FolderEntry {
  name: string;
  path: string;
  qualis: QualisFolder | null;
  hasChildren: boolean;
}

/** Dependency and build-output folders: never listed, never searched for projects (hidden folders such as .git neither). */
export const SKIPPED = new Set(["node_modules", "bin", "obj", "dist", "build", "target", "vendor"]);

async function subfolders(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith(".") && !SKIPPED.has(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  } catch {
    return [];
  }
}

/** Directories of a folder (hidden folders and build output skipped), each with its `.qualis/` summary. */
export async function listFolder(root: string, dir: string, limit = 500): Promise<FolderEntry[]> {
  const realRoot = await realpath(root);
  const entries: FolderEntry[] = [];
  for (const name of (await subfolders(dir)).slice(0, limit)) {
    const full = path.join(dir, name);
    let real: string;
    try {
      real = await realpath(full);
      if (!isInside(realRoot, real) || !(await stat(real)).isDirectory()) continue;
    } catch {
      continue;
    }
    entries.push({ name, path: real, qualis: await inspectQualis(real), hasChildren: (await subfolders(real)).length > 0 });
  }
  return entries;
}

// ------------------------------------------------------------------------------------------- project discovery

export interface DiscoveredProject {
  /** Real path of the project folder. */
  path: string;
  /** Path relative to the searched folder ("" for the folder itself). */
  rel: string;
  qualis: QualisFolder;
}

export interface DiscoverOptions {
  /** Levels of sub-folders searched below the folder (default 4). */
  maxDepth?: number;
  /** Folders read at most, to keep huge trees fast (default 5000). */
  maxFolders?: number;
  /** Include the folder itself when it has a `.qualis/` (default true). */
  includeSelf?: boolean;
}

/**
 * Project folders (with a `.qualis/`) at or below `folder`, breadth first: at most `maxDepth` levels, hidden,
 * dependency and build-output folders skipped, every folder resolved with realpath and kept inside the root (so
 * symbolic links cannot escape it or loop). Never searches the browse root itself: a whole workspace is not a solution.
 */
export async function discoverProjects(root: string, folder: string, options: DiscoverOptions = {}): Promise<DiscoveredProject[]> {
  const realRoot = await realpath(/*turbopackIgnore: true*/ root);
  let start: string;
  try {
    start = await realpath(folder);
  } catch {
    return [];
  }
  if (start === realRoot || !isInside(realRoot, start)) return [];
  const maxDepth = options.maxDepth ?? 4;
  let budget = options.maxFolders ?? 5000;
  const out: DiscoveredProject[] = [];
  const seen = new Set<string>([start]);
  if (options.includeSelf !== false) {
    const own = await inspectQualis(start);
    if (own) out.push({ path: start, rel: "", qualis: own });
  }
  // Folders are read through their real path; `rel` follows the names as listed (a link keeps its own name).
  let level = [{ dir: start, rel: "" }];
  for (let depth = 1; depth <= maxDepth && level.length && budget > 0; depth++) {
    const next: Array<{ dir: string; rel: string }> = [];
    for (const { dir, rel: parent } of level) {
      for (const name of await subfolders(dir)) {
        if (budget-- <= 0) break;
        const rel = parent ? `${parent}/${name}` : name;
        let real: string;
        try {
          real = await realpath(path.join(dir, name));
          if (seen.has(real) || !isInside(realRoot, real) || !(await stat(real)).isDirectory()) continue;
        } catch {
          continue;
        }
        seen.add(real);
        const qualis = await inspectQualis(real);
        if (qualis) out.push({ path: real, rel, qualis });
        next.push({ dir: real, rel });
      }
    }
    level = next;
  }
  return out.sort((a, b) => (a.rel === "" ? -1 : b.rel === "" ? 1 : a.rel.localeCompare(b.rel)));
}
