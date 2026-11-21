---
title: New code
description: How Qualis decides which lines are new and what it measures on them.
---
New code is every line **added or changed** since the reference, including uncommitted changes in the working tree. Files not yet tracked by git are new in full. Deleted lines are not new code.

## Choosing the reference

| `newCode.reference` | Behaviour |
|---|---|
| `"auto"` (default) | On a pull request, the target branch from the CI variables (`GITHUB_BASE_REF`, `SYSTEM_PULLREQUEST_TARGETBRANCH`, `CI_MERGE_REQUEST_TARGET_BRANCH_NAME`). Otherwise the default branch: `origin/HEAD`, then `origin/main`, `origin/master`, `main`, `master`. On the default branch itself there is no new code. |
| `"origin/main"`, a tag or a commit | Compare with this reference. If it does not exist, the analysis fails with exit code 2. |
| `null` | Disable new-code detection. |

Qualis compares with the **merge base** of `HEAD` and the reference (`git merge-base`), so commits added to the target branch after the branch was created are not counted as new.

## What is measured

| Measure | Meaning |
|---|---|
| Lines, lines of code | Added or changed lines, and those of them that contain code. |
| Issues | Issues whose first line is a new line (`isNew: true` in the report). |
| Ratings, debt | Computed on the new issues and the new lines of code. |
| Coverage | Coverage of the new lines that the coverage report knows about. |
| Duplications | New lines that belong to a duplicated block. |

## Stable issues

Each issue has a fingerprint built from the rule, the file, the text of the offending line and its rank among identical lines. An issue keeps the same id when unrelated lines are inserted above it, which lets viewers track issues from one analysis to the next.
