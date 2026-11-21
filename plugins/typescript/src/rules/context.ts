import ts from "typescript";
import type { FileMeasures, LineIndex, PluginIssue, RuleDefinition, TextRange } from "@qualis/plugin-api";
import type { Comment, FunctionInfo } from "../analysis.js";

export const LANGUAGES = ["typescript", "javascript"];

export interface RuleContext {
  sf: ts.SourceFile;
  /** Type checker; undefined when the file is analysed without a program. */
  checker: ts.TypeChecker | undefined;
  /** Effective parameters of the rule being run. */
  params: Record<string, number | string | boolean>;
  lines: LineIndex;
  comments: Comment[];
  functions: FunctionInfo[];
  measures: FileMeasures;
  /** Local name → imported module binding (ES imports and CommonJS require). */
  imports: Map<string, ImportBinding>;
  /** Semantic diagnostics of the file (only when type information is available). */
  semanticDiagnostics: readonly ts.Diagnostic[];
  report(target: ts.Node | TextRange, message: string, options?: { effortMinutes?: number }): void;
}

export interface Rule {
  definition: RuleDefinition;
  /** Called for every node of the file. */
  visit?: (node: ts.Node, ctx: RuleContext) => void;
  /** Called once per file, after the visit. */
  check?: (ctx: RuleContext) => void;
}

export interface ImportBinding {
  /** Module specifier without the `node:` prefix. */
  module: string;
  /** Imported member name, `*` for namespace/whole-module bindings, `default` for default imports. */
  member: string;
}

export function rangeOf(sf: ts.SourceFile, lines: LineIndex, node: ts.Node): TextRange {
  return lines.range(node.getStart(sf), node.end);
}

export function toIssue(
  ruleId: string,
  sf: ts.SourceFile,
  lines: LineIndex,
  target: ts.Node | TextRange,
  message: string,
  effortMinutes?: number,
): PluginIssue {
  const range = "kind" in target ? rangeOf(sf, lines, target) : target;
  const issue: PluginIssue = { ruleId, message, range };
  if (effortMinutes !== undefined) issue.effortMinutes = effortMinutes;
  return issue;
}

const normalizeModule = (m: string) => m.replace(/^node:/, "");

function requiredModule(node: ts.Expression | undefined): string | undefined {
  if (
    node &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "require" &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0]!)
  ) {
    return normalizeModule(node.arguments[0].text);
  }
  return undefined;
}

/** Collects ES module imports and `require` bindings of a file. */
export function collectImports(sf: ts.SourceFile): Map<string, ImportBinding> {
  const imports = new Map<string, ImportBinding>();
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause) {
      const module = normalizeModule(node.moduleSpecifier.text);
      const clause = node.importClause;
      if (clause.name) imports.set(clause.name.text, { module, member: "default" });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, { module, member: "*" });
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          imports.set(el.name.text, { module, member: (el.propertyName ?? el.name).getText(sf) });
        }
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      if (ts.isStringLiteral(expr)) imports.set(node.name.text, { module: normalizeModule(expr.text), member: "*" });
    } else if (ts.isVariableDeclaration(node)) {
      const module = requiredModule(node.initializer);
      if (module) {
        if (ts.isIdentifier(node.name)) imports.set(node.name.text, { module, member: "*" });
        else if (ts.isObjectBindingPattern(node.name)) {
          for (const el of node.name.elements) {
            if (ts.isIdentifier(el.name)) {
              const member = el.propertyName ? el.propertyName.getText(sf) : el.name.text;
              imports.set(el.name.text, { module, member });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return imports;
}

/**
 * Resolves a callee to `{module, member}` when it refers to an imported module
 * member: `exec(...)`, `cp.exec(...)`, `require("child_process").exec(...)`.
 */
export function resolveImportedCallee(
  callee: ts.Expression,
  imports: Map<string, ImportBinding>,
): ImportBinding | undefined {
  if (ts.isIdentifier(callee)) {
    const binding = imports.get(callee.text);
    return binding && binding.member !== "*" && binding.member !== "default" ? binding : undefined;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const object = callee.expression;
    const member = callee.name.text;
    if (ts.isIdentifier(object)) {
      const binding = imports.get(object.text);
      if (binding && (binding.member === "*" || binding.member === "default")) return { module: binding.module, member };
    }
    const required = requiredModule(object);
    if (required) return { module: required, member };
  }
  return undefined;
}

/** True when an expression is a compile-time constant string (no interpolation, no variables). */
export function isConstantString(node: ts.Expression): boolean {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isParenthesizedExpression(node)) return isConstantString(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return isConstantString(node.left) && isConstantString(node.right);
  }
  return false;
}

/** What `constantStringValue` needs to resolve identifiers. */
export interface ConstantScope {
  sf: ts.SourceFile;
  checker: ts.TypeChecker | undefined;
}

function constDeclaration(id: ts.Identifier, scope: ConstantScope): ts.VariableDeclaration | undefined {
  let declaration: ts.Declaration | undefined;
  if (scope.checker) {
    let symbol = scope.checker.getSymbolAtLocation(id);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = scope.checker.getAliasedSymbol(symbol);
    declaration = symbol?.valueDeclaration;
  } else {
    for (const statement of scope.sf.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      declaration ??= statement.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === id.text);
    }
  }
  if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer) return undefined;
  return ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const ? declaration : undefined;
}

/**
 * Value of a string expression that is constant: literals, `+` and templates made of
 * constant parts, and identifiers bound by `const` to such an expression (also across
 * imports when type information is available). Undefined when not constant.
 */
export function constantStringValue(node: ts.Expression, scope: ConstantScope, depth = 0): string | undefined {
  if (depth > 8) return undefined;
  const e = skipParens(node);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isNumericLiteral(e)) return e.text;
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantStringValue(e.left, scope, depth + 1);
    const right = left === undefined ? undefined : constantStringValue(e.right, scope, depth + 1);
    return right === undefined ? undefined : left! + right;
  }
  if (ts.isTemplateExpression(e)) {
    let text = e.head.text;
    for (const span of e.templateSpans) {
      const value = constantStringValue(span.expression, scope, depth + 1);
      if (value === undefined) return undefined;
      text += value + span.literal.text;
    }
    return text;
  }
  if (ts.isIdentifier(e)) {
    const declaration = constDeclaration(e, scope);
    return declaration ? constantStringValue(declaration.initializer!, { sf: declaration.getSourceFile(), checker: scope.checker }, depth + 1) : undefined;
  }
  return undefined;
}

/** Literal text of a string expression, or undefined when not a literal. */
export function stringValue(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/** Name of a property access or identifier callee (`a.b.c(...)` → `c`). */
export function calleeName(callee: ts.Expression): string | undefined {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

/** Text of a property name when static. */
export function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const expr = name.expression;
    if (ts.isStringLiteral(expr) || ts.isNumericLiteral(expr)) return expr.text;
  }
  return undefined;
}

export function skipParens(node: ts.Expression): ts.Expression {
  let n = node;
  while (ts.isParenthesizedExpression(n)) n = n.expression;
  return n;
}
