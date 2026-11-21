---
title: External issues
description: Import the issues of the linters and analyzers a project already runs (SARIF, ESLint JSON).
---
Qualis can add the findings of other tools to its own: the project's ESLint with its own configuration and plugins, the .NET compiler and analyzers, Semgrep, Ruff, golangci-lint, CodeQL or any tool that writes SARIF. Qualis does not run these tools: it reads the reports they produce, as it does for coverage. Configure them with `externalIssues.reports` (glob patterns) or with `--external`.

```json
{
  "externalIssues": {
    "reports": ["reports/eslint.json", "**/*.sarif"],
    "types": { "external:eslint:react-hooks/*": "bug" },
    "effortMinutes": 5
  }
}
```

## Formats

| Format | Produced by |
|---|---|
| SARIF 2.1.0 and 1.0 | `eslint -f @microsoft/eslint-formatter-sarif`, `dotnet build -p:ErrorLog=build.sarif`, `semgrep --sarif`, `ruff check --output-format sarif`, `golangci-lint run --out-format sarif`, CodeQL, many others |
| ESLint JSON | `eslint -f json -o reports/eslint.json` |

The format is detected from the content. File paths may be absolute, `file://` URIs, relative to a SARIF `originalUriBaseIds` root, or relative to the project root. Run the tool on the same revision as the analysis: an issue on a line past the end of its file is dropped with a warning.

Qualis skips these results:

- SARIF results with `kind` `pass`, `notApplicable` or `informational`, with `baselineState` `absent`, or suppressed in the source or accepted as suppressed;
- issues on files outside the project, or on files no language plugin analyzes (for example Python without a Python plugin); the report diagnostics count them;
- ESLint parsing errors, and the "Definition for rule … was not found" errors of `eslint-disable` comments that name a rule the configuration does not load; both are reported in a warning.

## .NET build error logs

The C# and Visual Basic compilers write every diagnostic of a build to a SARIF file, the error log. It includes the compiler warnings (`CS…`), the .NET analyzers (`CA…`, `IDE…`) and the analyzer packages of the project, such as StyleCop or Roslynator, configured by the project's own `.editorconfig`. Qualis reads the error log of every `.csproj` and `.vbproj` it finds, without configuration:

```bash
dotnet build -p:ErrorLog=build.sarif
```

1. **Where.** Qualis looks first for the `ErrorLog` property declared in the project file, or else in its `Directory.Build.props`, for example `<ErrorLog>$(MSBuildProjectDirectory)/build.sarif,version=2.1</ErrorLog>`. Without one, it reads the `*.sarif` files in the project folder; `-p:ErrorLog=build.sarif` on the command line writes there, because a relative path is resolved against each project's folder. `$(MSBuildProjectDirectory)`, `$(MSBuildProjectName)` and `$(MSBuildThisFileDirectory)` are expanded; any other property matches any text. Conditions are not evaluated.
2. **Which files.** A project's error log only counts for the files of that project, meaning the files whose nearest project file above them is that project's file, as with the SDK's default `Compile` items. Results on files of another project, such as a nested project or a linked file, are ignored and counted in the diagnostics. Only the compiler runs of the file are read.
3. **Freshness.** When a source file of the project was modified after the error log was written, a warning asks to rebuild the project.

The rules are named `external:roslyn:<id>`, for example `external:roslyn:CA1822`. The `@qualis/plugin-roslyn` rule pack also runs the recommended CA rules; when both report the same rule on the same line, only its issue is kept. Set `externalIssues.dotnetErrorLogs` to `false` to stop reading error logs. An error log that also matches `externalIssues.reports` is read once, restricted to its project.

## Rules

Each rule of a tool becomes a rule `external:<tool>:<rule>` in the report, for example `external:eslint:react-hooks/exhaustive-deps` or `external:semgrep-oss:js.eval-injection`. `<tool>` is the tool name in lowercase (`ESLint` becomes `eslint`). The .NET compilers become `roslyn`.

| Property | Value |
|---|---|
| Type | `code-smell`. A rule the tool tags as `security`, or that has a `security-severity`, is a `security-hotspot`, to be reviewed. Use `externalIssues.types` to assign other types: keys are rule ids, where `*` matches any text. |
| Severity | Level `error` → major, `warning` → minor, `note` → info. ESLint severity 2 is an error and 1 a warning. The highest level reported for the rule applies. |
| Effort | `externalIssues.effortMinutes` per issue (default 5), counted in the technical debt like any code smell. |
| Scope | As for Qualis rules: bugs apply to test code too, other types to production code only. |
| References | The rule's documentation page given by the tool, if any. |

External rules accept the same `rules` settings as Qualis rules, except `params`:

```json
{
  "rules": {
    "external:eslint:no-console": "off",
    "external:eslint:react-hooks/exhaustive-deps": { "severity": "major", "exclude": ["src/legacy/**"] }
  }
}
```

The issues of external rules count in the ratings, the quality gate and new code like any other issue. Qualis does not check them, and their rules have no verified references. Changing the type of a rule with `types` changes which rating it affects: a `vulnerability` lowers the security rating.

## Overlap with the rule packs

The `@qualis/plugin-eslint` rule pack runs the ESLint recommended rules with its own configuration, not the project's. When the same rule is reported by a Qualis plugin and by an imported report on the same line, for example `eslint:no-eval` and `external:eslint:no-eval`, only the Qualis issue is kept. To rely only on the project's ESLint, remove `@qualis/plugin-eslint` from `plugins`.
