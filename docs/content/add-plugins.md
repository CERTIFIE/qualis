---
title: Add plugins
description: The plugins that come with the qualis command, their options, and how to install and enable other plugins.
---
Plugins teach Qualis a language, or add rules to one. The CLI comes with four of them, installed and enabled by default: if your code is TypeScript, JavaScript or C#, there is nothing to do.

## Bundled plugins

| Plugin | Kind | Analyzes |
|---|---|---|
| `@qualis/plugin-typescript` | language | TypeScript and JavaScript (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`), with type information |
| `@qualis/plugin-csharp` | language | C# (`.cs`), with tree-sitter: no .NET needed |
| `@qualis/plugin-eslint` | rule pack | Adds the ESLint and typescript-eslint recommended rules to TypeScript and JavaScript |
| `@qualis/plugin-roslyn` | rule pack | Adds the Microsoft .NET code analysis rules (CA) to C#; needs the .NET SDK 10 |

A **language** plugin owns the files with its extensions and measures them; a **rule pack** adds the rules of an existing analyzer to the files of a language plugin. The rules of every plugin are in [Rules](rules/index.html).

## Add a plugin

**Step 1.** Install the plugin in the repository, if it is an npm package:

```bash
npm install --save-dev qualis-plugin-yaml   # example name of a plugin published on npm
```

A plugin can also be any program on disk, written in any language: then there is nothing to install with npm.

**Step 2.** List it in `qualis.config.json`. The `plugins` list **replaces** the default one, so also list the bundled plugins you still want:

```json title="qualis.config.json"
{
  "plugins": [
    "@qualis/plugin-typescript",
    "@qualis/plugin-eslint",
    "qualis-plugin-yaml",
    { "command": "python3", "args": ["tools/qualis_python.py"] }
  ]
}
```

Each entry is a package name, a package with options (`{ "module": "…", "options": { … } }`), or a command that starts a plugin running as a separate program (`{ "command": "…", "args": [ … ], "options": { … } }`). Package names resolve from the repository's `node_modules` first, then from the installation of the CLI, which holds the bundled plugins.

**Step 3.** Check the result:

```bash
qualis rules
```

It lists the rules of the configured plugins and whether each one is enabled. Then run `qualis analyze` as usual.

## Plugin options

| Plugin | Options |
|---|---|
| `@qualis/plugin-typescript` | `tsconfig`: path of the TypeScript configuration (default `tsconfig.json`). `typeCheck`: `false` disables the type-aware rules. |
| `@qualis/plugin-eslint` | `typeChecked`: run the type-aware typescript-eslint rules (default: when `tsconfig.json` exists in the project root). |
| `@qualis/plugin-roslyn` | `solution` or `projects`: what to load (default: the `.slnx`/`.sln` in the root, otherwise every `.csproj`). `restore`: `false` skips the automatic `dotnet restore` of projects that were never restored. |

```json title="qualis.config.json"
{
  "plugins": [
    { "module": "@qualis/plugin-typescript", "options": { "tsconfig": "tsconfig.app.json" } },
    "@qualis/plugin-csharp"
  ]
}
```

## Findings of other tools

To import the results of linters you already run (SARIF or ESLint JSON), you don't need a plugin: see [External issues](external-issues.html). To write a plugin of your own, see [Write a plugin](plugins.html).
