---
title: Introduction
description: Qualis is an open static code analyzer with sourced rules, human-oriented metrics, an open report format and pluggable languages.
---
Qualis analyzes source code and answers one question for a team: **is this change good enough to ship?** It measures security, reliability and maintainability, imports test results and coverage, detects duplicated code, computes metrics that help a person understand the code, and evaluates a quality gate that passes or fails the build.

## Features

<div class="not-prose grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
<div class="bg-bg p-4"><div class="text-[14px] font-medium">Sourced rules</div><p class="mt-1 text-[13.5px] leading-6 text-muted">{{rule-count}} rules for TypeScript, JavaScript and C#: Qualis rules sourced from CWE, OWASP, NIST, MDN and Microsoft Learn, plus the ESLint, typescript-eslint and Microsoft .NET analyzers.</p></div>
<div class="bg-bg p-4"><div class="text-[14px] font-medium">Human metrics</div><p class="mt-1 text-[13.5px] leading-6 text-muted">Cyclomatic and cognitive complexity, nesting, Halstead and the maintainability index for every function, with the hotspots to look at first.</p></div>
<div class="bg-bg p-4"><div class="text-[14px] font-medium">Quality gate</div><p class="mt-1 text-[13.5px] leading-6 text-muted">Conditions on ratings, coverage, duplications and tests. A failed gate exits with code 1 and stops the build.</p></div>
<div class="bg-bg p-4"><div class="text-[14px] font-medium">New code</div><p class="mt-1 text-[13.5px] leading-6 text-muted">Lines added or changed since the reference branch are measured on their own, so the gate judges the change.</p></div>
<div class="bg-bg p-4"><div class="text-[14px] font-medium">Open report</div><p class="mt-1 text-[13.5px] leading-6 text-muted">report.json follows a published JSON Schema: any tool can read it. SARIF output feeds code scanning.</p></div>
<div class="bg-bg p-4"><div class="text-[14px] font-medium">Any language</div><p class="mt-1 text-[13.5px] leading-6 text-muted">Languages are plugins: a JavaScript module, or any executable speaking JSON-RPC over stdio.</p></div>
</div>

## Your first analysis

[Install the qualis command](installation.html), then run it in the root of your repository:

```bash
qualis analyze
```

The command prints a summary, writes `.qualis/report.json` and exits with `0` when the quality gate passes, `1` when it fails and `2` on errors.

```text title="Terminal"
Quality gate "Qualis default": FAILED
  ✗ securityRating (new code) = D  fails when > A
  ✓ blockerIssues (overall) = 0  fails when > 0

Overall code
  Security        D  1 vulnerabilities
  Reliability     A  0 bugs
  Maintainability A  12 code smells, debt 2.1h (0.4%)
  Coverage        81.4%  lines 84.0%, branches 72.5%
  Duplications     1.2%  3 blocks, 41 lines
```

## How it works

1. **Discover files.** Files tracked by git (or matching `include`) are assigned to the plugin that handles their extension.
2. **Analyze.** Each language plugin returns issues, measures, per-function metrics and tokens for duplication detection; rule packs (ESLint, Roslyn) add the issues of their analyzers.
3. **Combine.** The core detects duplications, imports coverage and test reports, computes the new-code lines from git and the ratings.
4. **Decide.** The quality gate evaluates its conditions; the report is written as JSON (and SARIF).

## Principles

- **Every rule has a source.** A rule exists only if official documentation describes the problem. The rule page summarises the source in our own words and links to it; see [Sources](sources.html).
- **Honest numbers.** Where a threshold is a convention rather than a standard (for example the default coverage target), the documentation says so and the value is configurable.
- **Open contracts.** The report, the configuration and the plugin protocol are JSON Schemas under the Apache-2.0 license.
