import ts from "typescript";
import { TASK_MARKER } from "@qualis/plugin-api";
import { REF } from "../references.js";
import { LANGUAGES, skipParens, type Rule } from "./context.js";

export const functionComplexity: Rule = {
  definition: {
    id: "typescript:function-complexity",
    name: "Functions should not be too complex",
    languages: LANGUAGES,
    type: "code-smell",
    severity: "major",
    tags: ["complexity", "cwe-1121"],
    enabledByDefault: true,
    effortMinutes: 10,
    description:
      "Reports functions whose McCabe cyclomatic complexity exceeds `max` (default 10). Complexity is 1 plus one for each `if`, `?:`, loop, `case`, `catch`, `&&`, `||`, `??` and logical assignment.",
    rationale:
      "Cyclomatic complexity counts the linearly independent paths through a function and therefore the minimum number of tests needed to cover them (McCabe, 1976). NIST SP 500-235 recommends limiting it to 10 per module, noting that limits up to 15 have been used successfully only with additional safeguards. MITRE lists excessive cyclomatic complexity as a maintainability weakness (CWE-1121); ISO/IEC 5055 (OMG ASCQM) flags values above 20.",
    params: [{ name: "max", description: "Highest accepted cyclomatic complexity per function.", type: "integer", default: 10 }],
    references: [REF.nist500235, REF.mccabe1976, REF.cwe1121, REF.omgAscqm],
  },
  check(ctx) {
    const max = Number(ctx.params["max"] ?? 10);
    for (const fn of ctx.functions) {
      const c = fn.metrics.complexity;
      if (c > max) {
        const target = fn.node.name ?? fn.node.getChildAt(0, ctx.sf);
        ctx.report(target, `Cyclomatic complexity of "${fn.metrics.name}" is ${c} (max ${max}). Split it into smaller functions.`, {
          effortMinutes: 10 + (c - max),
        });
      }
    }
  },
};

export const tooManyParameters: Rule = {
  definition: {
    id: "typescript:too-many-parameters",
    name: "Functions should not have too many parameters",
    languages: LANGUAGES,
    type: "code-smell",
    severity: "major",
    tags: ["design", "cwe-1064"],
    enabledByDefault: true,
    effortMinutes: 20,
    description: "Reports functions declaring more than `max` parameters (default 7).",
    rationale:
      "Long parameter lists make calls hard to read and easy to get wrong, and usually indicate a function with too many responsibilities. MITRE lists them as a weakness (CWE-1064) and ISO/IEC 5055 (OMG ASCQM) uses 7 parameters as the threshold.",
    params: [{ name: "max", description: "Highest accepted number of parameters.", type: "integer", default: 7 }],
    noncompliantExample: "function createUser(name, email, phone, street, city, zip, country, role) {}",
    compliantExample: "function createUser({ name, email, phone, address, role }) {}",
    references: [REF.cwe1064, REF.omgAscqm],
  },
  check(ctx) {
    const max = Number(ctx.params["max"] ?? 7);
    for (const fn of ctx.functions) {
      if (fn.metrics.parameters > max) {
        const target = fn.node.name ?? fn.node.getChildAt(0, ctx.sf);
        ctx.report(target, `"${fn.metrics.name}" has ${fn.metrics.parameters} parameters (max ${max}).`);
      }
    }
  },
};

export const fileTooLong: Rule = {
  definition: {
    id: "typescript:file-too-long",
    name: "Files should not have too many lines of code",
    languages: LANGUAGES,
    type: "code-smell",
    severity: "major",
    tags: ["size", "cwe-1080"],
    enabledByDefault: true,
    effortMinutes: 60,
    description: "Reports files with more than `max` non-comment lines of code (default 1000).",
    rationale:
      "Very large files tend to mix several responsibilities and are harder to understand, review and change. MITRE lists them as a weakness (CWE-1080) and ISO/IEC 5055 (OMG ASCQM) uses 1000 lines of code per file as the threshold.",
    params: [{ name: "max", description: "Highest accepted number of lines of code.", type: "integer", default: 1000 }],
    references: [REF.cwe1080, REF.omgAscqm],
  },
  check(ctx) {
    const max = Number(ctx.params["max"] ?? 1000);
    if (ctx.measures.ncloc > max) {
      ctx.report({ startLine: 1, startColumn: 1, endLine: 1, endColumn: Math.max(2, ctx.lines.lineText(1).length + 1) }, `This file has ${ctx.measures.ncloc} lines of code (max ${max}). Split it.`);
    }
  },
};

