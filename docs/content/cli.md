---
title: Command line
description: Commands and options of the qualis CLI.
---
Run `qualis --help` for a summary of the commands and `qualis --version` for the installed version. [Usage](usage.html) shows the commands at work on a project.

## qualis analyze

```bash
qualis analyze [dir] [options]
```

Analyzes the project in `dir` (default: the current directory), writes the reports and evaluates the quality gate.

The results always go to the project's `.qualis/` folder (or `--output`): `report.json` is the latest analysis and `history/` keeps a timestamped copy of each recent analysis, the latest included. This folder is what the [web UI](web-ui.html) imports. Add `.qualis/` to the project's `.gitignore`.

| Option | Meaning |
|---|---|
| `-c, --config <file>` | Configuration file (default: `qualis.config.json` in `dir`). |
| `-o, --output <dir>` | Output directory (default: `output.dir`, `.qualis`). |
| `-f, --format <list>` | Comma-separated formats: `json`, `sarif`. |
| `--new-code <ref>` | Git reference new code is compared with. |
| `--no-new-code` | Disable new-code detection. |
| `--coverage <glob>` | Coverage report (LCOV, Cobertura or OpenCover). Repeatable. |
| `--tests <glob>` | Test report (JUnit XML or TRX). Repeatable. |
| `--external <glob>` | Report of another linter or analyzer to import (SARIF 2.1.0 or ESLint JSON). Repeatable. |
| `--include-sources` | Embed file contents in the report (only needed for viewers without access to the project folder). |
| `--history <n>` | Analyses kept in `<output>/history`, the latest included (default: `output.history`, 20); `0` disables the history. |
| `--issues` | Print every issue, one per line, before the summary. |
| `--no-fail` | Exit with 0 even when the gate fails. |
| `--strict-plugins` | Validate the results of in-process plugins against the schema (process plugins are always validated). |
| `-q, --quiet` | Print nothing but errors. |
| `-v, --verbose` | Print plugin logs and warnings. |

Examples:

```bash
qualis analyze                                   # the current folder
qualis analyze ~/projects/my-app --issues        # another folder, every issue printed
qualis analyze --format json,sarif               # also write .qualis/report.sarif
qualis analyze --coverage "**/coverage.opencover.xml" --tests "**/*.trx"
qualis analyze --new-code origin/main            # new code since the merge base with origin/main
qualis analyze --no-fail --quiet                 # write the report, never fail the build
```

## qualis rules

```bash
qualis rules [dir] [--json] [--config <file>]
```

Lists the rules of the configured plugins with their type, effective severity and whether they are enabled. `--json` prints the full rule definitions, references included.

## qualis init

```bash
qualis init [dir]
```

Writes a `qualis.config.json` with the default quality gate and common report locations. It does not overwrite an existing file.

## qualis validate

```bash
qualis validate .qualis/report.json
```

Checks a report against the published schema. Useful when you write your own tooling on top of the report.

## Exit codes

`0` the gate passed (or `--no-fail`), `1` the gate failed, `2` an error occurred.
