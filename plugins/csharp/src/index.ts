import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";
import {
  definePlugin,
  LineIndex,
  PLUGIN_API_VERSION,
  Suppressions,
  type AnalyzeFileRequest,
  type FileAnalysis,
  type LanguagePlugin,
  type PluginIssue,
} from "@qualis/plugin-api";
import { collectConstants, RULES, type Rule, type RuleContext } from "./rules.js";
import { analyzeStructure, codeAndCommentLines, collectTokens, cpdTokens, executableLines, halstead, rangeOf, walk } from "./syntax.js";

const VERSION: string = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

const require = createRequire(import.meta.url);

let languagePromise: Promise<Language> | undefined;

/** The grammar shipped in grammar/ (published package), or the one of the dev dependency. */
function grammarPath(): string {
  const bundled = fileURLToPath(new URL("../grammar/tree-sitter-c_sharp.wasm", import.meta.url));
  return existsSync(bundled) ? bundled : require.resolve("tree-sitter-c-sharp/tree-sitter-c_sharp.wasm");
}

/** Loads the tree-sitter runtime and the C# grammar (WebAssembly) once per process. */
function loadLanguage(): Promise<Language> {
  languagePromise ??= (async () => {
    await Parser.init();
    return Language.load(grammarPath());
  })();
  return languagePromise;
}

async function createPlugin(): Promise<LanguagePlugin> {
  const language = await loadLanguage();
  const parser = new Parser();
  parser.setLanguage(language);

  const analyzeFile = (request: AnalyzeFileRequest): FileAnalysis => {
    const tree = parser.parse(request.content);
    if (!tree) throw new Error("tree-sitter could not parse the file");
    try {
      const lines = new LineIndex(request.content);
      const tokens = collectTokens(tree);
      const { code, comment } = codeAndCommentLines(tokens, lines);
      const structure = analyzeStructure(tree, tokens.leaves, code);
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

      const diagnostics: NonNullable<FileAnalysis["diagnostics"]> = [];
      if (tree.rootNode.hasError) {
        let first: number | undefined;
        walk(tree.rootNode, (n) => {
          if (first !== undefined) return false;
          if (n.type === "ERROR" || n.isMissing) first = n.startPosition.row + 1;
          return n.hasError;
        });
        diagnostics.push({ level: "warning", message: `Syntax error near line ${first ?? "?"}; results for this file may be incomplete.` });
      }

      const enabled = new Map(request.rules.map((r) => [r.id, r.params]));
      const active = RULES.filter((r) => enabled.has(r.definition.id));
      const suppressions = Suppressions.parse(tokens.comments);
      const issues: PluginIssue[] = [];
      const constants = collectConstants(tree.rootNode);
      const contexts = new Map<Rule, RuleContext>();
      for (const rule of active) {
        const id = rule.definition.id;
        contexts.set(rule, {
          params: enabled.get(id) ?? {},
          constants,
          lines,
          comments: tokens.comments,
          functions: structure.functions,
          measures,
          parser,
          report(target, message, options) {
            const range = "startLine" in target ? target : rangeOf(target);
            if (suppressions.isSuppressed(id, range.startLine)) return;
            const issue: PluginIssue = { ruleId: id, message, range };
            if (options?.effortMinutes !== undefined) issue.effortMinutes = options.effortMinutes;
            issues.push(issue);
          },
        });
      }
      const run = (rule: Rule, fn: () => void) => {
        try {
          fn();
        } catch (error) {
          diagnostics.push({ level: "error", message: `Rule ${rule.definition.id} failed: ${(error as Error).message}` });
        }
      };
      const visitors = active.filter((r) => r.visit);
      if (visitors.length > 0) {
        walk(tree.rootNode, (node) => {
          if (node.type === "comment") return false;
          for (const rule of visitors) run(rule, () => rule.visit!(node, contexts.get(rule)!));
          return true;
        });
      }
      // Rule checks may re-parse snippets with the shared parser: run them last.
      for (const rule of active) if (rule.check) run(rule, () => rule.check!(contexts.get(rule)!));

      return {
        issues,
        measures,
        functions: structure.functions.map((f) => f.metrics),
        halstead: halstead(tokens.leaves),
        codeLines: [...code].sort((a, b) => a - b),
        executableLines: executableLines(tree),
        cpdTokens: cpdTokens(tokens.leaves),
        diagnostics,
      };
    } finally {
      tree.delete();
    }
  };

  return definePlugin({
    apiVersion: PLUGIN_API_VERSION,
    id: "csharp",
    name: "C#",
    version: VERSION,
    description: "Analyses C# with the tree-sitter C# grammar (syntax only, no semantic model).",
    languages: [{ id: "csharp", name: "C#", extensions: [".cs"] }],
    rules: RULES.map((r) => r.definition),
    analyzeFile,
    dispose() {
      parser.delete();
    },
  });
}

export default createPlugin;