export const todoComment: Rule = {
  definition: {
    id: "typescript:todo-comment",
    name: "Task markers in comments should be tracked",
    languages: LANGUAGES,
    type: "code-smell",
    severity: "info",
    tags: ["cwe-546"],
    enabledByDefault: true,
    effortMinutes: 0,
    description: "Reports comments containing `TODO`, `FIXME`, `XXX` or `HACK`.",
    rationale:
      "Such markers flag known gaps or defects that were left in the code. MITRE classifies them as Suspicious Comment (CWE-546): they point to unfinished work that should be tracked and resolved rather than forgotten.",
    noncompliantExample: "// TODO handle the timeout",
    compliantExample: "// Timeout handled by the caller, see RetryPolicy.",
    references: [REF.cwe546],
  },
  check(ctx) {
    for (const comment of ctx.comments) {
      const match = TASK_MARKER.exec(comment.text);
      if (!match) continue;
      const offset = comment.pos + match.index;
      ctx.report(ctx.lines.range(offset, offset + match[0].length), `Complete the task associated with this "${match[0]}" comment.`);
    }
  },
};

/** Groups adjacent single-line comments into blocks. */
function commentBlocks(ctx: Parameters<NonNullable<Rule["check"]>>[0]) {
  const blocks: { pos: number; end: number; text: string; single: boolean }[] = [];
  for (const c of ctx.comments) {
    if (c.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      if (c.text.startsWith("/**")) continue; // documentation
      blocks.push({ pos: c.pos, end: c.end, text: c.text.slice(2, -2).replace(/^\s*\*/gm, ""), single: false });
      continue;
    }
    const body = c.text.slice(2);
    const last = blocks[blocks.length - 1];
    const adjacent = last?.single && ctx.lines.lineOf(last.end) === c.startLine - 1 && ctx.sf.text.slice(last.end, c.pos).trim() === "";
    if (last && adjacent) {
      last.end = c.end;
      last.text += "\n" + body;
    } else {
      blocks.push({ pos: c.pos, end: c.end, text: body, single: true });
    }
  }
  return blocks;
}

const CODE_HINT = /[;{}]|=>|\b(const|let|var|return|if|for|while|function|import|export|class)\b/;

/** True when the text parses as TypeScript statements that are more than bare words. */
function looksLikeCode(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3 || !CODE_HINT.test(trimmed)) return false;
  if (/^(eslint|prettier|istanbul|@ts-|tslint|jshint|global |qualis-)/.test(trimmed)) return false;
  const sf = ts.createSourceFile("comment.ts", trimmed, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const diagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0 || sf.statements.length === 0) return false;
  // Prose such as "see foo" parses as expression statements of identifiers: require real code.
  return sf.statements.some((s) => {
    if (!ts.isExpressionStatement(s)) return true;
    const e = skipParens(s.expression);
    return ts.isCallExpression(e) || ts.isBinaryExpression(e) || ts.isAwaitExpression(e) || (ts.isPropertyAccessExpression(e) && /;\s*$/.test(trimmed));
  });
}

export const commentedOutCode: Rule = {
  definition: {
    id: "typescript:commented-out-code",
    name: "Commented-out code should be removed",
    languages: LANGUAGES,
    type: "code-smell",
    severity: "minor",
    tags: ["unused", "cwe-1085"],
    enabledByDefault: true,
    effortMinutes: 5,
    description: "Reports comment blocks whose content parses as code. JSDoc comments and tool directives are ignored.",
    rationale:
      "Commented-out code distracts readers, gets out of date and is not compiled or tested; version control already keeps old versions. MITRE lists an excessive volume of commented-out code as a maintainability weakness (CWE-1085) and ISO/IEC 5055 (OMG ASCQM) measures it.",
    noncompliantExample: "// const legacy = computeOld(order);\n// return legacy.total;",
    compliantExample: "// Totals include VAT since 2024 (see ADR-12).",
    references: [REF.cwe1085, REF.omgAscqm],
  },
  check(ctx) {
    for (const block of commentBlocks(ctx)) {
      if (looksLikeCode(block.text)) ctx.report(ctx.lines.range(block.pos, block.end), "Remove this commented-out code.");
    }
  },
};

/** TypeScript diagnostics produced by `noUnusedLocals`. */
const UNUSED_CODES = new Set([6133, 6138, 6192, 6196, 6198, 6199, 6205]);

export const unusedDeclaration: Rule = {
  definition: {
    id: "typescript:unused-declaration",
    name: "Unused local declarations and imports should be removed",
    languages: LANGUAGES,
    type: "code-smell",
    severity: "minor",
    tags: ["unused", "cwe-563", "cwe-1164", "type-aware"],
    enabledByDefault: true,
    effortMinutes: 5,
    description:
      "Reports local variables, functions, imports, private members and type parameters that are declared but never read, as computed by the TypeScript compiler with `noUnusedLocals`.",
    rationale:
      "Unused declarations are irrelevant code (CWE-1164): they make readers look for a purpose that does not exist and may hide a bug where the wrong variable is used. A value that is assigned and never read is Assignment to Variable without Use (CWE-563). The TypeScript `noUnusedLocals` option exists to report them.",
    exceptions: "Requires type information. Parameters are not reported. Names starting with an underscore are ignored by the compiler for destructuring.",
    noncompliantExample: "import { readFile, writeFile } from \"node:fs/promises\";\nexport const load = (p) => readFile(p);",
    compliantExample: "import { readFile } from \"node:fs/promises\";\nexport const load = (p) => readFile(p);",
    references: [REF.tsNoUnusedLocals, REF.cwe563, REF.cwe1164],
  },
  check(ctx) {
    for (const d of ctx.semanticDiagnostics) {
      if (!UNUSED_CODES.has(d.code) || d.start === undefined || d.length === undefined) continue;
      ctx.report(ctx.lines.range(d.start, d.start + d.length), ts.flattenDiagnosticMessageText(d.messageText, " "));
    }
  },
};

