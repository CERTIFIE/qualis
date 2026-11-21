import js from "@eslint/js";
import { builtinRules } from "eslint/use-at-your-own-risk";
import tseslint from "typescript-eslint";
import type { Reference, RuleDefinition, Severity } from "@qualis/plugin-api";

type RuleEntry = string | number | [string | number, ...unknown[]];
type RuleMap = Record<string, RuleEntry>;

const collect = (configs: readonly { rules?: object }[]): RuleMap =>
  Object.assign({}, ...configs.map((c) => (c.rules ?? {}) as RuleMap));
const isOn = (entry: RuleEntry | undefined) => {
  const level = Array.isArray(entry) ? entry[0] : entry;
  return level !== undefined && level !== "off" && level !== 0;
};

const TS_PREFIX = "@typescript-eslint/";
const tsRecommended = collect(tseslint.configs.recommendedTypeChecked);
const tsStrict = collect(tseslint.configs.strictTypeChecked);

/** Core rules typescript-eslint turns off on TypeScript files (the compiler checks them). */
export const CORE_OFF_FOR_TS = new Set(
  Object.entries({ ...tsStrict, ...tsRecommended })
    .filter(([name, entry]) => !name.startsWith(TS_PREFIX) && !isOn(entry))
    .map(([name]) => name),
);

/** Security-relevant core rules added to the recommended set. */
const SECURITY_EXTRAS = ["no-eval", "no-implied-eval", "no-new-func"];

const coreEnabled: RuleMap = {
  ...(js.configs.recommended.rules as RuleMap),
  ...Object.fromEntries(Object.entries(tsRecommended).filter(([n, e]) => !n.startsWith(TS_PREFIX) && isOn(e))),
  ...Object.fromEntries(SECURITY_EXTRAS.map((n) => [n, "error"])),
};

const cwe = (id: number, title: string): Reference => ({ publisher: "MITRE CWE", id: `CWE-${id}`, title, url: `https://cwe.mitre.org/data/definitions/${id}.html` });
const CWE: Record<string, Reference[]> = {
  "no-eval": [cwe(95, "Improper Neutralization of Directives in Dynamically Evaluated Code ('Eval Injection')")],
  "no-implied-eval": [cwe(95, "Improper Neutralization of Directives in Dynamically Evaluated Code ('Eval Injection')")],
  "no-new-func": [cwe(95, "Improper Neutralization of Directives in Dynamically Evaluated Code ('Eval Injection')")],
  "ts-no-implied-eval": [cwe(95, "Improper Neutralization of Directives in Dynamically Evaluated Code ('Eval Injection')")],
  "no-unsafe-finally": [cwe(584, "Return Inside Finally Block")],
  "no-unreachable": [cwe(561, "Dead Code")],
  "no-cond-assign": [cwe(481, "Assigning instead of Comparing")],
  "no-fallthrough": [cwe(484, "Omitted Break Statement in Switch")],
  "no-dupe-keys": [cwe(563, "Assignment to Variable without Use")],
  "no-unused-vars": [cwe(563, "Assignment to Variable without Use")],
  "ts-no-unused-vars": [cwe(563, "Assignment to Variable without Use")],
  "use-isnan": [cwe(570, "Expression is Always False")],
  "valid-typeof": [cwe(570, "Expression is Always False")],
  "no-self-compare": [cwe(570, "Expression is Always False")],
  "no-debugger": [cwe(489, "Active Debug Code")],
  "ts-no-floating-promises": [cwe(755, "Improper Handling of Exceptional Conditions")],
};

const VULNERABILITIES = new Set(["no-eval", "no-implied-eval", "no-new-func", "ts-no-implied-eval"]);

/** Problem rules that describe maintainability rather than a defect. */
const SMELL_PROBLEMS = /^(ts-)?no-unused-vars$|^ts-no-unsafe-|^ts-no-explicit-any$|^ts-no-redundant-type-constituents$|^ts-no-unnecessary-type-assertion$/;

/** ESLint rules equivalent to rules of the Qualis TypeScript plugin. */
const EQUIVALENT: Record<string, string> = {
  "no-eval": "typescript:no-eval",
  "no-implied-eval": "typescript:no-implied-eval",
  "no-new-func": "typescript:no-implied-eval",
  "ts-no-implied-eval": "typescript:no-implied-eval",
  "use-isnan": "typescript:no-compare-nan",
  "valid-typeof": "typescript:valid-typeof",
  "no-self-compare": "typescript:no-self-compare",
  "no-unsafe-finally": "typescript:no-unsafe-finally",
  "no-fallthrough": "typescript:no-fallthrough",
  "no-duplicate-case": "typescript:no-duplicate-case",
  "no-dupe-keys": "typescript:no-dupe-keys",
  "no-unreachable": "typescript:no-unreachable",
  "no-cond-assign": "typescript:no-cond-assign",
  "no-debugger": "typescript:no-debugger",
  "no-empty": "typescript:no-empty-catch",
  "no-unused-vars": "typescript:unused-declaration",
  "ts-no-unused-vars": "typescript:unused-declaration",
  "ts-no-floating-promises": "typescript:no-floating-promises",
  "ts-no-deprecated": "typescript:deprecated-api",
};

