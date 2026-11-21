import ts from "typescript";
import {
  HalsteadCounter,
  isMeaningfulCommentText,
  type CommentInfo,
  type CpdToken,
  type FunctionMetrics,
  type HalsteadCounts,
  type LineIndex,
} from "@qualis/plugin-api";

export interface Comment extends CommentInfo {
  pos: number;
  end: number;
  kind: ts.CommentKind;
}

export type FunctionNode =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction;

export interface FunctionInfo {
  node: FunctionNode;
  metrics: FunctionMetrics;
  /** True when not nested inside another function. */
  topLevel: boolean;
}

/** Function-like declarations that have a body. */
export function isFunctionWithBody(node: ts.Node): node is FunctionNode {
  switch (node.kind) {
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.Constructor:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
    case ts.SyntaxKind.FunctionExpression:
    case ts.SyntaxKind.ArrowFunction:
      return (node as FunctionNode).body !== undefined;
    default:
      return false;
  }
}

const isJsDocNode = (node: ts.Node) =>
  node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;

/** All leaf tokens of a source file in order (JSDoc and zero-width tokens excluded). */
export function collectLeaves(sf: ts.SourceFile): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (isJsDocNode(node)) return;
    const children = node.getChildren(sf);
    if (children.length === 0) {
      if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
      if (node.kind === ts.SyntaxKind.JsxText && (node as ts.JsxText).containsOnlyTriviaWhiteSpaces) return;
      if (node.getStart(sf) >= node.end) return;
      out.push(node);
      return;
    }
    for (const child of children) visit(child);
  };
  visit(sf);
  return out;
}

/** Comments of a file, read from the trivia around each token. */
export function collectComments(sf: ts.SourceFile, leaves: ts.Node[], lines: LineIndex): Comment[] {
  const text = sf.text;
  const seen = new Set<number>();
  const out: Comment[] = [];
  const add = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      out.push({
        pos: range.pos,
        end: range.end,
        kind: range.kind,
        text: text.slice(range.pos, range.end),
        startLine: lines.lineOf(range.pos),
        endLine: lines.lineOf(Math.max(range.pos, range.end - 1)),
      });
    }
  };
  for (const leaf of leaves) {
    if (leaf.kind === ts.SyntaxKind.JsxText) continue;
    add(ts.getLeadingCommentRanges(text, leaf.pos));
    // Comments after a token on the same line are trailing trivia of that token.
    add(ts.getTrailingCommentRanges(text, leaf.end));
  }
  add(ts.getLeadingCommentRanges(text, sf.endOfFileToken.pos));
  return out.sort((a, b) => a.pos - b.pos);
}

/** Marks the lines of [start, end) that contain non-whitespace text. */
function markLines(text: string, start: number, end: number, lines: LineIndex, target: Set<number>, test: (s: string) => boolean) {
  const first = lines.lineOf(start);
  const last = lines.lineOf(Math.max(start, end - 1));
  if (first === last) {
    if (test(text.slice(start, end))) target.add(first);
    return;
  }
  for (let line = first; line <= last; line++) {
    const lineText = lines.lineText(line);
    // Clip to the token on the first and last line.
    const from = line === first ? lines.position(start).column - 1 : 0;
    const to = line === last ? lines.position(end).column - 1 : lineText.length;
    if (test(lineText.slice(from, to))) target.add(line);
  }
}

export function codeAndCommentLines(sf: ts.SourceFile, leaves: ts.Node[], comments: Comment[], lines: LineIndex) {
  const code = new Set<number>();
  const comment = new Set<number>();
  const nonBlank = (s: string) => s.trim().length > 0;
  for (const leaf of leaves) markLines(sf.text, leaf.getStart(sf), leaf.end, lines, code, nonBlank);
  for (const c of comments) markLines(sf.text, c.pos, c.end, lines, comment, isMeaningfulCommentText);
  return { code, comment };
}

// ---------------------------------------------------------------------------
// Halstead
// ---------------------------------------------------------------------------

