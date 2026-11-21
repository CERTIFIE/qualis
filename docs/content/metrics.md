---
title: Metrics
description: What each metric measures, how it is computed and how to read it.
---
Metrics describe the code without judging it; rules and the quality gate judge. Every metric below is computed by the language plugin for each file and each function, and aggregated by the core. Plugins written by third parties follow the same definitions, which are part of the [plugin contract](plugins.html).

## Size

| Metric | Definition |
|---|---|
| Lines | Physical lines. A final line break does not start a new line. |
| Lines of code (`ncloc`) | Lines containing at least one token that is not a comment. Blank lines and comment-only lines are excluded. |
| Comment lines | Lines containing comment text with at least one letter or digit. Decorative lines such as `/*` or `// -----` are not counted. |
| Comment density | Comment lines ÷ (lines of code + comment lines) × 100. |
| Functions | Function-like elements with a body: functions, methods, constructors, accessors, local functions and lambdas. |
| Classes | Classes (TypeScript, JavaScript) and classes, structs and records (C#). |
| Statements | Executable statements; blocks and empty statements are not counted. |

## Cyclomatic complexity

McCabe's cyclomatic complexity counts the linearly independent paths through a function, which is also the minimum number of test cases that cover all of them. For a function it is **1 + the number of decision points**:

| Language | Decision points |
|---|---|
| TypeScript, JavaScript | `if`, `?:`, `for`, `for…in`, `for…of`, `while`, `do`, each `case` (not `default`), `catch`, `&&`, `\|\|`, `??`, `&&=`, `\|\|=`, `??=` |
| C# | `if`, `?:`, `for`, `foreach`, `while`, `do`, each `case` label, each switch-expression arm except the discard `_`, `catch`, `&&`, `\|\|`, `??`, `??=` |

A file's complexity is the sum over its functions plus the decision points outside functions. NIST SP 500-235 recommends a limit of 10 per function; ISO/IEC 5055 flags functions above 20. Qualis groups functions into the bands of the SEI C4 reference guide:

| Band | Complexity | Reading |
|---|---|---|
| Low | 1–10 | Simple, low risk |
| Moderate | 11–20 | More complex, moderate risk |
| High | 21–50 | Complex, high risk |
| Very high | above 50 | Very high risk, hard to test |

**Complexity density** is the cyclomatic complexity per 1000 lines of code; it compares projects of different size.

## Cognitive complexity

Cognitive complexity estimates how hard a function is to *understand* rather than to test. It follows G. Ann Campbell's definition:

- **+1 for each break in the linear flow**: `if`, `else if`, `else`, `?:`, `switch`, loops, `catch`, labelled `break`/`continue` (TypeScript), `goto` (C#), each sequence of like logical operators (`a && b && c` counts 1, `a && b || c` counts 2) and each recursive call.
- **+1 per nesting level** for the structures that nest (`if`, `?:`, `switch`, loops, `catch`) — but not for `else if` and `else`.
- **Nesting increases** inside those structures and inside nested functions and lambdas; their structures count toward the enclosing function.
- **Shorthand is free**: `?.` and `??` do not add anything.

A `switch` with many cases costs 1 instead of one per case, which is why it can have a high cyclomatic but a low cognitive complexity.

## Nesting depth and parameters

**Maximum nesting depth** is the deepest nesting of `if`, loops, `switch` and `try` inside a function (an `else if` chain counts as one level). **Parameters** is the number of declared parameters (TypeScript's `this` parameter excluded). ISO/IEC 5055 uses 7 parameters as the threshold, enforced by the `too-many-parameters` rules.

## Halstead measures

Halstead's software science counts the tokens of a program as **operators** (keywords, punctuation, operators) and **operands** (identifiers, literals, `this`, `true`, `null`…). Closing brackets are counted once with their opening bracket.

| Measure | Formula |
|---|---|
| Vocabulary *n* | n₁ + n₂ (distinct operators + distinct operands) |
| Length *N* | N₁ + N₂ (total operators + total operands) |
| Volume *V* | N × log₂ n |
| Difficulty *D* | (n₁ ÷ 2) × (N₂ ÷ n₂) |
| Effort *E* | D × V |
| Time *T* | E ÷ 18 seconds |
| Delivered bugs *B* | E^(2/3) ÷ 3000 |

Volume grows with the amount of information in the code; difficulty grows when a few operands are reused by many operators. The time and bug estimates are coarse, historical models: compare them between functions, do not read them as absolute values.

## Maintainability index

The maintainability index combines volume, complexity and size into a value between 0 and 100. Qualis uses the variant documented for Visual Studio:

```text
MI = max(0, (171 − 5.2 × ln(V) − 0.23 × CC − 16.2 × ln(LOC)) × 100 ÷ 171)
```

where *V* is the Halstead volume, *CC* the cyclomatic complexity and *LOC* the lines of code of the function.

| Band | Range | Reading |
|---|---|---|
| High | 20–100 | Good maintainability |
| Moderate | 10–19 | Moderately maintainable |
| Low | 0–9 | Low maintainability |

A file's maintainability index in the report is the lowest index among its functions: the weakest function is what a maintainer will struggle with.

## Hotspots

The report lists the ten functions with the highest cyclomatic complexity, the ten with the highest cognitive complexity and the ten with the lowest maintainability index. They are the best starting point for a refactoring.
