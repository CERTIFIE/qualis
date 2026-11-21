import ts from "typescript";
import { REF } from "../references.js";
import { LANGUAGES, propertyNameText, resolveImportedCallee, skipParens, stringValue, type ImportBinding, type Rule } from "./context.js";

const EQUALITY = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

const isNaNReference = (node: ts.Expression): boolean => {
  const n = skipParens(node);
  if (ts.isIdentifier(n)) return n.text === "NaN";
  return ts.isPropertyAccessExpression(n) && n.name.text === "NaN" && ts.isIdentifier(n.expression) && n.expression.text === "Number";
};

export const noCompareNaN: Rule = {
  definition: {
    id: "typescript:no-compare-nan",
    name: "NaN should be tested with Number.isNaN()",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["cwe-570", "cwe-571"],
    enabledByDefault: true,
    effortMinutes: 5,
    description: "Reports comparisons with `==`, `===`, `!=` or `!==` against `NaN` or `Number.NaN`.",
    rationale:
      "MDN explains that `NaN` compares unequal to every value, itself included, and that `Number.isNaN()` must be used to test for it. An equality test against `NaN` is therefore always false (CWE-570) and an inequality test always true (CWE-571).",
    noncompliantExample: "if (value === NaN) { reset(); }",
    compliantExample: "if (Number.isNaN(value)) { reset(); }",
    references: [REF.mdnNaN, REF.cwe570, REF.cwe571],
  },
  visit(node, ctx) {
    if (ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind) && (isNaNReference(node.left) || isNaNReference(node.right))) {
      ctx.report(node, "Use Number.isNaN() instead; comparisons with NaN are never true.");
    }
  },
};

const TYPEOF_RESULTS = new Set(["undefined", "object", "boolean", "number", "bigint", "string", "symbol", "function"]);

export const validTypeof: Rule = {
  definition: {
    id: "typescript:valid-typeof",
    name: "typeof should be compared with a valid type name",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["cwe-570"],
    enabledByDefault: true,
    effortMinutes: 5,
    description: "Reports comparisons of a `typeof` expression with a string literal that `typeof` can never return.",
    rationale:
      "MDN lists the only strings `typeof` can produce: \"undefined\", \"object\", \"boolean\", \"number\", \"bigint\", \"string\", \"symbol\" and \"function\". Comparing with any other string (often a typo such as \"strnig\") gives a condition that is always false (CWE-570) or always true.",
    noncompliantExample: "if (typeof name === \"strnig\") { greet(name); }",
    compliantExample: "if (typeof name === \"string\") { greet(name); }",
    references: [REF.mdnTypeof, REF.cwe570],
  },
  visit(node, ctx) {
    if (!ts.isBinaryExpression(node) || !EQUALITY.has(node.operatorToken.kind)) return;
    const pairs: [ts.Expression, ts.Expression][] = [
      [node.left, node.right],
      [node.right, node.left],
    ];
    for (const [a, b] of pairs) {
      if (ts.isTypeOfExpression(skipParens(a))) {
        const text = stringValue(skipParens(b));
        if (text !== undefined && !TYPEOF_RESULTS.has(text)) {
          ctx.report(b, `"${text}" is not a possible result of typeof.`);
        }
      }
    }
  },
};

/** Operands without side effects whose identical text means identical value. */
const isPureReference = (node: ts.Expression): boolean => {
  const n = skipParens(node);
  if (ts.isIdentifier(n) || n.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isPropertyAccessExpression(n)) return isPureReference(n.expression);
  return false;
};

