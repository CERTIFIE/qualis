import { execFile } from "node:child_process";
import type { VcsInfo } from "@qualis/schema";

const MAX_BUFFER = 256 * 1024 * 1024;

/** Runs git in `cwd`; resolves stdout, rejects on non-zero exit. */
export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "core.quotepath=off", ...args],
      { cwd, maxBuffer: MAX_BUFFER, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolve(stdout);
      },
    );
  });
}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await git(cwd, args)).trim();
  } catch {
    return null;
  }
}

export async function isGitWorkTree(cwd: string): Promise<boolean> {
  return (await tryGit(cwd, ["rev-parse", "--is-inside-work-tree"])) === "true";
}

export async function vcsInfo(cwd: string): Promise<VcsInfo | null> {
  if (!(await isGitWorkTree(cwd))) return null;
  const revision = await tryGit(cwd, ["rev-parse", "HEAD"]);
  const branch = await tryGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = await tryGit(cwd, ["status", "--porcelain", "--untracked-files=no"]);
  return {
    type: "git",
    revision,
    branch: branch && branch !== "HEAD" ? branch : null,
    dirty: Boolean(status),
  };
}

/** Lists files not ignored by git (tracked and untracked), relative to `cwd`. */
export async function listGitFiles(cwd: string): Promise<string[]> {
  const out = await git(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return [...new Set(out.split("\0").filter(Boolean))];
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  return (await tryGit(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])) !== null;
}

/** Detects the default branch to compare against: CI base branch, origin/HEAD, main or master. */
async function detectDefaultReference(cwd: string): Promise<string | null> {
  const ciBase = process.env["GITHUB_BASE_REF"] || process.env["SYSTEM_PULLREQUEST_TARGETBRANCH"] || process.env["CI_MERGE_REQUEST_TARGET_BRANCH_NAME"];
  if (ciBase) {
    const name = ciBase.replace(/^refs\/heads\//, "");
    for (const candidate of [`origin/${name}`, name]) if (await refExists(cwd, candidate)) return candidate;
  }
  const originHead = await tryGit(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (originHead) return originHead.replace(/^refs\/remotes\//, "");
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    if (await refExists(cwd, candidate)) return candidate;
  }
  return null;
}

export interface NewCodeBaseline {
  reference: string;
  baseRevision: string;
}

/**
 * Resolves the new-code baseline. With `auto`, the default branch is used and
 * no baseline is returned when HEAD is on the default branch itself.
 */
export async function resolveNewCodeBaseline(cwd: string, reference: string | null): Promise<NewCodeBaseline | null> {
  if (reference === null || !(await isGitWorkTree(cwd))) return null;
  let ref = reference;
  if (reference === "auto") {
    const detected = await detectDefaultReference(cwd);
    if (!detected) return null;
    const head = await tryGit(cwd, ["rev-parse", "HEAD"]);
    const target = await tryGit(cwd, ["rev-parse", `${detected}^{commit}`]);
    if (!head || head === target) return null;
    ref = detected;
  } else if (!(await refExists(cwd, ref))) {
    throw new Error(`New-code reference "${reference}" does not exist in the git repository`);
  }
  const base = await tryGit(cwd, ["merge-base", "HEAD", ref]);
  if (!base) return null;
  return { reference: ref, baseRevision: base };
}

/** Parses `git diff --unified=0` output into added/changed line numbers per file. */
export function parseUnifiedDiff(diff: string): Map<string, number[]> {
  const result = new Map<string, number[]>();
  let current: number[] | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      if (target === "/dev/null") {
        current = null;
      } else {
        const p = target.startsWith("b/") ? target.slice(2) : target;
        current = result.get(p) ?? [];
        result.set(p, current);
      }
      continue;
    }
    if (current && line.startsWith("@@")) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) continue;
      const start = Number(match[1]);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      for (let i = 0; i < count; i++) current.push(start + i);
    }
  }
  return result;
}

/**
 * Lines added or changed since `baseRevision` (working tree included), per file
 * relative to `cwd`. Untracked files are reported with `"all"`.
 */
export async function changedLines(cwd: string, baseRevision: string): Promise<Map<string, number[] | "all">> {
  const diff = await git(cwd, ["diff", "--unified=0", "--no-color", "--no-ext-diff", "--relative", baseRevision, "--", "."]);
  const result = new Map<string, number[] | "all">(parseUnifiedDiff(diff));
  const untracked = await git(cwd, ["ls-files", "-z", "--others", "--exclude-standard"]);
  for (const file of untracked.split("\0").filter(Boolean)) result.set(file, "all");
  return result;
}
