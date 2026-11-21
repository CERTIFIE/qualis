import { describe, expect, it } from "vitest";
import { VH, analysesOverTime, trendGeometry } from "../lib/trend";

describe("trendGeometry", () => {
  it("draws a flat series as a level line at mid-height", () => {
    const g = trendGeometry([538, 538, 538]);
    expect(g.flat).toBe(true);
    expect(g.pts).toEqual([
      [0, VH / 2],
      [50, VH / 2],
      [100, VH / 2],
    ]);
  });

  it("spans two different points across the full width, inside the padded domain", () => {
    const g = trendGeometry([10, 20]);
    expect(g.flat).toBe(false);
    expect(g.pts.map((p) => p[0])).toEqual([0, 100]);
    const [a, b] = g.pts.map((p) => p[1]);
    // Higher value, smaller y; both away from the edges thanks to the padding.
    expect(b!).toBeLessThan(a!);
    expect(b!).toBeGreaterThan(3);
    expect(a!).toBeLessThan(VH - 3);
  });

  it("treats two equal points as flat", () => {
    expect(trendGeometry([7, 7]).flat).toBe(true);
  });

  it("centres a single analysis", () => {
    expect(trendGeometry([5]).pts).toEqual([[50, VH / 2]]);
  });
});

describe("analysesOverTime", () => {
  it("keeps analyses of the same day as separate, growing points", () => {
    const s = analysesOverTime(["2026-11-04T17:00:00Z", "2026-11-04T09:00:00Z", "2026-11-04T12:00:00Z"]);
    expect(s).toEqual([
      { date: "2026-11-04T09:00:00Z", value: 1 },
      { date: "2026-11-04T12:00:00Z", value: 2 },
      { date: "2026-11-04T17:00:00Z", value: 3 },
    ]);
  });

  it("is empty without analyses", () => {
    expect(analysesOverTime([])).toEqual([]);
  });
});
