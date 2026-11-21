# Qualis

Qualis is an open static code analyzer. It measures **security**, **reliability** and **maintainability**, imports **test results** and **coverage**, detects **duplications**, computes human-oriented **metrics** (cyclomatic and cognitive complexity, Halstead, maintainability index) and evaluates a **quality gate** that passes or fails a build.

It is built around three open contracts:

| Contract | What it lets you do |
|---|---|
| **Report format** ([JSON Schema](packages/schema/schemas/report.schema.json)) | Read the results with any tool. The bundled UI is optional; anyone can build their own. |
| **Plugin contract** ([JSON Schema](packages/schema/schemas/plugin-manifest.schema.json) + [protocol](packages/plugin-api/src/protocol.ts)) | Add a language as an in-process JavaScript module or as a separate process written in **any** language (JSON-RPC 2.0 over stdio). |
| **Configuration** ([JSON Schema](packages/schema/schemas/config.schema.json)) | Rules, quality gate, coverage and test reports, new-code reference. |

**Every rule is derived from an official, authoritative source** (MITRE CWE, OWASP, NIST, IETF RFCs, MDN, Node.js, Microsoft Learn, TypeScript, ISO/IEC 5055 / OMG ASCQM). Each rule lists its references, and every reference was checked against the published page.

> Status: 0.1.0, not yet published to npm. Run it from source (see [Development](#development)).

## Contents

- [Quick start](#quick-start)
- [What is measured](#what-is-measured)
- [Quality gate](#quality-gate)
- [Configuration](#configuration)
- [Suppressing an issue](#suppressing-an-issue)
- [Report format](#report-format)
- [Web UI](#web-ui)
- [Language plugins](#language-plugins)
- [Rules](#rules)
- [Development](#development)
- [Documentation site](#documentation-site)
- [License](#license)

## Quick start

```bash
pnpm install
pnpm build
npm install --global ./packages/cli   # the qualis command, linked to this checkout
qualis analyze path/to/project
```

Without the global install, run `pnpm qualis analyze path/to/project` from the repository root.

The command prints a summary, writes `.qualis/report.json` in the project (recent analyses are also kept in `.qualis/history/`; add `.qualis/` to the project's `.gitignore`) and exits with:

| Exit code | Meaning |
|---|---|
| `0` | Quality gate passed (or `--no-fail`) |
| `1` | Quality gate failed |
| `2` | Error (invalid configuration, plugin failure, …) |

Useful options:

```bash
qualis analyze . --format json,sarif          # also write report.sarif (GitHub/Azure DevOps code scanning)
qualis analyze . --coverage coverage/lcov.info --coverage "**/coverage.opencover.xml" --tests "reports/*.xml"
qualis analyze . --new-code origin/main      # compare with a branch (default: auto-detected)
qualis analyze . --issues                    # print every issue
qualis rules                                 # list rules of the configured plugins
qualis init                                  # create qualis.config.json
qualis validate .qualis/report.json          # validate a report against the schema
```

Once published, the CLI runs with any package manager: `npx qualis`, `pnpm dlx qualis`, `bunx qualis`.

## What is measured

| Area | How |
|---|---|
| Security | Vulnerabilities (rating A–E by worst severity) and **security hotspots** (code to review; they do not lower the rating). |
| Reliability | Bugs, rating A–E by worst severity. |
| Maintainability | Code smells; technical debt (sum of remediation estimates) and debt ratio over the development cost (30 min per line by default); rating A ≤ 5 %, B ≤ 10 %, C ≤ 20 %, D ≤ 50 %, E above. |
| Tests | JUnit XML and Visual Studio TRX: total, passed, failed, errors, skipped, duration. |
| Coverage | LCOV, Cobertura XML and OpenCover XML: line, branch (condition) and combined coverage, per file and per line. Source files the tests never loaded count as not covered (tests and configuration excluded). |
| Duplications | Identical token sequences (type-1 clones) of at least 100 tokens over 10 lines, within and across files. |
| Size | Lines, lines of code, comment lines and density, functions, classes, statements. |
| Complexity | McCabe cyclomatic complexity, cognitive complexity, nesting depth, parameters, for every function. |
| Halstead | Operators/operands, vocabulary, length, volume, difficulty, effort, estimated bugs. |
| Maintainability index | Visual Studio variant, 0–100, per function, with the green/yellow/red bands. |
| Hotspots | The ten most complex functions and the ten with the lowest maintainability index. |
| New code | Lines added or changed since the reference branch (git): issues, ratings, coverage and duplications on new code. |

The rating scales, the debt model and the default thresholds are documented with their sources in the documentation site. Where a threshold is a convention and not a standard, the documentation says so.

## Quality gate

The default gate fails when:

- new code has a reliability, security or maintainability rating worse than **A**;
- new code coverage is below **80 %** or new code duplication above **3 %**;
- the project has **blocker** issues or **failing tests**.

A condition without data (no coverage report, no new-code reference) is reported as `no-data` and does not fail the gate. Define your own gate in the configuration:

```json
{
  "qualityGate": {
    "name": "Strict",
    "conditions": [
      { "metric": "securityRating", "scope": "overall", "operator": "gt", "threshold": "A" },
      { "metric": "coverage", "scope": "new", "operator": "lt", "threshold": 90 },
      { "metric": "securityHotspots", "operator": "gt", "threshold": 0 }
    ]
  }
}
```

Metrics: `reliabilityRating`, `securityRating`, `maintainabilityRating`, `issues`, `blockerIssues`, `criticalIssues`, `majorIssues`, `bugs`, `vulnerabilities`, `securityHotspots`, `codeSmells`, `technicalDebtMinutes`, `debtRatio`, `coverage`, `lineCoverage`, `branchCoverage`, `duplicatedLinesDensity`, `testFailures`, `testSuccessDensity`.

## Configuration

`qualis.config.json` in the project root (all fields optional):

```json
{
  "$schema": "./node_modules/@qualis/schema/schemas/config.schema.json",
  "project": { "key": "shop", "name": "Shop" },
  "exclude": ["**/generated/**"],
  "coverage": { "reports": ["coverage/lcov.info", "**/coverage.cobertura.xml"] },
  "tests": { "reports": ["reports/junit.xml", "**/TestResults/*.trx"] },
  "externalIssues": { "reports": ["reports/eslint.json", "**/*.sarif"] },
  "newCode": { "reference": "auto" },
  "rules": {
    "typescript:strict-equality": "off",
    "typescript:function-complexity": { "params": { "max": 15 } },
    "csharp:no-hardcoded-credentials": { "exclude": ["samples/**"] },
    "csharp:no-weak-hash": "blocker"
  },
  "output": { "dir": ".qualis", "formats": ["json", "sarif"] }
}
```

Test code (`**/*.test.*`, `**/*.spec.*`, `test/`, `tests/`, `__tests__/`, `*.Tests/` projects, `*Tests.cs`; set `tests.sources` to change the list) is analyzed but left out of the size, complexity, duplication and coverage measures; by default only rules that report bugs apply to it, and `"scope": "all"` in a rule setting extends any rule to it. Files ignored by git are skipped, as are `node_modules`, `dist`, `build`, `bin`, `obj`, `coverage`, minified files and generated C# (`*.Designer.cs`, `*.g.cs`). With `newCode.reference: "auto"` the reference is the CI target branch (GitHub Actions, Azure DevOps, GitLab) or the default branch (`origin/HEAD`, `main`, `master`); on the default branch itself there is no new code.

`externalIssues.reports` imports the findings of the linters and analyzers the project already runs (SARIF 2.1.0, ESLint JSON): the project's own ESLint configuration and plugins, the .NET analyzers, Semgrep, Ruff and others. The build error log of each .NET project (`dotnet build -p:ErrorLog=build.sarif`) is read automatically, only for the files of that project. Each becomes a rule `external:<tool>:<rule>` (code smell by default, security hotspot when the tool tags it as security) that takes the usual `rules` settings.

## Suppressing an issue

Write a directive in a comment, preferably with a reason after `--`:

```ts
// qualis-ignore-next-line typescript:no-weak-hash -- ETag only, not a security use
const etag = createHash("md5").update(body).digest("hex");
```

`qualis-ignore-line` applies to its own line, `qualis-ignore-next-line` to the following line, `qualis-ignore-file` to the whole file. Without rule ids the directive applies to every rule.

## Report format

`report.json` follows [`report.schema.json`](packages/schema/schemas/report.schema.json) (JSON Schema 2020-12, version `1.0.0`). It contains the project and VCS information, the quality gate result, overall and new-code measures, per-file measures with per-function metrics, line coverage and new lines, the issues with stable fingerprints, the active rules with their references, the duplication groups, the test suites and the analysis diagnostics. `qualis validate` checks any file against the schema; TypeScript types are exported by `@qualis/schema`.

## Web UI

`apps/ui` is the default web UI (Next.js). It shows projects, quality gates, ratings, issues with filters, the code with issues and coverage inline, measures, rules and the history of every project. Projects get in two ways:

- **Import project**: choose a project folder; the UI reads its `.qualis/report.json` and `.qualis/history/` on every visit, so each new `qualis analyze` appears by itself. The code view reads the files from the folder and warns when one changed since the analysis.
- **Read analysis**: add a single `report.json`; it is validated and stored by the UI, in a new project or in the one with the same `project.key`.

Related projects can be grouped in a **solution**: import a folder that contains several projects as one (its sub-folders with `.qualis` are found up to 4 levels down), or group imported projects with **New solution**. A solution shows combined metrics: sums, size-weighted coverage, duplications and debt ratio, and the worst rating of its projects. It counts its projects' quality gates and has none of its own. Projects and solutions can be bookmarked as **favorites**; favorites are kept in the browser, since the UI has no user accounts.

```bash
pnpm ui                                   # http://localhost:3000; data in .qualis-ui/, imports from your home folder
docker build -f apps/ui/Dockerfile -t qualis-ui .
docker run --rm -p 3000:3000 -v ~/workspace:/workspace:ro -v qualis-data:/data qualis-ui
```

See [Web UI](docs/content/web-ui.md) for the settings.

## Language plugins

| Plugin | Languages | Engine |
|---|---|---|
| `@qualis/plugin-typescript` | TypeScript, JavaScript (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`) | TypeScript compiler API, with type information for type-aware rules |
| `@qualis/plugin-csharp` | C# (`.cs`) | tree-sitter C# grammar (WebAssembly, no .NET SDK required; syntax only) |
| `@qualis/plugin-eslint` (rule pack) | TypeScript, JavaScript | ESLint 10 and typescript-eslint 8: the recommended rules (strict rules available, off by default) |
| `@qualis/plugin-roslyn` (rule pack) | C# | Microsoft .NET code analysis rules (CA) run by a .NET 10 helper with full semantic information; Microsoft's Recommended analysis mode by default |
| [`examples/python-plugin`](examples/python-plugin) | Python (example) | Python standard library, connected over stdio |

A plugin publishes a manifest (id, kind, languages, rules with references) and returns, for each file, its issues, measures, per-function metrics, Halstead counts, code lines and duplication tokens. A **rule pack** returns issues only, for files owned by a language plugin, and its rules may **supersede** equivalent rules (the replaced rule stops running only if the pack could prepare, e.g. when .NET is available). Two transports exist:

- **Module**: an npm package whose default export is a plugin object or a factory (see [`@qualis/plugin-api`](packages/plugin-api)).
- **Process**: any executable speaking newline-delimited JSON-RPC 2.0 on stdin/stdout: `initialize` → `prepare` → `analyzeFile`… → `shutdown` → `exit`. Its answers are validated against the published schemas.

```json
{ "plugins": ["@qualis/plugin-typescript", { "command": "python3", "args": ["tools/qualis_python.py"] }] }
```

## Rules

The Qualis rules below are implemented by the language plugins. The rule packs add the ESLint and typescript-eslint recommended rules (141 rules) and the Microsoft .NET code analysis rules (CA): every one of them is documented, with its official page, in the documentation site. When an ESLint or CA rule detects the same problem as a Qualis rule, it supersedes it.

### TypeScript / JavaScript (30 rules)

| Rule | Type | Severity | Main sources |
|---|---|---|---|
| `typescript:no-eval` — eval() should not be used | vulnerability | critical | MDN Web Docs, CWE-95 |
| `typescript:no-implied-eval` — Code should not be built from strings | vulnerability | critical | MDN Web Docs, CWE-95 |
| `typescript:no-os-command-injection` — Shell commands should not be built from variable data | vulnerability | critical | Node.js Documentation, OWASP, CWE-78 |
| `typescript:no-tls-verification-disabled` — TLS certificate verification should not be disabled | vulnerability | critical | Node.js Documentation, CWE-295 |
| `typescript:no-weak-hash` — Weak hash algorithms should not be used | vulnerability | major | Node.js Documentation, RFC 6151, SP 800-131A Rev. 2, NIST, CWE-328 |
| `typescript:no-weak-cipher` — Broken or risky ciphers should not be used | vulnerability | critical | Node.js Documentation, SP 800-131A Rev. 2, RFC 7465, OWASP, CWE-327 |
| `typescript:no-hardcoded-credentials` — Credentials should not be hard-coded | vulnerability | critical | CWE-798, OWASP |
| `typescript:no-sql-injection` — Data should not be concatenated or interpolated into SQL | vulnerability | critical | OWASP, CWE-89 |
| `typescript:dynamic-sql-review` — Dynamically built SQL should be reviewed | security-hotspot | major | OWASP, CWE-89 |
| `typescript:no-unsafe-html-sink` — Variable data should not be written to HTML sinks | vulnerability | major | MDN Web Docs, OWASP, CWE-79 |
| `typescript:dangerous-html-review` — HTML injected with dangerouslySetInnerHTML should be reviewed | security-hotspot | major | OWASP, CWE-79 |
| `typescript:no-debugger` — debugger statements should be removed | vulnerability | minor | MDN Web Docs, CWE-489 |
| `typescript:no-compare-nan` — NaN should be tested with Number.isNaN() | bug | major | MDN Web Docs, CWE-570, CWE-571 |
| `typescript:valid-typeof` — typeof should be compared with a valid type name | bug | major | MDN Web Docs, CWE-570 |
| `typescript:no-self-compare` — A value should not be compared with itself | bug | major | MDN Web Docs, CWE-570, CWE-571 |
| `typescript:no-unsafe-finally` — Control flow should not leave a finally block | bug | major | MDN Web Docs, CWE-584 |
| `typescript:no-fallthrough` — Switch cases should not fall through | bug | major | MDN Web Docs, TypeScript Documentation, CWE-484 |
| `typescript:no-duplicate-case` — Switch statements should not have duplicate case labels | bug | major | MDN Web Docs, CWE-561 |
| `typescript:no-dupe-keys` — Object literals should not have duplicate keys | bug | major | MDN Web Docs, CWE-563 |
| `typescript:no-unreachable` — Code after return, throw, break or continue should be removed | bug | major | TypeScript Documentation, CWE-561 |
| `typescript:no-cond-assign` — Conditions should not contain assignments | bug | major | CWE-481 |
| `typescript:no-empty-catch` — Exceptions should not be silently ignored | bug | minor | CWE-1069, CWE-390 |
| `typescript:no-floating-promises` — Promises should be awaited or have their rejection handled | bug | major | MDN Web Docs, Node.js Documentation, CWE-755 |
| `typescript:function-complexity` — Functions should not be too complex | code-smell | major | SP 500-235, IEEE, CWE-1121, ASCQM 1.1 / ISO/IEC 5055 |
| `typescript:too-many-parameters` — Functions should not have too many parameters | code-smell | major | CWE-1064, ASCQM 1.1 / ISO/IEC 5055 |
| `typescript:file-too-long` — Files should not have too many lines of code | code-smell | major | CWE-1080, ASCQM 1.1 / ISO/IEC 5055 |
| `typescript:todo-comment` — Task markers in comments should be tracked | code-smell | info | CWE-546 |
| `typescript:commented-out-code` — Commented-out code should be removed | code-smell | minor | CWE-1085, ASCQM 1.1 / ISO/IEC 5055 |
| `typescript:unused-declaration` — Unused local declarations and imports should be removed | code-smell | minor | TypeScript Documentation, CWE-563, CWE-1164 |
| `typescript:deprecated-api` — Deprecated APIs should not be used | code-smell | minor | TypeScript Documentation |
| `typescript:strict-equality` — Strict equality operators should be used | code-smell | minor | MDN Web Docs |

### C# (19 rules)

| Rule | Type | Severity | Main sources |
|---|---|---|---|
| `csharp:no-insecure-deserializer` — BinaryFormatter and related serializers should not be used | vulnerability | critical | Microsoft Learn, CWE-502 |
| `csharp:no-weak-hash` — Weak hash algorithms should not be used | vulnerability | major | CA5351, CA5350, CWE-328 |
| `csharp:no-weak-cipher` — Broken or risky ciphers and cipher modes should not be used | vulnerability | critical | CA5351, CA5350, CA5358, SP 800-131A Rev. 2, CWE-327 |
| `csharp:no-certificate-validation-bypass` — Server certificate validation should not be disabled | vulnerability | critical | CA5359, CWE-295 |
| `csharp:no-sql-injection` — Data should not be concatenated or interpolated into SQL | vulnerability | critical | CA2100, Microsoft Learn, OWASP, CWE-89 |
| `csharp:dynamic-sql-review` — Dynamically built SQL should be reviewed | security-hotspot | major | CA2100, Microsoft Learn, OWASP, CWE-89 |
| `csharp:no-hardcoded-credentials` — Credentials should not be hard-coded | vulnerability | critical | CWE-798, OWASP |
| `csharp:no-insecure-xml-dtd` — XML parsers should not process DTDs or resolve external entities | vulnerability | critical | CA3075, CWE-611 |
| `csharp:no-async-void` — Async methods should return Task | bug | major | Microsoft Learn |
| `csharp:no-blocking-async` — Asynchronous calls should be awaited, not blocked on | bug | major | Microsoft Learn |
| `csharp:preserve-stack-on-rethrow` — Caught exceptions should be rethrown with throw; | bug | major | CA2200 |
| `csharp:no-compare-nan` — NaN should be tested with IsNaN | bug | major | CA2242, Microsoft Learn, CWE-570, CWE-571 |
| `csharp:no-empty-catch` — Exceptions should not be silently ignored | bug | minor | CWE-1069, CWE-390 |
| `csharp:no-unsafe-lock-target` — Locks should use a private object | bug | major | Microsoft Learn, CWE-412 |
| `csharp:function-complexity` — Methods should not be too complex | code-smell | major | SP 500-235, IEEE, CWE-1121, ASCQM 1.1 / ISO/IEC 5055 |
| `csharp:too-many-parameters` — Methods should not have too many parameters | code-smell | major | CWE-1064, ASCQM 1.1 / ISO/IEC 5055 |
| `csharp:file-too-long` — Files should not have too many lines of code | code-smell | major | CWE-1080, ASCQM 1.1 / ISO/IEC 5055 |
| `csharp:todo-comment` — Task markers in comments should be tracked | code-smell | info | CWE-546 |
| `csharp:commented-out-code` — Commented-out code should be removed | code-smell | minor | CWE-1085, ASCQM 1.1 / ISO/IEC 5055 |

The documentation site has a page for each rule with what it detects, why, compliant and noncompliant examples, parameters, exceptions and the full list of references.

## Development

```text
packages/schema        JSON Schemas and TypeScript types (report, config, plugin protocol)
packages/plugin-api    Plugin contract, stdio protocol, helpers (Halstead, suppressions, line index)
packages/core          Engine: plugin host, git new code, duplication, coverage, tests, metrics, gate, SARIF
packages/cli           `qualis` command
plugins/typescript     TypeScript/JavaScript plugin
plugins/csharp         C# plugin
plugins/eslint         ESLint + typescript-eslint rule pack
plugins/roslyn         Roslyn rule pack (C# helper in dotnet/, npm wrapper in src/)
examples/python-plugin Plugin written in Python (stdio)
apps/ui                Web UI (Next.js): imported project folders and uploaded analyses; Docker image in apps/ui/Dockerfile
docs                   Documentation site generator (static HTML + Tailwind CSS)
```

```bash
pnpm install
pnpm build          # tsc -b
pnpm test           # build + vitest
pnpm docs:build     # build and generate docs/site
pnpm docs:serve     # serve docs/site on http://localhost:4321
pnpm ui             # web UI on http://localhost:3000 (data in .qualis-ui/)
pnpm ui:dev         # the same with the Next.js development server
pnpm ui:build       # production build of the web UI
```

Every rule's noncompliant example must raise the rule and its compliant example must not: the tests run the examples shown in the documentation, so documentation and behaviour cannot drift apart.

Requirements: Node.js 20.19 or later, pnpm 10, git (for new-code detection). Optional: .NET SDK 10 for the Roslyn rule pack (`pnpm build` publishes its helper when the SDK is present).

## Documentation site

`pnpm docs:build` generates a static site in `docs/site` (HTML + Tailwind CSS, light and dark themes, no runtime dependencies) from the rule metadata of the plugins and the published schemas; `pnpm docs:serve` serves it on http://localhost:4321 (`PORT` changes the port). The site also works when `docs/site/index.html` is opened directly.

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Qualis is an independent project and is not affiliated with any vendor of code analysis products.
