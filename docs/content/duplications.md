---
title: Duplications
description: How duplicated code is detected and measured.
---
Duplicated code is a maintainability weakness (CWE-1041, Use of Redundant Code): a fix applied to one copy is easily forgotten in the others.

## Detection

Qualis finds **type-1 clones** in the classification of Roy and Cordy: identical code fragments, ignoring layout and comments.

1. Each plugin turns a file into a token stream. Comments and whitespace are not tokens; import declarations (TypeScript) and `using` directives (C#) are left out, because similar import lists are not duplication.
2. The core hashes every window of `minTokens` consecutive tokens (Karp-Rabin rolling hash) across all files.
3. Matching windows are extended into the longest common blocks and verified token by token.
4. A block is reported when it has at least `minTokens` tokens (default 100) and spans at least `minLines` lines (default 10) in every occurrence. Occurrences overlapping each other in the same file are discarded.

## Measures

| Measure | Definition |
|---|---|
| Duplicated blocks | Number of occurrences of duplicated blocks. |
| Duplicated lines | Lines that belong to at least one occurrence. |
| Duplicated files | Files with at least one duplicated line. |
| Duplicated lines density | Duplicated lines ÷ lines × 100. |

Each duplication group in the report lists its occurrences with file and line range.

## Tuning

Raise `duplication.minTokens` to report only large copies; list generated or vendored code in `duplication.exclude` to keep it in the analysis but out of the duplication measures.
