---
title: Write a plugin
description: What you need and the steps to write a Qualis plugin, as a JavaScript module or as a program in any language, and the full protocol.
---
A plugin declares the languages and rules it supports and, for each file, returns issues (and, for a language plugin, measures). Everything else (duplication detection, coverage, tests, new code, ratings, quality gate, report) is done by the core, so a plugin stays small.

## What you need

| To write it in… | You need |
|---|---|
| JavaScript or TypeScript | Node.js 20.19 and the `@qualis/plugin-api` package, which provides `definePlugin`, `defineRule` and helpers. |
| Any other language | Only a program that reads and writes JSON-RPC 2.0 messages on stdin/stdout, one per line. |

In both cases every rule needs at least one reference to an official source, and a compliant and a noncompliant example (see [Rules need sources](#rules-need-sources)).

## Steps

**Step 1. Choose the kind.** A *language plugin* owns files by extension and measures them; a *rule pack* adds rules to the files of an existing language plugin. See [below](#language-plugins-and-rule-packs).

**Step 2. Start from an example.** For JavaScript, copy the [minimal plugin](#in-process-plugins-javascript); outside this repository install the API under its source name, so the imports work unchanged: `npm install @qualis/plugin-api@npm:{{npm-scope}}/qualis-plugin-api` (GitHub Packages, see [Install the CLI](installation.html#or-add-it-to-a-project)). For another language, copy [`examples/python-plugin`]({{tree-url}}/examples/python-plugin), a complete plugin written with the Python standard library.

**Step 3. Define the rules and analyze each file.** Return the issues of the enabled rules and, for a language plugin, the measures of the file (see [The contract](#the-contract)).

**Step 4. Try it on a repository.** Add it to `plugins` in that repository's `qualis.config.json` (see [Add plugins](add-plugins.html)), then run `qualis rules` and `qualis analyze`.

**Step 5. Publish it.** In your own repository, for example as `qualis-plugin-<language>` on npm, or as a pull request to this repository under `plugins/<name>` (see [Contribute](contributing.html)).

## Language plugins and rule packs

| Kind | Owns files | Returns | Examples |
|---|---|---|---|
| `language` (default) | yes: the files with its extensions | issues and measures | `@qualis/plugin-typescript`, `@qualis/plugin-csharp` |
| `rule-pack` | no: it receives the files of the languages it lists, owned by language plugins | issues only | `@qualis/plugin-eslint`, `@qualis/plugin-roslyn` |

A rule pack wraps an existing analyzer (ESLint, Roslyn, Semgrep, a team's own checks) without re-implementing metrics. A rule may declare `supersedes: ["other-plugin:rule"]`: while it is enabled and its pack prepared successfully, the superseded rule does not run, so the same problem is not reported twice. When a pack throws in `prepare` (for example because the project does not build), its rules are skipped with a warning and the superseded rules run as usual.

## The contract

A plugin publishes a **manifest** ([schema](schemas/plugin-manifest.schema.json)):

| Field | Meaning |
|---|---|
| `apiVersion` | `1`. |
| `kind` | `language` (default) or `rule-pack`. |
| `id` | Lower-case id; rule ids must start with `id:`. |
| `name`, `version`, `description` | Display information. |
| `languages` | Language ids and file extensions (`.py`), lower case. |
| `rules` | Rule definitions: id, name, type, severity, tags, default state, remediation effort, description, rationale, examples, parameters and **at least one reference**. |

For each file a language plugin returns a **file analysis** ([schema](schemas/file-analysis.schema.json)); a rule pack returns only `issues` and `diagnostics`:

| Field | Required | Meaning |
|---|---|---|
| `issues` | yes | Rule id, message, range, optional secondary locations and effort. Only enabled rules may report. |
| `measures` | yes | `lines`, `ncloc`, `commentLines`, `functions`, `classes`, `statements`, `complexity`, `cognitiveComplexity`, as defined in [Metrics](metrics.html). |
| `functions` | no | Per-function metrics; needed for function statistics, hotspots and the maintainability index. |
| `halstead` | no | File-level Halstead counts. |
| `codeLines` | no | Lines that contain code; used to measure new code precisely. |
| `executableLines` | no | Lines a coverage tool would count as executable; the lines to cover of files missing from the coverage reports. |
| `cpdTokens` | no | Normalised tokens with lines, for duplication detection. |
| `diagnostics` | no | Warnings such as syntax errors. |

## In-process plugins (JavaScript)

An npm package whose default export is a plugin object or a function returning one:

```ts title="index.ts"
import { definePlugin, LineIndex, PLUGIN_API_VERSION } from "@qualis/plugin-api";

export default definePlugin({
  apiVersion: PLUGIN_API_VERSION,
  id: "yaml",
  name: "YAML",
  version: "1.0.0",
  languages: [{ id: "yaml", name: "YAML", extensions: [".yml", ".yaml"] }],
  rules: [/* rule definitions with references */],
  analyzeFile({ content, rules }) {
    const lines = new LineIndex(content);
    return {
      issues: [],
      measures: { lines: lines.lineCount, ncloc: 0, commentLines: 0, functions: 0, classes: 0, statements: 0, complexity: 0, cognitiveComplexity: 0 },
    };
  },
});
```

Optional `prepare({ baseDir, files, options, rules, log })` runs once before the files (`rules` lists the enabled rules of the plugin) (the TypeScript plugin builds its program there) and `dispose()` once at the end. `@qualis/plugin-api` also provides `HalsteadCounter`, `Suppressions` (the `qualis-ignore-*` directives) and `LineIndex`.

## Out-of-process plugins (any language)

Any executable can be a plugin. The host starts it with the configured command and talks **JSON-RPC 2.0** over its standard input and output, **one JSON message per line** (UTF-8, `\n`-terminated). Standard error is free for logs.

```json title="qualis.config.json"
{ "plugins": [{ "command": "dotnet", "args": ["tools/MyPlugin.dll"], "options": { "strict": true } }] }
```

| Step | Message | Answer |
|---|---|---|
| 1 | request `initialize` `{ apiVersion: 1, host: { name, version } }` | the manifest |
| 2 | request `prepare` `{ baseDir, files: [{ path, absolutePath, language }], options, rules: [{ id, params }] }` | `null` |
| 3 | request `analyzeFile` `{ file, content, rules: [{ id, params }] }`, once per file | a file analysis |
| 4 | request `shutdown` `{}` | `null` |
| 5 | notification `exit` | the process exits |

At any time the plugin may send the notification `log` `{ level: "debug" | "info" | "warning" | "error", message }`; warnings and errors appear in the report diagnostics. Errors are answered with a standard JSON-RPC error object. Requests are sent one at a time.

```text title="stdin / stdout"
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"apiVersion":1,"host":{"name":"qualis","version":"0.1.0"}}}
← {"jsonrpc":"2.0","id":1,"result":{"apiVersion":1,"id":"python","name":"Python","version":"0.1.0","languages":[…],"rules":[…]}}
→ {"jsonrpc":"2.0","id":2,"method":"prepare","params":{"baseDir":"/repo","files":[…],"options":{}}}
← {"jsonrpc":"2.0","id":2,"result":null}
→ {"jsonrpc":"2.0","id":3,"method":"analyzeFile","params":{"file":{"path":"app.py",…},"content":"…","rules":[{"id":"python:bare-except","params":{}}]}}
← {"jsonrpc":"2.0","id":3,"result":{"issues":[…],"measures":{…}}}
```

The host validates the manifest and every result against the schemas and rejects invalid answers with a clear error. Time limits: 30 s for `initialize`, 30 min for `prepare`, 2 min per `analyzeFile`, 10 s for `shutdown`.

### Publishing a process plugin on npm

A JavaScript module may ask the host to start a process instead of returning a plugin object, so a plugin written in another language can be installed and referenced like any package:

```js title="index.js"
import { fileURLToPath } from "node:url";

export default () => ({ command: "dotnet", args: [fileURLToPath(new URL("./bin/MyPlugin.dll", import.meta.url))] });
```

`@qualis/plugin-roslyn` works this way: its module checks that .NET 10 is installed and returns the command of its .NET helper, or a stand-in rule pack that explains in `prepare` why it cannot run.

> [!TIP]
> The repository contains two complete out-of-process plugins: an example language plugin written in Python with only the standard library (`examples/python-plugin/qualis_python.py`) and the Roslyn rule pack written in C# (`plugins/roslyn/dotnet`). `runStdioPlugin()` from `@qualis/plugin-api` serves any JavaScript plugin over the same protocol.

## Rules need sources

The schema requires at least one reference per rule. To keep the catalog trustworthy:

- Base each rule on documentation published by the authority on the subject: the language or platform vendor, a standard (CWE, ISO, NIST, IETF) or OWASP.
- Explain the problem **in your own words** in `rationale`, and link the exact section in `references`.
- Give a noncompliant and a compliant example, and test that the first raises the rule and the second does not.
- Prefer a security hotspot to a vulnerability when the code can only be judged by a person.