/** Nodes whose `name` identifier declares rather than uses a symbol. */
const DECLARATION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.EnumMember,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.TypeParameter,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.BindingElement,
]);

function deprecationOf(checker: ts.TypeChecker, node: ts.Identifier): string | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  // Overloaded calls: look at the resolved signature.
  const parent = node.parent;
  const call = ts.isCallExpression(parent) || ts.isNewExpression(parent) ? parent : ts.isPropertyAccessExpression(parent) && parent.name === node && (ts.isCallExpression(parent.parent) || ts.isNewExpression(parent.parent)) ? parent.parent : undefined;
  if (call && (ts.isCallExpression(call) || ts.isNewExpression(call)) && (call.expression === node || call.expression === parent)) {
    const signature = checker.getResolvedSignature(call);
    const tag = signature?.getJsDocTags().find((t) => t.name === "deprecated");
    if (tag) return ts.displayPartsToString(tag.text) || "";
    if (symbol.declarations && symbol.declarations.length > 1) return undefined;
  }
  const tag = symbol.getJsDocTags(checker).find((t) => t.name === "deprecated");
  return tag ? ts.displayPartsToString(tag.text) || "" : undefined;
}

export const deprecatedApi: Rule = {
  definition: {
    id: "typescript:deprecated-api",
    name: "Deprecated APIs should not be used",
    languages: LANGUAGES,
    type: "code-smell",
    severity: "minor",
    tags: ["obsolete", "type-aware"],
    enabledByDefault: true,
    effortMinutes: 15,
    description: "Reports references to functions, classes, members and variables whose declaration carries a JSDoc `@deprecated` tag.",
    rationale:
      "The `@deprecated` tag (TypeScript JSDoc reference) tells consumers that an API is scheduled for removal or has a better replacement. Code that keeps using it will break or miss fixes when the dependency is upgraded.",
    exceptions: "Requires type information. Declarations themselves and imports are not reported, only uses.",
    noncompliantExample: "/** @deprecated Use fetchUser instead. */\ndeclare function getUser(id: string): object;\ndeclare function fetchUser(id: string): object;\n\ngetUser(\"42\");",
    compliantExample: "/** @deprecated Use fetchUser instead. */\ndeclare function getUser(id: string): object;\ndeclare function fetchUser(id: string): object;\n\nfetchUser(\"42\");",
    references: [REF.tsDeprecated],
  },
  visit(node, ctx) {
    if (!ctx.checker || !ts.isIdentifier(node)) return;
    const parent = node.parent;
    if (!parent) return;
    // Skip declarations and import specifiers.
    if ((DECLARATION_KINDS.has(parent.kind) && (parent as ts.NamedDeclaration).name === node) || ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isExportSpecifier(parent)) return;
    const reason = deprecationOf(ctx.checker, node);
    if (reason !== undefined) ctx.report(node, `"${node.text}" is deprecated${reason ? `: ${reason}` : "."}`);
  },
};

const LOOSE_EQUALITY = new Set<ts.SyntaxKind>([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);

export const strictEquality: Rule = {
  definition: {
    id: "typescript:strict-equality",
    name: "Strict equality operators should be used",
    languages: LANGUAGES,
    type: "code-smell",
    severity: "minor",
    tags: ["confusing"],
    enabledByDefault: true,
    effortMinutes: 2,
    description: "Reports `==` and `!=`, except comparisons with the `null` literal.",
    rationale:
      "Loose equality converts operands of different types before comparing them, following rules that are easy to get wrong (`\"\" == 0` is true). MDN recommends strict equality as the comparison to use in almost every case.",
    exceptions: "`x == null` and `x != null` are accepted as the idiomatic test for both null and undefined.",
    noncompliantExample: "if (count == \"0\") { reset(); }",
    compliantExample: "if (count === 0) { reset(); }",
    references: [REF.mdnEquality],
  },
  visit(node, ctx) {
    if (!ts.isBinaryExpression(node) || !LOOSE_EQUALITY.has(node.operatorToken.kind)) return;
    const isNull = (e: ts.Expression) => skipParens(e).kind === ts.SyntaxKind.NullKeyword;
    if (isNull(node.left) || isNull(node.right)) return;
    const strict = node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ? "===" : "!==";
    ctx.report(node.operatorToken, `Use "${strict}" instead of "${node.operatorToken.getText(ctx.sf)}".`);
  },
};

export const maintainabilityRules: Rule[] = [
  functionComplexity,
  tooManyParameters,
  fileTooLong,
  todoComment,
  commentedOutCode,
  unusedDeclaration,
  deprecatedApi,
  strictEquality,
];
