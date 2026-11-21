import type { Node, Tree } from "web-tree-sitter";
import {
  HalsteadCounter,
  isMeaningfulCommentText,
  type CommentInfo,
  type CpdToken,
  type FunctionMetrics,
  type HalsteadCounts,
  type LineIndex,
  type TextRange,
} from "@qualis/plugin-api";

/** Nodes treated as a single token although tree-sitter gives them children. */
const ATOMIC = new Set(["string_literal", "verbatim_string_literal", "raw_string_literal", "character_literal"]);

export interface Comment extends CommentInfo {
  node: Node;
}

/** 1-based text range of a node. */
export function rangeOf(node: Node): TextRange {
  return {
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
}

/** Depth-first walk; return false from `enter` to skip a subtree. */
export function walk(node: Node, enter: (node: Node) => boolean | void): void {
  if (enter(node) === false) return;
  for (const child of node.children) if (child) walk(child, enter);
}

export interface Tokens {
  leaves: Node[];
  comments: Comment[];
}

export function collectTokens(tree: Tree): Tokens {
  const leaves: Node[] = [];
  const comments: Comment[] = [];
  walk(tree.rootNode, (node) => {
    if (node.type === "comment") {
      comments.push({ node, text: node.text, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });
      return false;
    }
    if (ATOMIC.has(node.type) || node.childCount === 0) {
      if (node.endIndex > node.startIndex && !node.isMissing) leaves.push(node);
      return false;
    }
    return true;
  });
  return { leaves, comments };
}

function markLines(node: Node, lines: LineIndex, target: Set<number>, test: (s: string) => boolean): void {
  const first = node.startPosition.row + 1;
  const last = node.endPosition.row + 1;
  if (first === last) {
    if (test(node.text)) target.add(first);
    return;
  }
  for (let line = first; line <= last; line++) {
    const text = lines.lineText(line);
    const from = line === first ? node.startPosition.column : 0;
    const to = line === last ? node.endPosition.column : text.length;
    if (test(text.slice(from, to))) target.add(line);
  }
}

export function codeAndCommentLines(tokens: Tokens, lines: LineIndex) {
  const code = new Set<number>();
  const comment = new Set<number>();
  for (const leaf of tokens.leaves) markLines(leaf, lines, code, (s) => s.trim().length > 0);
  for (const c of tokens.comments) markLines(c.node, lines, comment, isMeaningfulCommentText);
  return { code, comment };
}

/** Statements whose own line is executable; their nested statements are counted on their own. */
const COMPOUND_STATEMENTS = new Set([
  "if_statement",
  "for_statement",
  "foreach_statement",
  "while_statement",
  "do_statement",
  "switch_statement",
  "try_statement",
  "using_statement",
  "lock_statement",
  "fixed_statement",
  "checked_statement",
  "unsafe_statement",
  "labeled_statement",
]);
const NOT_EXECUTABLE = new Set(["block", "empty_statement", "local_function_statement", "global_statement"]);

/**
 * Lines a .NET coverage tool would instrument: statements, the braces of method
 * bodies, expression bodies, field and property initializers and constructor initializers. Declarations
 * without code (interfaces, abstract members, enums) have none.
 */
export function executableLines(tree: Tree): number[] {
  const lines = new Set<number>();
  const span = (node: Node) => {
    for (let l = node.startPosition.row + 1; l <= node.endPosition.row + 1; l++) lines.add(l);
  };
  walk(tree.rootNode, (node) => {
    if (node.type === "comment") return false;
    if (node.type.endsWith("_statement") && !NOT_EXECUTABLE.has(node.type)) {
      if (COMPOUND_STATEMENTS.has(node.type)) lines.add(node.startPosition.row + 1);
      else span(node);
    } else if (node.type === "block" && node.parent && FUNCTION_TYPES.has(node.parent.type)) {
      // Coverage tools instrument the opening and closing braces of a method body.
      lines.add(node.startPosition.row + 1);
      lines.add(node.endPosition.row + 1);
    } else if (node.type === "arrow_expression_clause" || node.type === "constructor_initializer") {
      span(node);
    } else if (node.type === "variable_declarator" && node.parent?.parent?.type === "field_declaration" && node.namedChildren.length > 1) {
      span(node);
    } else if (node.type === "property_declaration" && node.childForFieldName("value") && node.childForFieldName("value")?.type !== "arrow_expression_clause") {
      span(node.childForFieldName("value")!);
    }
    return true;
  });
  return [...lines].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Halstead and duplication tokens
// ---------------------------------------------------------------------------

const OPERANDS = new Set([
  "identifier",
  "integer_literal",
  "real_literal",
  "boolean_literal",
  "null_literal",
  "character_literal",
  "string_literal",
  "verbatim_string_literal",
  "raw_string_literal",
  "string_content",
  "this",
  "base",
  "true",
  "false",
  "null",
]);
const IGNORED = new Set([")", "]", "}"]);

export function halstead(leaves: Node[]): HalsteadCounts {
  const counter = new HalsteadCounter();
  for (const leaf of leaves) {
    if (IGNORED.has(leaf.type)) continue;
    if (OPERANDS.has(leaf.type)) counter.operand(leaf.text);
    else counter.operator(leaf.text);
  }
  return counter.counts();
}

/** Tokens for duplication detection; `using` directives are skipped. */
export function cpdTokens(leaves: Node[]): CpdToken[] {
  const out: CpdToken[] = [];
  for (const leaf of leaves) {
    let skip = false;
    for (let p = leaf.parent; p; p = p.parent) {
      if (p.type === "using_directive" || p.type === "extern_alias_directive") {
        skip = true;
        break;
      }
      if (p.type.endsWith("_declaration") || p.type === "compilation_unit") break;
    }
    if (!skip) out.push({ image: leaf.text, startLine: leaf.startPosition.row + 1, endLine: leaf.endPosition.row + 1 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Functions and complexity
// ---------------------------------------------------------------------------

const FUNCTION_TYPES = new Set([
  "method_declaration",
  "constructor_declaration",
  "destructor_declaration",
  "operator_declaration",
  "conversion_operator_declaration",
  "local_function_statement",
  "accessor_declaration",
  "lambda_expression",
  "anonymous_method_expression",
]);

const TYPE_DECLARATIONS = new Set([
  "class_declaration",
  "struct_declaration",
  "record_declaration",
  "interface_declaration",
]);

/** Function-like nodes with a body (expression-bodied properties included). */
export function isFunction(node: Node): boolean {
  if (FUNCTION_TYPES.has(node.type)) return node.childForFieldName("body") !== null;
  return node.type === "property_declaration" && node.childForFieldName("value")?.type === "arrow_expression_clause";
}

const sameNode = (a: Node | null | undefined, b: Node) => a !== null && a !== undefined && a.id === b.id;

export function isElseIf(node: Node): boolean {
  const parent = node.parent;
  return node.type === "if_statement" && parent?.type === "if_statement" && sameNode(parent.childForFieldName("alternative"), node);
}

function operatorOf(node: Node): string | undefined {
  return node.childForFieldName("operator")?.type;
}

const DECISION_OPERATORS = new Set(["&&", "||", "??"]);

/** Decision points counted by the cyclomatic complexity. */
export function decisionPoints(node: Node): number {
  switch (node.type) {
    case "if_statement":
    case "conditional_expression":
    case "for_statement":
    case "foreach_statement":
    case "while_statement":
    case "do_statement":
    case "catch_clause":
      return 1;
    case "switch_section":
      return node.children.filter((c) => c?.type === "case").length;
    case "switch_expression_arm": {
      const pattern = node.namedChildren[0];
      return pattern && pattern.text.trim() === "_" ? 0 : 1;
    }
    case "binary_expression":
      return DECISION_OPERATORS.has(operatorOf(node) ?? "") ? 1 : 0;
    case "assignment_expression":
      return operatorOf(node) === "??=" ? 1 : 0;
    default:
      return 0;
  }
}

function countDecisions(root: Node): number {
  let n = 0;
  for (const child of root.children) {
    if (!child) continue;
    walk(child, (node) => {
      if (isFunction(node)) return false;
      n += decisionPoints(node);
      return true;
    });
  }
  return n;
}

const LOGICAL = new Set(["&&", "||"]);
const isLogical = (node: Node | null) => node?.type === "binary_expression" && LOGICAL.has(operatorOf(node) ?? "");

function unwrapParent(node: Node): Node | null {
  let p = node.parent;
  while (p && p.type === "parenthesized_expression") p = p.parent;
  return p;
}

function logicalSequence(node: Node, ops: string[], members: Set<number>): void {
  let n: Node | null = node;
  while (n && n.type === "parenthesized_expression") n = n.namedChildren[0] ?? null;
  if (!n || !isLogical(n)) return;
  members.add(n.id);
  logicalSequence(n.childForFieldName("left")!, ops, members);
  ops.push(operatorOf(n)!);
  logicalSequence(n.childForFieldName("right")!, ops, members);
}

const LOOPS = new Set(["for_statement", "foreach_statement", "while_statement", "do_statement"]);

/** Cognitive complexity (G. A. Campbell) of a function or, with `stopAtFunctions`, of code outside functions. */
export function cognitiveComplexity(root: Node, ownName: string | undefined, stopAtFunctions = false): number {
  let total = 0;
  const counted = new Set<number>();

  const visit = (node: Node, nesting: number): void => {
    if (node.id !== root.id && isFunction(node)) {
      if (!stopAtFunctions) for (const c of node.children) if (c) visit(c, nesting + 1);
      return;
    }
    switch (node.type) {
      case "if_statement": {
        total += isElseIf(node) ? 1 : 1 + nesting;
        const condition = node.childForFieldName("condition");
        const consequence = node.childForFieldName("consequence");
        const alternative = node.childForFieldName("alternative");
        if (condition) visit(condition, nesting);
        if (consequence) visit(consequence, nesting + 1);
        if (alternative) {
          if (alternative.type === "if_statement") visit(alternative, nesting);
          else {
            total += 1;
            visit(alternative, nesting + 1);
          }
        }
        return;
      }
      case "conditional_expression":
      case "switch_statement":
      case "switch_expression":
      case "catch_clause":
        total += 1 + nesting;
        for (const c of node.children) if (c) visit(c, nesting + 1);
        return;
      case "goto_statement":
        total += 1;
        return;
      case "binary_expression":
        if (isLogical(node) && !counted.has(node.id) && !isLogical(unwrapParent(node))) {
          const ops: string[] = [];
          logicalSequence(node, ops, counted);
          total += 1;
          for (let i = 1; i < ops.length; i++) if (ops[i] !== ops[i - 1]) total += 1;
        }
        break;
      case "invocation_expression":
        if (ownName) {
          const fn = node.childForFieldName("function");
          const name =
            fn?.type === "identifier"
              ? fn.text
              : fn?.type === "member_access_expression" && fn.childForFieldName("expression")?.text === "this"
                ? fn.childForFieldName("name")?.text
                : undefined;
          if (name === ownName) total += 1;
        }
        break;
      default:
        if (LOOPS.has(node.type)) {
          total += 1 + nesting;
          const body = node.childForFieldName("body");
          for (const c of node.children) if (c) visit(c, sameNode(body, c) ? nesting + 1 : nesting);
          return;
        }
    }
    for (const c of node.children) if (c) visit(c, nesting);
  };

  for (const c of root.children) if (c) visit(c, 0);
  return total;
}

const NESTING = new Set(["if_statement", "for_statement", "foreach_statement", "while_statement", "do_statement", "switch_statement", "try_statement"]);

export function maxNestingDepth(fn: Node): number {
  let max = 0;
  const visit = (node: Node, depth: number) => {
    if (node.id !== fn.id && isFunction(node)) return;
    let next = depth;
    if (NESTING.has(node.type)) {
      if (!isElseIf(node)) next = depth + 1;
      max = Math.max(max, next);
    }
    for (const c of node.children) if (c) visit(c, next);
  };
  const body = fn.childForFieldName("body") ?? fn.childForFieldName("value");
  if (body) visit(body, 0);
  return max;
}

function ownerName(node: Node): string | undefined {
  for (let p = node.parent; p; p = p.parent) {
    if (TYPE_DECLARATIONS.has(p.type)) return p.childForFieldName("name")?.text;
  }
  return undefined;
}

export function functionName(node: Node): string | undefined {
  if (node.type === "accessor_declaration") return undefined;
  return node.childForFieldName("name")?.text;
}

function displayName(node: Node): string {
  const owner = ownerName(node);
  let own: string;
  switch (node.type) {
    case "lambda_expression":
    case "anonymous_method_expression":
      own = "<lambda>";
      break;
    case "accessor_declaration": {
      const property = node.parent?.parent;
      const propName = property?.childForFieldName("name")?.text ?? (property?.type === "indexer_declaration" ? "this[]" : "?");
      own = `${propName}.${node.childForFieldName("name")?.text ?? node.children[0]?.text ?? "get"}`;
      break;
    }
    case "property_declaration":
      own = `${node.childForFieldName("name")?.text ?? "?"}.get`;
      break;
    case "destructor_declaration":
      own = `~${node.childForFieldName("name")?.text ?? owner ?? "?"}`;
      break;
    case "operator_declaration":
      own = `operator ${node.childForFieldName("operator")?.text ?? ""}`.trim();
      break;
    case "conversion_operator_declaration":
      own = `operator ${node.childForFieldName("type")?.text ?? ""}`.trim();
      break;
    default:
      own = node.childForFieldName("name")?.text ?? "<anonymous>";
  }
  if (node.type === "local_function_statement" || node.type === "lambda_expression" || node.type === "anonymous_method_expression") {
    return own;
  }
  return owner ? `${owner}.${own}` : own;
}

function functionKind(node: Node): FunctionMetrics["kind"] {
  switch (node.type) {
    case "method_declaration":
    case "operator_declaration":
    case "conversion_operator_declaration":
      return "method";
    case "constructor_declaration":
    case "destructor_declaration":
      return "constructor";
    case "accessor_declaration":
    case "property_declaration":
      return "accessor";
    case "local_function_statement":
      return "local-function";
    default:
      return "lambda";
  }
}

export function parameterCount(node: Node): number {
  const params = node.childForFieldName("parameters");
  if (!params) return 0;
  if (params.type === "implicit_parameter") return 1;
  return params.namedChildren.filter((c) => c?.type === "parameter").length;
}

export interface FunctionInfo {
  node: Node;
  metrics: FunctionMetrics;
  topLevel: boolean;
}

export interface Structure {
  functions: FunctionInfo[];
  classes: number;
  statements: number;
  complexity: number;
  cognitiveComplexity: number;
}

const NOT_COUNTED_STATEMENTS = new Set(["empty_statement", "local_function_statement", "global_statement"]);

export function analyzeStructure(tree: Tree, leaves: Node[], codeLines: Set<number>): Structure {
  const functions: FunctionInfo[] = [];
  let classes = 0;
  let statements = 0;
  const visit = (node: Node, depth: number) => {
    if (node.type === "class_declaration" || node.type === "struct_declaration" || node.type === "record_declaration") classes++;
    if (node.type.endsWith("_statement") && !NOT_COUNTED_STATEMENTS.has(node.type)) statements++;
    let nextDepth = depth;
    if (isFunction(node)) {
      const range = rangeOf(node);
      let ncloc = 0;
      for (let l = range.startLine; l <= range.endLine; l++) if (codeLines.has(l)) ncloc++;
      const inside = leaves.filter((l) => l.startIndex >= node.startIndex && l.startIndex < node.endIndex);
      functions.push({
        node,
        topLevel: depth === 0,
        metrics: {
          name: displayName(node),
          kind: functionKind(node),
          range,
          ncloc,
          parameters: parameterCount(node),
          complexity: 1 + countDecisions(node),
          cognitiveComplexity: cognitiveComplexity(node, functionName(node)),
          maxNestingDepth: maxNestingDepth(node),
          halstead: halstead(inside),
        },
      });
      nextDepth = depth + 1;
    }
    for (const c of node.children) if (c) visit(c, nextDepth);
  };
  visit(tree.rootNode, 0);
  const root = tree.rootNode;
  return {
    functions,
    classes,
    statements,
    complexity: functions.reduce((s, f) => s + f.metrics.complexity, 0) + countDecisions(root),
    cognitiveComplexity:
      functions.filter((f) => f.topLevel).reduce((s, f) => s + f.metrics.cognitiveComplexity, 0) +
      cognitiveComplexity(root, undefined, true),
  };
}
