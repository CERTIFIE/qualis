import "server-only";
import { notFound } from "next/navigation";
import type { Report } from "@qualis/schema";
import type { HistoryPoint } from "@/components/HistoryChart";
import { store } from "./data";
import type { AnalysisSummary, ProjectView } from "./store";

export type SearchParams = Record<string, string | string[] | undefined>;

export function param(sp: SearchParams, name: string): string | undefined {
  const v = sp[name];
  return Array.isArray(v) ? v[0] : v;
}

export function list(sp: SearchParams, name: string): string[] {
  return (param(sp, name) ?? "").split(",").filter(Boolean);
}

/** URL of a project page; `a` (the analysis) is kept when it is not the latest. */
export function projectHref(slug: string, sub = "", params: Record<string, string | number | null | undefined> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return `/p/${encodeURIComponent(slug)}${sub ? `/${sub}` : ""}${s ? `?${s}` : ""}`;
}

export interface LoadedProject {
  project: ProjectView;
  analysis: AnalysisSummary;
  report: Report;
  /** The selected analysis when it is not the latest, for links. */
  analysisParam: string | undefined;
}

export async function loadProject(slug: string, sp: SearchParams): Promise<LoadedProject | { project: ProjectView; empty: true }> {
  const s = store();
  const project = await s.project(slug);
  if (!project) notFound();
  if (!project.analyses.length) return { project, empty: true };
  const requested = param(sp, "a");
  const loaded = await s.report(slug, requested && project.analyses.some((a) => a.id === requested) ? requested : undefined);
  if (!loaded) notFound();
  return { ...loaded, analysisParam: loaded.analysis.id === project.analyses[0]!.id ? undefined : loaded.analysis.id };
}

/** History up to the selected analysis, oldest first. */
export function historyPoints(project: ProjectView, current: AnalysisSummary): HistoryPoint[] {
  return project.analyses
    .filter((a) => a.finishedAt <= current.finishedAt)
    .reverse()
    .map((a) => ({ id: a.id, finishedAt: a.finishedAt, issues: a.issues, coverage: a.coverage, debt: a.debtMinutes, loc: a.ncloc, gate: a.gate }));
}
