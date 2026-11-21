import { describe, expect, it } from "vitest";
import { analyzeSnippet } from "./helpers.js";

const fn = (analysis: Awaited<ReturnType<typeof analyzeSnippet>>, name: string) => {
  const found = analysis.functions?.find((f) => f.name === name);
  if (!found) throw new Error(`function ${name} not found in ${analysis.functions?.map((f) => f.name).join(", ")}`);
  return found;
};

describe("complexity metrics", () => {
  // Examples from G. A. Campbell, "Cognitive Complexity" (sumOfPrimes = 7, getWords = 1).
  it("computes cognitive complexity as in the reference examples", async () => {
    const result = await analyzeSnippet(`
class Primes {
  int SumOfPrimes(int max) {
    int total = 0;
    for (int i = 1; i <= max; ++i) {
      for (int j = 2; j < i; ++j) {
        if (i % j == 0) {
          goto next;
        }
      }
      total += i;
      next: ;
    }
    return total;
  }

  string GetWords(int number) {
    switch (number) {
      case 1: return "one";
      case 2: return "a couple";
      case 3: return "a few";
      default: return "lots";
    }
  }
}`);
    expect(fn(result, "Primes.SumOfPrimes").cognitiveComplexity).toBe(7);
    expect(fn(result, "Primes.GetWords").cognitiveComplexity).toBe(1);
    expect(fn(result, "Primes.SumOfPrimes").complexity).toBe(4);
    expect(fn(result, "Primes.GetWords").complexity).toBe(4);
  });

  it("handles else-if chains, logical sequences and null-coalescing", async () => {
    const result = await analyzeSnippet(`
class A {
  int G(int x, int? y, bool a, bool b, bool c) {
    if (x > 0) { return 1; }
    else if (x < 0 && a && b || c) { return y ?? 2; }
    else { return 0; }
  }
}`);
    const g = fn(result, "A.G");
    // if +1, else if +1, else +1, "&& && ||" sequence +2
    expect(g.cognitiveComplexity).toBe(5);
    // 1 + if + else-if + && + && + || + ??
    expect(g.complexity).toBe(7);
    expect(g.maxNestingDepth).toBe(1);
    expect(g.parameters).toBe(5);
  });

  it("measures lines, comments, classes and functions", async () => {
    const result = await analyzeSnippet(`using System;

namespace Demo;

/// <summary>A store.</summary>
public class Store
{
    // the path
    private readonly string _path;

    public Store(string path) => _path = path;

    public string Name => "store";

    public string Load()
    {
        var text = """
            raw
            """;
        return text + _path;
    }
}
`);
    expect(result.measures.lines).toBe(22);
    expect(result.measures.commentLines).toBe(2);
    expect(result.measures.ncloc).toBe(15);
    expect(result.measures.classes).toBe(1);
    expect(result.functions?.map((f) => f.name)).toEqual(["Store.Store", "Store.Name.get", "Store.Load"]);
  });

  it("computes executable lines like a coverage tool", async () => {
    const result = await analyzeSnippet(`public interface INotary
{
    Task<string> NotarizeAsync(string hash);
}

public class Notary : INotary
{
    private readonly int _retries = 3;

    public Notary() : base() { }

    public string Name => "notary";

    public async Task<string> NotarizeAsync(string hash)
    {
        if (hash.Length == 0)
        {
            throw new ArgumentException("empty");
        }
        return await Task.FromResult(hash);
    }
}
`);
    expect(result.executableLines).toEqual([8, 10, 12, 15, 16, 18, 20, 21]);
    const iface = await analyzeSnippet("public interface I\n{\n    void M();\n    int P { get; }\n}\n");
    expect(iface.executableLines).toEqual([]);
  });

  it("excludes using directives from duplication tokens", async () => {
    const result = await analyzeSnippet("using System;\nusing System.Linq;\nclass A { }\n");
    expect(result.cpdTokens?.[0]?.image).toBe("class");
  });
});
