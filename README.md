# Qualis

Qualis is an open source static code analyzer. You run the `qualis` command in a repository: it checks **security**, **reliability** and **maintainability**, reads your **test results** and **coverage**, finds **duplicated code**, and tells you whether the code passes a **quality gate**. Every rule comes from an official source (CWE, OWASP, NIST, MDN, Microsoft Learn, …).

The results are printed in the terminal and saved as JSON in the `.qualis/` folder of the repository, so you can open them in **Qualis UI** or use them in your own tools and web pages.

**Documentation:** https://certifie.github.io/qualis/

| I want to… | Go to |
|---|---|
| Understand what Qualis is | [What Qualis is](#what-qualis-is) |
| Install the CLI | [1. Install the CLI](#1-install-the-cli) |
| Analyze my repository | [2. Use the CLI](#2-use-the-cli) |
| Add language plugins | [3. Plugins](#3-plugins) |
| Install Qualis UI | [4. Install Qualis UI](#4-install-qualis-ui) |
| See my results in Qualis UI | [5. Use Qualis UI with the CLI](#5-use-qualis-ui-with-the-cli) |
| Write a new plugin | [6. Write a plugin](#6-write-a-plugin) |
| Contribute with a fork and a pull request | [7. Contribute](#7-contribute) |

## What Qualis is

Qualis has three parts, and you only need the first one:

- **Qualis CLI** (the `qualis` command) analyzes a repository and writes the results.
- **Plugins** teach it languages. TypeScript, JavaScript and C# are included; anyone can write more, in any language.
- **Qualis UI** (optional) is a web application that shows the results of your repositories: quality gate, issues, code, coverage and history.

A typical path:

```text
your repository ──► qualis analyze ──► results in the terminal
                                  └──► .qualis/report.json ──► Qualis UI, or your own site and tools
```

## 1. Install the CLI

You need **Node.js 20.19** or later and **git**. The **.NET SDK 10** is optional: it enables the Microsoft analyzers for C#.

Download `qualis-<version>.tar.gz` (macOS, Linux) or `qualis-<version>.zip` (Windows) from the [latest release](https://github.com/CERTIFIE/qualis/releases/latest), then install it globally:

```bash
tar -xzf qualis-0.1.0.tar.gz
npm install --global ./qualis-0.1.0
qualis --version
```

The archive contains the command and all its dependencies, so no registry or token is needed. To pin the version in a project instead (as a development dependency, from GitHub Packages), see [Installation](https://certifie.github.io/qualis/installation.html).

## 2. Use the CLI

In the root of your repository:

```bash
qualis init       # optional: creates qualis.config.json with the defaults
qualis analyze    # analyzes the repository
```

`qualis analyze` prints a summary and the quality gate result, and writes the results into `.qualis/`:

| File | Content |
|---|---|
| `.qualis/report.json` | The latest analysis, in an open [JSON format](https://certifie.github.io/qualis/report-format.html) with a published schema. |
| `.qualis/history/<timestamp>.json` | The recent analyses (the newest 20). |
| `.qualis/report.sarif` | SARIF 2.1.0 for GitHub or Azure DevOps code scanning, with `--format json,sarif` or when `qualis.config.json` lists it (as `qualis init` does). |

Add `.qualis/` to your `.gitignore`. The command exits with `0` when the quality gate passes, `1` when it fails and `2` on errors, so it can stop a CI build.

Useful options: `--issues` lists every issue, `--coverage coverage/lcov.info` and `--tests "reports/*.xml"` import coverage and test results, `--new-code origin/main` compares with a branch.

More: [Usage](https://certifie.github.io/qualis/usage.html) · [Command line](https://certifie.github.io/qualis/cli.html) · [Configuration](https://certifie.github.io/qualis/configuration.html) · [CI integration](https://certifie.github.io/qualis/ci.html)

## 3. Plugins

The CLI comes with these plugins, installed and enabled by default:

| Plugin | Analyzes |
|---|---|
| `@qualis/plugin-typescript` | TypeScript and JavaScript |
| `@qualis/plugin-csharp` | C# (no .NET needed) |
| `@qualis/plugin-eslint` | ESLint and typescript-eslint recommended rules |
| `@qualis/plugin-roslyn` | Microsoft .NET code analysis rules (needs the .NET SDK 10) |

To add another plugin, install it in your repository and list it in `qualis.config.json`. The `plugins` list replaces the default one, so keep the bundled plugins you still want:

```bash
npm install --save-dev qualis-plugin-yaml   # example name of a plugin published on npm
```

```json
{
  "plugins": [
    "@qualis/plugin-typescript",
    "qualis-plugin-yaml",
    { "command": "python3", "args": ["tools/qualis_python.py"] }
  ]
}
```

The last entry is a plugin that runs as a separate program, here written in Python. Run `qualis rules` to check which rules are active. More: [Configuration → Plugins](https://certifie.github.io/qualis/configuration.html#plugins)

## 4. Install Qualis UI

Qualis UI is published as a container image. Mount the folder that contains your repositories under `/workspace`:

```bash
docker run -d --name qualis-ui -p 3000:3000 \
  -v ~/projects:/workspace:ro \
  -v qualis-data:/data \
  ghcr.io/certifie/qualis-ui:latest
```

Open http://localhost:3000. The UI only reads your folders; it keeps its own data in the `qualis-data` volume. To run it from source instead, clone this repository and run `pnpm install && pnpm ui`. More: [Web UI](https://certifie.github.io/qualis/web-ui.html)

## 5. Use Qualis UI with the CLI

1. Run `qualis analyze` in your repository: it writes `.qualis/report.json`.
2. In Qualis UI choose **Import project** and pick the repository folder (with Docker, it is under `/workspace`).
3. Every new `qualis analyze` appears in the UI by itself, with the history of the previous ones.

No folder to share, for example when the analysis runs in CI? Choose **Read analysis** and upload the `report.json`. Several repositories of one product can be grouped in a **solution**.

## 6. Write a plugin

A plugin tells Qualis how to read a language, or adds rules to one. Qualis does the rest: duplications, coverage, tests, new code, ratings, quality gate and report.

What you need:

- **In JavaScript or TypeScript:** Node.js 20.19 and the `@qualis/plugin-api` package. Export a plugin with `definePlugin(...)` and its rules with `defineRule(...)`.
- **In any other language:** a program that reads and writes JSON-RPC 2.0 messages on stdin/stdout. [`examples/python-plugin`](examples/python-plugin) is a complete example using only the Python standard library.
- **Rules with sources:** every rule links an official reference and has a compliant and a noncompliant example, which the tests run.

Publish it in your own repository (for example as `qualis-plugin-<language>`) or propose it here. Start from [CONTRIBUTING.md → Writing a plugin](CONTRIBUTING.md#writing-a-plugin); the full protocol is in [Writing a plugin](https://certifie.github.io/qualis/plugins.html).

## 7. Contribute

Qualis is open to everyone: bug reports, documentation, rules and plugins are welcome.

1. Fork this repository and create a branch from `main`.
2. Set it up with Node.js 20.19+, pnpm 10 and git: `pnpm install`, then `pnpm test`.
3. Make your change, with tests and documentation.
4. Open a pull request against `main`.

[CONTRIBUTING.md](CONTRIBUTING.md) explains the setup, the repository layout, the pull request checklist and how releases are made.

## More documentation

[Metrics](https://certifie.github.io/qualis/metrics.html) · [Ratings and technical debt](https://certifie.github.io/qualis/ratings.html) · [Quality gate](https://certifie.github.io/qualis/quality-gate.html) · [New code](https://certifie.github.io/qualis/new-code.html) · [Coverage and tests](https://certifie.github.io/qualis/coverage-and-tests.html) · [External issues (SARIF, ESLint)](https://certifie.github.io/qualis/external-issues.html) · [All rules](https://certifie.github.io/qualis/rules/index.html) · [Report format](https://certifie.github.io/qualis/report-format.html) · [Sources](https://certifie.github.io/qualis/sources.html)

## License

Qualis is licensed under the [Apache License 2.0](LICENSE). You may use, modify, fork and redistribute it, also in commercial and closed-source products, and plugins may use any license.

When you redistribute Qualis or a work based on it, such as a fork, keep the copyright notices and include the [LICENSE](LICENSE) and the [NOTICE](NOTICE) file, which credits Qualis and links to this project. A fork may use any name, as long as the credit to Qualis stays.

Qualis is an independent project and is not affiliated with any vendor of code analysis products. Bundled third-party components keep their own licenses, listed in [NOTICE](NOTICE).