const OPERAND_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PrivateIdentifier,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.SuperKeyword,
]);

/** Closing delimiters are counted once with their opening counterpart. */
const IGNORED_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.CloseBraceToken,
]);

export function halstead(sf: ts.SourceFile, leaves: ts.Node[]): HalsteadCounts {
  const counter = new HalsteadCounter();
  for (const leaf of leaves) {
    if (IGNORED_KINDS.has(leaf.kind)) continue;
    const image = leaf.getText(sf);
    if (OPERAND_KINDS.has(leaf.kind)) counter.operand(image);
    else counter.operator(image);
  }
  return counter.counts();
}

/** Leaves whose start lies in [start, end). `leaves` must be sorted. */
export function leavesIn(sf: ts.SourceFile, leaves: ts.Node[], starts: number[], start: number, end: number): ts.Node[] {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid]! < start) lo = mid + 1;
    else hi = mid;
  }
  const out: ts.Node[] = [];
  for (let i = lo; i < leaves.length && starts[i]! < end; i++) out.push(leaves[i]!);
  return out;
}

// ---------------------------------------------------------------------------
// Duplication tokens
// ---------------------------------------------------------------------------

/** Tokens for duplication detection; import/export-from declarations are skipped. */
export function cpdTokens(sf: ts.SourceFile, leaves: ts.Node[], lines: LineIndex): CpdToken[] {
  const skipped: [number, number][] = [];
  for (const statement of sf.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement) ||
      (ts.isExportDeclaration(statement) && statement.moduleSpecifier)
    ) {
      skipped.push([statement.getStart(sf), statement.end]);
    }
  }
  const out: CpdToken[] = [];
  let k = 0;
  for (const leaf of leaves) {
    const start = leaf.getStart(sf);
    while (k < skipped.length && skipped[k]![1] <= start) k++;
    if (k < skipped.length && start >= skipped[k]![0]) continue;
    out.push({ image: leaf.getText(sf), startLine: lines.lineOf(start), endLine: lines.lineOf(Math.max(start, leaf.end - 1)) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Complexity
// ---------------------------------------------------------------------------

const LOGICAL = new Set<ts.SyntaxKind>([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken]);
const DECISION_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Decision points counted by the cyclomatic complexity (McCabe; NIST SP 500-235). */
export function isDecisionPoint(node: ts.Node): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.ConditionalExpression:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.CaseClause:
    case ts.SyntaxKind.CatchClause:
      return true;
    case ts.SyntaxKind.BinaryExpression:
      return DECISION_OPERATORS.has((node as ts.BinaryExpression).operatorToken.kind);
    default:
      return false;
  }
}

/** Counts decision points under `root`, not entering nested functions. */
function countDecisions(root: ts.Node, includeRoot: boolean): number {
  let n = includeRoot && isDecisionPoint(root) ? 1 : 0;
  const visit = (node: ts.Node) => {
    if (isFunctionWithBody(node)) return;
    if (isDecisionPoint(node)) n++;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return n;
}

export function cyclomaticComplexity(fn: FunctionNode): number {
  return 1 + countDecisions(fn, false);
}

const unwrapParens = (node: ts.Node): ts.Node => {
  let n = node.parent;
  while (n && ts.isParenthesizedExpression(n)) n = n.parent;
  return n;
};

function isLogical(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && LOGICAL.has(node.operatorToken.kind);
}

/** Operators of a flattened sequence of && / || (through parentheses), in source order. */
function logicalSequence(node: ts.Node, out: ts.SyntaxKind[], members: Set<ts.Node>): void {
  let n = node;
  while (ts.isParenthesizedExpression(n)) n = n.expression;
  if (!isLogical(n)) return;
  members.add(n);
  logicalSequence(n.left, out, members);
  out.push(n.operatorToken.kind);
  logicalSequence(n.right, out, members);
}

function functionName(fn: FunctionNode): string | undefined {
  if (fn.name && (ts.isIdentifier(fn.name) || ts.isPrivateIdentifier(fn.name))) return fn.name.text;
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return undefined;
}

/**
 * Cognitive complexity of a function (G. A. Campbell, "Cognitive Complexity",
 * SonarSource 2017-2023): +1 for each break in linear flow, plus the current
 * nesting level for structures that nest; shorthand such as `?.` and `??` is ignored.
 */
export function cognitiveComplexity(root: ts.Node, ownName?: string, stopAtFunctions = false): number {
  let total = 0;
  const counted = new Set<ts.Node>();

  const visit = (node: ts.Node, nesting: number): void => {
    switch (node.kind) {
      case ts.SyntaxKind.IfStatement: {
        const s = node as ts.IfStatement;
        const isElseIf = ts.isIfStatement(s.parent) && s.parent.elseStatement === s;
        total += isElseIf ? 1 : 1 + nesting;
        visit(s.expression, nesting);
        visit(s.thenStatement, nesting + 1);
        if (s.elseStatement) {
          if (ts.isIfStatement(s.elseStatement)) visit(s.elseStatement, nesting);
          else {
            total += 1;
            visit(s.elseStatement, nesting + 1);
          }
        }
        return;
      }
      case ts.SyntaxKind.ConditionalExpression: {
        const c = node as ts.ConditionalExpression;
        total += 1 + nesting;
        visit(c.condition, nesting);
        visit(c.whenTrue, nesting + 1);
        visit(c.whenFalse, nesting + 1);
        return;
      }
      case ts.SyntaxKind.SwitchStatement: {
        const s = node as ts.SwitchStatement;
        total += 1 + nesting;
        visit(s.expression, nesting);
        visit(s.caseBlock, nesting + 1);
        return;
      }
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement: {
        total += 1 + nesting;
        const body = (node as ts.IterationStatement).statement;
        ts.forEachChild(node, (child) => visit(child, child === body ? nesting + 1 : nesting));
        return;
      }
      case ts.SyntaxKind.CatchClause:
        total += 1 + nesting;
        ts.forEachChild(node, (child) => visit(child, nesting + 1));
        return;
      case ts.SyntaxKind.BreakStatement:
      case ts.SyntaxKind.ContinueStatement:
        if ((node as ts.BreakOrContinueStatement).label) total += 1;
        return;
      case ts.SyntaxKind.BinaryExpression:
        if (isLogical(node) && !counted.has(node)) {
          const parent = unwrapParens(node);
          if (!(parent && isLogical(parent))) {
            const ops: ts.SyntaxKind[] = [];
            logicalSequence(node, ops, counted);
            total += 1;
            for (let i = 1; i < ops.length; i++) if (ops[i] !== ops[i - 1]) total += 1;
          }
        }
        break;
      case ts.SyntaxKind.CallExpression: {
        const callee = (node as ts.CallExpression).expression;
        if (ownName) {
          const name = ts.isIdentifier(callee)
            ? callee.text
            : ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.ThisKeyword
              ? callee.name.text
              : undefined;
          if (name === ownName) total += 1;
        }
        break;
      }
      default:
        if (node !== root && isFunctionWithBody(node)) {
          // Nested functions add nesting to the enclosing one (or are scored on their own).
          if (!stopAtFunctions) ts.forEachChild(node, (child) => visit(child, nesting + 1));
          return;
        }
    }
    ts.forEachChild(node, (child) => visit(child, nesting));
  };

  ts.forEachChild(root, (child) => visit(child, 0));
  return total;
}

const NESTING_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement,
]);

