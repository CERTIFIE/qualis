---
title: CI integration
description: Run the analysis in a pipeline, stop the build on a failed quality gate and publish SARIF.
---
The CLI exits with a code a pipeline can act on:

| Exit code | Meaning |
|---|---|
| `0` | The quality gate passed, or `--no-fail` was given. |
| `1` | The quality gate failed. |
| `2` | The analysis could not run (invalid configuration, plugin failure, missing reference). |

New code is detected automatically on pull requests: Qualis reads the target branch from `GITHUB_BASE_REF` (GitHub Actions), `SYSTEM_PULLREQUEST_TARGETBRANCH` (Azure DevOps) or `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` (GitLab). The pipeline must fetch enough history for `git merge-base` to find the common ancestor.

## GitHub Actions

```yaml title=".github/workflows/quality.yml"
name: quality
on: [pull_request]
permissions:
  contents: read
  security-events: write
jobs:
  qualis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test -- --coverage
      - run: npx qualis analyze . --format json,sarif --coverage coverage/lcov.info
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: .qualis/report.sarif
```

The workflow runs the `qualis` of the project's development dependencies (see [Install the CLI](installation.html#or-add-it-to-a-project)): it comes from npmjs, so `npm ci` needs no registry configuration or token.

## Azure DevOps

```yaml title="azure-pipelines.yml"
steps:
  - checkout: self
    fetchDepth: 0
  - task: UseDotNet@2
    inputs:
      version: 8.x
  - script: dotnet test --logger trx --collect "XPlat Code Coverage"
    displayName: Tests
  - script: npx qualis analyze . --tests "**/*.trx" --coverage "**/coverage.cobertura.xml"
    displayName: Qualis
```

## Keep the report

Archive `.qualis/report.json` as a build artifact: it contains everything a viewer needs, and comparing two reports shows how quality evolves. Add `--include-sources` when the viewer runs without access to the repository.
