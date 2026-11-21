// Favorites live in the browser (the UI has no users). This module is pure: parsing what was stored and deciding
// what the Projects page shows.
//   All        solutions and the projects that are in no solution
//   Favorites  favorite solutions as a whole; favorite projects of a non-favorite solution (or of none) on their
//              own, flat, with an "in <solution>" hint; favorite projects of a favorite solution only marked inside it

export interface Favorites {
  projects: string[];
  solutions: string[];
}

export const NO_FAVORITES: Favorites = { projects: [], solutions: [] };

export type ProjectsView = "all" | "favorites";

const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : []);

/** Reads the stored value; anything unexpected counts as no favorites. */
export function parseFavorites(text: string | null | undefined): Favorites {
  if (!text) return NO_FAVORITES;
  try {
    const data = JSON.parse(text) as Partial<Favorites> | null;
    return { projects: strings(data?.projects), solutions: strings(data?.solutions) };
  } catch {
    return NO_FAVORITES;
  }
}

export function toggleFavorite(favs: Favorites, kind: keyof Favorites, id: string): Favorites {
  const list = favs[kind];
  return { ...favs, [kind]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] };
}

export interface PageSolution {
  id: string;
  projects: string[];
  /** Latest analysis of its projects (ISO), for the order. */
  latest: string | null;
}

export interface PageProject {
  key: string;
  latest: string | null;
}

export type PageItem = { kind: "solution"; id: string } | { kind: "project"; key: string; inSolution: string | null };

/** The cards of the Projects page, newest analysis first. */
export function projectsPageItems(view: ProjectsView, solutions: PageSolution[], projects: PageProject[], favs: Favorites): PageItem[] {
  const solutionOf = new Map(solutions.flatMap((s) => s.projects.map((k) => [k, s.id] as const)));
  const items: Array<PageItem & { latest: string }> = [];
  if (view === "all") {
    for (const s of solutions) items.push({ kind: "solution", id: s.id, latest: s.latest ?? "" });
    for (const p of projects) if (!solutionOf.has(p.key)) items.push({ kind: "project", key: p.key, inSolution: null, latest: p.latest ?? "" });
  } else {
    const favSolutions = new Set(solutions.filter((s) => favs.solutions.includes(s.id)).map((s) => s.id));
    for (const s of solutions) if (favSolutions.has(s.id)) items.push({ kind: "solution", id: s.id, latest: s.latest ?? "" });
    for (const p of projects) {
      const sol = solutionOf.get(p.key) ?? null;
      if (favs.projects.includes(p.key) && !(sol && favSolutions.has(sol))) items.push({ kind: "project", key: p.key, inSolution: sol, latest: p.latest ?? "" });
    }
  }
  return items.sort((a, b) => b.latest.localeCompare(a.latest)).map(({ latest: _latest, ...item }) => item as PageItem);
}