const COMPARISON = new Set<ts.SyntaxKind>([
  ...EQUALITY,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

export const noSelfCompare: Rule = {
  definition: {
    id: "typescript:no-self-compare",
    name: "A value should not be compared with itself",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["cwe-570", "cwe-571"],
    enabledByDefault: true,
    effortMinutes: 5,
    description: "Reports comparisons whose two operands are the same variable or property, such as `x === x` or `a.b < a.b`.",
    rationale:
      "Comparing a value with itself is always true or always false (CWE-570, CWE-571) except for `NaN`; it is usually a typo for another operand. When the intent is to detect `NaN`, MDN recommends `Number.isNaN()`, which states the intent explicitly.",
    noncompliantExample: "if (order.total !== order.total) { return; }",
    compliantExample: "if (Number.isNaN(order.total)) { return; }",
    references: [REF.mdnNaN, REF.cwe570, REF.cwe571],
  },
  visit(node, ctx) {
    if (
      ts.isBinaryExpression(node) &&
      COMPARISON.has(node.operatorToken.kind) &&
      isPureReference(node.left) &&
      skipParens(node.left).getText(ctx.sf) === skipParens(node.right).getText(ctx.sf)
    ) {
      ctx.report(node, "Both sides of this comparison are the same; the result is constant.");
    }
  },
};

/** True when `node` is inside `finally` and the jump leaves the finally block. */
function escapesFinally(jump: ts.Node, finallyBlock: ts.Block): boolean {
  if (ts.isReturnStatement(jump) || ts.isThrowStatement(jump)) return true;
  const label = (jump as ts.BreakOrContinueStatement).label?.text;
  for (let n: ts.Node = jump.parent; n !== finallyBlock; n = n.parent) {
    if (label) {
      if (ts.isLabeledStatement(n) && n.label.text === label) return false;
    } else if (ts.isIterationStatement(n, false) || (ts.isBreakStatement(jump) && ts.isSwitchStatement(n))) {
      return false;
    }
  }
  return true;
}

export const noUnsafeFinally: Rule = {
  definition: {
    id: "typescript:no-unsafe-finally",
    name: "Control flow should not leave a finally block",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["error-handling", "cwe-584"],
    enabledByDefault: true,
    effortMinutes: 10,
    description: "Reports `return`, `throw`, `break` and `continue` statements that exit a `finally` block.",
    rationale:
      "MDN explains that a control-flow statement in a `finally` block overrides the effect of a `return` or `throw` in the `try` or `catch` block: a thrown error is silently discarded or a returned value replaced. MITRE describes the same defect as Return Inside Finally Block (CWE-584).",
    noncompliantExample: "try {\n  return await load();\n} finally {\n  return null; // discards the result and any error\n}",
    compliantExample: "try {\n  return await load();\n} finally {\n  release();\n}",
    references: [REF.mdnFinally, REF.cwe584],
  },
  visit(node, ctx) {
    if (!ts.isReturnStatement(node) && !ts.isThrowStatement(node) && !ts.isBreakStatement(node) && !ts.isContinueStatement(node)) return;
    for (let n: ts.Node = node.parent; n && !ts.isSourceFile(n); n = n.parent) {
      if (ts.isFunctionLike(n) || ts.isClassLike(n)) return;
      if (ts.isBlock(n) && ts.isTryStatement(n.parent) && n.parent.finallyBlock === n) {
        if (escapesFinally(node, n)) ctx.report(node, "Do not leave a finally block with a control-flow statement; it discards the outcome of try/catch.");
        return;
      }
    }
  },
};

/** True when executing `statement` can never continue to the next statement. */
function alwaysJumps(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement) || ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    const last = statement.statements[statement.statements.length - 1];
    return last !== undefined && alwaysJumps(last);
  }
  if (ts.isIfStatement(statement)) {
    return statement.elseStatement !== undefined && alwaysJumps(statement.thenStatement) && alwaysJumps(statement.elseStatement);
  }
  if (ts.isTryStatement(statement)) {
    if (statement.finallyBlock && alwaysJumps(statement.finallyBlock)) return true;
    return alwaysJumps(statement.tryBlock) && (!statement.catchClause || alwaysJumps(statement.catchClause.block));
  }
  return false;
}

const FALLTHROUGH_COMMENT = /falls?\s?through/i;

