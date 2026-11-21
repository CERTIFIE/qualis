import { stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import picomatch from "picomatch";
import { isGitWorkTree, listGitFiles } from "./git.js";

export interface DiscoveredFile {
  /** Relative to the project root, forward slashes. */
  path: string;
  absolutePath: string;
  size: number;
}

/** Files larger than this are skipped (generated or minified code). */
export const MAX_FILE_SIZE = 2 * 1024 * 1024;

export function matcher(patterns: string[]): (file: string) => boolean {
  if (patterns.length === 0) return () => false;
  return picomatch(patterns, { dot: true });
}

/**
 * Lists the files of a project that match `include` and not `exclude`.
 * Inside a git work tree with `respectGitignore`, files ignored by git are skipped.
 */
export async function discoverFiles(
  baseDir: string,
  options: { include: string[]; exclude: string[]; respectGitignore: boolean },
): Promise<{ files: DiscoveredFile[]; skipped: { path: string; reason: string }[] }> {
  const isIncluded = matcher(options.include);
  const isExcluded = matcher(options.exclude);
  let candidates: string[];
  if (options.respectGitignore && (await isGitWorkTree(baseDir))) {
    candidates = await listGitFiles(baseDir);
  } else {
    candidates = await fg(options.include, {
      cwd: baseDir,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore: options.exclude,
    });
  }
  const files: DiscoveredFile[] = [];
  const skipped: { path: string; reason: string }[] = [];
  for (const rel of candidates.sort()) {
    if (!isIncluded(rel) || isExcluded(rel)) continue;
    const absolutePath = path.join(baseDir, rel);
    let info;
    try {
      info = await stat(absolutePath);
    } catch {
      continue; // deleted from the work tree but still tracked
    }
    if (!info.isFile()) continue;
    if (info.size > MAX_FILE_SIZE) {
      skipped.push({ path: rel, reason: `larger than ${MAX_FILE_SIZE / 1024 / 1024} MB` });
      continue;
    }
    files.push({ path: rel, absolutePath, size: info.size });
  }
  return { files, skipped };
}
