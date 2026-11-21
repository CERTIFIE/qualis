---
title: Usage
description: Analyze a project with the qualis command, read the results, add coverage and tests, and run it from a package script or the CI.
---
This page walks through a typical first use of the `qualis` command. Every option is listed in [Command line](cli.html).

## Analyze a project

Run `qualis analyze` in the project folder, or pass the folder:

```bash
cd ~/projects/my-app
qualis analyze
```

Qualis finds the languages by file extension (TypeScript, JavaScript and C# with the bundled plugins), skips the files ignored by git and analyzes the rest. No configuration is needed for the first run.

## Read the summary

The command prints the quality gate first, then the ratings, the coverage, the duplications and the complexity:

```text title="Terminal"
my-app  1 files, 12 lines of code, 813 ms

Quality gate "Qualis default": PASSED
  – reliabilityRating (new code) = no data  fails when > A
  – coverage (new code) = no data  fails when < 80
  ✓ blockerIssues (overall) = 0  fails when > 0

Overall code
  Security        D  1 vulnerabilities
  Reliability     C  1 bugs
  Maintainability A  0 code smells, debt 0min (0%)
  Coverage        –  no coverage report
  Duplications     0.0%  0 blocks, 0 lines

Complexity
  Cyclomatic      5 total, 2.5 avg/function, max 4
  Cognitive       7 total, 3.5 avg/function, max 7
  Most complex functions:
      4  total  src/app.ts:1

Report: .qualis/report.json
Report: .qualis/history/20261105T204734603Z.json
```

- A gate condition shows **✓** when it passed, **✗** when it failed and **–** when there is no data. Conditions on new code have no data on the default branch, where nothing is new, or without git; see [New code](new-code.html).
- The ratings go from A (best) to E. [Ratings and technical debt](ratings.html) explains how they are computed.
- The exit code tells scripts the outcome: `0` the gate passed, `1` it failed, `2` the analysis could not run.

## See the issues

Add `--issues` to print every issue, one per line, with its position, severity, message and rule:

```bash
qualis analyze --issues
```

```text title="Terminal"
src/app.ts:11:18  critical Do not hard-code the value of "password"; load it from the environment or a secret store.  typescript:no-hardcoded-credentials
src/app.ts:12:32  major    Await this promise or handle its rejection with .catch().  typescript:no-floating-promises
```

Each rule is documented, with the official source it derives from, in [Rules](rules/index.html). To list the rules active for your project, run `qualis rules`. To silence an issue in place, or turn a rule off, see [Configuration](configuration.html).

## Where the results go

Every analysis writes into the project's `.qualis/` folder:

| File | Content |
|---|---|
| `.qualis/report.json` | The latest analysis, in the [report format](report-format.html). |
| `.qualis/history/<timestamp>.json` | One copy of each recent analysis, the latest included; the newest 20 are kept (`--history`). |
| `.qualis/report.sarif` | SARIF 2.1.0, when `sarif` is among the formats (`--format json,sarif`). |

Add `.qualis/` to the project's `.gitignore`. To browse the results, import the project folder in the [web UI](web-ui.html): it reads `.qualis/` on every visit, so each new analysis appears by itself.

## Create a configuration

The defaults work for most projects. To change the quality gate, the files analyzed or the rules, create a configuration file:

```bash
qualis init
```

It writes `qualis.config.json` with the default quality gate and the usual locations of coverage and test reports, and never overwrites an existing file. Every setting is described in [Configuration](configuration.html).

## Add coverage and test results

Qualis does not run your tests: it reads the reports your test runner writes. Run the tests with coverage first, then analyze:

```bash tab=Node.js
npx vitest run --coverage --coverage.reporter=lcov --reporter=junit --outputFile=reports/junit.xml
qualis analyze --coverage coverage/lcov.info --tests reports/junit.xml
```

```bash tab=.NET
dotnet test --logger trx --collect "XPlat Code Coverage;Format=opencover"
qualis analyze --coverage "**/coverage.opencover.xml" --tests "**/*.trx"
```

Coverage reports may be LCOV, Cobertura or OpenCover; test reports JUnit XML or TRX. `--coverage` and `--tests` are repeatable and accept glob patterns; put them in `qualis.config.json` to avoid repeating them. Source files missing from the coverage report count as uncovered: see [Coverage and tests](coverage-and-tests.html).

## Compare with a branch

On a feature branch, Qualis compares the code with the branch it started from and applies the new-code conditions of the gate to the changed lines only. The reference is detected automatically; pass it when the detection is not what you want:

```bash
qualis analyze --new-code origin/main
```

## Run it from a package script

In a project that has Qualis as a development dependency, add a script and run it like any other:

```json title="package.json"
{
  "scripts": {
    "analyze": "qualis analyze"
  }
}
```

```bash
pnpm analyze
```

Options are appended to the script: `pnpm analyze --issues`, or with npm `npm run analyze -- --issues`.

## Run it in the CI

The exit code stops the pipeline when the gate fails. Write SARIF to show the issues in GitHub or Azure DevOps code scanning:

```bash
qualis analyze --format json,sarif
```

[CI integration](ci.html) has complete pipelines for GitHub Actions and Azure DevOps.
