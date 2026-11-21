import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { loadSchema, SCHEMA_IDS, SCHEMA_NAMES, type SchemaName } from "@qualis/schema";

// ajv-formats is CommonJS; its default export shape differs between loaders.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as (ajv: Ajv2020) => Ajv2020;

let ajv: Ajv2020 | undefined;
const validators = new Map<string, ValidateFunction>();

function instance(): Ajv2020 {
  if (!ajv) {
    ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    for (const name of SCHEMA_NAMES) ajv.addSchema(loadSchema(name));
  }
  return ajv;
}

function validator(ref: string): ValidateFunction {
  let fn = validators.get(ref);
  if (!fn) {
    fn = instance().getSchema(ref);
    if (!fn) throw new Error(`Unknown schema ${ref}`);
    validators.set(ref, fn);
  }
  return fn;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).slice(0, 20).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
}

/** Validates data against one of the published schemas, or a `$defs` entry (`schema#/$defs/Name`). */
export function validate(schema: SchemaName | `${SchemaName}#/$defs/${string}`, data: unknown): ValidationResult {
  const [name, fragment] = schema.split("#") as [SchemaName, string | undefined];
  const ref = fragment ? `${SCHEMA_IDS[name]}#${fragment}` : SCHEMA_IDS[name];
  const fn = validator(ref);
  const valid = fn(data) as boolean;
  return { valid, errors: valid ? [] : formatErrors(fn.errors) };
}
