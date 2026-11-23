---
title: What is Qualis
description: Qualis is an open static code analyzer with sourced rules, human-oriented metrics, an open report format and pluggable languages.
---
Qualis analyzes the source code of a repository and answers one question for a team: **is this change good enough to ship?** It checks security, reliability and maintainability, reads test results and coverage, finds duplicated code, and evaluates a quality gate that passes or fails the build. Every rule comes from an official source.

## The three parts

| Part | What it does | Do you need it? |
|---|---|---|
| **Qualis CLI** | The `qualis` command. It analyzes a repository, prints the results and saves them as JSON in `.qualis/`. | Yes |
| **Plugins** | Teach the CLI a language. TypeScript, JavaScript and C# are included. | Included; add more when you need them |
| **Qualis UI** | A web application that shows the results of your repositories: quality gate, issues, code, coverage, history. | Optional |

## From zero to results

1. **[Install the CLI](installation.html)**: `npm install --global qualis`.
2. **[Analyze a repository](usage.html)**: run `qualis analyze` in the repository root and read the results in the terminal.
3. **[Add plugins](add-plugins.html)**, if the bundled ones don't cover your languages.
4. **Use the results**: `.qualis/report.json` follows a [published JSON format](report-format.html), so you can build your own pages or tools on it, or…
5. **[Install Qualis UI](ui-install.html)** and **[connect the repository](web-ui.html)** to browse the results.

Want to extend Qualis? See [Write a plugin](plugins.html) and [Contribute](contributing.html).

```text title="Terminal"
$ qualis analyze
Quality gate "Qualis default": FAILED
  ✗ securityRating (new code) = D  fails when > A
  ✓ blockerIssues (overall) = 0  fails when > 0

Overall code
  Security        D  1 vulnerabilities
  Reliability     A  0 bugs
  Maintainability A  12 code smells, debt 2.1h (0.4%)
  Coverage        81.4%  lines 84.0%, branches 72.5%
  Duplications     1.2%  3 blocks, 41 lines

Report: .qualis/report.json
```

## Features

<div class="not-prose grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
<div class="bg-bg p-4"><div class="text-[14px] font-medium">Sourced rules</div><p class="mt-1 text-[13.5px] leading-6 text-muted">{{rule-count}} rules for TypeScript, JavaScript and C#: Qualis rules sourced from CWE, OWASP, NIST, MDN and Microsoft Learn, plus the ESLint, typescript-eslint and Microsoft .NET analyzers.</p></div>
<div class="bg-bg p-4"><div class="text-[14px] font-medium">Human metrics</div><p class="mt-1 text-[13.5px] leading-6 text-muted">Cyclomatic and cognitive complexity, nesting, Halstead and the maintainability index for every function, with the hotspots to look at first.</p></div>
<div class="bg-bg p-4"><div class="text-[14px] font-medium">Quality gate</div><p class="mt-1 text-[13.5px] leading-6 text-muted">Conditions on ratings, coverage, duplications and tests. A failed gate exits with code 1 and stops the build.</p></div>
<div class="bg-bg p-4"><div class="text-[14px] font-medium">New code</div><p class="mt-1 text-[13.5px] leading-6 text-muted">Lines added or changed since the reference branch are measured on their own, so the gate judges the change.</p></div>
<div class="bg-bg p-4"><div class="text-[14px] font-medium">Open report</div><p class="mt-1 text-[13.5px] leading-6 text-muted">report.json follows a published JSON Schema: any tool can read it. SARIF output feeds code scanning.</p></div>
<div class="bg-bg p-4"><div class="text-[14px] font-medium">Any language</div><p class="mt-1 text-[13.5px] leading-6 text-muted">Languages are plugins: a JavaScript module, or any executable speaking JSON-RPC over stdio.</p></div>
</div>

## How it works

1. **Discover files.** Files tracked by git (or matching `include`) are assigned to the plugin that handles their extension.
2. **Analyze.** Each language plugin returns issues, measures, per-function metrics and tokens for duplication detection; rule packs (ESLint, Roslyn) add the issues of their analyzers.
3. **Combine.** The core detects duplications, imports coverage and test reports, computes the new-code lines from git and the ratings.
4. **Decide.** The quality gate evaluates its conditions; the report is written as JSON (and SARIF).

## Principles

- **Every rule has a source.** A rule exists only if official documentation describes the problem. The rule page summarises the source in our own words and links to it; see [Sources](sources.html).
- **Honest numbers.** Where a threshold is a convention rather than a standard (for example the default coverage target), the documentation says so and the value is configurable.
- **Open contracts.** The report, the configuration and the plugin protocol are JSON Schemas under the Apache-2.0 license.
