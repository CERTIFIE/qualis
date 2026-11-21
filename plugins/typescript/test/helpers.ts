import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import type { FileAnalysis, LanguagePlugin } from "@qualis/plugin-api";
import createPlugin from "../src/index.js";

const dir = mkdtempSync(path.join(tmpdir(), "qualis-ts-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let counter = 0;
const silent = { log: () => undefined };

/** Analyses a snippet with every rule enabled (type information included). */
export async function analyzeSnippet(
  code: string,
  options: { ext?: string; params?: Record<string, Record<string, number | string | boolean>> } = {},
): Promise<FileAnalysis> {
  const file = path.join(dir, `snippet${counter++}${options.ext ?? ".ts"}`);
  writeFileSync(file, code);
  const plugin: LanguagePlugin = createPlugin();
  const pluginFile = { path: path.basename(file), absolutePath: file, language: "typescript" };
  await plugin.prepare?.({ baseDir: dir, files: [pluginFile], options: {}, log: silent });
  const rules = plugin.rules.map((r) => ({
    id: r.id,
    params: { ...Object.fromEntries((r.params ?? []).map((p) => [p.name, p.default])), ...options.params?.[r.id] },
  }));
  return plugin.analyzeFile({ file: pluginFile, content: code, rules });
}

