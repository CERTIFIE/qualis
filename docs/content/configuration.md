---
title: Configuration
description: The qualis.config.json file: files, plugins, rules, reports, new code, quality gate and output.
---
Qualis reads `qualis.config.json` (or `.qualis.json`) from the project root. Every field is optional; `qualis init` writes a starting file. The file is validated against [config.schema.json](schemas/config.schema.json) and an invalid file stops the analysis with exit code 2.

```json title="qualis.config.json"
{
  "$schema": "./node_modules/@qualis/schema/schemas/config.schema.json",
  "project": { "key": "shop", "name": "Shop" },
  "exclude": ["**/generated/**"],
  "coverage": { "reports": ["coverage/lcov.info"] },
  "tests": { "reports": ["reports/junit.xml"] },
  "newCode": { "reference": "auto" },
  "rules": {
    "typescript:strict-equality": "off",
    "typescript:function-complexity": { "params": { "max": 15 } }
  },
  "output": { "dir": ".qualis", "formats": ["json", "sarif"] }
}
```

## Files

| Field | Default | Meaning |
|---|---|---|
| `include` | `["**/*"]` | Glob patterns of files to analyze, relative to the project root. |
| `exclude` | `[]` | Additional patterns to skip. |
| `respectGitignore` | `true` | Inside a git work tree, only files tracked or not ignored by git are considered. |

These patterns are always excluded: `node_modules`, `.git`, `.qualis`, `dist`, `build`, `out`, `coverage`, `bin`, `obj`, `*.min.js`, `*.Designer.cs`, `*.g.cs`, `*.g.i.cs`. Files larger than 2 MB are skipped and listed in the report diagnostics. A file is analyzed only if a plugin handles its extension.

### Test code

`tests.sources` lists the glob patterns of test code. Test files are analyzed and listed in the report (`"test": true`), but they are left out of the size, complexity, duplication and coverage measures, and their lines do not count in the debt ratio. Their size is reported on its own in `measures.overall.testCode`.

| Field | Default | Meaning |
|---|---|---|
| `tests.sources` | `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`, `**/__mocks__/**`, `**/test/**`, `**/tests/**`, `**/*.Tests/**`, `**/*.UnitTests/**`, `**/*.IntegrationTests/**`, `**/*Tests.cs` | Patterns of test code. Replaces the default list; `[]` treats every file as production code. |

The defaults leave out folders such as `testing/`, which can hold test helpers but also production code (a documentation route, a `*.Testing` library shipped to consumers). Add them when they are test code:

```json
{ "tests": { "sources": ["**/*.test.*", "**/tests/**", "packages/indexer/src/testing/**"] } }
```


Each rule has a **scope**: `main` (production code), `test` (test code) or `all`. Rules that do not declare one apply to all code when they report bugs, and to production code only otherwise: naming conventions, complexity limits and security hotspots are rarely meaningful in tests, while a bug in a test makes the test wrong. The issues found in test code count in the issue totals and ratings like any other. The rule catalog shows the scope of each rule; `scope` in the rule configuration changes it.

## Plugins

`plugins` replaces the default list:

```json
["@qualis/plugin-typescript", "@qualis/plugin-csharp", "@qualis/plugin-eslint", "@qualis/plugin-roslyn"]
```

