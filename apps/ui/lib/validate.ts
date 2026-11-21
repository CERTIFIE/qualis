import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { Report } from "@qualis/schema";
import commonSchema from "@qualis/schema/schemas/common.schema.json";
import reportSchema from "@qualis/schema/schemas/report.schema.json";

// Isomorphic: the server validates the files it reads, the browser validates a report.json opened with "Read analysis".
// The schemas are imported as JSON so that no file system access is needed in either environment.

// ajv-formats is CommonJS; its default export shape differs between bundlers and loaders.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (ajv: Ajv2020) => Ajv2020;

let validator: ValidateFunction | undefined;

function reportValidator(): ValidateFunction {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: false, strict: false });
    addFormats(ajv);
    ajv.addSchema(commonSchema as Record<string, unknown>);
    validator = ajv.compile(reportSchema as Record<string, unknown>);
  }
  return validator;
}

export type ReportCheck = { ok: true; report: Report } | { ok: false; errors: string[] };

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).slice(0, 10).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
}

/** Checks parsed JSON against the published report schema. */
export function checkReport(data: unknown): ReportCheck {
  const fn = reportValidator();
  if (fn(data)) return { ok: true, report: data as Report };
  return { ok: false, errors: formatErrors(fn.errors) };
}

/** Parses and checks the text of a report.json file. */
export function parseReport(text: string): ReportCheck {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`Not valid JSON: ${(error as Error).message}`] };
  }
  return checkReport(data);
}
