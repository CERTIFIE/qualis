import type { FileAnalysis, PluginKind, PluginManifest, RulePackAnalysis } from "@qualis/schema";
import { PLUGIN_API_VERSION } from "@qualis/plugin-api";
import { validate } from "../validation.js";

export class PluginError extends Error {}

/** Checks a manifest against the schema and the host's expectations. */
export function checkManifest(manifest: unknown, origin: string): PluginManifest {
  const result = validate("plugin-manifest", manifest);
  if (!result.valid) {
    throw new PluginError(`Plugin ${origin} returned an invalid manifest:\n  ${result.errors.join("\n  ")}`);
  }
  const m = manifest as PluginManifest;
  // Read as a number: the schema already pins the value, but a plugin may still declare another version.
  const version: number = (manifest as { apiVersion: number }).apiVersion;
  if (version !== PLUGIN_API_VERSION) {
    throw new PluginError(`Plugin ${origin} implements API version ${version}, host supports ${PLUGIN_API_VERSION}`);
  }
  const ids = new Set<string>();
  for (const rule of m.rules) {
    if (!rule.id.startsWith(`${m.id}:`)) {
      throw new PluginError(`Plugin ${m.id}: rule id "${rule.id}" must start with "${m.id}:"`);
    }
    if (ids.has(rule.id)) throw new PluginError(`Plugin ${m.id}: duplicate rule id "${rule.id}"`);
    ids.add(rule.id);
  }
  return m;
}

/** Checks the result returned by a plugin for one file (file analysis, or issues only for rule packs). */
export function checkFileAnalysis(data: unknown, pluginId: string, file: string, kind: PluginKind = "language"): FileAnalysis | RulePackAnalysis {
  const result = validate(kind === "rule-pack" ? "file-analysis#/$defs/RulePackAnalysis" : "file-analysis", data);
  if (!result.valid) {
    throw new PluginError(`Plugin ${pluginId} returned an invalid result for ${file}:\n  ${result.errors.join("\n  ")}`);
  }
  return data as FileAnalysis | RulePackAnalysis;
}

/** Kind of a plugin (`language` when not declared). */
export const kindOf = (manifest: PluginManifest): PluginKind => manifest.kind ?? "language";
