import type { ActiveRule, IssueType, PluginManifest, RuleScope, RuleSetting, Severity } from "@qualis/schema";

/** Scope of a rule that does not declare one: bugs everywhere, the other types on production code only. */
export function defaultScope(type: IssueType): RuleScope {
  return type === "bug" ? "all" : "main";
}

export interface RuleResolution {
  /** Enabled rules, keyed by id. */
  active: Map<string, ActiveRule>;
  /** Glob patterns of files excluded per rule. */
  excludes: Map<string, string[]>;
  warnings: string[];
}

type ParamValue = number | string | boolean;

function checkParam(type: string, value: unknown): value is ParamValue {
  switch (type) {
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    default:
      return false;
  }
}

/** Combines plugin rule definitions with the `rules` section of the configuration. */
export function resolveRules(manifests: PluginManifest[], settings: Record<string, RuleSetting>): RuleResolution {
  const active = new Map<string, ActiveRule>();
  const excludes = new Map<string, string[]>();
  const warnings: string[] = [];
  const known = new Set<string>();

  for (const manifest of manifests) {
    for (const rule of manifest.rules) {
      known.add(rule.id);
      const setting = settings[rule.id];
      let enabled = rule.enabledByDefault;
      let severity: Severity = rule.severity;
      let params: Record<string, unknown> = {};
      let scope: RuleScope = rule.scope ?? defaultScope(rule.type);
      if (setting === "off") enabled = false;
      else if (setting === "on") enabled = true;
      else if (typeof setting === "string") {
        enabled = true;
        severity = setting;
      } else if (setting) {
        enabled = setting.enabled ?? true;
        severity = setting.severity ?? severity;
        params = setting.params ?? {};
        scope = setting.scope ?? scope;
        if (setting.exclude?.length) excludes.set(rule.id, setting.exclude);
      }
      if (!enabled) continue;

      const paramValues: Record<string, ParamValue> = {};
      for (const def of rule.params ?? []) paramValues[def.name] = def.default;
      for (const [name, value] of Object.entries(params)) {
        const def = rule.params?.find((p) => p.name === name);
        if (!def) {
          warnings.push(`Rule ${rule.id} has no parameter "${name}"; ignored`);
        } else if (!checkParam(def.type, value)) {
          warnings.push(`Rule ${rule.id}: parameter "${name}" must be of type ${def.type}; default used`);
        } else {
          paramValues[name] = value;
        }
      }
      active.set(rule.id, { ...rule, severity, plugin: manifest.id, defaultSeverity: rule.severity, paramValues, scope });
    }
  }
  for (const id of Object.keys(settings)) {
    if (!known.has(id) && !id.startsWith("external:")) warnings.push(`Unknown rule "${id}" in configuration`);
  }
  return { active, excludes, warnings };
}
