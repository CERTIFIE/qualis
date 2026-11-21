---
title: Installation
description: Requirements and the ways to install the qualis command line, today from source and later from npm.
---
## Requirements

- **Node.js 20.19** or later (required by ESLint 10).
- **pnpm 10**, to build from source (`corepack enable` installs the version the repository asks for).
- **git**, to skip ignored files and to detect new code. Without git, every file matching `include` is analyzed and there is no new code.
- **.NET SDK 10** or later, optional: it enables the [Roslyn rule pack](rules/roslyn.html), which runs the Microsoft code analysis rules with full semantic information. Without it the C# plugin still analyzes C# with tree-sitter (no .NET needed) and reports why the Roslyn rules were skipped.

> [!NOTE]
> Qualis 0.1.0 is not yet published to npm. Until then, build it from source and install the `qualis` command from your checkout, as described below.

## Build from source

```bash
git clone <repository-url> qualis
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

Once published, add Qualis to a project as a development dependency, so that every developer and the CI run the same version. Only the analyzer is installed: the [web UI](web-ui.html) is a separate application.

```bash tab=npm
npm install --save-dev qualis
npx qualis analyze
```

```bash tab=pnpm
pnpm add --save-dev qualis
pnpm qualis analyze
```

```bash tab=bun
bun add --dev qualis
bunx qualis analyze
```

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

| Package | Purpose |
|---|---|
| `qualis` | Command line interface; depends on the bundled plugins. |
| `@qualis/core` | Analysis engine, usable as a library (`analyze()`, `writeReport()`). |
| `@qualis/schema` | JSON Schemas and TypeScript types of the report, configuration and plugin protocol. |
| `@qualis/plugin-api` | Contract and helpers for writing plugins. |
| `@qualis/plugin-typescript` | TypeScript and JavaScript plugin. |
| `@qualis/plugin-csharp` | C# plugin (tree-sitter, no .NET needed). |
| `@qualis/plugin-eslint` | Rule pack: ESLint and typescript-eslint recommended rules. |
| `@qualis/plugin-roslyn` | Rule pack: Microsoft .NET code analysis rules (CA), run by a .NET helper over the stdio protocol. |
