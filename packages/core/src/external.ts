import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TextRange } from "@qualis/schema";
import { relativeTo } from "./paths.js";

/** SARIF result level; ESLint severities 2 and 1 map to `error` and `warning`. */
export type ExternalLevel = "error" | "warning" | "note" | "none";

/** One issue read from an external report. */
export interface ExternalFinding {
  /** Rule id in Qualis: `external:<tool>:<rule>`. */
  id: string;
  /** Project-relative path with forward slashes. */
  path: string;
  range: TextRange;
  message: string;
  level: ExternalLevel;
}

/** What a report says about one rule of the tool. */
export interface ExternalRuleInfo {
  id: string;
  /** Tool name as written in the report. */
  tool: string;
  /** Rule id in the tool. */
  ruleId: string;
  name: string;
  description?: string;
  helpUri?: string;
  /** The tool tags the rule as a security finding. */
  security: boolean;
}

export interface ExternalImport {
  findings: ExternalFinding[];
  rules: Map<string, ExternalRuleInfo>;
  /** Issues on files outside the project root. */
  outside: number;
  /** Issues on files that do not belong to the report's own project (`accept`). */
  otherProject: number;
  warnings: string[];
}

/** A report to import, optionally restricted to the files of one build project. */
export interface ExternalReportInput {
  /** Absolute path of the report. */
  file: string;
  /** Keeps only the issues of files this returns true for (project-relative paths). */
  accept?: (path: string) => boolean;
  /** Keeps only the runs of the C# and Visual Basic compilers (build error logs). */
  compilerOnly?: boolean;
}

const LEVEL_RANK: Record<ExternalLevel, number> = { none: 0, note: 1, warning: 2, error: 3 };

/** Highest of two levels. */
export function maxLevel(a: ExternalLevel, b: ExternalLevel): ExternalLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/** Short lowercase name of a tool, used in rule ids. */
export function toolSlug(tool: string): string {
  if (/visual (c#|basic)|roslyn/i.test(tool)) return "roslyn"; // the name is localised: "Compilatore Microsoft (R) Visual C#"
  return tool.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "") || "tool";
}

/** Qualis id of a rule of another tool. */
export function externalRuleId(tool: string, ruleId: string): string {
  return `external:${toolSlug(tool)}:${ruleId}`;
}

function normalizeRange(startLine: unknown, startColumn: unknown, endLine: unknown, endColumn: unknown): TextRange {
  const int = (v: unknown, fallback: number) => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : fallback);
  const sl = int(startLine, 1);
  const sc = int(startColumn, 1);
  const el = Math.max(int(endLine, sl), sl);
  let ec = int(endColumn, sc + 1);
  if (el === sl && ec <= sc) ec = sc + 1;
  return { startLine: sl, startColumn: sc, endLine: el, endColumn: ec };
}

/** Resolves a path or URI of a report to a project-relative path; null when outside the project. */
function projectPath(location: string, baseDir: string, roots: string[]): string | null {
  let absolute: string;
  try {
    absolute = location.startsWith("file:") ? fileURLToPath(location) : path.resolve(baseDir, decodeURIComponent(location));
  } catch {
    return null;
  }
  for (const root of roots) {
    const rel = relativeTo(root, absolute);
    if (rel !== null) return rel;
  }
  try {
    return relativeTo(roots[roots.length - 1]!, realpathSync(absolute));
  } catch {
    return null;
  }
}

type Json = Record<string, any>;

function eslintHelpUri(ruleId: string): string | undefined {
  if (!ruleId.includes("/")) return `https://eslint.org/docs/latest/rules/${ruleId}`;
  if (ruleId.startsWith("@typescript-eslint/")) return `https://typescript-eslint.io/rules/${ruleId.slice("@typescript-eslint/".length)}`;
  return undefined;
}

