import type { Rating, Ratings } from "@qualis/schema";

// Metrics of a solution from the latest analyses of its projects (pure: no I/O, shared by pages and tests).
//   sums               issues, lines of code, technical debt
//   weighted averages  coverage by lines to cover, duplications by lines, debt ratio by lines of code
//   ratings            the worst among the projects ("worst of N")
//   quality gate       none of its own: the projects' gates are counted
//   trend              the sum of each project's latest issues as of each analysis date, from the date every project
//                      has an analysis; omitted when a project has none or fewer than two points remain

export interface MemberLatest {
  finishedAt: string;
  branch: string | null;
  gate: "passed" | "failed";
  ratings: Ratings;
  /** Percentage 0-100, null without coverage data. */
  coverage: number | null;
  linesToCover: number | null;
  /** Duplicated lines density, percentage 0-100. */
  duplication: number;
  lines: number;
  ncloc: number;
  issues: number;
  debtMinutes: number;
  debtRatio: number;
}

export interface Member {
  key: string;
  name: string;
  /** Latest analysis; null when the project has none. */
  latest: MemberLatest | null;
  /** Issues of every analysis, oldest first. */
  history: Array<{ date: string; issues: number; failed: boolean }>;
  analyses: number;
}

export interface GateSummary {
  /** Projects with an analysis. */
  analysed: number;
  passed: number;
  failed: Array<{ key: string; name: string }>;
  status: "none" | "passed" | "failed";
}

export type RatingKey = keyof Ratings;
export const RATING_KEYS: RatingKey[] = ["reliability", "security", "maintainability"];
const ORDER: Rating[] = ["A", "B", "C", "D", "E"];

export interface SolutionMetrics {
  projects: number;
  analysed: number;
  analyses: number;
  issues: number;
  ncloc: number;
  debtMinutes: number;
  coverage: number | null;
  duplication: number | null;
  debtRatio: number | null;
  /** Worst rating of each kind among the analysed projects; null when none is analysed. */
  ratings: Ratings | null;
  /** Names of the projects that have the worst rating of each kind. */
  worstBy: Record<RatingKey, string[]>;
  gate: GateSummary;
  lowestCoverage: { key: string; name: string; coverage: number } | null;
  /** Lines of code per analysed project, largest first. */
  shares: Array<{ key: string; name: string; ncloc: number }>;
  latest: string | null;
  trend: Array<{ date: string; value: number; failed: boolean }> | null;
}

export function worstRating(ratings: Rating[]): Rating | null {
  return ratings.reduce<Rating | null>((w, r) => (w === null || ORDER.indexOf(r) > ORDER.indexOf(w) ? r : w), null);
}

/** Weighted mean of the pairs whose value is known and whose weight is positive; null when there is none. */
export function weightedMean(pairs: Array<[value: number | null, weight: number | null]>): number | null {
  let sum = 0;
  let weight = 0;
  for (const [v, w] of pairs) {
    if (v === null || w === null || !(w > 0)) continue;
    sum += v * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

export function gateSummary(members: Member[]): GateSummary {
  const analysed = members.filter((m) => m.latest);
  const failed = analysed.filter((m) => m.latest!.gate === "failed").map((m) => ({ key: m.key, name: m.name }));
  return { analysed: analysed.length, passed: analysed.length - failed.length, failed, status: !analysed.length ? "none" : failed.length ? "failed" : "passed" };
}

/**
 * Sum of each project's latest issues at every analysis date, starting at the date when every project has an
 * analysis. Null when a project has no analysis or fewer than two points remain.
 */
export function combinedTrend(members: Member[]): SolutionMetrics["trend"] {
  if (!members.length || members.some((m) => !m.history.length)) return null;
  const start = members.map((m) => m.history[0]!.date).sort().pop()!;
  const dates = [...new Set(members.flatMap((m) => m.history.map((h) => h.date)))].filter((d) => d >= start).sort();
  if (dates.length < 2) return null;
  return dates.map((date) => {
    let value = 0;
    let failed = false;
    for (const m of members) {
      let current = m.history[0]!;
      for (const h of m.history) {
        if (h.date > date) break;
        current = h;
      }
      value += current.issues;
      if (m.history.some((h) => h.date === date && h.failed)) failed = true;
    }
    return { date, value, failed };
  });
}

export function aggregateSolution(members: Member[]): SolutionMetrics {
  const analysed = members.filter((m): m is Member & { latest: MemberLatest } => m.latest !== null);
  const sum = (f: (l: MemberLatest) => number) => analysed.reduce((s, m) => s + f(m.latest), 0);
  const worstBy = {} as Record<RatingKey, string[]>;
  let ratings: Ratings | null = null;
  if (analysed.length) {
    const r = {} as Ratings;
    for (const k of RATING_KEYS) {
      r[k] = worstRating(analysed.map((m) => m.latest.ratings[k]))!;
      worstBy[k] = analysed.filter((m) => m.latest.ratings[k] === r[k]).map((m) => m.name);
    }
    ratings = r;
  } else {
    for (const k of RATING_KEYS) worstBy[k] = [];
  }
  const covered = analysed.filter((m) => m.latest.coverage !== null);
  const lowest = covered.sort((a, b) => a.latest.coverage! - b.latest.coverage!)[0];
  return {
    projects: members.length,
    analysed: analysed.length,
    analyses: members.reduce((s, m) => s + m.analyses, 0),
    issues: sum((l) => l.issues),
    ncloc: sum((l) => l.ncloc),
    debtMinutes: sum((l) => l.debtMinutes),
    coverage: weightedMean(analysed.map((m) => [m.latest.coverage, m.latest.linesToCover])),
    duplication: weightedMean(analysed.map((m) => [m.latest.duplication, m.latest.lines])),
    debtRatio: weightedMean(analysed.map((m) => [m.latest.debtRatio, m.latest.ncloc])),
    ratings,
    worstBy,
    gate: gateSummary(members),
    lowestCoverage: lowest ? { key: lowest.key, name: lowest.name, coverage: lowest.latest.coverage! } : null,
    shares: analysed.map((m) => ({ key: m.key, name: m.name, ncloc: m.latest.ncloc })).sort((a, b) => b.ncloc - a.ncloc),
    latest: analysed.map((m) => m.latest.finishedAt).sort().pop() ?? null,
    trend: combinedTrend(members),
  };
}

/** Maintainability rating of a debt ratio on the default thresholds (5 / 10 / 20 / 50 %). */
export function ratingOfDebtRatio(ratio: number): Rating {
  return ratio <= 5 ? "A" : ratio <= 10 ? "B" : ratio <= 20 ? "C" : ratio <= 50 ? "D" : "E";
}
