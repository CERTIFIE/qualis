---
title: Installation
description: Requirements and the ways to install the qualis command line, from a release download, from GitHub Packages or from source.
---
## Requirements

- **Node.js 20.19** or later (required by ESLint 10).
- **pnpm 10**, to build from source (`corepack enable` installs the version the repository asks for).
- **git**, to skip ignored files and to detect new code. Without git, every file matching `include` is analyzed and there is no new code.
- **.NET SDK 10** or later, optional: it enables the [Roslyn rule pack](rules/roslyn.html), which runs the Microsoft code analysis rules with full semantic information. Without it the C# plugin still analyzes C# with tree-sitter (no .NET needed) and reports why the Roslyn rules were skipped.

## Download

Every release on [GitHub]({{release-url}}) contains the `qualis` command with all its dependencies, ready to run with Node.js. This documentation describes Qualis {{version}}:

{{downloads}}

Extract the archive and run the command in place, or install it globally:

```bash
tar -xzf qualis-{{version}}.tar.gz
npm install --global ./qualis-{{version}}
qualis --version
```

## From GitHub Packages

The npm packages are published on [GitHub Packages]({{repo-url}}/packages) under the `{{npm-scope}}` scope (`{{npm-scope}}/qualis`, `{{npm-scope}}/qualis-core`, ...). Official releases have the `latest` tag, beta builds the `beta` tag. GitHub Packages asks for a token even for public packages: create a personal access token (classic) with the `read:packages` scope, then point the scope to the registry in the project's `.npmrc` (or in `~/.npmrc`):

```ini title=".npmrc"
{{npm-scope}}:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash tab=npm
npm install --save-dev {{npm-scope}}/qualis{{npm-tag}}
npx qualis analyze
```

```bash tab=pnpm
pnpm add --save-dev {{npm-scope}}/qualis{{npm-tag}}
pnpm qualis analyze
```

In GitHub Actions the workflow's own `GITHUB_TOKEN` is enough, with `permissions: packages: read`.

## Build from source

The source code is on [GitHub]({{repo-url}}).

```bash
git clone {{repo-url}}.git qualis
cd qualis
pnpm install
pnpm build
```

`pnpm build` compiles every package, copies the C# grammar and, when the .NET SDK is installed, publishes the Roslyn helper. Without .NET the build still succeeds and the Roslyn rule pack stays off.

## Install the qualis command

Install the CLI package of your checkout globally, so that `qualis` works in any folder:

```bash
npm install --global ./packages/cli
```

npm links the global command to the checkout instead of copying it: after a `git pull` and `pnpm build` the command runs the new version without reinstalling. Remove it with `npm uninstall --global qualis`.

Without a global install, run the CLI from the root of the checkout and pass the project folder:

```bash
pnpm qualis analyze ~/projects/my-app
```

## As a project dependency

Add Qualis to a project as a development dependency (see [From GitHub Packages](#from-github-packages)), so that every developer and the CI run the same version. Only the analyzer is installed: the [web UI](web-ui.html) is a separate application, also published as a container image (`{{ui-image}}`).

Then add a script to the project's `package.json`, and run it with `npm run analyze` or `pnpm analyze`:

```json title="package.json"
{
  "scripts": {
    "analyze": "qualis analyze"
  }
}
```

## Check the installation

```bash
qualis --version
qualis rules
```

`qualis rules` lists the rules of the configured plugins and whether each one is enabled. When the Roslyn rules are missing from the list, run `qualis analyze --verbose` in a C# project: the log says why the rule pack was skipped (no .NET SDK, or the helper was not built).

Continue with [Usage](usage.html) to analyze your first project.

## Packages

The workspace packages are named `@qualis/*` in the source code; on GitHub Packages they are published under the `{{npm-scope}}` scope, and their dependencies on each other are npm aliases, so that the code still imports `@qualis/*`.

| Package | Published as | Purpose |
|---|---|---|
| [`qualis`]({{tree-url}}/packages/cli) | `{{npm-scope}}/qualis` | Command line interface; depends on the bundled plugins. |
| [`@qualis/core`]({{tree-url}}/packages/core) | `{{npm-scope}}/qualis-core` | Analysis engine, usable as a library (`analyze()`, `writeReport()`). |
| [`@qualis/schema`]({{tree-url}}/packages/schema) | `{{npm-scope}}/qualis-schema` | JSON Schemas and TypeScript types of the report, configuration and plugin protocol. |
| [`@qualis/plugin-api`]({{tree-url}}/packages/plugin-api) | `{{npm-scope}}/qualis-plugin-api` | Contract and helpers for writing plugins. |
| [`@qualis/plugin-typescript`]({{tree-url}}/plugins/typescript) | `{{npm-scope}}/qualis-plugin-typescript` | TypeScript and JavaScript plugin. |
| [`@qualis/plugin-csharp`]({{tree-url}}/plugins/csharp) | `{{npm-scope}}/qualis-plugin-csharp` | C# plugin (tree-sitter, no .NET needed). |
| [`@qualis/plugin-eslint`]({{tree-url}}/plugins/eslint) | `{{npm-scope}}/qualis-plugin-eslint` | Rule pack: ESLint and typescript-eslint recommended rules. |
| [`@qualis/plugin-roslyn`]({{tree-url}}/plugins/roslyn) | `{{npm-scope}}/qualis-plugin-roslyn` | Rule pack: Microsoft .NET code analysis rules (CA), run by a .NET helper over the stdio protocol. |
| [`@qualis/ui`]({{tree-url}}/apps/ui) | `{{ui-image}}` | Web UI, as a container image. |