function importEslint(data: Json[], report: string, baseDir: string, roots: string[], out: ExternalImport): void {
  let parseErrors = 0;
  const missing = new Set<string>();
  for (const file of data) {
    if (typeof file?.filePath !== "string" || !Array.isArray(file.messages)) continue;
    const rel = projectPath(file.filePath, baseDir, roots);
    for (const m of file.messages as Json[]) {
      if (!m.ruleId) {
        if (m.fatal) parseErrors++;
        continue;
      }
      // An eslint-disable comment naming a rule the configuration does not load: a configuration problem, not an issue.
      if (/^Definition for rule '.+' was not found/.test(String(m.message))) {
        missing.add(m.ruleId);
        continue;
      }
      if (rel === null) {
        out.outside++;
        continue;
      }
      const id = externalRuleId("ESLint", m.ruleId);
      if (!out.rules.has(id)) {
        const helpUri = eslintHelpUri(m.ruleId);
        out.rules.set(id, { id, tool: "ESLint", ruleId: m.ruleId, name: m.ruleId, ...(helpUri && { helpUri }), security: /(^|\/)security\//.test(m.ruleId) });
      }
      out.findings.push({
        id,
        path: rel,
        range: normalizeRange(m.line, m.column, m.endLine, m.endColumn),
        message: String(m.message ?? m.ruleId),
        level: m.severity === 2 ? "error" : "warning",
      });
    }
  }
  if (missing.size > 0) out.warnings.push(`${report}: comments name ESLint rules the configuration does not define (${[...missing].sort().join(", ")}); ignored`);
  if (parseErrors > 0) out.warnings.push(`${report}: ESLint could not parse ${parseErrors} file(s); their issues are missing`);
}

function sarifText(message: Json | undefined, rule: Json | undefined): string | undefined {
  if (!message) return undefined;
  let text: string | undefined = message.text ?? (message.id ? rule?.messageStrings?.[message.id]?.text : undefined);
  if (text && Array.isArray(message.arguments)) {
    text = text.replace(/\{(\d+)\}/g, (all, i) => (message.arguments[Number(i)] !== undefined ? String(message.arguments[Number(i)]) : all));
  }
  return text;
}

const V1_SUPPRESSED = new Set(["suppressedInSource", "suppressedExternally"]);

/** Converts a SARIF 1.0 run (the default format of the compilers' `ErrorLog`) to the 2.1 shape read below. */
function sarifV1Run(run: Json): Json {
  const text = (v: unknown) => (typeof v === "string" ? { text: v } : v);
  const rules = Object.entries((run.rules ?? {}) as Json).map(([id, r]: [string, Json]) => ({
    id: r?.id ?? id,
    name: r?.name,
    shortDescription: text(r?.shortDescription),
    fullDescription: text(r?.fullDescription),
    helpUri: r?.helpUri,
    defaultConfiguration: r?.defaultLevel ? { level: r.defaultLevel } : undefined,
    properties: r?.properties,
  }));
  return {
    tool: { driver: { name: run.tool?.name, rules } },
    results: ((run.results ?? []) as Json[]).map((r) => ({
      ruleId: r.ruleId,
      level: r.level === "pass" || r.level === "notApplicable" ? undefined : r.level,
      kind: r.level === "pass" ? "pass" : r.level === "notApplicable" ? "notApplicable" : undefined,
      message: text(r.message),
      suppressions: Array.isArray(r.suppressionStates) && r.suppressionStates.some((s: string) => V1_SUPPRESSED.has(s)) ? [{ kind: "inSource" }] : undefined,
      locations: ((r.locations ?? []) as Json[]).map((l) => ({
        physicalLocation: { artifactLocation: { uri: l.resultFile?.uri }, region: l.resultFile?.region },
      })),
    })),
  };
}

/** Whether a SARIF tool is the C# or Visual Basic compiler (a build error log). */
export function isCompiler(tool: string): boolean {
  return toolSlug(tool) === "roslyn";
}

function importSarif(data: Json, input: ExternalReportInput, baseDir: string, roots: string[], out: ExternalImport): void {
  const v1 = typeof data.version === "string" && data.version.startsWith("1.");
  for (const original of (data.runs ?? []) as Json[]) {
    const run = v1 ? sarifV1Run(original) : original;
    const driver: Json = run.tool?.driver ?? {};
    const tool = String(driver.name ?? "SARIF");
    if (input.compilerOnly && !isCompiler(tool)) continue;
    const components: Json[] = [driver, ...((run.tool?.extensions ?? []) as Json[])];
    const byId = new Map<string, Json>();
    for (const c of components) for (const r of (c.rules ?? []) as Json[]) if (r?.id && !byId.has(r.id)) byId.set(r.id, r);
    const bases = new Map<string, string>();
    for (const [key, value] of Object.entries((run.originalUriBaseIds ?? {}) as Json)) if (typeof value?.uri === "string") bases.set(key, value.uri);

    for (const result of (run.results ?? []) as Json[]) {
      if (result.kind && result.kind !== "fail" && result.kind !== "review" && result.kind !== "open") continue;
      if (result.baselineState === "absent") continue;
      if (Array.isArray(result.suppressions) && result.suppressions.some((s: Json) => !s.status || s.status === "accepted")) continue;
      const component = components[result.rule?.toolComponent?.index ?? 0] ?? driver;
      const index = result.ruleIndex ?? result.rule?.index;
      const rule: Json | undefined =
        (typeof index === "number" ? component.rules?.[index] : undefined) ?? byId.get(result.ruleId ?? result.rule?.id);
      const ruleId: string | undefined = result.ruleId ?? result.rule?.id ?? rule?.id;
      if (!ruleId) continue;

      const physical: Json | undefined = result.locations?.[0]?.physicalLocation;
      let artifact: Json | undefined = physical?.artifactLocation;
      if (artifact && artifact.uri === undefined && typeof artifact.index === "number") artifact = run.artifacts?.[artifact.index]?.location;
      if (typeof artifact?.uri !== "string") continue; // project-level finding: no file to attach it to
      let uri: string = artifact.uri;
      const base = artifact.uriBaseId ? bases.get(artifact.uriBaseId) : undefined;
      if (base && !/^[a-z]+:/i.test(uri)) uri = new URL(uri, base.endsWith("/") ? base : base + "/").href;
      const rel = projectPath(uri, baseDir, roots);
      if (rel === null) {
        out.outside++;
        continue;
      }
      if (input.accept && !input.accept(rel)) {
        out.otherProject++;
        continue;
      }

      const id = externalRuleId(tool, ruleId);
      if (!out.rules.has(id)) {
        const tags: unknown[] = Array.isArray(rule?.properties?.tags) ? rule.properties.tags : [];
        const helpUri: string | undefined = rule?.helpUri ?? rule?.help?.uri;
        const description = rule?.fullDescription?.text ?? rule?.shortDescription?.text;
        out.rules.set(id, {
          id,
          tool,
          ruleId,
          name: rule?.shortDescription?.text ?? rule?.name ?? ruleId,
          ...(description && { description }),
          ...(helpUri && { helpUri }),
          security: tags.some((t) => String(t).toLowerCase() === "security") || rule?.properties?.["security-severity"] !== undefined,
        });
      }
      const region: Json = physical?.region ?? {};
      const level: ExternalLevel = result.level ?? rule?.defaultConfiguration?.level ?? "warning";
      out.findings.push({
        id,
        path: rel,
        range: normalizeRange(region.startLine, region.startColumn, region.endLine, region.endColumn),
        message: sarifText(result.message, rule) ?? out.rules.get(id)!.name,
        level: level in LEVEL_RANK ? level : "warning",
      });
    }
  }
}

/** Reads SARIF (2.1.0 and 1.0) and ESLint JSON reports. */
export async function importExternalIssues(reports: (string | ExternalReportInput)[], baseDir: string): Promise<ExternalImport> {
  const out: ExternalImport = { findings: [], rules: new Map(), outside: 0, otherProject: 0, warnings: [] };
  const roots = [baseDir];
  try {
    const real = realpathSync(baseDir);
    if (real !== baseDir) roots.push(real);
  } catch {
    // baseDir exists: it was analysed
  }
  for (const report of reports) {
    const input = typeof report === "string" ? { file: report } : report;
    const file = input.file;
    const name = relativeTo(baseDir, file) ?? file;
    let data: unknown;
    try {
      data = JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, ""));
    } catch (error) {
      out.warnings.push(`${name}: not a JSON report (${(error as Error).message})`);
      continue;
    }
    if (Array.isArray(data)) importEslint(data as Json[], name, baseDir, roots, out);
    else if (data && typeof data === "object" && Array.isArray((data as Json).runs)) importSarif(data as Json, input, baseDir, roots, out);
    else out.warnings.push(`${name}: neither a SARIF nor an ESLint JSON report`);
  }
  return out;
}
