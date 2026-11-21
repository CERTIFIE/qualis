import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ESLint, type Linter } from "eslint";
import globals from "globals";
import tseslint from "typescript-eslint";
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type AnalyzeFileRequest,
  type PluginIssue,
  type PrepareContext,
  type RulePackAnalysis,
  type RulePackPlugin,
} from "@qualis/plugin-api";
import { BY_ESLINT_NAME, CORE_OFF_FOR_TS, RULES } from "./rules.js";

export { RULES };

const VERSION: string = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

const JS_FILES = ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"];
const TS_FILES = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

export interface EslintPackOptions {
  /** Run type-aware rules (default: when tsconfig.json exists in the project root). */
  typeChecked?: boolean;
}

/** Flat configuration enabling exactly the Qualis rules requested for this analysis. */
function buildConfig(baseDir: string, enabledNames: Set<string>, typed: boolean): Linter.Config[] {
  const enabled = RULES.filter((r) => enabledNames.has(r.eslintName) && (typed || !r.requiresTypeChecking));
  const core = Object.fromEntries(enabled.filter((r) => !r.typescriptOnly).map((r) => [r.eslintName, r.entry]));
  const tsCore = Object.fromEntries(Object.entries(core).filter(([name]) => !CORE_OFF_FOR_TS.has(name)));
  const ts = Object.fromEntries(enabled.filter((r) => r.typescriptOnly).map((r) => [r.eslintName, r.entry]));
  const shared = {
    ecmaVersion: "latest" as const,
    sourceType: "module" as const,
    globals: { ...globals.browser, ...globals.node, ...globals.es2025 },
  };
  return [
    { files: JS_FILES, languageOptions: { ...shared, parserOptions: { ecmaFeatures: { jsx: true } } }, rules: core as Linter.RulesRecord },
    {
      files: TS_FILES,
      languageOptions: {
        ...shared,
        parser: tseslint.parser as Linter.Parser,
        parserOptions: { ecmaFeatures: { jsx: true }, ...(typed && { projectService: true, tsconfigRootDir: baseDir }) },
      },
      plugins: { "@typescript-eslint": tseslint.plugin as unknown as ESLint.Plugin },
      rules: { ...tsCore, ...ts } as Linter.RulesRecord,
    },
  ];
}

function createPlugin(): RulePackPlugin {
  let typed: ESLint | undefined;
  let untyped: ESLint | undefined;
  let typedReady = false;

  const prepare = ({ baseDir, options, log }: PrepareContext) => {
    const opts = options as EslintPackOptions;
    typedReady = opts.typeChecked ?? existsSync(path.join(baseDir, "tsconfig.json"));
    const make = (withTypes: boolean, names: Set<string>) =>
      new ESLint({ cwd: baseDir, overrideConfigFile: true, overrideConfig: buildConfig(baseDir, names, withTypes), warnIgnored: false, errorOnUnmatchedPattern: false });
    // The rule set is known only per file request; build lazily with all rules and filter messages.
    const all = new Set(RULES.map((r) => r.eslintName));
    untyped = make(false, all);
    typed = typedReady ? make(true, all) : undefined;
    if (!typedReady) log.log("info", "No tsconfig.json found: type-aware ESLint rules are skipped.");
  };

  const analyzeFile = async (request: AnalyzeFileRequest): Promise<RulePackAnalysis> => {
    const wanted = new Set(request.rules.map((r) => r.id));
    const diagnostics: NonNullable<RulePackAnalysis["diagnostics"]> = [];
    const isTs = /\.(ts|tsx|mts|cts)$/i.test(request.file.path);
    let results = await (isTs && typed ? typed : untyped!).lintText(request.content, { filePath: request.file.absolutePath, warnIgnored: false });
    const fatal = results[0]?.messages.find((m) => m.fatal);
    if (fatal && isTs && typed && /project service|parserOptions\.project|was not found by the project/i.test(fatal.message)) {
      // The file is outside every tsconfig: lint it without type information.
      results = await untyped!.lintText(request.content, { filePath: request.file.absolutePath, warnIgnored: false });
      diagnostics.push({ level: "info", message: "Not part of a TypeScript project: type-aware ESLint rules skipped." });
    }
    const issues: PluginIssue[] = [];
    for (const message of results[0]?.messages ?? []) {
      if (message.fatal || !message.ruleId) {
        diagnostics.push({ level: "warning", message: `ESLint: ${message.message} (line ${message.line})` });
        continue;
      }
      const rule = BY_ESLINT_NAME.get(message.ruleId);
      if (!rule || !wanted.has(rule.definition.id)) continue;
      const startLine = message.line;
      const startColumn = message.column;
      const endLine = message.endLine ?? startLine;
      const endColumn = message.endColumn ?? startColumn + 1;
      issues.push({
        ruleId: rule.definition.id,
        message: message.message,
        range: endLine < startLine || (endLine === startLine && endColumn <= startColumn) ? { startLine, startColumn, endLine: startLine, endColumn: startColumn + 1 } : { startLine, startColumn, endLine, endColumn },
      });
    }
    return { issues, diagnostics };
  };

  return definePlugin({
    apiVersion: PLUGIN_API_VERSION,
    kind: "rule-pack",
    id: "eslint",
    name: "ESLint",
    version: VERSION,
    description: "Runs the recommended rules of ESLint and typescript-eslint (strict rules available, disabled by default).",
    homepage: "https://eslint.org",
    languages: [
      { id: "typescript", name: "TypeScript", extensions: [".ts", ".tsx", ".mts", ".cts"] },
      { id: "javascript", name: "JavaScript", extensions: [".js", ".jsx", ".mjs", ".cjs"] },
    ],
    rules: RULES.map((r) => r.definition),
    prepare,
    analyzeFile,
    dispose() {
      typed = undefined;
      untyped = undefined;
    },
  });
}

export default createPlugin;
