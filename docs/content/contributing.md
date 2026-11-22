---
title: Contribute
description: Fork the repository, build it from source, and open a pull request with a fix, a rule, a plugin or documentation.
---
Qualis is free and open source under the Apache License 2.0. Bug reports, documentation, rules and plugins are all welcome. The full guide, with the style rules and the release process, is [CONTRIBUTING.md]({{repo-url}}/blob/main/CONTRIBUTING.md).

## Ways to help

- **Report a bug or propose a feature** in the [issues]({{repo-url}}/issues). A false positive or a missed issue is a bug too: include the rule id and a small piece of code.
- **Improve the documentation**: the pages are in `docs/content/`, in Markdown.
- **Fix a bug or add a rule** to a bundled plugin.
- **Write a plugin**, here or in your own repository: see [Write a plugin](plugins.html).

## Build from source

You need Node.js 20.19 or later, pnpm 10 (`corepack enable` installs the version the repository asks for) and git. The .NET SDK 10 is optional, for the Roslyn rule pack.

```bash
git clone {{repo-url}}.git qualis
cd qualis
pnpm install
pnpm build
pnpm test
```

To use your checkout as the `qualis` command in any folder:

```bash
npm install --global ./packages/cli
```

npm links the command to the checkout: after `git pull` and `pnpm build` it runs the new code without reinstalling. Without the global install, run `pnpm qualis analyze ~/projects/my-app` from the root of the checkout. `pnpm ui` starts [Qualis UI](ui-install.html#from-the-source-code) from the checkout.

## Open a pull request

**Step 1.** Fork the repository on GitHub and clone your fork.

**Step 2.** Create a branch from `main`: `git switch -c fix-my-bug`.

**Step 3.** Make the change, with tests and documentation. Every rule's noncompliant example must raise the rule and its compliant example must not: the tests run the examples shown in this documentation.

**Step 4.** Run `pnpm test` and `pnpm typecheck`.

**Step 5.** Push the branch to your fork and open a pull request against `main` of [{{repo-url}}]({{repo-url}}). Explain what it changes and why. The pipeline runs the same tests; a maintainer reviews and merges it.

By opening a pull request you agree that your contribution is licensed under the Apache License 2.0.

## Forks

You may fork Qualis and give your fork any name. A redistributed fork must keep the LICENSE and the NOTICE, with the credit to Qualis and the link to the project. If your fork fixes something, a pull request back helps everyone.
