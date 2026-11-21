// Test fixture: rule pack superseding txt:todo; set FAIL_PREPARE to simulate a pack that cannot run.
import language, { todoIssues } from "./txt-language.mjs";

export default () => ({
  apiVersion: 1,
  kind: "rule-pack",
  id: "pack",
  name: "Pack",
  version: "1.0.0",
  languages: [{ id: "txt", name: "Text", extensions: [".txt"] }],
  rules: [{ ...language.ruleFactory("pack:todo"), supersedes: ["txt:todo"] }],
  prepare({ options }) {
    if (options.fail) throw new Error("project cannot be loaded");
  },
  analyzeFile({ content }) {
    return { issues: todoIssues(content, "pack:todo") };
  },
});
