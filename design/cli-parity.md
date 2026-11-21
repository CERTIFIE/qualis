# CLI parity with the web UI

Status: design proposal, not implemented. Date: 2026-11-05, revised 2026-11-06 with the decisions in [section 12](#12-decisions-and-open-questions).
Scope: the terminal commands of the `qualis` package once installed in a project (`pnpm add -D qualis`, then `qualis …`), so that everything the web UI shows can be obtained from the terminal alone.

## Contents

1. [Goals and principles](#1-goals-and-principles)
2. [Where we are](#2-where-we-are)
3. [One implementation for the CLI and the UI: `@qualis/report-kit`](#3-one-implementation-for-the-cli-and-the-ui-qualisreport-kit)
4. [Conventions shared by the read commands](#4-conventions-shared-by-the-read-commands)
5. [Deep dive: is the analysis behind its branch?](#5-deep-dive-is-the-analysis-behind-its-branch)
6. [Deep dive: the analysis "graphically" in the terminal](#6-deep-dive-the-analysis-graphically-in-the-terminal)
7. [Deep dive: one folder, several projects](#7-deep-dive-one-folder-several-projects)
8. [The command set](#8-the-command-set)
9. [UI to CLI map](#9-ui-to-cli-map)
10. [Report format: changes and guarantees for other UIs](#10-report-format-changes-and-guarantees-for-other-uis)
11. [Roadmap](#11-roadmap)
12. [Decisions and open questions](#12-decisions-and-open-questions)

---

## 1. Goals and principles

The user's goals:

- The analyzer is complete without the UI: every piece of information the UI shows can be read from the terminal.
- A UI is optional: the bundled one or one built by anyone from the published documentation and the analyzer's output.
- The CLI commands are the same operations the UI performs.

Two separate installations follow from this:

| Product | Installed as | Does |
|---|---|---|
| **Qualis CLI** | npm package `qualis` (`pnpm add -D qualis`) | Runs the analysis, writes the files in `.qualis/`, reads them back in the terminal. Terminal only: it never starts or opens a UI. |
| **Qualis UI** | Its own installation (Docker image or package, `apps/ui`) | Shows the files the CLI wrote. Depends on the published file formats and the shared library, not on the CLI. |

The contract between them, and with any third-party UI, is the set of files in `.qualis/` and their documentation.

Principles:

1. **The files are the contract.** Every read command works from `.qualis/report.json`, `.qualis/history/*.json`, `.qualis/solution.json` and, where the question is about the repository *now*, git. Nothing is computed from a private store.
2. **One implementation per computation.** Whatever the UI derives from a report (filters, facets, aggregates, trends, solution metrics, freshness, source checks) moves into a separate package, `@qualis/report-kit`, that the CLI, the UI and third parties import. The UI keeps only rendering and its own state (registry, uploads, favorites).
3. **Same names, same numbers.** A command and the UI screen it mirrors use the same terms and the same formatting functions, so a value printed by `qualis show` is the value on the overview card.
4. **Read commands never write**, not to `.qualis/`, not to the repository, not to git's index (see [5.6](#56-safety-and-read-only-git)). Only `analyze` and `init` write. Nothing uses the network.
5. **Human first, machine always.** On a terminal the output is coloured and drawn to the width; every command also has `--json` with a documented shape, so scripts and UIs written in any language can use the CLI instead of re-implementing it.
6. **Never wait for input that cannot come.** Questions are asked only on an interactive terminal; elsewhere the command fails with the flag or setting that answers the question ([7.4](#74-without-a-terminal)).
7. **Stable exit codes** a pipeline can act on: `0` fine, `1` the checked condition is bad, `2` error (unchanged from today).

## 2. Where we are

### 2.1 The CLI today

`packages/cli/src/cli.ts` offers four commands:

| Command | What it does |
|---|---|
| `analyze [dir]` | Runs the analysis, writes `report.json` (+ `history/`, + `report.sarif`), prints a summary (`format.ts`), optionally every issue (`--issues`), exits 0/1/2 on the gate. |
| `rules [dir]` | Loads the configured plugins and lists their rules (enabled, type, effective severity), `--json` for definitions. |
| `init [dir]` | Writes `qualis.config.json` with the default gate. |
| `validate <report>` | Validates a report against the schema. |

There is no way to read an existing analysis without re-running it: once `analyze` has printed its summary, the terminal has nothing else to offer. History, issue filters, files, rules of the analysis, solutions, freshness and docs exist only in the UI.

### 2.2 What the UI computes that the CLI cannot

| Computation | Where it lives today | Used by |
|---|---|---|
| Analysis summary (gate, ratings, coverage, LOC, issues, debt per analysis) | `apps/ui/lib/store.ts` `summarize()` | Cards, history, analysis switcher |
| History = `report.json` ∪ `history/*.json`, deduplicated by `analysis.id`, newest first | `apps/ui/lib/store.ts` | Header, Activity chart |
| Issue filters, facets with counts, search, sort | `apps/ui/lib/derive.ts` (`matches`, `facetCounts`, `sortIssues`, `dirKey`) | Issues tab |
| Code tree with aggregates (LOC, coverage, complexity, MI, issues, debt) | `apps/ui/lib/derive.ts` (`aggregate`, `treeRows`) | Code tab |
| Delta against the previous analysis | `apps/ui/lib/derive.ts` (`deltaLabel`) | Overview tiles |
| Debt band position, worst severity per type | `apps/ui/lib/derive.ts` | Overview |
| Trend series | `apps/ui/lib/trend.ts` | Activity chart, solution trend |
| Solution metrics (sums, weighted means, worst-of ratings, gate count, combined trend) | `apps/ui/lib/solutions.ts` | Solution page and card |
| Project discovery below a folder (`.qualis` up to 4 levels, skip list) | `apps/ui/lib/browse.ts` | Import project / Import as solution |
| Source from disk checked against `sha256` | `apps/ui/lib/source.ts` | File view |
| Staleness (analysis behind its branch, monorepo-aware) | `apps/ui/lib/staleness.ts` (in progress in the parallel UI work) | Amber chip on cards, strip in the header |
| Docs search | `apps/ui/lib/docs-search.ts` | `/docs` |
| Number, debt and date formatting | `apps/ui/lib/format.ts` | Everywhere |

### 2.3 Inconsistencies found while reading

Small, but exactly the drift a shared implementation prevents:

- **Debt formatting differs.** The CLI prints debt with 8-hour days (`format.ts` `duration()`: `3.2d`); the UI prints hours and minutes (`fDebt()`: `26h 40min`).
- **Maintainability thresholds are hard-coded in the UI.** `ratingOfDebtRatio()` (solution page) and `debtBandPosition()` (debt meter) assume 5/10/20/50 %, while the configuration can change them (`ratings.maintainabilityThresholds`) and the report does not record the values used. A third-party UI cannot get them right either.
- **"history keeps the previous ones" is not exact.** `writeReport()` writes the current analysis into `history/` too, so `history/` holds the newest analysis as well (the UI's `inspectQualis()` relies on that). The docs (`cli.md`, `web-ui.md`) should say so; readers must dedupe by `analysis.id`.
- **`vcs.branch` is `null` on most CI checkouts.** Azure DevOps and pull-request builds on GitHub check out a detached HEAD, so `vcsInfo()` records no branch. Freshness and the branch-scoped history need it; it is available from the CI variables ([10.1](#101-additive-changes-schema-110)).
- **History retention ignores branches.** `output.history` keeps the newest 20 analyses of the folder; analyses of a busy branch push out those of the others. With branch-scoped views ([4.3](#43-which-branches)) retention becomes per branch ([10.1](#101-additive-changes-schema-110)).
- **Reports are not written atomically.** `writeReport()` uses `writeFile` directly; the UI re-reads folders every 2 s and can read a half-written `report.json`. Writing to a temporary file and renaming fixes it for every reader.
- **The CLI's colour check** looks at `stdout.isTTY` also for the progress written to stderr; the new renderer decides per stream.

### 2.4 Measured facts that shape the design

- A real 4.5 MB `report.json` (143 files, 347 issues) parses in about 8 ms; `files` is half of it. Reading 20 history files costs well under a second, so **no history index is needed now**.
- History files are complete reports (minified), `report.json` is pretty-printed; both validate against the same schema.

## 3. One implementation for the CLI and the UI: `@qualis/report-kit`

### 3.1 The package

A new package `packages/report-kit`, published as `@qualis/report-kit`, depending only on `@qualis/schema`. It is what the CLI and the UI share, and what a third-party JavaScript UI installs without the analysis engine.

| Entry point | Environment | Content |
|---|---|---|
| `@qualis/report-kit` | Pure, isomorphic (Node and browser), no I/O | Analysis summary, issue filters/facets/sort, code tree aggregates, deltas, trend series, solution aggregation, report comparison, docs search, formatting (`fInt`, `fPct`, `fDebt`, `fAgo`, `fDate`), wording (`describeFreshness`, `describeCondition`). |
| `@qualis/report-kit/node` | Node only (fs, git) | Locate a project and its `.qualis` folder, load analyses (report + history, dedupe, select by analysis and branch), read `solution.json`, project discovery, source resolution with `sha256`, freshness, local branch listing. |

Dependency graph:

```text
@qualis/schema  ←  @qualis/report-kit  ←  qualis (CLI)  →  @qualis/core (engine)
                          ↑
                    Qualis UI, third-party UIs
```

The engine (`@qualis/core`) does not depend on report-kit except where `analyze` needs a read function (the multi-project detection of [section 7](#7-deep-dive-one-folder-several-projects) lives in core, since it decides what is analysed). The UI never imports `@qualis/core`.

The types the functions return (`AnalysisSummary`, `IssueFilters`, `Freshness`, `ReportComparison`, `SolutionMetrics`…) live in `@qualis/schema`, next to `Report`, because they also define the shape of the CLI's `--json` output.

### 3.2 What moves from the UI

| From `apps/ui/lib` | To | Notes |
|---|---|---|
| `store.ts` `summarize()`, `memberOf()` | `report-kit` `summary.ts` | Without the UI-only fields (`origin`, `file`), which the UI adds. |
| `derive.ts` (all) | `issues.ts`, `tree.ts`, `measures.ts` | `debtBandPosition` takes the thresholds from the report ([10.1](#101-additive-changes-schema-110)). |
| `trend.ts` `analysesOverTime()` | `trend.ts` | `trendGeometry()` is SVG geometry: stays in the UI; the CLI has terminal geometry. |
| `solutions.ts` | `solution.ts` | `ratingOfDebtRatio` takes thresholds. |
| `browse.ts` `discoverProjects()`, `inspectQualis()` | `node/discover.ts` | Root confinement (`resolveInRoot`) stays in the UI: a server security boundary, not a report concern. |
| `source.ts` | `node/source.ts` | Same states (`embedded`, `disk`, `changed`, `missing`…). |
| `staleness.ts` | `node/freshness.ts` | Extended as in [section 5](#5-deep-dive-is-the-analysis-behind-its-branch). |
| `docs-search.ts` | `docs-search.ts` | |
| `format.ts` | `format.ts` | The CLI's `duration()` is dropped. |
| `validate.ts` | stays | The UI validates in the browser with bundled schemas; the CLI keeps `core/validation.ts`. Same published schemas. |

Store-specific code (registry, uploads, caching by mtime, favorites) stays in the UI.

### 3.3 What stays in the CLI

```text
packages/cli/src/
  cli.ts                 argument parsing and dispatch (as today)
  context.ts             project lookup, analysis and branch selection, output options (section 4)
  prompt.ts              interactive questions, only on a TTY (section 7)
  render/
    terminal.ts          colour, width, unicode/ASCII, hyperlinks, pager
    widgets.ts           bars, sparklines, block charts, rating badges, tables, path shortening
    markdown.ts          Markdown output for CI summaries and PR comments
    docs.ts              terminal rendering of the packaged Markdown documentation
  commands/
    status.ts show.ts gate.ts issues.ts files.ts file.ts coverage.ts duplications.ts tests.ts
    functions.ts rules.ts explain.ts docs.ts history.ts diff.ts freshness.ts projects.ts solution.ts
```

No full-screen TUI framework: output is static text, deterministic for a given report and width, which allows golden-file tests (render fixtures at 60/100/140 columns, with and without colour).

### 3.4 Keeping the two consumers honest

A contract test runs report-kit on the repository's fixture reports and checks that the CLI's `--json` output and the UI's server functions return the same values (gate, ratings, facet counts, solution metrics, freshness on a fixture repository).

## 4. Conventions shared by the read commands

### 4.1 Finding the project and its analyses

- `[dir]` positional (as `analyze` today) or `-C <dir>` (as git) for commands whose positional is something else (`file <path>`, `explain <rule>`).
- Without either, the project is the nearest ancestor of the current directory with a `qualis.config.json` or a `.qualis/` folder (as git finds `.git`), so `qualis issues` works from `src/orders/`.
- The output folder comes from `output.dir` (default `.qualis`); an invalid configuration falls back to `.qualis` with a warning.
- `--report <file>` reads a single report instead (a CI artifact): the terminal equivalent of the UI's **Read analysis**. Commands that need the folder (freshness, `file --source` from disk) say so when only a file is given.

### 4.2 Choosing an analysis

`-a, --analysis <ref>` mirrors the UI's analysis switcher (`?a=`). The analyses are the union of `report.json` and `history/*.json`, deduplicated by `analysis.id`, ordered by `analysis.finishedAt`, restricted to the branches of [4.3](#43-which-branches).

| `<ref>` | Analysis |
|---|---|
| `latest` (default) | The newest. |
| `previous`, `~1`, `~N` | The N-th before the newest. |
| `9b2e0c3a` | The analysis whose id starts with this (at least 4 characters, unambiguous). |
| `@2026-11-01`, `@2026-11-01T18:00` | The newest analysis finished at or before that time (UTC unless an offset is given). |
| `path/to/report.json` | That file (same as `--report`). |

### 4.3 Which branches

A folder's history mixes the analyses of every branch analysed there; a trend or a "latest" that jumps between branches is misleading. So the read commands look at **the branch checked out now** by default.

| Option | Analyses considered |
|---|---|
| (default) | Those of the branch checked out now (`analysis.vcs.branch` equal to `git symbolic-ref --short HEAD`). On a detached HEAD: those of the commit checked out, otherwise none, with a hint. |
| `--all-branches` | Those of every **local** branch whose newest commit is at most 30 days old (committer date of the branch tip). `--branch-age <days>` changes the window. |
| `--branch <name>` | Those of that branch, however old, even if it no longer exists locally (its analyses are still in the history). Repeatable. Combines with `--all-branches`. |

- The branch list comes from one call: `git for-each-ref refs/heads --format='%(refname:short)%00%(committerdate:iso-strict)%00%(objectname)'`.
- Without git (no repository, `--report`), no filtering applies, and the commands say so.
- Branches without any analysis are listed by the commands that compare branches (`status --all-branches`: "never analysed").
- Each output names the branch scope in its header ("feat/invoices", "3 branches active in the last 30 days").
- The selection is a report-kit function (`selectAnalyses(analyses, scope, branches)`), so the UI can offer the same filter.

### 4.4 Terminal output

| Aspect | Rule |
|---|---|
| Colour | On when the stream is a TTY; `NO_COLOR` (non-empty) turns it off, `FORCE_COLOR` turns it on (CI logs on GitHub Actions and Azure DevOps render ANSI colours), `--color auto\|always\|never` overrides both. Decided per stream. |
| Colour depth | Truecolor when `COLORTERM` is `truecolor`/`24bit` (rating colours match the UI's), otherwise the 16 basic colours. |
| Colour is never the only signal | Ratings print their letter, conditions `✓ ✗ –`, the gate `PASSED`/`FAILED`. |
| Width | `stdout.columns` on a TTY, otherwise `COLUMNS`, otherwise 80. Layouts adapt (two columns from 100, one below); minimum 40. Outside a TTY, line-oriented lists are never truncated, so `grep` and editors see full paths. |
| Characters | Unicode by default; `--ascii` (or `TERM=dumb`, or `QUALIS_ASCII=1`) uses `#`, `-`, `ok`, `FAIL`. |
| Links | `path:line:col` everywhere (clickable in VS Code, JetBrains and most terminals). OSC 8 hyperlinks for reference URLs when the terminal supports them (`TERM_PROGRAM` is iTerm.app, vscode, WezTerm…), `--hyperlinks` to force. |
| Pager | Long outputs (`issues`, `file --source`, `explain`, `docs`) go through `$QUALIS_PAGER`/`$PAGER` (`less -FRX` by default) on a TTY when taller than the screen, as git does; `--no-pager` disables it. |
| Progress | stderr only, only on a TTY, erased when done (as today). |

### 4.5 Output formats

Every read command has `--json`; list commands also `--format`:

| Format | For | Commands |
|---|---|---|
| `text` (default) | People | All |
| `json` | Scripts, other UIs | All |
| `jsonl` | Streaming to `jq`, large lists | `issues`, `files`, `functions`, `history`, `projects` |
| `markdown` | Job summaries (`$GITHUB_STEP_SUMMARY`, Azure `##vso[task.uploadsummary]`), PR comments | `status`, `show`, `gate`, `diff`, `history`, `solution` |
| `github`, `azure` | Inline annotations in pipeline UIs | `issues`, `diff` |
| `csv` | Spreadsheets | `issues`, `files`, `functions`, `history` |

The JSON output is an envelope with the selected analysis and the result:

```json
{
  "schema": "qualis-cli/issues@1",
  "qualis": "0.2.0",
  "project": { "key": "shop", "name": "Shop", "dir": "/home/me/shop" },
  "scope": { "branches": ["feat/invoices"] },
  "analysis": { "id": "9b2e0c3a-…", "finishedAt": "2026-11-05T10:33:30.705Z", "branch": "feat/invoices", "revision": "3e5c2a1…", "gate": "failed" },
  "result": { "total": 6, "issues": [ { "id": "4f1c2a9e0b7d36e85a12", "ruleId": "typescript:no-cond-assign", "…": "…" } ] }
}
```

- `schema` names the output shape and its major version. The JSON Schemas ship in `@qualis/schema/schemas/cli/`; they get an `$id` URL once the project has a public address.
- Objects inside `result` are report objects unchanged wherever they exist (an issue is a report `Issue`); computed shapes use `@qualis/schema` types.
- Same evolution rule as the report: fields added in minor versions, never removed or changed.
- Errors with `--json` are JSON on stdout with a stable code: `{"error": {"code": "no-analysis", "message": "No analysis of feat/invoices in /home/me/shop/.qualis: run qualis analyze"}}`.

### 4.6 Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. Display commands always exit 0 when they could display. |
| `1` | The condition the command was asked to check is bad: gate failed (`analyze`, `gate`, `status --check`), stale analysis (`freshness --check`, `status --check`), matching issues (`issues --fail-on`), new issues (`diff --fail-on-new`), invalid file (`validate`). |
| `2` | Error: no analysis, unreadable report, unknown option, git failure, a question that needs an answer on a non-interactive run ([7.4](#74-without-a-terminal)). |

`validate` today exits 2 on an invalid report; since 0.1.0 is not published, it moves to 1, keeping 2 for "could not read".

## 5. Deep dive: is the analysis behind its branch?

The question: *the latest analysis was made on branch B at commit R. Has B moved since, by how many commits, and since when?* The UI is getting the same warning now (an amber chip on project cards, a strip in the project header, `apps/ui/lib/staleness.ts`). This section turns that into one function in `@qualis/report-kit/node`, used by `qualis status`, `qualis freshness`, `qualis projects`, `qualis solution` and the UI.

### 5.1 What the UI work already decided (kept)

- The branch tip is `refs/heads/<branch>` of the project folder's repository; nothing is fetched.
- **Only commits that touch the project folder count** (`-- .` in the folder), so the projects of a monorepo are not marked stale by each other's commits.
- Outcomes `current`, `behind` (count and newest commit), `moved` (the analysed commit is no longer on the branch: rebase, reset, force-push).
- Answers are cached briefly (10 s) because the Projects page asks for every project at once.

### 5.2 What the shared version adds

| Addition | Why |
|---|---|
| **"Since when"**: the *oldest* newer commit, not only the newest | "Behind since 4 Nov 18:12" answers the user's question; the newest commit says how active the branch is. Both come from the same `git log` call. |
| **Both counts**: commits touching the project (`commits`) and on the whole branch (`branchCommits`) | "3 commits behind, 1 touches this project" explains why a monorepo project is still `current`. The state is decided on `commits`; `--whole-repo` decides on `branchCommits`. |
| **Reasons instead of `null`** | The CLI must say *why* freshness is unknown ("the repository does not have commit 3e5c2a1: shallow clone or another clone"). The UI may still render nothing for `unknown`. |
| **The checked-out state** (`head`) | "Uncommitted changes in 2 analysed files" tells a developer whether `qualis issues` still matches the code. |
| **The analysis itself was dirty** | `vcs.dirty`/`vcs.untracked` mean the report describes uncommitted code; shown as a note. |
| **Upstream, without fetching** (`--upstream`) | `origin/<branch>` as last fetched may be ahead of the local branch; reported with the age of the last fetch (`FETCH_HEAD` mtime). |
| **Several branches** | With `--all-branches` / `--branch` ([4.3](#43-which-branches)) the function runs per branch, on the latest analysis of each. |
| **Shared wording** | `describeFreshness()` returns `{ tone, short, long }`, so the chip, the strip and the CLI say the same thing. |

**No network, ever.** Freshness never runs `git fetch`, and there is no `--fetch` option: a read command that silently contacts a remote can hang on a credential prompt, be slow or offline, and changes the repository's remote-tracking refs behind the user's back. A developer who wants the remote's view runs `git fetch` and then `qualis freshness --upstream`; the output shows how old the last fetch is.

### 5.3 Types

```ts
// @qualis/schema
export type FreshnessState = "current" | "behind" | "moved" | "unknown";

export type FreshnessUnknownReason =
  | "no-vcs"              // the report has no git information
  | "no-revision"         // the report has no commit
  | "no-branch"           // detached HEAD at analysis time and no CI branch
  | "not-a-repository"    // the folder is not (any more) a git work tree
  | "git-unavailable"     // no git executable (e.g. the UI's Docker image)
  | "unsafe-repository"   // git refuses: repository owned by another user (safe.directory)
  | "branch-missing"      // neither refs/heads/<b> nor refs/remotes/origin/<b>
  | "revision-missing"    // the commit is not in this repository (shallow clone, gc, other clone)
  | "timeout";

export interface CommitRef {
  revision: string;
  committedAt: string;    // ISO 8601, committer date
  subject?: string;
  author?: string;
}

export interface Freshness {
  state: FreshnessState;
  reason?: FreshnessUnknownReason;
  branch: string | null;
  tipRef?: string;                    // "refs/heads/feat/invoices" or "refs/remotes/origin/feat/invoices"
  analysed: { revision: string; finishedAt: string; dirty: boolean };
  tip?: CommitRef;
  /** Newer commits on the branch that touch the project folder (decides the state). */
  commits?: number;
  /** Newer commits on the branch, whole repository. */
  branchCommits?: number;
  /** Oldest and newest of the newer commits that touch the project folder. */
  first?: CommitRef;
  last?: CommitRef;
  /** Only with `upstream: true`; null when the branch has no remote-tracking ref. */
  upstream?: { ref: string; commits: number; fetchedAt: string | null } | null;
  /** Only with `head: true`. */
  head?: { branch: string | null; revision: string; isAnalysedBranch: boolean; isAnalysedRevision: boolean; dirty: boolean | null };
}
```

```ts
// @qualis/report-kit/node
export interface FreshnessOptions {
  wholeRepo?: boolean;
  upstream?: boolean;
  head?: boolean;
  timeoutMs?: number;                 // per git call, default 5000
}
export function analysisFreshness(projectDir: string, analysis: Report["analysis"], options?: FreshnessOptions): Promise<Freshness>;

// @qualis/report-kit
export function describeFreshness(f: Freshness, now?: Date): { tone: "ok" | "warn" | "muted"; short: string; long: string };
```

Caching is the caller's policy: the UI keeps its TTL cache; the CLI calls once per branch.

### 5.4 Algorithm

All commands run in the project folder (`git -C <dir>`), read-only, with the settings of [5.6](#56-safety-and-read-only-git). `R` is `analysis.vcs.revision`, `B` is `analysis.vcs.branch`.

| Step | Command | Outcome |
|---|---|---|
| 1 | Report has no `vcs` / `revision` / `branch` | `unknown` with `no-vcs` / `no-revision` / `no-branch`. |
| 2 | `git rev-parse --verify --quiet refs/heads/B^{commit}`, else `refs/remotes/origin/B^{commit}` | Tip `T`; neither → `branch-missing`; git errors map to `not-a-repository`, `unsafe-repository`, `git-unavailable`. |
| 3 | `T == R` | `current`, `commits: 0` (one git call in the common case). |
| 4 | `git cat-file -e R^{commit}` | Fails → `revision-missing`. |
| 5 | `git merge-base --is-ancestor R T` | Not an ancestor → `moved`; `last` = `git log -1 --format=… T -- .`. |
| 6 | `git log --format=%H%x1f%cI%x1f%an%x1f%s --max-count=1001 R..T -- .` | Newer commits touching the folder, newest first: `commits`, `last` = first line, `first` = last line. 0 lines → `current` (the branch moved elsewhere in the repository). At 1001 lines the count comes from `git rev-list --count R..T -- .`. |
| 7 | `git rev-list --count R..T` | `branchCommits`. |
| 8 (`upstream`) | `git rev-parse --verify --quiet refs/remotes/origin/B`, `git rev-list --count R..origin/B -- .`, mtime of `git rev-parse --git-path FETCH_HEAD` | `upstream`. |
| 9 (`head`) | `git rev-parse HEAD`, `git symbolic-ref --quiet --short HEAD`, `git --no-optional-locks status --porcelain --untracked-files=no -- .` | `head`. |

The state is `behind` when `commits > 0` (or `branchCommits > 0` with `wholeRepo`).

Edge cases:

- **Analysis of a pull-request merge commit** (GitHub's `refs/pull/N/merge`): the commit exists only in the CI clone; locally → `revision-missing`.
- **Short revisions** in old reports: step 3 compares by prefix, as the UI does.
- **Worktrees**: `git -C` handles `.git` files; `FETCH_HEAD` is found with `--git-path`.
- **Working-tree changes** are not commits: shown through `head.dirty` and, in the CLI, through the per-file `sha256` check (`qualis status --files`).

### 5.5 What the user sees

CLI (`qualis status`, `qualis freshness`):

```text
Freshness  ⚠ 3 commits behind feat/invoices, 2 of them touch this project
           behind since 5 Nov 11:02 UTC (28 min after the analysis) · newest 5 Nov 12:40 "Round invoice totals"
           uncommitted changes in 2 analysed files
           → qualis analyze
```

UI: the chip keeps its short label (`describeFreshness().short`: "2 commits behind", "Branch moved"); the strip uses `long`; `unknown` shows no chip, and the strip a muted line only for reasons the user can fix (`git-unavailable`, `unsafe-repository`, `revision-missing`).

### 5.6 Safety and read-only git

The UI runs git on folders it did not create (in Docker, mounted read-only and owned by another user). The shared runner therefore:

- uses only read commands, with `GIT_OPTIONAL_LOCKS=0` / `--no-optional-locks` so `git status` does not refresh `.git/index`, `GIT_TERMINAL_PROMPT=0`, a timeout, and `-c core.fsmonitor=false` (an fsmonitor command in a repository's config would otherwise run);
- passes branch names after `--end-of-options` and accepts only hexadecimal revisions;
- **does not bypass `safe.directory`**: git refuses repositories owned by another user to avoid running their configuration. The state is then `unknown`/`unsafe-repository`, and the UI's docs explain how to set `safe.directory` in the container for the mounted folders. The UI's Docker image (`node:22-alpine`) has no git today: freshness in Docker needs `apk add --no-cache git`.

### 5.7 In CI

`qualis freshness --check` (exit 1 when not `current`) guards steps that must use an analysis of the commit being built, e.g. a deploy job reusing an earlier job's report. `--max-behind <n>` and `--max-age <duration>` relax it.

## 6. Deep dive: the analysis "graphically" in the terminal

### 6.1 Building blocks

| Widget | Drawing | Used for |
|---|---|---|
| Gate badge | `✗ FAILED` / `✔ PASSED` in reverse video (red/green), word always present | Gate |
| Condition row | `✓ ✗ –` + metric + scope + actual + "fails when > 3" | Gate |
| Rating badge | ` A ` on the UI's rating colour (A/B green, C yellow, D orange, E red) | Ratings |
| Bar | Eighth blocks `▏▎▍▌▋▊▉█` on `░`, with a `│` tick for the gate threshold | Coverage, duplications, debt band |
| Stacked bar | Segments in the series' colours, labels after the bar | Tests by result |
| Matrix | Type × severity counts, zeros as `·` | Issues |
| Sparkline | `▁▂▃▄▅▆▇█` over the last N analyses, min–max padded as the UI's `trendGeometry` (a flat series sits mid-height) | Activity |
| Gate strip | `✓✓✗✓` aligned under a sparkline | Activity |
| Block chart | 8 rows high, y labels, x dates, `✗` under failed gates | `history --chart` |
| Delta | `▲ 0.4` / `▼ 6` coloured good/bad by "lower is better", `±0` | Measures vs previous |
| Table | Column widths fitted to the width; paths shortened in the middle (`src/…/invoice.ts`) only on a TTY | Lists |

The bar and sparkline geometry is pure (`render/widgets.ts`) and unit-tested.

### 6.2 `qualis show` on a 100-column terminal

```text
$ qualis show
 Shop  shop · feat/invoices @ 3e5c2a1 · 5 Nov 10:33 UTC (2 h ago) · ⚠ 2 commits behind
 ─────────────────────────────────────────────────────────────────────────────────────────────────
 ✗ FAILED  Quality gate "Default" · 2 of 7 conditions fail                  New code since origin/main

   ✗ Coverage on new code                62.4 %   fails when < 80        → qualis coverage --new
   ✗ Duplicated lines on new code         4.1 %   fails when > 3         → qualis duplications --new
   ✓ Reliability rating on new code       A       fails when worse than A
   ✓ Security rating on new code          A       fails when worse than A
   ✓ Maintainability rating on new code   A       fails when worse than A
   ✓ Blocker issues                       0       fails when > 0
   ✓ Test failures                        0       fails when > 0

 Ratings                         New code                         Overall
   Security         A   0 vulnerabilities · 1 hotspot      C   3 vulnerabilities · 4 hotspots
   Reliability      A   0 bugs                             C   12 bugs
   Maintainability  A   5 code smells · 35min              A   206 code smells · 506h 12min (2.1 %)

 Coverage    new  ████████████████████████▉       │░░░░░░░  62.4 %  257 of 412 lines
             all  ████████████████████████████████│█▌░░░░░  81.0 %  lines 83.2 % · branches 74.9 %
                                                  └ gate 80 %
 Duplications new  4.1 %  ·  all 1.4 %   23 blocks · 687 lines in 31 files

 Issues  225 · 6 on new code       blocker  critical  major  minor  info
   Bug                  12               ·         ·      9      3     ·
   Vulnerability         3               ·         ·      3      ·     ·
   Security hotspot      4               ·         ·      4      ·     ·
   Code smell          206               ·         ·     58    131    17

 Tests  1 204 · 100.0 % success · 41.2 s
   ████████████████████████████████████████████████████████████▉░  1 200 passed · 4 skipped

 Hotspots (cyclomatic)                          Activity (feat/invoices, last 8 analyses)
   58  InvoiceService.compute  src/…/invoice.ts:88   Issues    231 ▇▇▆▆▅▅▅▄ 225  ▼ 6
   41  parseOrder              src/…/order.ts:12     Coverage  78% ▂▃▃▄▄▅▅▆ 81%  ▲ 0.4
   33  TaxTable.lookup         src/…/tax.ts:140      Debt     512h ▆▆▆▅▅▅▄▄ 506h ▼ 5h 48min
   29  routes                  src/http/routes.ts:9  Gate          ✓✓✗✓✓✓✓✗

 312 files · 48 210 lines of code · 9.8 s · Qualis 0.1.0 · 2 warnings (qualis show --section analysis)
```

- The header answers "what am I looking at" first: project, branch, commit, age, freshness.
- Each failed condition points to the command that explains it, the terminal equivalent of the UI's links from cards to filtered lists.
- The default scope is new code when the analysis has new code, overall otherwise, like the overview; `--scope overall|new` switches.
- `--section gate,ratings,coverage,duplications,issues,tests,size,hotspots,activity,analysis` selects sections (the UI's cards); `--hotspots complexity|cognitive|mi` and `--activity issues|coverage|debt|loc` are the UI's two tab switches (`hs`, `hm`).
- Activity uses the branch scope of [4.3](#43-which-branches): by default only the analyses of the checked-out branch.

### 6.3 Narrow terminals, pipes and CI

- **Below 100 columns** the two-column sections stack; below 60 the matrix becomes one line per type (`Bug 12: major 9, minor 3`) and bars shrink to 20 cells.
- **Not a TTY** (pipe, file, CI log): no colour unless forced, width 80 unless `COLUMNS`, same layout otherwise. No cursor movement.
- **`--compact`**: header, gate verdict with failing conditions, one line of ratings/coverage/duplications/issues. `analyze` prints this after an analysis (replacing today's `summary()`), so the post-analysis summary and `qualis show` are the same code.
- **`--format markdown`** for job summaries and PR comments:

```markdown
### Shop — ❌ Quality gate failed (2 of 7)
`feat/invoices` @ `3e5c2a1` · new code since `origin/main`

| Condition | Actual | Fails when |
|---|---|---|
| ❌ Coverage on new code | 62.4 % | < 80 |
| ❌ Duplicated lines on new code | 4.1 % | > 3 |

| | New code | Overall |
|---|---|---|
| Security | A | C |
| Reliability | A | C |
| Maintainability | A | A (2.1 %) |
| Coverage | 62.4 % | 81.0 % |
| Issues | 6 | 225 |
```

- **`--json`** returns the selected sections as data (the report's `qualityGate`, `measures`, computed deltas and freshness), never display strings.

### 6.4 History chart

```text
$ qualis history --chart --metric coverage
 Coverage · feat/invoices · 8 analyses
  82 %┤                                         ▄▄▄▄▄▄
      │                             ▄▄▄▄▄▄▄▄▄▄▄▄██████
  80 %┤                 ▄▄▄▄▄▄▄▄▄▄▄▄████████████████████
      │     ▄▄▄▄▄▄▄▄▄▄▄▄████████████████████████████████
  78 %┤▄▄▄▄▄████████████████████████████████████████████
      └─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────
       29 Oct 30 Oct 31 Oct  2 Nov  3 Nov  4 Nov  4 Nov  5 Nov
                         ✗                          ✗
```

The vertical domain fits the values (as the UI's charts), failed gates are marked under their analysis, and `--metric` accepts `issues`, `coverage`, `debt`, `loc`, `duplication`, `bugs`, `vulnerabilities`, `hotspots`, `codeSmells`, `complexity`, `tests` and the three ratings. With `--all-branches` the chart draws one series per branch (different colours and markers, legend below), never one line through all of them.

## 7. Deep dive: one folder, several projects

### 7.1 The rule

**The folder where `qualis analyze` runs is the project.** Its `.qualis/` holds the analysis of everything below it.

When that folder visibly contains several projects, Qualis does not decide alone whether it is one project or a solution: it **asks**, once, and records the answer in `qualis.config.json`, so the question does not come back and CI does the same as the developer.

### 7.2 Detection heuristic

Cheap, before any plugin runs, on the files `analyze` would consider (git-ignored files, `node_modules`, `bin`, `obj`, `dist`, `build`, `target`, `vendor` and hidden folders skipped; up to 4 levels, as the UI's discovery). A **candidate project** is a sub-folder of the root with one of these markers:

| Marker | Notes |
|---|---|
| Workspace declarations: `pnpm-workspace.yaml`, `workspaces` in the root `package.json` | When present, they define the candidates exactly (their package folders). |
| `package.json` with a `name` | Outside a workspace declaration. |
| `*.csproj` | **Each `.csproj` is a candidate**: for .NET the number of projects is the number of `.csproj`. A `.sln`/`.slnx` does not group them; it only supplies the default solution name. Test projects (`*.Tests.csproj`, `*.Test.csproj`, `<IsTestProject>true</IsTestProject>`) are listed but not selected by default: their test and coverage reports belong to the projects they test. |
| `qualis.config.json` or `.qualis/` in a sub-folder | Someone already analysed or configured it on its own: the strongest signal. |

The question is asked when there are **at least two candidates** other than the root itself. A root that is itself a single project (one `package.json`, one `.csproj`) with no other markers is analysed without a question.

Detection lives in `@qualis/core` (it decides what `analyze` does) and is exported so `qualis init` and the UI can show the same candidates.

### 7.3 The question (interactive terminal)

```text
$ qualis analyze
This folder contains 4 projects:
  packages/core      package.json   @shop/core
  packages/api       package.json   @shop/api
  apps/web           package.json   @shop/web
  src/Shop.Worker    Shop.Worker.csproj
  (tests: src/Shop.Worker.Tests — not selected)

How should Qualis analyse it?
  1) As one project: one report for the whole folder
  2) As a solution: one report per project, grouped as a solution
  3) As a solution, choosing the projects
Choice [1-3]: 2
Solution name [shop]: Shop suite
Save this in qualis.config.json? [Y/n] y
```

The answer is stored in the root configuration:

```json
{ "layout": "project" }
```

or

```json
{
  "solution": {
    "name": "Shop suite",
    "projects": ["packages/core", "packages/api", "apps/web", "src/Shop.Worker"]
  }
}
```

`projects` accepts globs (`packages/*`), so new packages join without editing. If the user does not save, the choice applies to this run only and the next run asks again. `qualis init` asks the same question when it detects several projects.

### 7.4 Without a terminal

A pipeline cannot answer. When the question would be asked and stdin/stdout is not a TTY (or `--json`, or `CI` is set), `analyze` **exits 2 without analysing**:

```text
error: this folder contains 4 projects (packages/core, packages/api, apps/web, src/Shop.Worker).
Decide how to analyse it, either in qualis.config.json ("layout": "project", or a "solution" section)
or on the command line: qualis analyze --as project | --as solution [--projects <glob,...>]
Run `qualis init` in a terminal to choose interactively.
```

A silent default would make CI produce a different result from the developer's machine, which is exactly what asking is meant to prevent. `--as project|solution` and `--projects` also override a saved choice for one run.

### 7.5 What a solution analysis writes

- Each member is analysed as a normal project: its own `.qualis/report.json` and `history/`, its own `project.key` (from its configuration, otherwise its package name or folder). Every read command and every UI handles a member like any project.
- The root gets **`.qualis/solution.json`**, a small index (schema `solution.schema.json`):

```json
{
  "schemaVersion": "1.0.0",
  "name": "Shop suite",
  "members": [
    { "path": "packages/core", "key": "shop-core", "name": "@shop/core" },
    { "path": "src/Shop.Worker", "key": "shop-worker", "name": "Shop.Worker" }
  ]
}
```

  It declares membership only. Metrics are always computed from each member's latest report (`aggregateSolution()` in report-kit), so analysing one member on its own (running `qualis analyze` in its folder, which is then the project) never leaves the solution with stale numbers.
- Configuration (proposal, [Q2](#122-open-questions)): a member's configuration is the root's, **overridden** by the member's own `qualis.config.json` when there is one, like `extends` in ESLint or tsconfig:
  - `rules` are merged per rule id (the member can switch off or tune one rule without repeating the others);
  - `qualityGate` is replaced as a whole (a gate is one decision; merging conditions would produce a gate nobody wrote);
  - other sections (`ratings`, `newCode`, `coverage`, `tests`, `duplication`, `output`) are merged per key; arrays (`exclude`, report globs, `plugins`) are replaced, not concatenated, so a member can remove an entry;
  - every path is resolved from the folder of the file that contains it;
  - `"extends": false` in a member's file ignores the root's settings entirely;
  - `layout` and `solution` exist only in the root file.

  `qualis config` (or `validate --effective`) prints the resulting configuration of a member, with the file each value comes from.
- The run prints the solution summary (as `qualis solution`) and exits 1 when any member's gate failed.
- The UI: importing a folder with `.qualis/solution.json` imports it as a solution with that name and those members, without its own heuristics.

## 8. The command set

Grouped by purpose. "Data" says what each command reads.

### 8.1 Analyse and configure

#### `qualis analyze` (exists; additions)

| Addition | Purpose |
|---|---|
| Multi-project question, `--as project\|solution`, `--projects <glob,...>` | [Section 7](#7-deep-dive-one-folder-several-projects). |
| `--print compact\|show\|none` | What is printed after the analysis (default `compact`, the shared renderer). `--issues` stays. |
| `--json` | Prints the `status` JSON of the new analysis on stdout (the report file is written as usual). |

Core changes: CI branch detection, `vcs.committedAt`, `vcs.untracked`, `vcs.path`, `analysis.ci`, `analysis.settings` ([10.1](#101-additive-changes-schema-110)); atomic writes; retention per branch ([10.1](#101-additive-changes-schema-110)).

#### `qualis init` (exists; addition)

Asks the project/solution question of [7.3](#73-the-question-interactive-terminal) when it detects several projects and writes the answer.

#### `qualis validate` (extended)

```bash
qualis validate [file-or-dir ...]
```

Detects what it is given: a report, a `qualis.config.json` (schema plus gate semantics, `checkConditions()`), a `solution.json`, or a `.qualis` folder (report, every history file, and that they agree on `project.key`). Without arguments: the project's configuration and `.qualis`.

```text
$ qualis validate
 ✓ qualis.config.json            valid configuration
 ✓ .qualis/report.json           valid report (schema 1.0.0), analysis 9b2e0c3a
 ✓ .qualis/history/  8 files     valid, same project "shop"
```

Exit: 0 valid, 1 invalid, 2 unreadable. Data: files only.

### 8.2 The latest analysis at a glance

#### `qualis status`

The command to run first, like `git status`: what was analysed, whether it is still current, the gate verdict, what to do next.

```text
$ qualis status
 Shop (shop) · .qualis/report.json · branch feat/invoices
   Analysis   5 Nov 10:33 UTC (2 h ago) · 3e5c2a1 · new code since origin/main
   Freshness  ⚠ 3 commits behind feat/invoices, 2 of them touch this project (since 5 Nov 11:02)
   Gate       ✗ FAILED "Default" · coverage on new code 62.4 % < 80 · duplicated lines on new code 4.1 % > 3
   Issues     225 · 6 on new code · 0 blocker, 0 critical
   Notes      2 analysis warnings

 Next: qualis analyze (analysis is behind) · qualis gate (why it fails)
```

With `--all-branches`, one line per branch:

```text
$ qualis status --all-branches
 Shop (shop) · local branches with commits in the last 30 days
   Branch           Analysed        Commit   Gate  Issues  Freshness
 * feat/invoices    5 Nov 10:33     3e5c2a1  ✗        225  ⚠ 2 behind
   main             30 Oct 09:12    a19b44f  ✓        229  ⚠ 5 behind
   feat/export      never analysed (last commit 2 Nov)
```

Options: `-a`, `--report`, `--all-branches`, `--branch-age`, `--branch`, `--files` (count analysed files changed since, by `sha256`), `--upstream`, `--check` (exit 1 when the gate failed or the analysis is not current; with several branches, when any of them is), `--json`, `--format markdown`.
Exit: 0, or 1 with `--check`. Data: report, history, git.

#### `qualis show`

The overview page in the terminal: [section 6.2](#62-qualis-show-on-a-100-column-terminal).

Options: `-a`, `--report`, `--branch`, `--scope new|overall`, `--section <list>`, `--hotspots complexity|cognitive|mi`, `--activity <metric>`, `--compact`, `--watch` (re-render when `report.json` changes, like the UI picking up new analyses), `--no-git`, `--json`, `--format markdown`.
Exit: 0. Data: report; history for activity and deltas; git for the header's freshness.

#### `qualis gate`

The quality gate card, with the reason for each condition and the next command.

```text
$ qualis gate
 ✗ FAILED  "Default" (7 conditions, 2 fail)
   ✗ Coverage on new code          62.4 %  fails when < 80   155 of 412 new lines not covered → qualis coverage --new
   ✗ Duplicated lines on new code   4.1 %  fails when > 3    17 new lines in 3 blocks        → qualis duplications --new
   ✓ Reliability rating, new code   A
   …
 Conditions without data do not fail the gate. More: qualis explain quality-gate
```

Options: `-a`, `--report`, `--definition` (the configured gate now vs. the one recorded in the analysis, with differences), `--json`, `--format markdown`.
Exit: 0 passed, 1 failed (checks the gate of an existing report or artifact without re-analysing). Data: report, configuration for `--definition`.

### 8.3 Issues, rules and documentation

#### `qualis issues`

The Issues tab. Filters are the UI's facets, with the same semantics (`matches()`): values of one facet are OR-ed, facets are AND-ed.

```bash
qualis issues [dir] [--type <t,...>] [--severity <s,...> | --min-severity <s>] [--rule <id-or-glob,...>]
              [--dir <prefix,...>] [--file <glob,...>] [--new] [--search <text>]
              [--sort file|severity|effort] [--limit <n>] [--facets] [--group-by file|rule|severity|type|dir]
              [--fail-on <severity>] [--format text|json|jsonl|csv|github|azure]
qualis issues <issue-id>
```

```text
$ qualis issues --new --sort severity
src/billing/invoice.ts:88:5    major   code-smell        Refactor this function to reduce its cognitive complexity from 21 to 15.  typescript:function-complexity
src/http/routes.ts:41:3        major   security-hotspot  Review this dynamically built SQL query.                                    typescript:dynamic-sql-review
src/billing/invoice.ts:132:9   minor   code-smell        Remove this commented-out code.                                             typescript:commented-out-code
…
6 issues (new code) · effort 35min
```

`--facets` prints the counts of the UI's side panel, each computed with the other filters applied (`facetCounts()`):

```text
$ qualis issues --facets --new
 Type        code-smell 5 · security-hotspot 1
 Severity    major 2 · minor 4
 Rule        typescript:commented-out-code 2 · typescript:function-complexity 1 · …
 Directory   src/billing 4 · src/http 2
```

`qualis issues <id>` is the issue panel of the file view: message, location with a few lines of code (from disk if unchanged), secondary locations, effort, tags, fingerprint, whether it is new, the rule summary, and `→ qualis explain <rule>`.

`--format github|azure` prints `::warning file=…,line=…,col=…,endLine=…,title=…::message` / `##vso[task.logissue …]`. GitHub shows at most 10 warning and 10 error annotations per step, so the docs recommend them for new-code issues (`--new`) and SARIF for full lists.

Exit: 0; 1 with `--fail-on <severity>` when a matching issue has at least that severity. Data: report.

#### `qualis rules` (extended)

With an analysis present, it lists **the rules that ran in that analysis** (`report.rules`, effective severity, parameters, issue counts), as the UI's Rules tab does; `--configured` keeps today's behaviour (what would run now), which is also the default without an analysis.

```text
$ qualis rules --with-issues --type code-smell
 ON  typescript:function-complexity   code-smell  major  Functions should not be too complex                 14 issues
 ON  typescript:commented-out-code    code-smell  minor  Commented-out code should be removed                 51 issues
 …
 127 rules ran in this analysis · 18 with issues · `qualis rules --configured` for the configuration now
```

Options: `--plugin`, `--type`, `--search`, `--with-issues`, `--configured`, `--json`.
Exit: 0. Data: report, or plugin manifests.

#### `qualis explain <rule | topic>`

The rule page, or a documentation topic, in the terminal.

```text
$ qualis explain no-cond-assign
 typescript:no-cond-assign · Conditions should not contain assignments
 bug · major · 5min · TypeScript, JavaScript · enabled by default · 1 issue in this analysis

 What it detects
   An assignment (`=`) used as the condition of `if`, `while`, `do … while`, `for` or the ternary operator.

 Why it matters
   …

 Noncompliant                         Compliant
   if (order.items.length = 0) {        if (order.items.length === 0) {

 References
   CWE-481 Assigning instead of Comparing — https://cwe.mitre.org/data/definitions/481.html

 → qualis issues --rule typescript:no-cond-assign
```

Resolution: a full id, or a key matched against every rule (`no-eval` → `typescript:no-eval`; several matches are listed). Rules come from `report.rules` (effective severity and parameters) or, without an analysis, from the installed plugins' manifests, so `explain` works before the first analysis. Topics are the documentation pages (`quality-gate`, `ratings`, `new-code`, `coverage-and-tests`, `duplications`, `metrics`, …) and metric names (`cognitiveComplexity` → its section). Every `?` link of the UI has an `explain` equivalent, and the CLI's hints print them.

Options: `--json` (the `ActiveRule`/`RuleDefinition`).
Exit: 0, 2 unknown rule or topic. Data: report, plugin manifests, packaged docs.

#### `qualis docs [topic] [--search <words>]`

The `/docs` section: without arguments, the table of contents; with a topic, the page rendered for the terminal (headings, tables re-flowed to the width, code blocks, links); `--search` uses the same index and ranking as the UI (`searchDocs()`).

**The CLI ships the whole documentation.** The Markdown of `docs/content` goes into the `qualis` package (a few hundred KB) and is rendered with `marked`, which the docs build already uses; rule documentation comes from the plugin manifests, as today. Reasons: there is no public documentation address yet; the installed documentation always matches the installed version, which a website cannot guarantee for a pinned devDependency; and it works offline and in CI. When a public site exists, a footer line can point to it, but nothing depends on it.

### 8.4 Code, coverage, duplications, tests, functions

#### `qualis files [path-prefix]`

The Code tab: directories with aggregates, collapsed single-child chains (`treeRows()`), or a flat list.

```text
$ qualis files src --sort coverage
 Name                 Files   LOC   Coverage   Cmplx  Cogn  Min MI  Issues   Debt
 src/billing             14  6 210    64.2 %     812   604      18      41   9h 20min
 src/http                 9  2 940    71.9 %     301   188      27      12   2h 05min
 src/orders/service.ts    1     96    71.4 %      18    11      41       2   15min
 …
```

Options: `--flat`, `--sort name|ncloc|coverage|complexity|cognitive|mi|issues|debt|duplications`, `--reverse`, `--filter <text>`, `--uncovered` (files not in any coverage report), `--limit`, `--format`.
Exit: 0. Data: report (`files`).

#### `qualis file <path>`

The file view.

```text
$ qualis file src/orders/service.ts --source --lines 12-16
 src/orders/service.ts · typescript · 120 lines · 96 LOC · coverage 71.4 % · 2 issues · MI 41
 Unchanged since the analysis (sha256 matches)

   12 ✓ + │ export class OrderService {
   13 ✓ + │   place(order: Order) {
   14 ✗ + │     if (order.items.length = 0) {
          │     ▲ major bug  Conditions should not contain assignments  typescript:no-cond-assign  4f1c2a9e
   15 ◐ + │       return null;                                              1 of 2 branches
   16    + │     }
 Gutter: ✓ covered · ✗ not covered · ◐ partly covered · + new line · ┃ duplicated block
```

Without `--source`: measures, functions table (complexity, cognitive, nesting, parameters, MI), issues by line, uncovered line ranges, duplication blocks with their other occurrences. `--issue <id>` jumps to an issue (the UI's `issue=`), `--around <line>` shows context. The code comes from `source` embedded in the report or from disk with the `sha256` check; a changed file is shown with a warning, a missing one falls back to issues and coverage by line, as the UI's three states.

Exit: 0, 2 file not in the analysis. Data: report, project folder.

#### `qualis coverage`

What the coverage condition needs: uncovered and partly covered lines, as ranges, worst files first.

```text
$ qualis coverage --new
 New code coverage 62.4 % (257 of 412 lines) · gate requires 80 %: cover 73 more lines
   src/billing/invoice.ts    41 uncovered  88-97, 102, 110-131
   src/billing/tax.ts        19 uncovered  140-158 · partly: 162 (1 of 2)
   …
```

Options: `--new`, `--file <glob>`, `--min <pct>`, `--not-in-reports`, `--format`. Data: report (`files[].coverage`, `newLines`, `measures`).

#### `qualis duplications`

Duplication groups, largest first, with every occurrence (`path:start-end`); `--new` only blocks with new lines; `--file`. Data: report (`duplications`, `newLines`).

#### `qualis tests`

The Tests card and the suites behind it: totals, failing and erroring cases with their messages, skipped, the slowest cases.

```text
$ qualis tests --slowest 3
 1 204 tests · 1 200 passed · 4 skipped · 41.2 s · from reports/junit.xml, TestResults/unit.trx
 Slowest
   6.8 s  InvoiceTests.compute_large_order        reports/junit.xml
   …
```

Options: `--failed`, `--skipped`, `--slowest <n>`, `--suite <name>`, `--format`. Data: report (`tests`, `measures.overall.tests`).

#### `qualis functions`

Every function with its metrics, beyond the ten hotspots kept in the report: `--sort complexity|cognitive|mi|ncloc|parameters|nesting`, `--min <value>`, `--file`. Data: report (`files[].functions`).

### 8.5 Over time

#### `qualis history`

The analysis switcher and the Activity card, for the branch scope of [4.3](#43-which-branches).

```text
$ qualis history
 Shop · feat/invoices · 6 analyses
   Analysis  Finished (UTC)  Commit   Gate  Issues     Coverage     Debt         LOC
   9b2e0c3a  5 Nov 10:33     3e5c2a1  ✗     225  ▼ 6   81.0  ▲ 0.4  506h 12min  48 210
   e1d4a7f0  4 Nov 17:02     d93b0e8  ✓     231  ▲ 2   80.6  ▼ 0.1  512h        48 120
   …
```

With `--all-branches` or several `--branch`, a branch column is added and deltas are computed against the previous analysis **of the same branch**.

Options: `--all-branches`, `--branch-age`, `--branch`, `--limit`, `--since <date>`, `--chart [--metric <m>]` ([6.4](#64-history-chart)), `--format text|json|jsonl|csv|markdown`.
Exit: 0. Data: report + history (`summarize()`), git for the branch list.

#### `qualis diff [A] [B]`

Compare two analyses: the UI's "▲/▼ since the previous analysis", extended to a full comparison. Not in the UI yet; both would use `compareReports()` from report-kit.

```text
$ qualis diff previous latest
 e1d4a7f0 (4 Nov 17:02, d93b0e8) → 9b2e0c3a (5 Nov 10:33, 3e5c2a1) · same branch feat/invoices
   Gate         ✓ passed → ✗ failed   new: coverage on new code 62.4 % < 80
   Ratings      unchanged
   Coverage     80.6 % → 81.0 %  ▲ 0.4      new code 85.0 % → 62.4 %  ▼ 22.6
   Issues       231 → 225       ▼ 6        9 fixed · 3 introduced
   Debt         512h → 506h 12min
   Files        2 added · 0 removed · 11 changed
 Introduced
   src/billing/invoice.ts:88:5   major  typescript:function-complexity  Refactor this function …
 Fixed
   src/orders/service.ts:52:7    major  typescript:no-floating-promises Handle the promise …
```

- Arguments: two analysis refs (default `previous latest` within the branch scope), `main..feat/invoices` (the latest analyses of two branches), or two report files (CI artifacts, no git needed).
- Issues are matched by their stable `id`, files by path and `sha256`.
- Printed caveats: different rule sets or plugin versions, different gate definitions or rating settings, different branches. A file moved to another path appears as fixed + introduced (the fingerprint includes the path).

Options: `--issues introduced|fixed|all|none`, `--fail-on-new [severity]`, `--format text|json|markdown|github|azure`.
Exit: 0; 1 with `--fail-on-new` when issues were introduced (at least that severity). Data: two reports.

#### `qualis freshness`

[Section 5](#5-deep-dive-is-the-analysis-behind-its-branch) on its own, with the commit list:

```text
$ qualis freshness
 ⚠ Behind: feat/invoices has 3 newer commits, 2 touch this project
   analysed  3e5c2a1  5 Nov 10:33 UTC
   tip       7c41d9e  5 Nov 12:40 UTC
   7c41d9e  5 Nov 12:40  Round invoice totals          (touches the project)
   5a0c3e9  5 Nov 11:47  Update README                 (elsewhere)
   b8d21f4  5 Nov 11:02  Add tax table cache           (touches the project)
```

Options: `-a`, `--all-branches`, `--branch-age`, `--branch`, `--whole-repo`, `--upstream`, `--head`, `--check`, `--max-behind <n>`, `--max-age <duration>`, `--json`.
Exit: 0; with `--check` 1 when not current (or beyond the limits), including `unknown`. Data: report, git.

### 8.6 Several projects

#### `qualis solution [dir]`

The solution page: members from `.qualis/solution.json` ([7.5](#75-what-a-solution-analysis-writes)), combined metrics with the same rules (`aggregateSolution()`): sums, size-weighted coverage, duplications and debt ratio, worst-of ratings with the projects that have them, the members' gates counted ("2 of 5 failing" with names), lowest coverage, lines of code by member, combined issues trend.

```text
$ qualis solution
 Shop suite · 4 projects · 1 of 4 quality gates failing: @shop/api
   Reliability C (worst of 4: @shop/api) · Security C (@shop/api) · Maintainability A
   Coverage 77.9 % (weighted) · lowest: Shop.Worker 52.1 % · Duplications 1.2 % · Debt 812h (2.4 %)
   Issues 640  ▂▃▃▄▄▅▆▆  trend since 29 Oct
   Project        Gate  Rel Sec Mnt  Coverage  Issues  Analysed   Freshness
   @shop/core     ✓     A   A   A     88.0 %       41  2 h ago    current
   @shop/api      ✗     C   C   A     72.4 %      310  2 h ago    ⚠ 2 behind
   …
```

Without `solution.json` the command lists the projects found below `dir` (the UI's discovery) and suggests `qualis init` to define the solution. Options: `--branch`, `--all-branches` (per member), `--format`. Data: members' reports and histories, git.

#### `qualis projects [root]`

The UI's Projects page: every project and solution below a folder (e.g. `~/workspace`), with gate, ratings, coverage, issues, age and freshness.

```text
$ qualis projects ~/workspace
 12 projects in 3 solutions and 5 standalone · 3 failing quality gate · latest analysis 2 h ago
   Project               Gate  Rel Sec Mnt  Coverage  Dup    Issues  Analysed       Freshness
   Shop suite (4)        ✗     C   C   A     77.9 %   1.2 %     640  2 h ago        ⚠ 1 behind
   legacy-billing        –                                           never analysed
   …
```

Options: `--depth <n>` (default 4), `--failing`, `--stale`, `--sort`, `--format`. Data: each project's files, git.

Favorites have no CLI equivalent: they are a per-browser bookmark of the UI.

### 8.7 Summary

| Command | Mirrors | Exit 1 when | New |
|---|---|---|---|
| `analyze` | — | Gate failed (any member for a solution) | Multi-project question, `--as`, `--print`, `--json` |
| `init` | — | — | Multi-project question |
| `validate` | Read analysis (validation) | Invalid | Config, solution, folders |
| `status` | Header, staleness strip | `--check`: gate failed or stale | ✓ |
| `show` | Overview | — | ✓ |
| `gate` | Gate card | Gate failed | ✓ |
| `issues` | Issues tab, issue panel | `--fail-on` matched | ✓ |
| `rules` | Rules tab | — | Report as source |
| `explain` | Rule page, `?` links | — | ✓ |
| `docs` | `/docs` | — | ✓ |
| `files` | Code tab | — | ✓ |
| `file` | File view | — | ✓ |
| `coverage` | Coverage card, gutter | — | ✓ |
| `duplications` | Duplications card, blocks | — | ✓ |
| `tests` | Tests card | — | ✓ |
| `functions` | Hotspots, function tables | — | ✓ |
| `history` | Analysis switcher, Activity | — | ✓ |
| `diff` | Deltas (Compare, future) | `--fail-on-new` | ✓ |
| `freshness` | Amber chip | `--check`: stale | ✓ |
| `solution` | Solution page | — | ✓ |
| `projects` | Projects page | — | ✓ |

## 9. UI to CLI map

| UI | What it shows | CLI |
|---|---|---|
| Projects page: tiles and cards | Every project's gate, ratings, coverage, issues, age; staleness chip | `qualis projects <root>` |
| Favorites filter | Bookmarked projects (browser storage) | None (per-browser state) |
| Import project, folder browser | Registering folders | Not needed: commands take a folder |
| Import as solution | Grouping projects | `qualis analyze`/`init` question → `solution` in the config and `.qualis/solution.json` |
| Read analysis | Validating and storing a report | `--report <file>` on every read command; `qualis validate` |
| Project menu: remove, link folder, move to solution | Registry management | None (the CLI has no registry) |
| Project header: folder, branch, commit, analysis switcher | Which analysis is shown | `qualis status`, `-a/--analysis`, `--branch`, `qualis history` |
| Staleness chip and strip | Analysis behind its branch | `qualis status`, `qualis freshness` |
| Overview scope New code / Overall | Scope switch | `qualis show --scope` |
| Gate card | Conditions, actual values | `qualis gate`, `show --section gate` |
| Tiles: debt, new lines, lines of code (with deltas) | Headline numbers | `qualis show` |
| Ratings card, links to filtered issues | Ratings with counts | `qualis show`; hints `qualis issues --type … --new` |
| Coverage card (bars, gate tick) | Line, branch, combined coverage | `qualis show`, `qualis coverage` |
| Duplications card | Density, blocks | `qualis show`, `qualis duplications` |
| Technical debt card (band meter) | Debt, ratio, band | `qualis show` |
| Tests card | Totals, result bar | `qualis show`, `qualis tests` |
| Issues by type / by severity | Counts | `qualis show`, `qualis issues --facets` |
| Size and complexity, distributions | Size, complexity and MI bands | `qualis show --section size` |
| Hotspots (tabs complexity/cognitive/MI) | Top functions | `qualis show --hotspots …`, `qualis functions` |
| Activity (issues/coverage/debt/LOC), deltas | Trend over the history | `qualis show --activity …`, `qualis history --chart` |
| Analysis card (id, LOC by language, plugins, diagnostics) | Analysis details | `qualis show --section analysis` |
| Code tab (tree, sort, filter, view) | Files and folders with aggregates | `qualis files` |
| File view (code, gutter, issues, duplications, functions, issue panel, previous/next) | One file | `qualis file <path> [--source] [--issue]`, `qualis issues <id>` |
| Issues tab (facets, search, sort, new code) | Filtered issues | `qualis issues` |
| Rules tab (plugin, type, search, with issues) | Rules of the analysis | `qualis rules` |
| Rule page | Rule documentation and its issues | `qualis explain <rule>`, `qualis issues --rule` |
| Solution page | Combined metrics | `qualis solution` |
| Docs, search, `?` links | Documentation | `qualis docs`, `qualis explain <topic>` |
| (future) Compare | Two analyses | `qualis diff` |

Everything the UI shows has a command; what has no command is UI state (registry, uploads, favorites), not information about the code.

## 10. Report format: changes and guarantees for other UIs

### 10.1 Additive changes (schema 1.1.0)

All optional, so 1.0.0 readers keep working and 1.0.0 reports stay valid.

| Field | Content | Why |
|---|---|---|
| `analysis.vcs.branch` (behaviour) | On a detached HEAD, the branch from the CI variables: `GITHUB_HEAD_REF` or `GITHUB_REF_NAME` (GitHub), `SYSTEM_PULLREQUEST_SOURCEBRANCH` or `BUILD_SOURCEBRANCH` without `refs/heads/` (Azure DevOps; `BUILD_SOURCEBRANCHNAME` is only the last segment), `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` or `CI_COMMIT_REF_NAME` (GitLab) | Branch-scoped history and freshness work for CI analyses. |
| `analysis.vcs.committedAt` | Committer date of the analysed commit | "Analysed code from 3 Nov" without git; history ordering by commit. |
| `analysis.vcs.untracked` | Untracked files were analysed (they are not in the commit; `dirty` ignores them) | Honest freshness and status. |
| `analysis.vcs.path` | Project folder relative to the repository root (`""` at the root) | Solutions in monorepos; matching a report to a folder in another clone. |
| `analysis.ci` | `{ provider, buildId?, buildUrl?, pullRequest?: { id, sourceBranch, targetBranch } }` | Link to the build; PR analyses labelled in the history. |
| `analysis.settings` | `{ developmentCostMinutesPerLine, maintainabilityThresholds, newCodeReference (as configured), duplication: { minTokens, minLines } }` | Ratings and debt bands drawn with the real thresholds; `diff` warns when they changed. |
| `analysis.configSha256` | Hash of the effective configuration | `status` can say "the configuration changed since the analysis". |
| `issues[].firstSeen` | `{ analysisId, at }`, if [Q1](#122-open-questions) is confirmed | Issue age. |

Writer changes in `@qualis/core` (no schema impact): atomic writes (temporary file + rename) for every file in `.qualis/`; **retention per branch**: `output.history` (default 20) becomes the number of analyses kept per branch (`analysis.vcs.branch`; analyses without a branch form one group), and the analyses of branches deleted locally or without commits for more than 30 days (`output.historyBranchDays`) are removed. The newest analysis of the folder (`report.json`) is never pruned.

Configuration schema: `layout` and `solution` ([7.3](#73-the-question-interactive-terminal)), `extends` ([7.5](#75-what-a-solution-analysis-writes)), `output.historyBranchDays`.

New schemas: `solution.schema.json` ([7.5](#75-what-a-solution-analysis-writes)); one per CLI JSON output (`cli/<command>.schema.json`); the shared types (`AnalysisSummary`, `Freshness`, `ReportComparison`, `SolutionMetrics`) in `common.schema.json`.

### 10.2 What the open format must guarantee

So that a third-party UI can do everything the Qualis UI and the CLI do, the documentation must state, as part of the contract:

1. **Folder layout.** `<output.dir>/report.json` is the newest analysis. With history enabled, `<output.dir>/history/<YYYYMMDDTHHMMSSmmmZ>.json` holds one complete report per analysis, **the newest included**; pruning follows the documented retention. Readers merge both and deduplicate by `analysis.id`. The output folder is `.qualis` unless `output.dir` in `qualis.config.json` says otherwise.
2. **Solutions.** A folder whose `.qualis/solution.json` exists is a solution; its members are the listed paths, each a project with its own `.qualis/`. Combined metrics follow the documented formulas.
3. **Atomicity.** A file is never observed half-written.
4. **Immutability.** A history file is never modified after it is written.
5. **Ordering and identity.** Analyses are ordered by `analysis.finishedAt`; `analysis.id` is unique; `analysis.vcs.branch` is the branch scope key.
6. **Issue fingerprints.** `issues[].id` is stable across line shifts, and the algorithm only changes in a major schema version, so comparisons across Qualis versions hold.
7. **`sha256` semantics** (UTF-8, no BOM), already documented, to detect changed files.
8. **Evolution.** Fields are added in minor versions and never removed or changed; readers must ignore unknown fields.
9. **Normative computations,** documented with formulas so they can be reproduced: ratings and thresholds (recorded in `analysis.settings`), solution aggregation, freshness ([5.4](#54-algorithm)), branch scope ([4.3](#43-which-branches)), delta conventions ("lower is better" per metric).
10. **The CLI as an API.** A UI in any language can call `qualis … --json` instead of re-implementing a computation; those outputs have schemas and the same evolution rule.

## 11. Roadmap

Ordered by value for the user's goal, each item usable on its own.

### Small

| # | Item | Notes |
|---|---|---|
| S1 | Create `@qualis/report-kit` with freshness moved from `apps/ui/lib/staleness.ts` and extended (reasons, `first`, both counts, `head`, `upstream`); `describeFreshness()`; the UI switches its import | Do it while the UI work is fresh, so the chip and strip use the shared function from the start. |
| S2 | Read-command context: project lookup, analysis selection, branch scope (`--all-branches`, `--branch`), `--report`, JSON envelope, exit codes, colour/width/ASCII rules | Foundation for every command. |
| S3 | `qualis status` (also `--all-branches`) and `qualis freshness` | First visible result: the user's example 1. |
| S4 | `qualis gate` (exit 1 on failure) and `qualis issues` with filters, facets, `--fail-on`, `github`/`azure`/`jsonl` | Moves `derive.ts` into report-kit. |
| S5 | `qualis explain <rule>` and `qualis rules` from the report | Rules are already in the report and manifests. |
| S6 | Fixes: CI branch on detached HEAD, atomic writes, docs on history containing the newest analysis, one debt format | Each a few lines. |

### Medium

| # | Item | Notes |
|---|---|---|
| M1 | Terminal widgets and `qualis show` (sections, scopes, compact, markdown); `analyze` prints the compact view | User's example 2. Golden tests at three widths. |
| M2 | `qualis history` (+ `--chart`, branch scope, per-branch deltas) and `qualis diff` with `compareReports()`; retention per branch | The UI can add Compare and the branch filter on the same functions. |
| M3 | Multi-project detection, the question in `analyze`/`init`, `--as`, `layout`/`solution` config, `.qualis/solution.json`, solution analysis | Replaces the UI-only grouping for analysed folders. |
| M4 | `files`, `file` (with `--source`), `coverage`, `duplications`, `tests`, `functions` | Moves `treeRows`/`aggregate` and `source.ts`. |
| M5 | `qualis solution` and `qualis projects`; the UI imports `solution.json` | Discovery and aggregation moved to report-kit. |
| M6 | Report schema 1.1.0: `committedAt`, `untracked`, `path`, `ci`, `settings`, `configSha256`; the UI uses `settings` for its bands | |

### Large

| # | Item | Notes |
|---|---|---|
| L1 | `qualis docs` and `explain <topic>`: Markdown packaged in the CLI, terminal renderer, search | |
| L2 | JSON Schemas for every CLI output, a docs page per command, the CLI/UI contract test | What makes the CLI a dependable API for other UIs. |
| L3 | `issues[].firstSeen` if adopted; `--watch`; a history index if histories grow to hundreds of analyses | Each optional. |

## 12. Decisions and open questions

### 12.1 Decisions (2026-11-06)

| Topic | Decision |
|---|---|
| Git tags on a passing gate | Dropped. No `tag` command, no tag configuration, nothing about tags in the report. |
| Project vs solution | The folder where the analysis runs is the project. When it contains several projects that a heuristic can detect, Qualis asks the user what to do and saves the answer; without a terminal it fails with the option to set ([section 7](#7-deep-dive-one-folder-several-projects)). |
| Shared code | A separate package, `@qualis/report-kit` ([section 3](#3-one-implementation-for-the-cli-and-the-ui-qualisreport-kit)). |
| Public address | None yet: JSON outputs carry a schema name and version (`qualis-cli/issues@1`); `$id` URLs come later. |
| Documentation in the terminal | The CLI ships the whole documentation as Markdown ([8.3](#qualis-docs-topic---search-words)). |
| Freshness and the remote | Local branch by default; `--upstream` compares with the remote-tracking ref as last fetched; never any network, no `--fetch` ([5.2](#52-what-the-shared-version-adds)). |
| Branches | Default: the branch checked out now. `--all-branches`: local branches with commits in the last 30 days. `--branch <name>`: a specific branch, however old ([4.3](#43-which-branches)). |
| Installations | Two products: the Qualis CLI (analysis, files, terminal) and the Qualis UI (viewing). The CLI never starts or opens a UI. |
| .NET projects | The number of projects is the number of `.csproj`; a `.sln` does not group them ([7.2](#72-detection-heuristic)). |
| History retention | Per branch: `output.history` analyses per branch; branches deleted or inactive for more than 30 days are pruned ([10.1](#101-additive-changes-schema-110)). |
| Package names | `@qualis/report-kit` for the shared library; `qualis` stays the CLI's npm name. |

### 12.2 Open questions

1. **Issue age (`firstSeen`).** Recommended, at low priority: record on each issue when it was first seen, carried over from the previous analysis of the same branch by fingerprint (for a branch's first analysis, from the latest analysis of its new-code reference branch, if in the history). It costs one extra report read per analysis (about 10 ms) and gives issue age, "introduced since the last analysis" as distinct from "on new code", and survives history pruning. Limitation: moving a file resets the age, because the fingerprint includes the path. To be confirmed.
2. **Solution members' configuration.** Proposed in [7.5](#75-what-a-solution-analysis-writes): the root's configuration overridden by the member's (rules merged per id, quality gate replaced as a whole, arrays replaced, `"extends": false` to opt out). To be confirmed.
