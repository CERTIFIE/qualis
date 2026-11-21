# Contributing to Qualis

Qualis is free and open source software under the [Apache License 2.0](LICENSE). Everyone is welcome to use it, fork it, help maintain it and extend it with new plugins. This guide explains how to contribute to the project and how to write a plugin.

## Ways to contribute

- **Report a bug or propose a feature**: open an [issue](https://github.com/CERTIFIE/qualis/issues). For a bug, include the Qualis version, the command you ran, what you expected and what happened, and if possible a small file that reproduces it. A false positive or a missed issue is a bug too: include the rule id and the code.
- **Improve the documentation**: the pages are in `docs/content/` (Markdown) and the rule pages are generated from the rule metadata of the plugins.
- **Fix a bug or add a rule** to one of the bundled plugins.
- **Write a plugin** for a new language or a new set of rules, either in this repository or in your own (see [Writing a plugin](#writing-a-plugin)).
- **Review pull requests** and help other users in the issues.

## License of contributions

By opening a pull request you agree that your contribution is licensed under the Apache License 2.0, as section 5 of the license states, and that you have the right to submit it. Do not copy code, rule texts or examples from sources whose license does not allow it. When a contribution includes a third-party component, keep its license and add it to the list in [NOTICE](NOTICE).

New source files do not need a license header: the repository's LICENSE and NOTICE cover them.

## Development setup

Requirements: Node.js 20.19 or later, pnpm 10 and git. The .NET SDK 10 is optional and needed only for the Roslyn rule pack.

```bash
git clone https://github.com/CERTIFIE/qualis.git   # or your fork
cd qualis
pnpm install
pnpm build          # compile every package (tsc -b)
pnpm test           # build, then run all the tests with vitest
pnpm qualis analyze path/to/project   # run the local qualis command
```

`pnpm test:watch` reruns the tests on every change, and `pnpm vitest run plugins/csharp` runs the tests of one package (after `pnpm build`). The layout of the repository is described in the [README](README.md#development).

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one change, and explain in its description what it changes and why.
3. Add or update tests. Every rule's noncompliant example must raise the rule and its compliant example must not; the tests run the examples shown in the documentation.
4. Update the documentation (`README.md`, `docs/content/`) when behaviour, options or rules change.
5. Run `pnpm test` and `pnpm typecheck` before pushing. The [pipeline](.github/workflows/pipeline.yml) runs the same tests on every pull request.

A maintainer reviews the pull request, may ask for changes, and merges it when it is ready. Be patient and kind: reviews are done by volunteers.

### Style

- TypeScript in strict mode, ES modules, no `any` where a type can be written.
- Prefer small functions and clear names to comments; comment the *why*, not the *what*.
- Messages, documentation and code are written in English.

## Writing a plugin

A plugin teaches Qualis a language or adds rules to one. The core does everything else (duplication, coverage, tests, new code, ratings, quality gate, report), so a plugin stays small. The full contract is in [Writing a plugin](docs/content/plugins.md); this section is a short path through it.

### Choose the kind and the transport

| | Language plugin | Rule pack |
|---|---|---|
| Owns files | yes, by extension | no, it receives the files of a language plugin |
| Returns | issues and measures | issues only |
| Examples | `plugins/typescript`, `plugins/csharp` | `plugins/eslint`, `plugins/roslyn` |

A plugin can run **in process**, as an npm package written in JavaScript or TypeScript, or **out of process**, as any executable that speaks JSON-RPC 2.0 over stdin/stdout, so it can be written in any language. [`examples/python-plugin`](examples/python-plugin) is a complete out-of-process plugin written in Python with only the standard library.

### A minimal in-process plugin

```ts
import { definePlugin, defineRule, LineIndex, PLUGIN_API_VERSION } from "@qualis/plugin-api";

const noTabs = defineRule({
  id: "yaml:no-tabs",
  name: "Tabs should not be used for indentation",
  languages: ["yaml"],
  type: "bug",
  severity: "major",
  tags: ["syntax"],
  enabledByDefault: true,
  effortMinutes: 1,
  description: "Reports lines indented with tab characters.",
  rationale: "The YAML specification forbids tabs in indentation, so parsers reject the file.",
  noncompliantExample: "a:\n\tb: 1",
  compliantExample: "a:\n  b: 1",
  references: [{ publisher: "YAML", id: "YAML 1.2.2", title: "Indentation Spaces", url: "https://yaml.org/spec/1.2.2/#61-indentation-spaces" }],
});

export default definePlugin({
  apiVersion: PLUGIN_API_VERSION,
  id: "yaml",
  name: "YAML",
  version: "0.1.0",
  languages: [{ id: "yaml", name: "YAML", extensions: [".yml", ".yaml"] }],
  rules: [noTabs],
  analyzeFile({ content, rules }) {
    const lines = new LineIndex(content);
    return {
      issues: [], // report only the rules listed in `rules`
      measures: { lines: lines.lineCount, ncloc: 0, commentLines: 0, functions: 0, classes: 0, statements: 0, complexity: 0, cognitiveComplexity: 0 },
    };
  },
});
```

The rule definition above follows the schema; check the exact fields in [`packages/schema`](packages/schema) and copy a rule of an existing plugin when in doubt. Enable the plugin in `qualis.config.json`:

```json
{ "plugins": ["@qualis/plugin-typescript", "qualis-plugin-yaml"] }
```

or, for an out-of-process plugin, `{ "command": "python3", "args": ["tools/my_plugin.py"] }`.

### Rules need sources

Every rule must have at least one reference to a published authority (the language or platform vendor, a standard such as CWE, ISO, NIST or IETF, or OWASP). Explain the problem in your own words in `rationale`, link the exact section in `references`, and give a noncompliant and a compliant example that the tests check. This keeps the catalog trustworthy.

### Where to publish it

- **In your own repository**: you own it and choose its license; Qualis loads any npm package or executable. Name it, for example, `qualis-plugin-<language>`, say that it is a plugin for Qualis, and open an issue so that we can list it in the documentation. See [TRADEMARKS.md](TRADEMARKS.md) for the use of the name.
- **In this repository**: add it under `plugins/<name>` with its own `package.json` (`"license": "Apache-2.0"`), `tsconfig.json` and `test/`, add it to the references of the root `tsconfig.json`, and propose it in a pull request. Plugins bundled by default are listed in `packages/core/src/config.ts`, and the documentation site reads their rules through `docs/package.json`. Open an issue first to discuss a new bundled plugin.

## Forks

You are free to fork Qualis. A redistributed fork must keep the [LICENSE](LICENSE) and the [NOTICE](NOTICE), with the credit to Qualis, and a modified fork needs its own product name: see [TRADEMARKS.md](TRADEMARKS.md). If your fork fixes something, a pull request back here helps everyone.

## Security

Do not report vulnerabilities in public issues. Use GitHub's [private vulnerability reporting](https://github.com/CERTIFIE/qualis/security/advisories/new) instead.
