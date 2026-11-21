---
title: Ratings and technical debt
description: How issues become A–E ratings for security, reliability and maintainability, and how technical debt is estimated.
---
Every issue has a **type** and a **severity**. The type decides which quality characteristic it affects; the names of the characteristics follow the ISO/IEC 25010 product quality model.

| Type | Characteristic | Effect |
|---|---|---|
| Vulnerability | Security | Lowers the security rating. |
| Security hotspot | Security | Needs a manual review; counted, but does **not** lower the rating. |
| Bug | Reliability | Lowers the reliability rating. |
| Code smell | Maintainability | Adds technical debt. |

Severities are `blocker`, `critical`, `major`, `minor` and `info`. Each rule has a default severity, which the [configuration](configuration.html#rules) can change.

## Security and reliability ratings

The rating is driven by the worst issue:

| Rating | Worst vulnerability (security) or bug (reliability) |
|---|---|
| A | none, or only `info` |
| B | at least one `minor` |
| C | at least one `major` |
| D | at least one `critical` |
| E | at least one `blocker` |

## Technical debt

Each rule estimates the time needed to fix one issue (`effortMinutes`, shown on every rule page; some rules scale it, for example by how far a function exceeds the complexity limit). **Technical debt** is the sum of the remediation estimates of the maintainability issues. Expressing quality as a remediation cost is the idea behind the SQALE method (Letouzey).

## Maintainability rating

The **debt ratio** compares the debt with the estimated cost of writing the code:

```text
debt ratio = technical debt ÷ (lines of code × development cost per line) × 100
```

| Rating | Debt ratio (default thresholds) |
|---|---|
| A | ≤ 5 % |
| B | ≤ 10 % |
| C | ≤ 20 % |
| D | ≤ 50 % |
| E | above 50 % |

> [!WARNING]
> The development cost per line (30 minutes) and the thresholds are conventions, not values fixed by a standard. Change them with `ratings.developmentCostMinutesPerLine` and `ratings.maintainabilityThresholds` if your team estimates differently; keep them stable over time so that ratings remain comparable.

## On new code

The same ratings are computed on the issues of [new code](new-code.html), with the new lines of code as the size, so a single change can be judged on its own.
