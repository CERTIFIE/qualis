import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { staleLabel, staleness } from "../lib/staleness";

// A repository with two projects (api/ and web/), as in a solution.
let repo: string;
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const commit = (file: string, text: string) => {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), text);
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", `edit ${file}`);
  return git("rev-parse", "HEAD");
};

beforeAll(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), "qualis-stale-"));
  git("init", "-q", "-b", "main");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("staleness", () => {
  it("counts only the commits that touch the project folder", async () => {
    const analysed = commit("api/a.ts", "1");
    expect(await staleness(path.join(repo, "api"), "main", analysed)).toEqual({ state: "current", branch: "main" });
    commit("web/w.ts", "1");
    // A change in another project of the repository does not make api stale.
    expect(await staleness(path.join(repo, "api"), "main", analysed.slice(0, 12))).toEqual({ state: "current", branch: "main" });
    commit("api/a.ts", "2");
    const last = commit("api/b.ts", "1");
    const s = await staleness(path.join(repo, "api"), "main", analysed.slice(0, 10));
    expect(s).toMatchObject({ state: "behind", branch: "main", commits: 2, last: { revision: last } });
    expect(staleLabel(s as Exclude<typeof s, null | { state: "current" }>)).toBe("2 commits behind");
  });

  it("reports a branch that no longer contains the analysed commit", async () => {
    git("checkout", "-q", "-b", "topic");
    const analysed = commit("api/c.ts", "1");
    git("reset", "-q", "--hard", "HEAD~1");
    commit("api/c.ts", "2");
    expect(await staleness(path.join(repo, "api"), "topic", analysed)).toMatchObject({ state: "moved", branch: "topic" });
  });

  it("knows nothing without a folder, a branch the repository has, a commit or git", async () => {
    const head = git("rev-parse", "HEAD");
    expect(await staleness(null, "main", head)).toBeNull();
    expect(await staleness(path.join(repo, "api"), "missing", head)).toBeNull();
    expect(await staleness(path.join(repo, "api"), "main", "0123456789abcdef")).toBeNull();
    expect(await staleness(path.join(repo, "api"), "main", "not a sha")).toBeNull();
    expect(await staleness(os.tmpdir(), "main", head)).toBeNull();
  });
});
