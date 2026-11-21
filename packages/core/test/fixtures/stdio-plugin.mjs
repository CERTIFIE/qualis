// Test fixture: an out-of-process plugin served with runStdioPlugin.
import { definePlugin, LineIndex, runStdioPlugin } from "@qualis/plugin-api";

const plugin = definePlugin({
  apiVersion: 1,
  id: "ini",
  name: "INI (test fixture)",
  version: "1.0.0",
  languages: [{ id: "ini", name: "INI", extensions: [".ini"] }],
  rules: [
    {
      id: "ini:empty-value",
      name: "Keys should have a value",
      languages: ["ini"],
      type: "bug",
      severity: "minor",
      tags: [],
      enabledByDefault: true,
      effortMinutes: 2,
      description: "Reports keys without a value.",
      rationale: "A key without a value is usually an unfinished edit in the configuration file.",
      references: [{ publisher: "Test", title: "INI file", url: "https://en.wikipedia.org/wiki/INI_file" }],
    },
  ],
  analyzeFile({ content, rules }) {
    const index = new LineIndex(content);
    const issues = [];
    const code = [];
    for (let line = 1; line <= index.lineCount; line++) {
      const text = index.lineText(line);
      if (text.trim() && !text.trim().startsWith(";")) code.push(line);
      const m = /^(\w+)\s*=\s*$/.exec(text);
      if (m && rules.some((r) => r.id === "ini:empty-value")) {
        issues.push({ ruleId: "ini:empty-value", message: `Key "${m[1]}" has no value.`, range: { startLine: line, startColumn: 1, endLine: line, endColumn: text.length + 1 } });
      }
    }
    return {
      issues,
      measures: { lines: index.lineCount, ncloc: code.length, commentLines: 0, functions: 0, classes: 0, statements: 0, complexity: 0, cognitiveComplexity: 0 },
      codeLines: code,
    };
  },
});

await runStdioPlugin(plugin);
