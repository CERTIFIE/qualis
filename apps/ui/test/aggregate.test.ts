import { describe, expect, it } from "vitest";
import type { Rating } from "@qualis/schema";
import { NO_FAVORITES, parseFavorites, projectsPageItems, toggleFavorite } from "../lib/favorites";
import { aggregateSolution, combinedTrend, gateSummary, ratingOfDebtRatio, type Member, type MemberLatest } from "../lib/solutions";

function latest(over: Partial<MemberLatest> = {}): MemberLatest {
  return {
    finishedAt: "2026-11-04T10:00:00Z",
    branch: "main",
    gate: "passed",
    ratings: { reliability: "A", security: "A", maintainability: "A" },
    coverage: 50,
    linesToCover: 100,
    duplication: 0,
    lines: 1000,
    ncloc: 800,
    issues: 10,
    debtMinutes: 60,
    debtRatio: 1,
    ...over,
  };
}

function member(key: string, l: MemberLatest | null, history: Array<[string, number, boolean?]> = []): Member {
  return { key, name: key.toUpperCase(), latest: l, analyses: history.length, history: history.map(([date, issues, failed]) => ({ date, issues, failed: !!failed })) };
}

describe("aggregateSolution", () => {
  it("sums counts and weights coverage, duplications and debt ratio by size", () => {
    const m = aggregateSolution([
      member("a", latest({ coverage: 90, linesToCover: 100, duplication: 10, lines: 1000, debtRatio: 2, ncloc: 100, issues: 5 })),
      member("b", latest({ coverage: 30, linesToCover: 300, duplication: 0, lines: 3000, debtRatio: 10, ncloc: 300, issues: 7 })),
      member("c", latest({ coverage: null, linesToCover: null, issues: 1, ncloc: 0, lines: 0 })),
      member("d", null),
    ]);
    expect(m.projects).toBe(4);
    expect(m.analysed).toBe(3);
    expect(m.issues).toBe(13);
    expect(m.ncloc).toBe(400);
    expect(m.coverage).toBeCloseTo((90 * 100 + 30 * 300) / 400); // 45, not the plain mean 60
    expect(m.duplication).toBeCloseTo(2.5);
    expect(m.debtRatio).toBeCloseTo((2 * 100 + 10 * 300) / 400);
    expect(m.lowestCoverage).toEqual({ key: "b", name: "B", coverage: 30 });
    expect(m.shares.map((s) => s.key)).toEqual(["b", "a", "c"]);
  });

  it("takes the worst rating of each kind and names who has it", () => {
    const r = (reliability: Rating, security: Rating, maintainability: Rating) => latest({ ratings: { reliability, security, maintainability } });
    const m = aggregateSolution([member("a", r("A", "C", "B")), member("b", r("C", "A", "B")), member("c", r("B", "A", "A"))]);
    expect(m.ratings).toEqual({ reliability: "C", security: "C", maintainability: "B" });
    expect(m.worstBy).toEqual({ reliability: ["B"], security: ["A"], maintainability: ["A", "B"] });
    expect(aggregateSolution([member("x", null)]).ratings).toBeNull();
  });

  it("counts the projects' quality gates without a gate of its own", () => {
    expect(gateSummary([member("a", latest({ gate: "failed" })), member("b", latest()), member("c", null)])).toEqual({ analysed: 2, passed: 1, failed: [{ key: "a", name: "A" }], status: "failed" });
    expect(gateSummary([member("a", latest())]).status).toBe("passed");
    expect(gateSummary([member("a", null)]).status).toBe("none");
  });

  it("starts the combined trend when every project has an analysis, with each project's latest value", () => {
    const trend = combinedTrend([
      member("a", latest(), [
        ["2026-10-01", 100],
        ["2026-10-10", 90],
        ["2026-10-20", 80, true],
      ]),
      member("b", latest(), [
        ["2026-10-05", 10],
        ["2026-10-15", 12],
      ]),
    ]);
    expect(trend).toEqual([
      { date: "2026-10-05", value: 110, failed: false },
      { date: "2026-10-10", value: 100, failed: false },
      { date: "2026-10-15", value: 102, failed: false },
      { date: "2026-10-20", value: 92, failed: true },
    ]);
  });

  it("omits the combined trend when a project has no analysis or fewer than two points remain", () => {
    expect(combinedTrend([member("a", latest(), [["2026-10-01", 1], ["2026-10-02", 2]]), member("b", null)])).toBeNull();
    expect(combinedTrend([member("a", latest(), [["2026-10-01", 1]]), member("b", latest(), [["2026-10-01", 2]])])).toBeNull();
    expect(combinedTrend([])).toBeNull();
  });

  it("rates a debt ratio on the default thresholds", () => {
    expect([0, 5, 5.1, 10, 20, 50, 51].map(ratingOfDebtRatio)).toEqual(["A", "A", "B", "B", "C", "D", "E"]);
  });
});

describe("favorites", () => {
  const solutions = [
    { id: "acs", projects: ["api", "web"], latest: "2026-11-04" },
    { id: "chain", projects: ["node"], latest: "2026-11-01" },
  ];
  const projects = [
    { key: "api", latest: "2026-11-04" },
    { key: "web", latest: "2026-11-03" },
    { key: "node", latest: "2026-11-01" },
    { key: "solo", latest: "2026-11-02" },
    { key: "empty", latest: null },
  ];

  it("shows solutions and standalone projects in All, newest first", () => {
    expect(projectsPageItems("all", solutions, projects, NO_FAVORITES)).toEqual([
      { kind: "solution", id: "acs" },
      { kind: "project", key: "solo", inSolution: null },
      { kind: "solution", id: "chain" },
      { kind: "project", key: "empty", inSolution: null },
    ]);
  });

  it("shows a favorite solution whole and a favorite project of another solution flat", () => {
    const favs = { solutions: ["chain"], projects: ["web", "node", "solo"] };
    expect(projectsPageItems("favorites", solutions, projects, favs)).toEqual([
      { kind: "project", key: "web", inSolution: "acs" },
      { kind: "project", key: "solo", inSolution: null },
      { kind: "solution", id: "chain" },
    ]);
  });

  it("shows only the solution when it and some of its projects are favorites", () => {
    expect(projectsPageItems("favorites", solutions, projects, { solutions: ["acs"], projects: ["api", "web"] })).toEqual([{ kind: "solution", id: "acs" }]);
    expect(projectsPageItems("favorites", solutions, projects, NO_FAVORITES)).toEqual([]);
  });

  it("reads anything unexpected as no favorites and toggles entries", () => {
    expect(parseFavorites(null)).toEqual(NO_FAVORITES);
    expect(parseFavorites("{ broken")).toEqual(NO_FAVORITES);
    expect(parseFavorites('{"projects":["a","a",3],"solutions":"x"}')).toEqual({ projects: ["a"], solutions: [] });
    const on = toggleFavorite(NO_FAVORITES, "solutions", "acs");
    expect(on).toEqual({ projects: [], solutions: ["acs"] });
    expect(toggleFavorite(on, "solutions", "acs")).toEqual(NO_FAVORITES);
  });
});
