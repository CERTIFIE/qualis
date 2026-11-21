import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Activity, ArrowDown, ArrowUp, Gauge, Layers, Search, Target, TriangleAlert } from "@/components/icons";
import { ParamInput } from "@/components/client";
import { EmptyProject } from "@/components/EmptyProject";
import { ProjectHeader } from "@/components/ProjectHeader";
import { DirMark, Empty, FileMark, Tile } from "@/components/ui";
import { aggregate, aggregateCoverage, lineCoverage, treeRows, type TreeRow } from "@/lib/derive";
import { fDebt, fInt, fPct } from "@/lib/format";
import { loadProject, param, projectHref, type SearchParams } from "@/lib/project";

type Props = { params: Promise<{ project: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Code · ${decodeURIComponent((await params).project)}` };
}

const COLUMNS = [
  ["name", "Name", ""],
  ["ncloc", "Lines of code", "num"],
  ["complexity", "Complexity", "num"],
  ["cognitive", "Cognitive", "num"],
  ["mi", "Min. MI", "num"],
  ["coverage", "Coverage", "num"],
  ["dup", "Dup. lines", "num"],
  ["issues", "Issues", "num"],
  ["debt", "Debt", "num"],
] as const;
type SortKey = (typeof COLUMNS)[number][0];
/** Columns where a low value is the interesting one: they sort ascending by default. */
const ASCENDING_FIRST = new Set<SortKey>(["name", "mi", "coverage"]);

function sortValue(r: TreeRow, key: SortKey): number | string {
  switch (key) {
    case "name":
      return r.name.toLowerCase();
    case "ncloc":
      return r.agg.ncloc;
    case "complexity":
      return r.agg.complexity;
    case "cognitive":
      return r.agg.cognitive;
    case "mi":
      return r.agg.minMaintainability ?? 999;
    case "coverage":
      return aggregateCoverage(r.agg) ?? 999;
    case "dup":
      return r.agg.duplicatedLines;
    case "issues":
      return r.agg.issues;
    case "debt":
      return r.agg.debt;
  }
}

function CoverageCell({ pct, notInReports, excluded }: { pct: number | null; notInReports?: boolean; excluded?: boolean }) {
  if (excluded) return <span className="text-faint" title="Excluded from coverage (coverage.exclude)">—</span>;
  if (pct === null) return <span className="text-faint">—</span>;
  const color = pct >= 80 ? "var(--cov-ok)" : pct >= 50 ? "var(--cov-part)" : "var(--cov-no)";
  return (
    <>
      <span className="tabular">{fPct(pct)}</span>
      {notInReports && <TriangleAlert aria-label="Not in any coverage report: counted as not covered" className="ml-1 inline size-3 text-warning" strokeWidth={1.75} />}
      <span className="minibar">
        <i style={{ width: `${pct}%`, background: color }} />
      </span>
    </>
  );
}

export default async function CodePage({ params, searchParams }: Props) {
  const slug = decodeURIComponent((await params).project);
  const sp = await searchParams;
  const loaded = await loadProject(slug, sp);
  if ("empty" in loaded) return <EmptyProject project={loaded.project} />;
  const { project, analysis, report, analysisParam } = loaded;
  const dir = param(sp, "dir") ?? "";
  const view = param(sp, "view") === "files" ? "files" : "tree";
  const sortParam = param(sp, "sort") as SortKey | undefined;
  const sortKey: SortKey = sortParam && COLUMNS.some((c) => c[0] === sortParam) ? sortParam : view === "tree" ? "name" : "issues";
  const flipped = param(sp, "flip") === "1";
  const ascending = ASCENDING_FIRST.has(sortKey) !== flipped;
  const text = (param(sp, "q") ?? "").toLowerCase();
  const inDir = report.files.filter((f) => !dir || f.path.startsWith(`${dir}/`));

  let rows: TreeRow[] =
    view === "tree"
      ? treeRows(report.files, dir)
      : inDir.filter((f) => !text || f.path.toLowerCase().includes(text)).map((f) => ({ name: f.path, path: f.path, dir: false, file: f, agg: aggregate([f]) }));
  rows = rows.sort((a, b) => {
    if (view === "tree" && a.dir !== b.dir) return a.dir ? -1 : 1;
    const x = sortValue(a, sortKey);
    const y = sortValue(b, sortKey);
    const r = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    return ascending ? r : -r;
  });

  const total = aggregate(inDir);
  const keep = { a: analysisParam, dir: dir || null, view: view === "files" ? "files" : null, q: param(sp, "q") };
  const href = (patch: Record<string, string | null>) => projectHref(slug, "code", { ...keep, ...patch });
  const segs = dir ? dir.split("/") : [];
  const name = view === "files" && dir ? (p: string) => p.slice(dir.length + 1) : (p: string) => p;

  return (
    <>
      <ProjectHeader project={project} analysis={analysis} report={report} active="code" analysisParam={analysisParam} />
      <div className="wrap">
        <div className="cards g4">
          <Tile icon={Layers} label="Lines of code" value={fInt(total.ncloc)} sub={`${fInt(total.files)} files${dir ? ` in ${segs[segs.length - 1]}` : ""}`} />
          <Tile icon={Activity} label="Complexity" value={fInt(total.complexity)} sub={`${fInt(total.cognitive)} cognitive`} />
          <Tile icon={Target} label="Coverage" value={fPct(aggregateCoverage(total))} sub={total.notInReports ? `${total.notInReports} files not in any report` : total.coverable ? "line coverage" : "no coverage data"} />
          <Tile icon={Gauge} label="Lowest maintainability" value={total.minMaintainability ?? "—"} sub="maintainability index of the worst function" />
        </div>
        <div className="card mt">
          <div className="card-hd">
            <div className="crumbs text-[13px]">
              <Link href={href({ dir: null })}>{project.name}</Link>
              {segs.map((s, k) => (
                <span key={k} className="contents">
                  <span className="sep">/</span>
                  {k === segs.length - 1 ? <b className="font-normal text-fg">{s}</b> : <Link href={href({ dir: segs.slice(0, k + 1).join("/") })}>{s}</Link>}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {view === "files" && (
                <div className="search block max-w-[220px]">
                  <Search aria-hidden strokeWidth={1.75} />
                  <Suspense>
                    <ParamInput name="q" placeholder="Filter files" />
                  </Suspense>
                </div>
              )}
              <div className="seg" role="group" aria-label="View">
                <Link href={href({ view: null, q: null })} aria-current={view === "tree" ? "true" : undefined}>
                  Tree
                </Link>
                <Link href={href({ view: "files" })} aria-current={view === "files" ? "true" : undefined}>
                  All files
                </Link>
              </div>
            </div>
          </div>
          {rows.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    {COLUMNS.map(([key, label, cls]) => {
                      const active = key === sortKey;
                      const Arrow = ascending ? ArrowUp : ArrowDown;
                      return (
                        <th key={key} className={`${cls}${key === "name" ? " sticky-col" : ""}`} aria-sort={active ? (ascending ? "ascending" : "descending") : undefined}>
                          <Link href={href({ sort: key, flip: active && !flipped ? "1" : null })} scroll={false}>
                            {key === "name" && view === "files" ? "File" : label}
                            {active && <Arrow aria-hidden className="size-3" />}
                          </Link>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const target = r.dir ? href({ dir: r.path }) : projectHref(slug, "file", { a: analysisParam, path: r.path });
                    const mi = r.agg.minMaintainability;
                    return (
                      <tr key={r.path}>
                        <td className="sticky-col">
                          <Link href={target} className="tree-name">
                            {r.dir ? <DirMark /> : <FileMark path={r.path} />}
                            <span className="mono" title={r.path}>
                              {name(r.name)}
                            </span>
                            {r.dir && <span className="text-[11.5px] text-faint">{r.agg.files} files</span>}
                          </Link>
                        </td>
                        <td className="num tabular">{fInt(r.agg.ncloc)}</td>
                        <td className="num tabular">{fInt(r.agg.complexity)}</td>
                        <td className="num tabular">{fInt(r.agg.cognitive)}</td>
                        <td className="num tabular" style={mi !== null && mi < 20 ? { color: mi < 10 ? "var(--danger)" : "var(--warning)" } : undefined}>
                          {mi ?? "—"}
                        </td>
                        <td className="num">
                          {r.file ? <CoverageCell pct={lineCoverage(r.file)} notInReports={!!r.file.coverage?.notInReports} excluded={!r.file.coverage} /> : <CoverageCell pct={aggregateCoverage(r.agg)} />}
                        </td>
                        <td className="num tabular">{r.agg.duplicatedLines ? fInt(r.agg.duplicatedLines) : <span className="text-faint">0</span>}</td>
                        <td className="num tabular">{r.agg.issues ? <b>{fInt(r.agg.issues)}</b> : <span className="text-faint">0</span>}</td>
                        <td className="num tabular">{fDebt(r.agg.debt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={Search} title="No files match">Change the filter.</Empty>
          )}
          <div className="flex flex-wrap gap-3.5 border-t border-line px-4 py-2.5 text-xs text-faint">
            <span>
              Coverage “—”: excluded by <code className="mono">coverage.exclude</code> or no coverage data
            </span>
            <span className="inline-flex items-center gap-1">
              <TriangleAlert aria-hidden className="size-3 text-warning" strokeWidth={1.75} />
              not in any report, counted as not covered
            </span>
            <span>Min. MI: lowest maintainability index among the functions (0–100, below 20 flagged)</span>
          </div>
        </div>
      </div>
    </>
  );
}