export const noFallthrough: Rule = {
  definition: {
    id: "typescript:no-fallthrough",
    name: "Switch cases should not fall through",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["cwe-484"],
    enabledByDefault: true,
    effortMinutes: 10,
    description:
      "Reports non-empty `case` clauses whose statements can reach the next clause without `break`, `return`, `throw` or `continue`.",
    rationale:
      "Without a jump statement, execution continues into the next `case` regardless of its label (MDN). Accidental fall-through is a classic defect (CWE-484, Omitted Break Statement in Switch); TypeScript offers the `noFallthroughCasesInSwitch` compiler option for the same reason.",
    exceptions: "Intentional fall-through is accepted when a comment containing \"falls through\" precedes the next clause. Empty clauses grouping several labels are allowed.",
    noncompliantExample: "switch (level) {\n  case \"warn\":\n    notify();\n  case \"error\":\n    page();\n    break;\n}",
    compliantExample: "switch (level) {\n  case \"warn\":\n    notify();\n    break;\n  case \"error\":\n    page();\n    break;\n}",
    references: [REF.mdnSwitch, REF.tsNoFallthrough, REF.cwe484],
  },
  visit(node, ctx) {
    if (!ts.isCaseBlock(node)) return;
    const clauses = node.clauses;
    for (let i = 0; i < clauses.length - 1; i++) {
      const clause = clauses[i]!;
      const last = clause.statements[clause.statements.length - 1];
      if (!last || alwaysJumps(last)) continue;
      const next = clauses[i + 1]!;
      const between = ctx.comments.some((c) => c.pos >= last.end && c.end <= next.getStart(ctx.sf) && FALLTHROUGH_COMMENT.test(c.text));
      if (!between) ctx.report(clause.getChildAt(0, ctx.sf), "End this case with break, return or throw, or document the fall-through.");
    }
  },
};

export const noDuplicateCase: Rule = {
  definition: {
    id: "typescript:no-duplicate-case",
    name: "Switch statements should not have duplicate case labels",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["cwe-561"],
    enabledByDefault: true,
    effortMinutes: 5,
    description: "Reports `case` clauses whose expression is textually identical to an earlier clause of the same `switch`.",
    rationale:
      "A `switch` runs the first clause whose value strictly equals the discriminant (MDN), so a later clause with the same label can never be selected: it is dead code (CWE-561), and usually a copy-paste mistake hiding the intended value.",
    noncompliantExample: "switch (status) {\n  case 200: ok(); break;\n  case 200: created(); break;\n}",
    compliantExample: "switch (status) {\n  case 200: ok(); break;\n  case 201: created(); break;\n}",
    references: [REF.mdnSwitch, REF.cwe561],
  },
  visit(node, ctx) {
    if (!ts.isCaseBlock(node)) return;
    const seen = new Map<string, ts.CaseClause>();
    for (const clause of node.clauses) {
      if (!ts.isCaseClause(clause)) continue;
      const key = skipParens(clause.expression).getText(ctx.sf).replace(/\s+/g, "");
      if (seen.has(key)) ctx.report(clause.expression, `Duplicate case label; the clause at line ${ctx.lines.lineOf(seen.get(key)!.getStart(ctx.sf))} already handles it.`);
      else seen.set(key, clause);
    }
  },
};

export const noDupeKeys: Rule = {
  definition: {
    id: "typescript:no-dupe-keys",
    name: "Object literals should not have duplicate keys",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["cwe-563"],
    enabledByDefault: true,
    effortMinutes: 5,
    description: "Reports properties defined twice in the same object literal (getter/setter pairs excepted).",
    rationale:
      "Duplicate property names are legal since ES2015, but MDN notes that the later definition overwrites the earlier one. The first value is therefore assigned and never used (CWE-563), which almost always indicates a mistake.",
    noncompliantExample: "const defaults = { timeout: 1000, retries: 3, timeout: 5000 };",
    compliantExample: "const defaults = { timeout: 5000, retries: 3 };",
    references: [REF.mdnDuplicateKeys, REF.cwe563],
  },
  visit(node, ctx) {
    if (!ts.isObjectLiteralExpression(node)) return;
    const seen = new Map<string, "value" | "get" | "set" | "accessor">();
    for (const prop of node.properties) {
      if (ts.isSpreadAssignment(prop) || !prop.name) {
        if (ts.isSpreadAssignment(prop)) seen.clear(); // a spread may redefine anything
        continue;
      }
      const name = propertyNameText(prop.name);
      if (name === undefined) continue;
      const kind = ts.isGetAccessorDeclaration(prop) ? "get" : ts.isSetAccessorDeclaration(prop) ? "set" : "value";
      const previous = seen.get(name);
      if (previous && !((previous === "get" && kind === "set") || (previous === "set" && kind === "get"))) {
        ctx.report(prop.name, `Duplicate key "${name}"; the earlier value is overwritten.`);
      }
      seen.set(name, previous && previous !== kind && kind !== "value" ? "accessor" : kind);
    }
  },
};

