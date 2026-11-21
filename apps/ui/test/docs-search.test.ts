import { describe, expect, it } from "vitest";
import { searchDocs, type DocsHit } from "../lib/docs-search";

const hit = (title: string, text = ""): DocsHit => ({ section: "Concepts", title, url: `/docs/${title.toLowerCase().replace(/\s+/g, "-")}`, text });

describe("searchDocs", () => {
  const index = [hit("Quality gate", "conditions on new code"), hit("Coverage and tests", "lcov cobertura opencover junit"), hit("New code", "reference branch")];

  it("finds pages whose title or text contain every word, title matches first", () => {
    expect(searchDocs(index, "new code").map((h) => h.title)).toEqual(["New code", "Quality gate"]);
    expect(searchDocs(index, "JUnit").map((h) => h.title)).toEqual(["Coverage and tests"]);
  });

  it("returns nothing for an empty query or a word that matches nothing", () => {
    expect(searchDocs(index, "  ")).toEqual([]);
    expect(searchDocs(index, "gate sarif")).toEqual([]);
  });

  it("returns at most 8 hits", () => {
    expect(searchDocs(Array.from({ length: 20 }, (_, i) => hit(`Rule ${i}`)), "rule")).toHaveLength(8);
  });
});
