import { describe, expect, it } from "vitest";
import { analyzeSnippet } from "./helpers.js";

const fn = (analysis: Awaited<ReturnType<typeof analyzeSnippet>>, name: string) => {
  const found = analysis.functions?.find((f) => f.name === name);
  if (!found) throw new Error(`function ${name} not found`);
  return found;
};

describe("complexity metrics", () => {
  // Examples from G. A. Campbell, "Cognitive Complexity" (sumOfPrimes = 7, getWords = 1).
  it("computes cognitive complexity as in the reference examples", async () => {
    const result = await analyzeSnippet(`
export function sumOfPrimes(max: number): number {
  let total = 0;
  OUT: for (let i = 1; i <= max; ++i) {
    for (let j = 2; j < i; ++j) {
      if (i % j === 0) {
        continue OUT;
      }
    }
    total += i;
  }
  return total;
}

export function getWords(n: number): string {
  switch (n) {
    case 1: return "one";
    case 2: return "a couple";
    case 3: return "a few";
    default: return "lots";
  }
}
`);
    expect(fn(result, "sumOfPrimes").cognitiveComplexity).toBe(7);
    expect(fn(result, "getWords").cognitiveComplexity).toBe(1);
    // McCabe: decisions + 1.
    expect(fn(result, "sumOfPrimes").complexity).toBe(4);
    expect(fn(result, "getWords").complexity).toBe(4);
  });

  it("counts sequences of logical operators once per change of operator", async () => {
    const result = await analyzeSnippet("export function f(a: boolean, b: boolean, c: boolean, d: boolean) {\n  return a && b && c || d;\n}\n");
    expect(fn(result, "f").cognitiveComplexity).toBe(2);
    expect(fn(result, "f").complexity).toBe(4);
  });

  it("adds nesting for else-if chains only once and ignores ?? in cognitive complexity", async () => {
    const result = await analyzeSnippet(`
export function g(x: number, y?: number) {
  if (x > 0) {
    return 1;
  } else if (x < 0) {
    return y ?? 2;
  } else {
    return 0;
  }
}`);
    expect(fn(result, "g").cognitiveComplexity).toBe(3);
    expect(fn(result, "g").complexity).toBe(4);
    expect(fn(result, "g").maxNestingDepth).toBe(1);
  });

  it("measures lines, comments and functions", async () => {
    const result = await analyzeSnippet(`/**
 * Header comment.
 */
import { readFile } from "node:fs/promises";

// helper
export class Store {
  constructor(private readonly path: string) {}

  async load(): Promise<string> {
    const text = \`multi
line\`;
    return text + (await readFile(this.path, "utf8"));
  }
}
`);
    expect(result.measures.lines).toBe(15);
    expect(result.measures.commentLines).toBe(2);
    expect(result.measures.ncloc).toBe(9);
    expect(result.measures.classes).toBe(1);
    expect(result.measures.functions).toBe(2);
    expect(result.functions?.map((f) => f.name)).toEqual(["Store.constructor", "Store.load"]);
    expect(fn(result, "Store.load").parameters).toBe(0);
    expect(fn(result, "Store.constructor").parameters).toBe(1);
  });

  it("computes Halstead counts", async () => {
    const result = await analyzeSnippet("export function add(a: number, b: number) {\n  return a + b;\n}\n");
    const h = fn(result, "add").halstead!;
    // Operands: add a b a b → distinct {add, a, b}
    expect(h.distinctOperands).toBe(3);
    expect(h.totalOperands).toBe(5);
    // Operators (closing delimiters ignored): export function ( : number , : number { return + ;
    expect(h.distinctOperators).toBe(10);
    expect(h.totalOperators).toBe(12);
  });

  it("excludes imports from duplication tokens", async () => {
    const result = await analyzeSnippet('import { a } from "./a";\nexport const b = a;\n');
    expect(result.cpdTokens?.[0]?.image).toBe("export");
  });
});
