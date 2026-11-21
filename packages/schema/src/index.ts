import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export * from "./types.js";

export const SCHEMA_NAMES = [
  "common",
  "config",
  "report",
  "plugin-manifest",
  "file-analysis",
  "plugin-protocol",
] as const;

export type SchemaName = (typeof SCHEMA_NAMES)[number];

/** `$id` of each schema. */
export const SCHEMA_IDS: Readonly<Record<SchemaName, string>> = {
  common: "urn:qualis:schema:common:1",
  config: "urn:qualis:schema:config:1",
  report: "urn:qualis:schema:report:1",
  "plugin-manifest": "urn:qualis:schema:plugin-manifest:1",
  "file-analysis": "urn:qualis:schema:file-analysis:1",
  "plugin-protocol": "urn:qualis:schema:plugin-protocol:1",
};

/** Absolute path of a JSON Schema file shipped with this package. */
export function schemaPath(name: SchemaName): string {
  return fileURLToPath(new URL(`../schemas/${name}.schema.json`, import.meta.url));
}

/** Loads a JSON Schema shipped with this package. */
export function loadSchema(name: SchemaName): Record<string, unknown> {
  return JSON.parse(readFileSync(schemaPath(name), "utf8")) as Record<string, unknown>;
}