export const noUnreachable: Rule = {
  definition: {
    id: "typescript:no-unreachable",
    name: "Code after return, throw, break or continue should be removed",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["cwe-561"],
    enabledByDefault: true,
    effortMinutes: 5,
    description: "Reports statements that follow a `return`, `throw`, `break` or `continue` in the same block.",
    rationale:
      "Statements placed after an unconditional jump can never execute (Dead Code, CWE-561). They often reveal a logic error such as a misplaced `return`. TypeScript reports the same condition unless `allowUnreachableCode` is enabled.",
    exceptions: "Function declarations (which are hoisted) and type declarations are not reported.",
    noncompliantExample: "function save(user) {\n  return repository.save(user);\n  audit(user);\n}",
    compliantExample: "function save(user) {\n  audit(user);\n  return repository.save(user);\n}",
    references: [REF.tsAllowUnreachable, REF.cwe561],
  },
  visit(node, ctx) {
    const statements = ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node)
      ? node.statements
      : ts.isCaseClause(node) || ts.isDefaultClause(node)
        ? node.statements
        : undefined;
    if (!statements) return;
    for (let i = 0; i < statements.length - 1; i++) {
      if (!alwaysJumps(statements[i]!)) continue;
      const unreachable = statements
        .slice(i + 1)
        .find((s) => !ts.isFunctionDeclaration(s) && !ts.isInterfaceDeclaration(s) && !ts.isTypeAliasDeclaration(s) && !ts.isEmptyStatement(s));
      if (unreachable) ctx.report(unreachable, "This code is unreachable.");
      return;
    }
  },
};

const isAssignment = (node: ts.Expression): boolean =>
  ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken;

export const noCondAssign: Rule = {
  definition: {
    id: "typescript:no-cond-assign",
    name: "Conditions should not contain assignments",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["cwe-481"],
    enabledByDefault: true,
    effortMinutes: 5,
    description:
      "Reports an assignment (`=`) used directly as the condition of `if`, `while`, `do...while`, `for` or a conditional expression.",
    rationale:
      "Writing `=` where `==` or `===` was meant makes the condition test the assigned value and silently changes the variable. MITRE lists this as Assigning instead of Comparing (CWE-481).",
    exceptions: "An assignment wrapped in an extra pair of parentheses, e.g. `while ((match = re.exec(s)))`, is considered intentional.",
    noncompliantExample: "if (user.role = \"admin\") { grant(); }",
    compliantExample: "if (user.role === \"admin\") { grant(); }",
    references: [REF.cwe481],
  },
  visit(node, ctx) {
    let condition: ts.Expression | undefined;
    if (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) condition = node.expression;
    else if (ts.isForStatement(node)) condition = node.condition;
    else if (ts.isConditionalExpression(node)) condition = node.condition;
    if (condition && isAssignment(condition)) ctx.report(condition, "Did you mean to compare instead of assign? Wrap in extra parentheses if intended.");
  },
};

export const noEmptyCatch: Rule = {
  definition: {
    id: "typescript:no-empty-catch",
    name: "Exceptions should not be silently ignored",
    languages: LANGUAGES,
    type: "bug",
    severity: "minor",
    tags: ["error-handling", "cwe-1069", "cwe-390"],
    enabledByDefault: true,
    effortMinutes: 10,
    description: "Reports `catch` blocks that contain neither statements nor a comment.",
    rationale:
      "An empty `catch` hides failures: the program continues in an unknown state and the cause is lost. MITRE describes this as Empty Exception Block (CWE-1069) and Detection of Error Condition Without Action (CWE-390).",
    exceptions: "A comment inside the block documenting why the error can be ignored marks the catch as intentional.",
    noncompliantExample: "try {\n  cache.write(key, value);\n} catch (e) {}",
    compliantExample: "try {\n  cache.write(key, value);\n} catch (e) {\n  // The cache is optional: a failed write only costs a recomputation.\n  log.debug(e);\n}",
    references: [REF.cwe1069, REF.cwe390],
  },
  visit(node, ctx) {
    if (!ts.isCatchClause(node) || node.block.statements.length > 0) return;
    const block = node.block;
    const hasComment = ctx.comments.some((c) => c.pos > block.getStart(ctx.sf) && c.end < block.end);
    if (!hasComment) ctx.report(node.getChildAt(0, ctx.sf), "Handle this exception or explain in a comment why it is ignored.");
  },
};

