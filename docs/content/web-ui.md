---
title: Use Qualis UI
description: Connect a repository analyzed with the qualis command, browse its results, group projects in solutions and keep favorites.
---
Qualis UI shows the results of the `qualis` command: projects, quality gates, issues, code, rules and history. It reads the same [report format](report-format.html) that any other tool can read. To install it, see [Install Qualis UI](ui-install.html).

## Connect a repository

**Step 1.** Analyze the repository with the [CLI](usage.html). It writes `.qualis/report.json`, and keeps the previous analyses in `.qualis/history/`:

```bash
cd ~/projects/my-app
qualis analyze
```

**Step 2.** Open Qualis UI (http://localhost:3000, see [Install Qualis UI](ui-install.html)), choose **Import project** and pick the repository folder in the folder browser. With Docker, the folders you mounted are under `/workspace`.

**Step 3.** That's it: the UI reads `.qualis/` on every visit, so each new `qualis analyze` appears by itself, with the history of the previous ones. The UI never writes into the folder.

When the UI can't see the folder, for example when the analysis runs in CI, publish `.qualis/report.json` as a build artifact and choose **Read analysis** to upload it instead.

## Import project or Read analysis

| | What you do | What the UI does |
|---|---|---|
| **Import project** | Choose a project folder in the folder browser. | Reads `.qualis/report.json` and `.qualis/history/*.json` on every visit, so each new `qualis analyze` appears by itself. Shows the code from the folder. |
| **Read analysis** | Drop or choose a `report.json`. | Validates it against the report schema and stores it in its data folder, in a new project or in the one with the same `project.key`. |

A project can have both: a folder and uploaded analyses. Its history is the union of the two, without duplicates (by analysis id), newest first. An uploaded project can be linked to its folder later (Import project on that folder, or **Project → Link a project folder…**).

**Project → Remove from Qualis** forgets a project and deletes only the copies of uploaded analyses that the UI stored; the project folder and its `.qualis` files are never modified.

## Solutions

A solution groups related projects, for example the services and apps of one product. A project belongs to at most one solution.

- **Import project on a folder that contains several projects.** The dialog lists the project folders below it, with a `.qualis` folder, up to 4 levels down. Hidden folders (such as `.git`) and `node_modules`, `bin`, `obj`, `dist`, `build`, `target` and `vendor` are skipped, and the browse root itself is never offered. Pick the projects, edit the name (the folder name by default) and choose **Import as solution**. When the folder is a project too, **Import only this project** imports it alone.
- **New solution** on the Projects page groups projects that are already imported. **Project → Move to solution…** and **Project → Remove from <solution>** change a project's solution later.
- **Solution → Look for new projects** searches the solution's folder again and imports project folders that appeared there. **Solution → Remove solution** forgets the grouping only: its projects stay as standalone projects, and no folder or file is touched.

A solution card and the solution page show combined metrics of the latest analyses of its projects:

| Metric | How it is combined |
|---|---|
| Issues, lines of code, technical debt | Sums |
| Coverage | Weighted by lines to cover |
| Duplications | Weighted by lines |
| Debt ratio | Weighted by lines of code |
| Ratings | The worst among the projects ("worst of N projects") |
| Quality gate | A solution has none of its own: the page counts its projects' gates ("2 of 5 failing") and names the failing ones |
| Issues trend | The sum of each project's latest value at every analysis date, from the date every project has an analysis; not shown when a project has none |

Solutions are stored with the projects in `projects.json` of the data folder. Opening a project of a solution shows the path **Projects › Solution › Project**.

## Favorites

The bookmark on a project or solution (on its card and next to its title) marks it as a favorite, and **Favorites** on the Projects page shows only them:

- a favorite solution is shown as a whole, with its favorite projects marked inside it;
- a favorite project of a solution that is not a favorite is shown on its own, with an "in <solution>" link.

Favorites and the All / Favorites choice are saved **in the browser** (local storage): the UI has no user accounts, so every browser keeps its own. Where local storage is not available, favorites last until the page is reloaded.

## Analyses behind their branch

For a project imported from a folder that is a git repository, the UI compares the commit an analysis was made on (`analysis.vcs` in the report) with the same branch in the folder now. Only the commits that touch the project folder count, so the projects of a monorepo are not marked by each other's changes.

- On a project card, an amber **N commits behind** in the footer (or **Branch moved**, when the analysed commit is no longer on the branch after a rebase or reset), and **Up to date** when the branch has no newer commit in the folder. The tooltip names both commits.
- On a solution card, **N of M behind**, with the projects in the tooltip.
- In the project header, a thin strip under the details says how far behind the analysis shown is, when the newest commit was made, and copies the `qualis analyze` command for the folder.

Nothing is shown for uploaded analyses, analyses without a branch or commit (detached HEAD, no git), or a branch the folder does not have. Answers are kept for 10 seconds.

## The code view

Reports do not embed the sources by default. The file view reads the file from the project folder and compares it with the `sha256` recorded in the report:

- **unchanged**: the code is shown with issues, coverage and duplicated lines;
- **changed since the analysis**: the current file is shown with a warning, because lines may not line up;
- **not available**: the file is gone, or the project has no folder (uploaded only): issues and coverage are listed by line.

A report analysed with `--include-sources` (`output.includeSources`) carries the code itself and needs no folder.
## Documentation

**Docs** in the header opens this documentation inside the UI, with its own search: on the documentation pages the header search looks through the pages and the rules. The **?** next to the quality gate, the ratings, the coverage, the tests, the duplications, the technical debt and the metrics opens the page that explains them, and the **?** next to a rule's name opens the rule's page.

The published image already contains them.

