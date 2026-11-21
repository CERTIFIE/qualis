// Test fixture: language plugin for .txt files with a TODO rule.
const ref = [{ publisher: "Test", title: "Fixture", url: "https://example.org/fixture" }];
const rule = (id) => ({ id, name: "TODO", languages: ["txt"], type: "code-smell", severity: "info", tags: [], enabledByDefault: true, effortMinutes: 0, description: "Reports TODO lines.", rationale: "Fixture rule used by the tests of the host.", references: ref });
export const todoIssues = (content, ruleId) =>
  content.split("\n").flatMap((text, i) => (text.includes("TODO") ? [{ ruleId, message: "TODO", range: { startLine: i + 1, startColumn: 1, endLine: i + 1, endColumn: text.length + 1 } }] : []));

export default {
  apiVersion: 1,
  id: "txt",
  name: "Text",
  version: "1.0.0",
  languages: [{ id: "txt", name: "Text", extensions: [".txt"] }],
  rules: [rule("txt:todo")],
  analyzeFile({ content, rules }) {
    const lines = content.split("\n").filter(Boolean).length;
    return {
      issues: rules.some((r) => r.id === "txt:todo") ? todoIssues(content, "txt:todo") : [],
      measures: { lines, ncloc: lines, commentLines: 0, functions: 0, classes: 0, statements: 0, complexity: 0, cognitiveComplexity: 0 },
    };
  },
  ruleFactory: rule,
};
