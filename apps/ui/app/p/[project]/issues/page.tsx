import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Clock, Search, X } from "@/components/icons";
import type { Issue, IssueType, Severity } from "@qualis/schema";
import { DrawerToggle, ParamInput } from "@/components/client";
import { EmptyProject } from "@/components/EmptyProject";
import { ProjectHeader } from "@/components/ProjectHeader";
import { Empty, FileMark, SEVERITY_ICON, SeverityBadge, TYPE_ICON, TypeBadge, TypeIcon, cx, InlineCode } from "@/components/ui";
import { facetCounts, matches, sortIssues, type FacetKey, type IssueFilters, type IssueSort } from "@/lib/derive";
import { fDebt, fInt } from "@/lib/format";
import { list, loadProject, param, projectHref, type SearchParams } from "@/lib/project";
import { ISSUE_TYPES, SEVERITIES, SEVERITY_LABEL, TYPE_LABEL } from "@/lib/vocab";

type Props = { params: Promise<{ project: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Issues · ${decodeURIComponent((await params).project)}` };
}

const PAGE = 40;
const KEEP = ["a", "type", "severity", "rule", "dir", "file", "new", "q", "sort", "rq", "fq"] as const;

export default async function IssuesPage({ params, searchParams }: Props) {
  const slug = decodeURIComponent((await params).project);
  const sp = await searchParams;
  const loaded = await loadProject(slug, sp);
  if ("empty" in loaded) return <EmptyProject project={loaded.project} />;
  const { project, analysis, report, analysisParam } = loaded;

  const hasNewCode = report.measures.newCode !== null;
  const f: IssueFilters = {
    type: list(sp, "type"),
    severity: list(sp, "severity"),
    rule: list(sp, "rule"),
    dir: list(sp, "dir"),
    file: list(sp, "file"),
    onlyNew: hasNewCode && param(sp, "new") === "1",
    text: param(sp, "q") ?? "",
  };
  const sortParam = param(sp, "sort");
  const sort: IssueSort = sortParam === "severity" || sortParam === "effort" ? sortParam : "file";
  const shown = Math.max(PAGE, Number(param(sp, "n")) || PAGE);
  const current: Record<string, string | undefined> = Object.fromEntries(KEEP.map((k) => [k, param(sp, k)]));
  if (analysisParam) current.a = analysisParam;
  const href = (patch: Record<string, string | null>) => {
    const next: Record<string, string | null | undefined> = { ...current, ...patch };
    if (!("n" in patch)) delete next.n;
    return projectHref(slug, "issues", next);
  };
  const toggle = (key: FacetKey, value: string) => {
    const values = f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value];
    return href({ [key]: values.length ? values.join(",") : null });
  };

  const all = report.issues;
  const filtered = all.filter((i) => matches(i, f));
  const counts = {
    type: facetCounts(all, f, "type"),
    severity: facetCounts(all, f, "severity"),
    rule: facetCounts(all, f, "rule"),
    dir: facetCounts(all, f, "dir"),
    file: facetCounts(all, f, "file"),
  };
  const ruleName = new Map(report.rules.map((r) => [r.id, r.name]));
  const top = (m: Map<string, number>, selected: string[], filter: string, n: number, name?: (k: string) => string) => {
    const t = filter.toLowerCase();
    const entries = [...m.entries()].filter(([k]) => !t || k.toLowerCase().includes(t) || (name?.(k) ?? "").toLowerCase().includes(t)).sort((a, b) => b[1] - a[1]);
    const keys = entries.slice(0, n).map(([k]) => k);
    for (const s of selected) if (!keys.includes(s)) keys.push(s);
    return { keys, more: Math.max(0, entries.length - n) };
  };
  const rules = top(counts.rule, f.rule, param(sp, "rq") ?? "", 8, (k) => ruleName.get(k) ?? "");
  const files = top(counts.file, f.file, param(sp, "fq") ?? "", 6);

  const option = (key: FacetKey, value: string, label: React.ReactNode, title?: string) => {
    const n = counts[key].get(value) ?? 0;
    const on = f[key].includes(value);
    return (
      <Link key={value} href={toggle(key, value)} className={cx("fopt", !n && !on && "zero")} aria-current={on ? "true" : undefined} title={title} scroll={false}>
        <span className="lbl">{label}</span>
        <span className="n">{fInt(n)}</span>
      </Link>
    );
  };
  const clear = (key: FacetKey) =>
    f[key].length ? (
      <Link href={href({ [key]: null })} scroll={false}>
        Clear
      </Link>
    ) : null;

  const chips: Array<{ label: string; href: string }> = [];
  for (const key of ["type", "severity", "rule", "dir", "file"] as FacetKey[]) {
    for (const v of f[key]) {
      const label = key === "type" ? TYPE_LABEL[v as IssueType]?.label ?? v : key === "severity" ? SEVERITY_LABEL[v as Severity] ?? v : key === "file" ? v.split("/").pop()! : v;
      chips.push({ label, href: toggle(key, v) });
    }
  }
  if (f.onlyNew) chips.push({ label: "New code", href: href({ new: null }) });
  if (f.text) chips.push({ label: `“${f.text}”`, href: href({ q: null }) });

  const sorted = sortIssues(filtered, sort);
  const page = sorted.slice(0, shown);
  const fileHref = (i: Issue) => projectHref(slug, "file", { a: analysisParam, path: i.path, issue: i.id, from: "issues" });
  const effort = filtered.reduce((a, i) => a + i.effortMinutes, 0);

  const row = (i: Issue, withPath: boolean) => {
    const Icon = TYPE_ICON[i.type];
    return (
      <div key={i.id} className="iss">
        <span className={`ic ty-${i.type}`} title={TYPE_LABEL[i.type].label}>
          <Icon aria-hidden strokeWidth={1.75} />
        </span>
        <Link className="msg" href={fileHref(i)}>
          <InlineCode text={i.message} />
        </Link>
        <div className="side">
          <SeverityBadge severity={i.severity} />
        </div>
        <div className="meta">
          <TypeBadge type={i.type} />
          {i.isNew && <span className="badge b-new">New</span>}
          <Link href={projectHref(slug, "rules/" + encodeURIComponent(i.ruleId), { a: analysisParam })} className="mono" title={ruleName.get(i.ruleId)}>
            {i.ruleId}
          </Link>
          <Link href={fileHref(i)} className="mono">
            {withPath ? `${i.path}:` : "L"}
            {i.range.startLine}
          </Link>
          <span title="Estimated remediation effort">
            <Clock aria-hidden strokeWidth={1.75} /> {fDebt(i.effortMinutes)}
          </span>
        </div>
      </div>
    );
  };

  let listView: React.ReactNode;
  if (!filtered.length) {
    listView = (
      <div className="card">
        <Empty icon={Search} title={all.length ? "No issues match these filters" : "No issues"}>
          {all.length ? "Remove a filter or clear the search. The count next to each filter shows how many issues remain when you pick it." : "This analysis found no issues."}
        </Empty>
        {all.length > 0 && (
          <div className="pb-5 text-center">
            <Link className="btn" href={projectHref(slug, "issues", { a: analysisParam })}>
              Clear all filters
            </Link>
          </div>
        )}
      </div>
    );
  } else if (sort === "file") {
    const groups: Array<{ path: string; items: Issue[] }> = [];
    for (const i of page) {
      const g = groups[groups.length - 1];
      if (g && g.path === i.path) g.items.push(i);
      else groups.push({ path: i.path, items: [i] });
    }
    const perFile = facetCounts(filtered, { ...f, file: [] }, "file");
    listView = groups.map((g) => (
      <div key={g.path} className="card igroup">
        <div className="igroup-hd">
          <FileMark path={g.path} />
          <Link href={projectHref(slug, "file", { a: analysisParam, path: g.path, from: "issues" })} title={g.path}>
            {g.path}
          </Link>
          <span className="ml-auto whitespace-nowrap text-xs text-faint">{fInt(perFile.get(g.path) ?? g.items.length)} issues</span>
        </div>
        {g.items.map((i) => row(i, false))}
      </div>
    ));
  } else {
    listView = <div className="card">{page.map((i) => row(i, true))}</div>;
  }

  return (
    <>
      <ProjectHeader project={project} analysis={analysis} report={report} active="issues" analysisParam={analysisParam} />
      <div className="wrap">
        <div className="issues-layout">
          <aside className="facets" id="facets" aria-label="Filters">
            <div className="facet">
              {hasNewCode ? (
                <Link href={href({ new: f.onlyNew ? null : "1" })} className="toggle" role="switch" aria-checked={f.onlyNew} scroll={false}>
                  <span className="sw" />
                  <span>
                    New code only <span className="tabular text-faint">({fInt(all.filter((i) => i.isNew).length)})</span>
                  </span>
                </Link>
              ) : (
                <>
                  <span className="toggle" role="switch" aria-checked={false} aria-disabled="true">
                    <span className="sw" />
                    New code only
                  </span>
                  <div className="mt-1.5 text-xs text-faint">Unavailable: this analysis has no new-code reference.</div>
                </>
              )}
            </div>
            <div className="facet">
              <h3>Type {clear("type")}</h3>
              {ISSUE_TYPES.map((t) =>
                option(
                  "type",
                  t,
                  <>
                    <TypeIcon type={t} />
                    {TYPE_LABEL[t].label}
                  </>,
                ),
              )}
            </div>
            <div className="facet">
              <h3>Severity {clear("severity")}</h3>
              {SEVERITIES.map((s) => {
                const Icon = SEVERITY_ICON[s];
                return option(
                  "severity",
                  s,
                  <>
                    <Icon aria-hidden strokeWidth={1.75} className={`sev-${s}`} />
                    {SEVERITY_LABEL[s]}
                  </>,
                );
              })}
            </div>
            <div className="facet">
              <h3>Rule {clear("rule")}</h3>
              <Suspense>
                <ParamInput name="rq" placeholder="Search rules" className="fsearch" />
              </Suspense>
              {rules.keys.map((r) => option("rule", r, <span className="mono text-xs">{r}</span>, ruleName.get(r)))}
              {rules.more > 0 && <div className="py-1 text-xs text-faint">+{rules.more} more, search to narrow</div>}
            </div>
            <div className="facet">
              <h3>Directory {clear("dir")}</h3>
              {[...counts.dir.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([d]) => option("dir", d, <span className="mono text-xs">{d}/</span>))}
            </div>
            <div className="facet">
              <h3>File {clear("file")}</h3>
              <Suspense>
                <ParamInput name="fq" placeholder="Search files" className="fsearch" />
              </Suspense>
              {files.keys.map((p) => option("file", p, <span className="mono text-xs">{p.split("/").pop()}</span>, p))}
              {files.more > 0 && <div className="py-1 text-xs text-faint">+{files.more} more, search to narrow</div>}
            </div>
          </aside>

          <div className="min-w-0">
            <div className="cards g4 mb-5">
              {ISSUE_TYPES.map((t) => {
                const on = f.type.includes(t);
                return (
                  <Link key={t} href={toggle("type", t)} className="tile" aria-pressed={on} style={on ? { background: "var(--soft)", boxShadow: "inset 0 0 0 1px var(--fg)" } : undefined} scroll={false}>
                    <div className="tile-top">
                      <TypeIcon type={t} />
                      <span className="tile-l">{TYPE_LABEL[t].plural}</span>
                    </div>
                    <div className="tile-v">{fInt(counts.type.get(t) ?? 0)}</div>
                  </Link>
                );
              })}
            </div>
            <div className="list-bar">
              <div className="flex flex-wrap items-center gap-2.5">
                <Suspense>
                  <DrawerToggle count={chips.length} />
                </Suspense>
                <div>
                  <b className="tabular text-base font-medium">{fInt(filtered.length)}</b> <span className="text-faint">issues · {fDebt(effort)} effort</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="search block max-w-[240px]">
                  <Search aria-hidden strokeWidth={1.75} />
                  <Suspense>
                    <ParamInput name="q" placeholder="Search messages" />
                  </Suspense>
                </div>
                <div className="seg" role="group" aria-label="Sort">
                  {(
                    [
                      ["file", "By file"],
                      ["severity", "Severity"],
                      ["effort", "Effort"],
                    ] as const
                  ).map(([k, l]) => (
                    <Link key={k} href={href({ sort: k === "file" ? null : k })} aria-current={sort === k ? "true" : undefined} scroll={false}>
                      {l}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
            {chips.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {chips.map((c) => (
                  <Link key={c.href + c.label} href={c.href} className="fchip" scroll={false}>
                    {c.label} <X aria-hidden strokeWidth={1.75} />
                  </Link>
                ))}
                <Link className="link text-xs" href={projectHref(slug, "issues", { a: analysisParam, sort: current.sort })}>
                  Clear all
                </Link>
              </div>
            )}
            {listView}
            {filtered.length > shown && (
              <div className="more">
                <Link className="btn" href={href({ n: String(shown + PAGE) })} scroll={false}>
                  Show {Math.min(PAGE, filtered.length - shown)} more{" "}
                  <span className="text-faint">
                    ({fInt(shown)} of {fInt(filtered.length)})
                  </span>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
