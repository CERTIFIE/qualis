---
title: Quality gate
description: The conditions that decide whether an analysis passes, the default gate and how to define your own.
---
The quality gate is a list of conditions on metrics. The analysis **fails** when at least one condition fails; the CLI then exits with code 1.

## Default gate

| Metric | Scope | Fails when |
|---|---|---|
| Reliability rating | New code | worse than A |
| Security rating | New code | worse than A |
| Maintainability rating | New code | worse than A |
| Coverage | New code | below 80 % |
| Duplicated lines | New code | above 3 % |
| Blocker issues | Overall | above 0 |
| Test failures | Overall | above 0 |

The default gate concentrates on new code: an old project can adopt Qualis without fixing its history first, while every change must be clean. The coverage and duplication targets are team conventions; adapt them to your project.

## No data

A condition whose metric is not available is reported as **no-data** and does not fail the gate. This happens when there is no coverage or test report, or no new code (for example on the default branch). The summary and the report show these conditions so that a missing report is noticed.

## Custom gate

```json title="qualis.config.json"
{
  "qualityGate": {
    "name": "Release",
    "conditions": [
      { "metric": "securityRating", "scope": "overall", "operator": "gt", "threshold": "A" },
      { "metric": "securityHotspots", "scope": "new", "operator": "gt", "threshold": 0 },
      { "metric": "coverage", "scope": "new", "operator": "lt", "threshold": 90 },
      { "metric": "testFailures", "operator": "gt", "threshold": 0 }
    ]
  }
}
```

- `operator` is `gt` (fails when the value is greater, or the rating worse) or `lt` (fails when the value is lower).
- `threshold` is a number, or a rating letter for rating metrics.
- `scope` is `overall` (default) or `new`.

## Metrics

| Metric | Overall | New code |
|---|---|---|
| `reliabilityRating`, `securityRating`, `maintainabilityRating` | yes | yes |
| `issues`, `blockerIssues`, `criticalIssues`, `majorIssues` | yes | yes |
| `bugs`, `vulnerabilities`, `securityHotspots`, `codeSmells` | yes | yes |
| `technicalDebtMinutes`, `debtRatio` | yes | yes |
| `coverage`, `lineCoverage`, `branchCoverage` | yes | yes |
| `duplicatedLinesDensity` | yes | yes |
| `testFailures` (failed + errors), `testSuccessDensity` | yes | no |

An inconsistent condition (a letter for a numeric metric, a test metric on new code) stops the analysis with exit code 2.
