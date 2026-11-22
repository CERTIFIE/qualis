---
title: Install the CLI
description: Install the qualis command from a release download, or as a development dependency of a project from GitHub Packages.
---
## Requirements

- **Node.js 20.19** or later.
- **git**, to skip ignored files and to detect new code.
- **.NET SDK 10**, optional: it enables the [Roslyn rule pack](rules/roslyn.html), the Microsoft analyzers for C#. Without it, C# is still analyzed (no .NET needed).

## Install it on your computer

Download the archive of the latest release from [GitHub]({{release-url}}). It contains the `qualis` command with all its dependencies, so no registry or token is needed. This documentation describes Qualis {{version}}:

{{downloads}}

Extract it and install it globally:

```bash
tar -xzf qualis-{{version}}.tar.gz
npm install --global ./qualis-{{version}}
qualis --version
```

On Windows, extract the `.zip` and run the same `npm install --global` on the extracted folder. To remove it: `npm uninstall --global qualis`.

## Or add it to a project

To give every developer and the CI the same version, add Qualis as a development dependency. The npm packages are on [GitHub Packages]({{repo-url}}/packages) as `{{npm-scope}}/qualis`, `{{npm-scope}}/qualis-core`, … (official releases have the `latest` tag, beta builds the `beta` tag).

GitHub Packages asks for a token, also for public packages:

**Step 1.** Create a personal access token (classic) with the `read:packages` scope.
**Step 2.** Tell npm where the `{{npm-scope}}` packages are, in the project's `.npmrc` (or `~/.npmrc`):

```ini title=".npmrc"
{{npm-scope}}:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

**Step 3.** Install it and run it:

```bash tab=npm
npm install --save-dev {{npm-scope}}/qualis{{npm-tag}}
npx qualis analyze
```

```bash tab=pnpm
pnpm add --save-dev {{npm-scope}}/qualis{{npm-tag}}
pnpm qualis analyze
```

In GitHub Actions the workflow's own `GITHUB_TOKEN` is enough, with `permissions: packages: read` (see [CI integration](ci.html)).

## Check the installation

```bash
qualis --version
qualis rules
```

`qualis rules` lists the rules of the configured plugins and whether each one is enabled. When the Roslyn rules are missing, run `qualis analyze --verbose` in a C# project: the log says why the rule pack was skipped.

Next: [Analyze a repository](usage.html). To run Qualis from a checkout of its source code, see [Contribute](contributing.html#build-from-source).

## Packages

The CLI depends on all the packages below, so installing it installs them too. In the source code they are named `@qualis/*`; on GitHub Packages they are published under the `{{npm-scope}}` scope, and their dependencies on each other are npm aliases, so the code still imports `@qualis/*`.

| Package | Published as | Purpose |
|---|---|---|
| [`qualis`]({{tree-url}}/packages/cli) | `{{npm-scope}}/qualis` | Command line interface; depends on the bundled plugins. |
| [`@qualis/core`]({{tree-url}}/packages/core) | `{{npm-scope}}/qualis-core` | Analysis engine, usable as a library (`analyze()`, `writeReport()`). |
| [`@qualis/schema`]({{tree-url}}/packages/schema) | `{{npm-scope}}/qualis-schema` | JSON Schemas and TypeScript types of the report, configuration and plugin protocol. |
| [`@qualis/plugin-api`]({{tree-url}}/packages/plugin-api) | `{{npm-scope}}/qualis-plugin-api` | Contract and helpers for [writing plugins](plugins.html). |
| [`@qualis/plugin-typescript`]({{tree-url}}/plugins/typescript) | `{{npm-scope}}/qualis-plugin-typescript` | TypeScript and JavaScript plugin. |
| [`@qualis/plugin-csharp`]({{tree-url}}/plugins/csharp) | `{{npm-scope}}/qualis-plugin-csharp` | C# plugin (tree-sitter, no .NET needed). |
| [`@qualis/plugin-eslint`]({{tree-url}}/plugins/eslint) | `{{npm-scope}}/qualis-plugin-eslint` | Rule pack: ESLint and typescript-eslint recommended rules. |
| [`@qualis/plugin-roslyn`]({{tree-url}}/plugins/roslyn) | `{{npm-scope}}/qualis-plugin-roslyn` | Rule pack: Microsoft .NET code analysis rules (CA), run by a .NET helper. |
| [`@qualis/ui`]({{tree-url}}/apps/ui) | `{{ui-image}}` | [Qualis UI](ui-install.html), as a container image. |