The first two are language plugins (they own `.ts`/`.js` and `.cs` files and measure them); the last two are [rule packs](plugins.html#language-plugins-and-rule-packs) that add the rules of ESLint and of the Microsoft .NET analyzers to those files. Each entry is a package name, a module with options, or a command for an out-of-process plugin:

```json
{
  "plugins": [
    { "module": "@qualis/plugin-typescript", "options": { "tsconfig": "tsconfig.app.json" } },
    "@qualis/plugin-csharp",
    { "command": "python3", "args": ["tools/qualis_python.py"], "options": {} }
  ]
}
```

| Plugin | Options |
|---|---|
| `@qualis/plugin-typescript` | `tsconfig`: path of the TypeScript configuration (default `tsconfig.json`). `typeCheck`: `false` disables the type-aware rules. |
| `@qualis/plugin-eslint` | `typeChecked`: run the type-aware typescript-eslint rules (default: when `tsconfig.json` exists in the project root). |
| `@qualis/plugin-roslyn` | `solution` or `projects`: what to load (default: the `.slnx`/`.sln` in the root, otherwise every `.csproj`). `restore`: `false` skips the automatic `dotnet restore` of projects that were never restored. |

See [Writing a plugin](plugins.html) for the protocol.

## Rules

Each key of `rules` is a rule id. The value is one of:

| Value | Effect |
|---|---|
| `"off"` | Disable the rule. |
| `"on"` | Enable the rule with its default severity. |
| `"blocker"` … `"info"` | Enable the rule with this severity. |
| `{ "enabled", "severity", "params", "exclude", "scope" }` | Full form: `params` sets rule parameters, `exclude` lists glob patterns of files where the rule does not apply, `scope` (`main`, `test` or `all`) the code it applies to (see [Test code](#test-code)). |

```json
{
  "rules": {
    "csharp:no-hardcoded-credentials": { "exclude": ["samples/**"] },
    "typescript:no-unsafe-html-sink": { "scope": "all" },
    "typescript:too-many-parameters": { "severity": "minor", "params": { "max": 5 } }
  }
}
```

Unknown rule ids and parameters are reported as warnings in the report diagnostics. Rules of imported reports (`external:<tool>:<rule>`, see [External issues](external-issues.html)) take the same settings, except `params`. The [rule catalog](rules/index.html) lists every rule with its parameters.

Some rules of the rule packs **supersede** an equivalent Qualis rule: for example `roslyn:ca5351` replaces `csharp:no-weak-hash`, and `eslint:no-eval` replaces `typescript:no-eval`. The replaced rule does not run while the superseding rule is enabled and its pack could run (a Roslyn pack without .NET leaves the C# rules in place). Writing the replaced rule in `rules` keeps both. The report diagnostics list every replacement.

### Suppressing an issue

When an issue is a deliberate exception, write a directive in a comment, with the reason after `--`:

```ts
// qualis-ignore-next-line typescript:no-weak-hash -- ETag only, not a security use
const etag = createHash("md5").update(body).digest("hex");

const data = eval(trusted); // qualis-ignore-line typescript:no-eval -- input built above
```

| Directive | Scope |
|---|---|
| `qualis-ignore-line [rule-id …]` | The line of the comment. |
| `qualis-ignore-next-line [rule-id …]` | The line after the comment. |
| `qualis-ignore-file [rule-id …]` | The whole file. |

Without rule ids, the directive applies to every rule. Prefer listing the rule id so that new problems on the same line are still reported.

## Reports

| Field | Meaning |
|---|---|
| `coverage.reports` | Glob patterns of LCOV, Cobertura XML or OpenCover XML files. See [Coverage and tests](coverage-and-tests.html). |
| `coverage.missingFiles` | `"uncovered"` (default) counts source files that no report mentions as not covered, for the languages present in the reports; `"ignore"` leaves them out. |
| `coverage.exclude` | Files not expected to be covered, besides the test code (default: `*.d.ts` and `*.config.*` files). Replaces the default list. |
| `tests.reports` | Glob patterns of JUnit XML or Visual Studio TRX files. |
| `externalIssues.reports` | Glob patterns of SARIF 2.1.0 or ESLint JSON reports of other linters and analyzers. See [External issues](external-issues.html). |
| `externalIssues.types` | Issue type per external rule id (`external:<tool>:<rule>`, `*` matches any text). Default: code smell, or security hotspot for rules the tool tags as security. |
| `externalIssues.dotnetErrorLogs` | Read the build error log (SARIF) of each `.csproj` and `.vbproj` for the files of that project (default `true`). See [.NET build error logs](external-issues.html#net-build-error-logs). |
| `externalIssues.effortMinutes` | Remediation effort of one external issue, in minutes (default 5). |

The command-line options `--coverage`, `--tests` and `--external` override these lists.

## New code

`newCode.reference` sets the git reference new code is compared with: `"auto"` (default), a branch, tag or commit such as `"origin/main"`, or `null` to disable new-code detection. See [New code](new-code.html).

## Duplications

| Field | Default | Meaning |
|---|---|---|
| `duplication.enabled` | `true` | Turn duplication detection on or off. |
| `duplication.minTokens` | `100` | Minimum length of a duplicated block, in tokens. |
| `duplication.minLines` | `10` | Minimum number of lines a block must span. |
| `duplication.exclude` | `[]` | Files that are analyzed but not checked for duplications. |

## Quality gate and ratings

`qualityGate` defines the gate (see [Quality gate](quality-gate.html)). `ratings.developmentCostMinutesPerLine` (default 30) and `ratings.maintainabilityThresholds` (default `[5, 10, 20, 50]`) tune the maintainability rating (see [Ratings and technical debt](ratings.html)).

## Output

| Field | Default | Meaning |
|---|---|---|
| `output.dir` | `.qualis` | Directory of the reports, relative to the project root. |
| `output.formats` | `["json"]` | `json` writes `report.json`, `sarif` writes `report.sarif`. |
| `output.includeSources` | `false` | Embed file contents in `report.json`, for viewers that do not have access to the sources. |
| `output.history` | `20` | Analyses kept in `<dir>/history`, the latest included; `0` disables the history. |
