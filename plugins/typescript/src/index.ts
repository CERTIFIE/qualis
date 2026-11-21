import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  definePlugin,
  LineIndex,
  PLUGIN_API_VERSION,
  Suppressions,
  type AnalyzeFileRequest,
  type FileAnalysis,
  type LanguagePlugin,
  type PluginIssue,
  type PrepareContext,
} from "@qualis/plugin-api";
import {
  analyzeStructure,
  codeAndCommentLines,
  collectComments,
  collectLeaves,
  cpdTokens,
  halstead,
} from "./analysis.js";
import { collectImports, toIssue, type Rule, type RuleContext } from "./rules/context.js";
import { maintainabilityRules } from "./rules/maintainability.js";
import { reliabilityRules } from "./rules/reliability.js";
import { securityRules } from "./rules/security.js";

const VERSION: string = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export const RULES: Rule[] = [...securityRules, ...reliabilityRules, ...maintainabilityRules];

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS,
  ".mts": ts.ScriptKind.TS,
  ".cts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
};

function scriptKind(file: string): ts.ScriptKind {
  const lower = file.toLowerCase();
  const ext = Object.keys(SCRIPT_KINDS).find((e) => lower.endsWith(e));
  return ext ? SCRIPT_KINDS[ext]! : ts.ScriptKind.TS;
}

/** Compiler options of the project (tsconfig.json when present), adjusted for analysis. */
function compilerOptions(baseDir: string, tsconfig: string | undefined): ts.CompilerOptions {
  let options: ts.CompilerOptions = {};
  const configPath = tsconfig ? path.resolve(baseDir, tsconfig) : path.join(baseDir, "tsconfig.json");
  if (existsSync(configPath)) {
    const read = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
    if (!read.error) {
      options = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath)).options;
    }
  }
  return {
    ...options,
    target: options.target ?? ts.ScriptTarget.ESNext,
    jsx: options.jsx ?? ts.JsxEmit.Preserve,
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    incremental: false,
    composite: false,
    noUnusedLocals: true,
    noUnusedParameters: false,
  };
}

interface State {
  program: ts.Program | undefined;
  checker: ts.TypeChecker | undefined;
}

function createPlugin(): LanguagePlugin {
  const state: State = { program: undefined, checker: undefined };

  const prepare = (ctx: PrepareContext) => {
    const options = ctx.options as { typeCheck?: boolean; tsconfig?: string };
    if (options.typeCheck === false) return;
    try {
      state.program = ts.createProgram({
        rootNames: ctx.files.map((f) => f.absolutePath),
        options: compilerOptions(ctx.baseDir, options.tsconfig),
      });
      state.checker = state.program.getTypeChecker();
    } catch (error) {
      state.program = undefined;
      state.checker = undefined;
      ctx.log.log("warning", `Type information unavailable, type-aware rules are skipped: ${(error as Error).message}`);
    }
  };

  const analyzeFile = (request: AnalyzeFileRequest): FileAnalysis => {
    const { file, content } = request;
    let sf = state.program?.getSourceFile(file.absolutePath);
    let checker = state.checker;
    if (!sf || sf.text !== content) {
      sf = ts.createSourceFile(file.absolutePath, content, ts.ScriptTarget.Latest, true, scriptKind(file.path));
      checker = undefined;
    }
    const lines = new LineIndex(sf.text);
    const leaves = collectLeaves(sf);
    const comments = collectComments(sf, leaves, lines);
    const { code, comment } = codeAndCommentLines(sf, leaves, comments, lines);
    const structure = analyzeStructure(sf, leaves, code, lines);
    const measures = {
      lines: lines.lineCount,
      ncloc: code.size,
      commentLines: comment.size,
      functions: structure.functions.length,
      classes: structure.classes,
      statements: structure.statements,
      complexity: structure.complexity,
      cognitiveComplexity: structure.cognitiveComplexity,
    };

    const parseErrors = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
    const diagnostics: FileAnalysis["diagnostics"] = parseErrors.slice(0, 5).map((d) => ({
      level: "warning" as const,
      message: `Syntax error at line ${lines.lineOf(d.start ?? 0)}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
    }));

    const enabled = new Map(request.rules.map((r) => [r.id, r.params]));
    const active = RULES.filter((r) => enabled.has(r.definition.id));
    const suppressions = Suppressions.parse(comments);
    const issues: PluginIssue[] = [];
    const semanticDiagnostics =
      checker && state.program && active.some((r) => r.definition.id === "typescript:unused-declaration")
        ? state.program.getSemanticDiagnostics(sf)
        : [];
    const imports = collectImports(sf);
    const contexts = new Map<Rule, RuleContext>();
    for (const rule of active) {
      const id = rule.definition.id;
      contexts.set(rule, {
        sf,
        checker,
        params: enabled.get(id) ?? {},
        lines,
        comments,
        functions: structure.functions,
        measures,
        imports,
        semanticDiagnostics,
        report(target, message, options) {
          const issue = toIssue(id, sf!, lines, target, message, options?.effortMinutes);
          if (!suppressions.isSuppressed(id, issue.range.startLine)) issues.push(issue);
        },
      });
    }

    const visitors = active.filter((r) => r.visit);
    const run = (rule: Rule, fn: () => void) => {
      try {
        fn();
      } catch (error) {
        diagnostics.push({ level: "error", message: `Rule ${rule.definition.id} failed: ${(error as Error).message}` });
      }
    };
    if (visitors.length > 0) {
      const visit = (node: ts.Node) => {
        for (const rule of visitors) run(rule, () => rule.visit!(node, contexts.get(rule)!));
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    for (const rule of active) if (rule.check) run(rule, () => rule.check!(contexts.get(rule)!));

    return {
      issues,
      measures,
      functions: structure.functions.map((f) => f.metrics),
      halstead: halstead(sf, leaves),
      codeLines: [...code].sort((a, b) => a - b),
      cpdTokens: cpdTokens(sf, leaves, lines),
      diagnostics,
    };
  };

  return definePlugin({
    apiVersion: PLUGIN_API_VERSION,
    id: "typescript",
    name: "TypeScript / JavaScript",
    version: VERSION,
    description: "Analyses TypeScript and JavaScript with the TypeScript compiler API (syntax and type information).",
    languages: [
      { id: "typescript", name: "TypeScript", extensions: [".ts", ".tsx", ".mts", ".cts"] },
      { id: "javascript", name: "JavaScript", extensions: [".js", ".jsx", ".mjs", ".cjs"] },
    ],
    rules: RULES.map((r) => r.definition),
    prepare,
    analyzeFile,
    dispose() {
      state.program = undefined;
      state.checker = undefined;
    },
  });
}

export default createPlugin;