/** Deepest nesting of control structures in a function body (else-if chains count as one level). */
export function maxNestingDepth(fn: FunctionNode): number {
  let max = 0;
  const visit = (node: ts.Node, depth: number) => {
    if (isFunctionWithBody(node)) return;
    let next = depth;
    if (NESTING_KINDS.has(node.kind)) {
      const elseIf = ts.isIfStatement(node) && ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
      if (!elseIf) next = depth + 1;
      max = Math.max(max, next);
    }
    ts.forEachChild(node, (child) => visit(child, next));
  };
  if (fn.body) ts.forEachChild(fn.body, (child) => visit(child, 0));
  return max;
}

function displayName(fn: FunctionNode, sf: ts.SourceFile): string {
  const owner = (() => {
    const p = fn.parent;
    if (p && (ts.isClassDeclaration(p) || ts.isClassExpression(p))) return p.name?.text ?? "<class>";
    if (p && ts.isObjectLiteralExpression(p)) {
      const holder = p.parent;
      if (holder && ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) return holder.name.text;
    }
    return undefined;
  })();
  let own: string;
  if (ts.isConstructorDeclaration(fn)) own = "constructor";
  else if (fn.name) own = fn.name.getText(sf);
  else {
    const p = fn.parent;
    if (p && ts.isVariableDeclaration(p)) own = p.name.getText(sf);
    else if (p && ts.isPropertyAssignment(p)) own = p.name.getText(sf);
    else if (p && ts.isPropertyDeclaration(p)) own = p.name.getText(sf);
    else if (p && ts.isBinaryExpression(p) && p.right === fn) own = p.left.getText(sf);
    else own = "<anonymous>";
  }
  if (ts.isGetAccessorDeclaration(fn)) own = `get ${own}`;
  if (ts.isSetAccessorDeclaration(fn)) own = `set ${own}`;
  return owner ? `${owner}.${own}` : own;
}

