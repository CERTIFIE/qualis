---
title: Coverage and tests
description: Import code coverage (LCOV, Cobertura) and test results (JUnit XML, TRX).
---
Qualis does not run your tests: it reads the reports your test runner already produces. Configure them with `coverage.reports` and `tests.reports` (glob patterns) or with `--coverage` and `--tests`.

## Coverage

| Format | Produced by |
|---|---|
| LCOV (`lcov.info`) | Vitest, Jest, c8, nyc, Istanbul, many others |
| Cobertura XML | coverlet / `dotnet test --collect "XPlat Code Coverage"`, Python coverage.py, many others |
| OpenCover XML | coverlet with `Format=opencover`, OpenCover, AltCover |

The format is detected from the content. Paths in the report are matched with the analyzed files relative to the project root, to the report folder or to the `<source>` roots of a Cobertura file; reports produced in another folder or container are matched by a unique path suffix. Files of the report that do not match are counted in a warning.

| Measure | Definition |
|---|---|
| Lines to cover | Lines the report lists as executable (LCOV `DA` records, Cobertura lines, OpenCover sequence points). A line that only has branch records counts its conditions, not itself, as SonarQube does: Vitest's V8 coverage writes such records on JSX lines. |
| Line coverage | Covered lines ÷ lines to cover × 100. |
| Branch coverage | Covered conditions ÷ conditions to cover × 100 (from LCOV `BRDA` records, Cobertura `condition-coverage` or OpenCover branch points). |
| Coverage | (covered lines + covered conditions) ÷ (lines to cover + conditions to cover) × 100. |

### Files missing from the reports

Test runners usually report only the files the tests loaded: a page or module that no test imports does not appear at all, and ignoring it would overstate the coverage. By default (`coverage.missingFiles: "uncovered"`) Qualis therefore counts every analyzed source file that no report mentions as **not covered**. Its lines to cover are the lines a coverage tool would instrument when the language plugin provides them (`executableLines`), otherwise its lines of code. This applies only to the languages that appear in at least one report: a project with TypeScript coverage and no .NET coverage is not penalised for its C# files. In the report these files have `coverage.notInReports: true`.

> [!NOTE]
> The lines to cover of a missing file are an estimate. The C# plugin counts statements, the braces of method bodies, expression bodies and initializers, like coverlet; on a real project the result was within 6% of the lines coverlet instrumented, and interfaces count no lines. The TypeScript plugin uses the lines of code, which match V8-based coverage (Node.js, c8) closely and are higher than statement-based coverage (Istanbul). Configure your test runner to report all source files (for example Vitest's `coverage.include`, c8's `--all`) for exact values, or set `coverage.missingFiles` to `"ignore"` to leave such files out.

Test code ([`tests.sources`](configuration.html#test-code)) is never expected to be covered: it is left out of the reports and of the missing files. Other files are excluded with `coverage.exclude`; the default list holds `**/*.d.ts` and `**/*.config.{js,cjs,mjs,ts,cts,mts}`. Setting `coverage.exclude` replaces this list.

OpenCover reports count *sequence points* (statements) rather than lines: Qualis marks every line a sequence point spans with its visit count, and counts each branch point as one condition of its line. Generated files (for example the `obj/` output of source generators) are not part of the analysis, so they are left out of the totals; this is why the coverage can differ slightly from the summary written in the OpenCover file.

The report keeps, for every file, the covered, uncovered and partially covered lines, so viewers can colour the source.

## Tests

| Format | Produced by |
|---|---|
| JUnit XML | Vitest, Jest (jest-junit), Node.js (`--test-reporter=junit`), pytest, Maven Surefire, many others |
| TRX | `dotnet test --logger trx` |

Node's test runner writes top-level tests straight under `<testsuites>`, without a `<testsuite>`: Qualis groups them in one suite per test file (its `file` attribute, relative to the project).

The report contains the suites and every test case with its status (`passed`, `failed`, `error`, `skipped`), duration and failure message, plus the totals and the success density: passed tests ÷ executed tests × 100.