function isPromiseLike(checker: ts.TypeChecker, node: ts.Expression): boolean {
  const type = checker.getTypeAtLocation(node);
  const types = type.isUnion() ? type.types : [type];
  return types.some((t) => {
    const then = t.getProperty("then");
    if (!then) return false;
    const thenType = checker.getTypeOfSymbolAtLocation(then, node);
    return thenType.getCallSignatures().length > 0;
  });
}

/** True when a promise expression is handled: `.catch()`, `.then(a, b)` or awaited/voided by the caller. */
function isHandledChain(expr: ts.Expression): boolean {
  const e = skipParens(expr);
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    const method = e.expression.name.text;
    if (method === "catch") return true;
    if (method === "then" && e.arguments.length >= 2) return true;
    // `.finally()` passes the outcome through: the chain is handled when its receiver is.
    if (method === "finally") return isHandledChain(e.expression.expression);
  }
  return false;
}

/** Test-definition functions of node:test: their promise always fulfils, failures are reported by the runner. */
const NODE_TEST_FUNCTIONS = new Set(["test", "it", "describe", "suite"]);

function isNodeTestDefinition(call: ts.CallExpression, imports: Map<string, ImportBinding>): boolean {
  let callee = call.expression;
  // test.skip(...), describe.only(...), test.todo(...)
  if (ts.isPropertyAccessExpression(callee) && ["skip", "only", "todo"].includes(callee.name.text)) callee = callee.expression;
  const binding = ts.isIdentifier(callee) ? imports.get(callee.text) : undefined;
  if (binding?.module === "test" && NODE_TEST_FUNCTIONS.has(binding.member)) return true;
  const member = resolveImportedCallee(callee, imports);
  return member?.module === "test" && NODE_TEST_FUNCTIONS.has(member.member);
}

export const noFloatingPromises: Rule = {
  definition: {
    id: "typescript:no-floating-promises",
    name: "Promises should be awaited or have their rejection handled",
    languages: LANGUAGES,
    type: "bug",
    severity: "major",
    tags: ["async", "error-handling", "cwe-755", "type-aware"],
    enabledByDefault: true,
    effortMinutes: 10,
    description:
      "Reports expression statements that create a promise (according to the type checker) without `await`, `return`, `void`, a `.catch()` handler or a two-argument `.then()`.",
    rationale:
      "A promise whose rejection is never handled loses the error. MDN's guide on promises shows terminating chains with a `.catch()` handler; since Node.js 15 the default `--unhandled-rejections=throw` mode makes an unhandled rejection crash the process when no `unhandledRejection` listener is registered. Not handling the failure is Improper Handling of Exceptional Conditions (CWE-755).",
    exceptions:
      "Requires type information: the rule is skipped for files analysed without a TypeScript program. Use `void promise;` to mark an intentionally detached promise. Calls of `test()`, `it()`, `describe()` and `suite()` imported from `node:test` are not reported: the Node.js documentation states that their promise is fulfilled once the test completes and failures are reported by the test runner (subtests created with `t.test()` must still be awaited).",
    noncompliantExample: "declare const repository: { save(item: string): Promise<void> };\n\nasync function onSave(item: string) {\n  repository.save(item);\n}",
    compliantExample: "declare const repository: { save(item: string): Promise<void> };\n\nasync function onSave(item: string) {\n  await repository.save(item);\n}",
    references: [REF.mdnPromises, REF.nodeUnhandledRejections, REF.nodeTest, REF.cwe755],
  },
  visit(node, ctx) {
    if (!ctx.checker || !ts.isExpressionStatement(node)) return;
    const expr = skipParens(node.expression);
    if (ts.isVoidExpression(expr) || ts.isAwaitExpression(expr)) return;
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && expr.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return;
    if (!ts.isCallExpression(expr) && !ts.isNewExpression(expr)) return;
    if (isHandledChain(expr)) return;
    if (ts.isCallExpression(expr) && isNodeTestDefinition(expr, ctx.imports)) return;
    if (isPromiseLike(ctx.checker, expr)) ctx.report(expr, "Await this promise or handle its rejection with .catch().");
  },
};

export const reliabilityRules: Rule[] = [
  noCompareNaN,
  validTypeof,
  noSelfCompare,
  noUnsafeFinally,
  noFallthrough,
  noDuplicateCase,
  noDupeKeys,
  noUnreachable,
  noCondAssign,
  noEmptyCatch,
  noFloatingPromises,
];
