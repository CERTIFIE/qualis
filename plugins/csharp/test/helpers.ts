import type { FileAnalysis, LanguagePlugin } from "@qualis/plugin-api";
import createPlugin from "../src/index.js";

let plugin: LanguagePlugin | undefined;

/** Analyses a C# snippet with every rule enabled. */
export async function analyzeSnippet(
  code: string,
  options: { params?: Record<string, Record<string, number | string | boolean>> } = {},
): Promise<FileAnalysis> {
  plugin ??= await createPlugin();
  const rules = plugin.rules.map((r) => ({
    id: r.id,
    params: { ...Object.fromEntries((r.params ?? []).map((p) => [p.name, p.default])), ...options.params?.[r.id] },
  }));
  const file = { path: "Snippet.cs", absolutePath: "/virtual/Snippet.cs", language: "csharp" };
  return plugin.analyzeFile({ file, content: code, rules });
}
