import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Is an analysis behind its branch? The report records the commit and branch it analysed (analysis.vcs); the project
// folder's git repository knows where that branch is now. Only commits that touch the project folder count, so the
// projects of a monorepo (a solution) are not marked by each other's changes. Server side only (runs git).

export type Staleness =
  | { state: "current"; branch: string }
  /** The branch has `commits` newer commits in the folder; `last` is the newest of them. */
  | { state: "behind"; branch: string; commits: number; last: { revision: string; date: string } }
  /** The analysed commit is no longer on the branch (rebased or reset); `last` is the branch's newest commit in the folder. */
  | { state: "moved"; branch: string; last: { revision: string; date: string } };

const exec = promisify(execFile);

/** Output of a git command in `cwd`, or null when it fails (no repository, unknown ref, git missing, timeout). */
async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["-C", cwd, ...args], { timeout: 5000, maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** The newest commit of a range or ref that touches the folder: `{ revision, date }`. */
async function lastCommit(folder: string, range: string): Promise<{ revision: string; date: string } | null> {
  const out = await git(folder, ["log", "-1", "--format=%H%x00%cI", range, "--", "."]);
  if (!out) return null;
  const [revision, date] = out.split("\0");
  return revision && date ? { revision, date } : null;
}

async function compute(folder: string, branch: string, revision: string): Promise<Staleness | null> {
  const tip = await git(folder, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`]);
  if (!tip) return null;
  if (tip === revision || tip.startsWith(revision)) return { state: "current", branch };
  if ((await git(folder, ["cat-file", "-e", `${revision}^{commit}`])) === null) return null;
  const onBranch = (await git(folder, ["merge-base", "--is-ancestor", revision, tip])) !== null;
  if (!onBranch) {
    const last = await lastCommit(folder, tip);
    return last ? { state: "moved", branch, last } : null;
  }
  const count = Number(await git(folder, ["rev-list", "--count", `${revision}..${tip}`, "--", "."]));
  if (!Number.isFinite(count) || count === 0) return { state: "current", branch };
  const last = await lastCommit(folder, `${revision}..${tip}`);
  return last ? { state: "behind", branch, commits: count, last } : null;
}

// Pages ask for the same projects often (the Projects page, a solution, a project): keep each answer for a while.
const TTL_MS = 10_000;
const cache = new Map<string, { at: number; value: Promise<Staleness | null> }>();

/**
 * How the analysis of `revision` on `branch` compares with the branch in `folder` now. Null when it cannot be known:
 * no folder (an uploaded analysis), no branch or commit in the report, no git repository, or a branch or commit the
 * repository does not have.
 */
export function staleness(folder: string | null, branch: string | null, revision: string | null): Promise<Staleness | null> {
  if (!folder || !branch || !revision || !/^[0-9a-f]{7,64}$/i.test(revision) || branch.startsWith("-")) return Promise.resolve(null);
  const key = `${folder}\0${branch}\0${revision}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = compute(folder, branch, revision);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** "5 commits behind" / "Branch moved": the short label of a stale analysis. */
export function staleLabel(s: Exclude<Staleness, { state: "current" }>): string {
  return s.state === "behind" ? `${s.commits} commit${s.commits === 1 ? "" : "s"} behind` : "Branch moved";
}
