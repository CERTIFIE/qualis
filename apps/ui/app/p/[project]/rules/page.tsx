import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BookOpen, Search } from "@/components/icons";
import type { IssueType } from "@qualis/schema";
import { ParamInput } from "@/components/client";
import { EmptyProject } from "@/components/EmptyProject";
import { ProjectHeader } from "@/components/ProjectHeader";
import { CardHeader, Empty, SeverityBadge, TypeBadge } from "@/components/ui";
import { fDebt, fInt } from "@/lib/format";
import { loadProject, param, projectHref, type SearchParams } from "@/lib/project";
import { ISSUE_TYPES, TYPE_LABEL } from "@/lib/vocab";

type Props = { params: Promise<{ project: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Rules · ${decodeURIComponent((await params).project)}` };
}

const LIMIT = 100;

export default async function RulesPage({ params, searchParams }: Props) {
  const slug = decodeURIComponent((await params).project);
  const sp = await searchParams;
  const loaded = await loadProject(slug, sp);
  if ("empty" in loaded) return <EmptyProject project={loaded.project} />;
  const { project, analysis, report, analysisParam } = loaded;
  const plugin = param(sp, "plugin") ?? "";
  const type = (param(sp, "type") ?? "") as IssueType | "";
  const withIssues = param(sp, "with") === "1";
  const text = (param(sp, "q") ?? "").toLowerCase();
  const issuesByRule = new Map<string, number>();
  for (const i of report.issues) issuesByRule.set(i.ruleId, (issuesByRule.get(i.ruleId) ?? 0) + 1);
  const plugins = [...new Set(report.rules.map((r) => r.plugin))];
  const rules = report.rules
    .filter((r) => (!plugin || r.plugin === plugin) && (!type || r.type === type) && (!withIssues || issuesByRule.has(r.id)) && (!text || r.id.toLowerCase().includes(text) || r.name.toLowerCase().includes(text)))
    .sort((a, b) => (issuesByRule.get(b.id) ?? 0) - (issuesByRule.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  const keep = { a: analysisParam, plugin: plugin || null, type: type || null, with: withIssues ? "1" : null, q: param(sp, "q") };
  const href = (patch: Record<string, string | null>) => projectHref(slug, "rules", { ...keep, ...patch });

  return (
    <>
      <ProjectHeader project={project} analysis={analysis} report={report} active="rules" analysisParam={analysisParam} />
      <div className="wrap">
        <div className="list-bar">
          <div className="flex flex-wrap items-center gap-2">
            <div className="seg" role="group" aria-label="Plugin">
              <Link href={href({ plugin: null })} aria-current={!plugin ? "true" : undefined}>
                All
              </Link>
              {plugins.map((p) => (
                <Link key={p} href={href({ plugin: p })} aria-current={plugin === p ? "true" : undefined}>
                  {p} <span className="count">{report.rules.filter((r) => r.plugin === p).length}</span>
                </Link>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Type">
              <Link href={href({ type: null })} aria-current={!type ? "true" : undefined}>
                All types
              </Link>
              {ISSUE_TYPES.map((t) => (
                <Link key={t} href={href({ type: t })} aria-current={type === t ? "true" : undefined}>
                  {TYPE_LABEL[t].badge}
                </Link>
              ))}
            </div>
            <Link href={href({ with: withIssues ? null : "1" })} className="toggle" role="switch" aria-checked={withIssues}>
              <span className="sw" />
              With issues only
            </Link>
          </div>
          <div className="search block max-w-[260px]">
            <Search aria-hidden strokeWidth={1.75} />
            <Suspense>
              <ParamInput name="q" placeholder="Search rules" />
            </Suspense>
          </div>
        </div>
        <div className="card">
          <CardHeader title={`${fInt(rules.length)} active rules`} subtitle="Rules that ran in this analysis, with their effective severity" />
          {rules.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Type</th>
                    <th>Severity</th>
                    <th>Plugin</th>
                    <th className="num">Effort</th>
                    <th className="num">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.slice(0, LIMIT).map((r) => (
                    <tr key={r.id}>
                      <td className="wrap" style={{ minWidth: 280 }}>
                        <Link className="row-link font-medium" href={projectHref(slug, "rules/" + encodeURIComponent(r.id), { a: analysisParam })}>
                          {r.name}
                        </Link>
                        <div className="mono text-[11.5px] text-faint">
                          {r.id}
                          {r.supersedes?.length ? ` · supersedes ${r.supersedes.length}` : ""}
                        </div>
                      </td>
                      <td>
                        <TypeBadge type={r.type} />
                      </td>
                      <td>
                        <SeverityBadge severity={r.severity} />
                      </td>
                      <td className="mono text-xs">{r.plugin}</td>
                      <td className="num tabular">{fDebt(r.effortMinutes)}</td>
                      <td className="num tabular">{issuesByRule.get(r.id) ? <b>{fInt(issuesByRule.get(r.id))}</b> : <span className="text-faint">0</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={BookOpen} title="No rules match">Change the plugin, the type or the search.</Empty>
          )}
          {rules.length > LIMIT && (
            <div className="border-t border-line px-4 py-3 text-xs text-faint">
              Showing {LIMIT} of {fInt(rules.length)} · refine the search
            </div>
          )}
        </div>
      </div>
    </>
  );
}