function functionKind(fn: FunctionNode): FunctionMetrics["kind"] {
  switch (fn.kind) {
    case ts.SyntaxKind.MethodDeclaration:
      return "method";
    case ts.SyntaxKind.Constructor:
      return "constructor";
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
      return "accessor";
    case ts.SyntaxKind.FunctionDeclaration:
      return ts.isSourceFile(fn.parent) || ts.isModuleBlock(fn.parent) ? "function" : "local-function";
    default:
      return "lambda";
  }
}

export interface FileStructure {
  functions: FunctionInfo[];
  classes: number;
  statements: number;
  complexity: number;
  cognitiveComplexity: number;
}

/** Per-function metrics and file totals. */
export function analyzeStructure(
  sf: ts.SourceFile,
  leaves: ts.Node[],
  codeLines: Set<number>,
  lines: LineIndex,
): FileStructure {
  const starts = leaves.map((l) => l.getStart(sf));
  const functions: FunctionInfo[] = [];
  let classes = 0;
  let statements = 0;
  let depth = 0;

  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) classes++;
    if (node.kind >= ts.SyntaxKind.FirstStatement && node.kind <= ts.SyntaxKind.LastStatement) statements++;
    if (isFunctionWithBody(node)) {
      const start = node.getStart(sf);
      const range = lines.range(start, node.end);
      let ncloc = 0;
      for (let l = range.startLine; l <= range.endLine; l++) if (codeLines.has(l)) ncloc++;
      functions.push({
        node,
        topLevel: depth === 0,
        metrics: {
          name: displayName(node, sf),
          kind: functionKind(node),
          range,
          ncloc,
          parameters: node.parameters.filter((p) => !(ts.isIdentifier(p.name) && p.name.text === "this")).length,
          complexity: cyclomaticComplexity(node),
          cognitiveComplexity: cognitiveComplexity(node, functionName(node)),
          maxNestingDepth: maxNestingDepth(node),
          halstead: halstead(sf, leavesIn(sf, leaves, starts, start, node.end)),
        },
      });
      depth++;
      ts.forEachChild(node, visit);
      depth--;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Decision points and cognitive increments outside of any function.
  const topLevelComplexity = countDecisions(sf, false);
  const topLevelCognitive = cognitiveComplexity(sf, undefined, true);
  return {
    functions,
    classes,
    statements,
    complexity: functions.reduce((s, f) => s + f.metrics.complexity, 0) + topLevelComplexity,
    cognitiveComplexity:
      functions.filter((f) => f.topLevel).reduce((s, f) => s + f.metrics.cognitiveComplexity, 0) + topLevelCognitive,
  };
}