/** Overlapping rules that cover only part of their Qualis equivalent: never supersede. */
const PARTIAL = new Set(["no-new-func"]);

export interface WrappedRule {
  definition: RuleDefinition;
  /** Name of the rule inside ESLint (`no-eval`, `@typescript-eslint/no-floating-promises`). */
  eslintName: string;
  /** ESLint configuration entry (severity and options) used when the rule is enabled. */
  entry: RuleEntry;
  typescriptOnly: boolean;
  requiresTypeChecking: boolean;
}

interface RuleMeta {
  type?: "problem" | "suggestion" | "layout";
  docs?: { description?: string; url?: string; requiresTypeChecking?: boolean };
}

function wrap(eslintName: string, meta: RuleMeta, entry: RuleEntry, enabledByDefault: boolean): WrappedRule {
  const typescriptOnly = eslintName.startsWith(TS_PREFIX);
  const key = typescriptOnly ? `ts-${eslintName.slice(TS_PREFIX.length)}` : eslintName;
  const project = typescriptOnly ? "typescript-eslint" : "ESLint";
  const description = (meta.docs?.description ?? eslintName).replace(/\.$/, "");
  const type = VULNERABILITIES.has(key) ? "vulnerability" : meta.type === "problem" && !SMELL_PROBLEMS.test(key) ? "bug" : "code-smell";
  const severity: Severity = type === "vulnerability" ? "critical" : type === "bug" ? "major" : meta.type === "layout" ? "info" : "minor";
  const equivalent = EQUIVALENT[key];
  // An ESLint rule replaces the equivalent Qualis rule only when it runs on every
  // file that rule covers; otherwise it starts disabled to avoid duplicate issues.
  const canSupersede = equivalent !== undefined && !typescriptOnly && !CORE_OFF_FOR_TS.has(eslintName) && !PARTIAL.has(key);
  const definition: RuleDefinition = {
    id: `eslint:${key}`,
    name: description.replace(/`/g, ""),
    languages: typescriptOnly ? ["typescript"] : ["typescript", "javascript"],
    type,
    severity,
    tags: ["eslint", ...(typescriptOnly ? ["typescript-eslint"] : []), ...(meta.docs?.requiresTypeChecking ? ["type-aware"] : []), ...(CWE[key] ?? []).map((r) => r.id!.toLowerCase())],
    enabledByDefault: enabledByDefault && (equivalent === undefined || canSupersede),
    effortMinutes: type === "vulnerability" ? 30 : type === "bug" ? 10 : meta.type === "layout" ? 1 : 5,
    description: `${description}. Runs the \`${eslintName}\` rule of ${project} unchanged.`,
    rationale:
      `This rule is defined and maintained by the ${project} project, which documents the problem it detects, its options and examples on the linked page. ` +
      (CWE[key] ? `MITRE classifies the underlying weakness as ${CWE[key]!.map((r) => r.id).join(", ")}. ` : "") +
      (equivalent
        ? canSupersede
          ? `When this rule is enabled it replaces \`${equivalent}\`, which detects the same problem.`
          : `It overlaps with \`${equivalent}\`, so it is disabled by default; enable it instead of that rule if you prefer the ${project} implementation.`
        : ""),
    references: [{ publisher: project, title: `${eslintName}: ${description}`, url: meta.docs?.url ?? "https://eslint.org/docs/latest/rules/" }, ...(CWE[key] ?? [])],
    ...(canSupersede && { supersedes: [equivalent] }),
  };
  if (meta.docs?.requiresTypeChecking) {
    definition.exceptions = "Requires type information: it runs only when the project has a tsconfig.json (or `typeChecked` is enabled) and the file belongs to a TypeScript project.";
  }
  return { definition, eslintName, entry, typescriptOnly, requiresTypeChecking: Boolean(meta.docs?.requiresTypeChecking) };
}

function buildRules(): WrappedRule[] {
  const rules: WrappedRule[] = [];
  for (const [name, entry] of Object.entries(coreEnabled)) {
    const rule = builtinRules.get(name);
    if (rule && isOn(entry)) rules.push(wrap(name, rule.meta as RuleMeta, entry, true));
  }
  const tsRules = (tseslint.plugin as unknown as { rules: Record<string, { meta: RuleMeta }> }).rules;
  for (const [fullName, entry] of Object.entries(tsStrict)) {
    if (!fullName.startsWith(TS_PREFIX) || !isOn(entry)) continue;
    const rule = tsRules[fullName.slice(TS_PREFIX.length)];
    if (!rule) continue;
    const recommended = isOn(tsRecommended[fullName]);
    rules.push(wrap(fullName, rule.meta, recommended ? tsRecommended[fullName]! : entry, recommended));
  }
  return rules.sort((a, b) => (a.definition.id < b.definition.id ? -1 : 1));
}

export const RULES: WrappedRule[] = buildRules();
export const BY_ESLINT_NAME = new Map(RULES.map((r) => [r.eslintName, r]));
