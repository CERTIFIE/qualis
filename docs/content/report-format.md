---
title: Report format
description: The structure of report.json, published as a JSON Schema so that anyone can build a viewer.
---
`report.json` is the only interface between the analyzer and the tools that display its results. The analyzer writes it to the project's `.qualis/` folder, with a copy of each recent analysis in `.qualis/history/`. It is described by [report.schema.json](schemas/report.schema.json) (JSON Schema 2020-12) and versioned with `schemaVersion` (currently `1.0.0`): fields may be added in minor versions, never removed or changed. TypeScript types are exported by `@qualis/schema`, and `qualis validate` checks any file.

All paths are relative to the project root and use forward slashes. Lines and columns are 1-based, columns are UTF-16 code units and `endColumn` is exclusive, as in SARIF.

## Top level

| Field | Content |
|---|---|
| `schemaVersion` | Version of the report format. |
| `tool` | Qualis version and the plugins used (id, version, transport, languages). |
| `project` | `key` and `name`. |
| `analysis` | Id, start and end time, duration, git revision and branch, new-code reference and merge base. |
| `qualityGate` | Name, `passed` or `failed`, and each condition with its actual value and status. |
| `measures.overall` | Project measures (see below). |
| `measures.newCode` | Measures on new code, or `null` without a reference. |
| `files` | One entry per analyzed file. |
| `issues` | Every issue. |
| `rules` | The enabled rules with their full documentation, effective severity and parameters. Rules of imported reports have `plugin: "external"` and an `external` object (`tool`, `ruleId`, `helpUri`). |
| `duplications` | Duplication groups and their occurrences. |
| `tests` | Imported test suites, or `null`. |
| `coverageReports` | Coverage reports that were read. |
| `externalIssueReports` | External issue reports that were read, when any. |
| `diagnostics` | Warnings and errors of the analysis (unparseable files, unknown rules, unmatched coverage paths…). |

## Measures

`measures.overall` contains size (`files`, `lines`, `ncloc`, `commentLines`, `commentLinesDensity`, `functions`, `classes`, `statements`), complexity (`complexity`, `cognitiveComplexity`, `complexityDensity`), `functionStats` (averages, maxima, complexity and maintainability distributions), `halstead` (volume, effort, delivered bugs), `hotspots`, `issues` counts by severity and type, `ratings`, `technicalDebtMinutes`, `debtRatio`, `duplication`, `coverage` and `tests`. `measures.newCode` contains the subset that makes sense on changed lines.

## Files

```json title="files[n]"
{
  "path": "src/orders/service.ts",
  "language": "typescript",
  "plugin": "typescript",
  "measures": { "lines": 120, "ncloc": 96, "complexity": 18, "cognitiveComplexity": 11, "issues": 2, "duplicatedLines": 0, "maintainabilityIndex": 41, "...": "…" },
  "functions": [
    { "name": "OrderService.place", "kind": "method", "range": { "startLine": 12, "startColumn": 3, "endLine": 40, "endColumn": 4 },
      "ncloc": 25, "parameters": 2, "complexity": 7, "cognitiveComplexity": 9, "maxNestingDepth": 3, "maintainabilityIndex": 48, "halstead": { "volume": 812.4, "...": "…" } }
  ],
  "newLines": [14, 15, 22],
  "coverage": { "coveredLines": [12, 13], "uncoveredLines": [22], "partialLines": [{ "line": 15, "covered": 1, "total": 2 }] }
}
```

`newLines` is present only when a new-code reference exists; `coverage` only when a report covers the file; `source` only with `--include-sources`. `sha256` is the SHA-256 of the analysed content (UTF-8, without byte order mark): a viewer that reads the file from the project folder compares it to know whether the file changed after the analysis.

## Issues

```json title="issues[n]"
{
  "id": "4f1c2a9e0b7d36e85a12",
  "ruleId": "typescript:no-sql-injection",
  "type": "vulnerability",
  "characteristic": "security",
  "severity": "critical",
  "message": "Pass this value as a query parameter instead of inserting it into the SQL text.",
  "path": "src/orders/repository.ts",
  "range": { "startLine": 31, "startColumn": 22, "endLine": 31, "endColumn": 70 },
  "effortMinutes": 30,
  "tags": ["injection", "sql", "cwe-89"],
  "isNew": true
}
```

`id` is a fingerprint that survives line shifts (see [New code](new-code.html#stable-issues)). The rule behind `ruleId` is in `rules`, with its description, rationale, examples and references, so a viewer can explain every issue without other sources.

## SARIF

With `--format sarif` Qualis also writes `report.sarif` (SARIF 2.1.0) with the rules and issues, for GitHub code scanning, Azure DevOps and editors. SARIF does not carry the measures, ratings or quality gate: use `report.json` for those.

## Other schemas

| Schema | Describes |
|---|---|
| [report.schema.json](schemas/report.schema.json) | The analysis report. |
| [config.schema.json](schemas/config.schema.json) | `qualis.config.json`. |
| [plugin-manifest.schema.json](schemas/plugin-manifest.schema.json) | What a plugin declares: languages and rules. |
| [file-analysis.schema.json](schemas/file-analysis.schema.json) | What a plugin returns for each file. |
| [plugin-protocol.schema.json](schemas/plugin-protocol.schema.json) | Parameters of the stdio protocol requests. |
| [common.schema.json](schemas/common.schema.json) | Shared definitions. |
