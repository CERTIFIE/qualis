import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, BookOpen, ChevronRight, Clock, SlidersHorizontal } from "@/components/icons";
import { EmptyProject } from "@/components/EmptyProject";
import { ProjectHeader } from "@/components/ProjectHeader";
import { CodeExamples, References } from "@/components/RuleParts";
import { CardHeader, DocLink, Empty, InlineCode, RichText, SeverityBadge, TYPE_ICON, TypeBadge } from "@/components/ui";
import { fDebt, fInt } from "@/lib/format";
import { loadProject, projectHref, type SearchParams } from "@/lib/project";
import { SEVERITY_LABEL, TYPE_LABEL } from "@/lib/vocab";

type Props = { params: Promise<{ project: string; rule: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: decodeURIComponent((await params).rule) };
}

export default async function RulePage({ params, searchParams }: Props) {
  const { project: rawSlug, rule: rawRule } = await params;
  const slug = decodeURIComponent(rawSlug);
  const id = decodeURIComponent(rawRule);
  const sp = await searchParams;
  const loaded = await loadProject(slug, sp);
  if ("empty" in loaded) return <EmptyProject project={loaded.project} />;
  const { project, analysis, report, analysisParam } = loaded;
  const rule = report.rules.find((r) => r.id === id);
  const ruleHref = (rid: string) => projectHref(slug, "rules/" + encodeURIComponent(rid), { a: analysisParam });
  const supersededBy = report.rules.filter((r) => r.supersedes?.includes(id)).map((r) => r.id);
  const header = <ProjectHeader project={project} analysis={analysis} report={report} active="rules" analysisParam={analysisParam} />;

  if (!rule) {
    return (
      <>
        {header}
        <div className="wrap">
          <div className="card">
            <Empty icon={BookOpen} title="Rule not active in this analysis">
              <code>{id}</code> did not run in this analysis: it may be disabled, or superseded by a rule of another plugin.
              {supersededBy.length > 0 && (
                <>
                  {" "}
                  It is superseded by{" "}
                  {supersededBy.map((s, i) => (
                    <span key={s}>
                      {i > 0 && ", "}
                      <Link className="link" href={ruleHref(s)}>
                        {s}
                      </Link>
                    </span>
                  ))}
                  .
                </>
              )}
            </Empty>
          </div>
        </div>
      </>
    );
  }

  const issues = report.issues.filter((i) => i.ruleId === rule.id);
  const overridden = rule.severity !== rule.defaultSeverity;
  const Icon = TYPE_ICON[rule.type];
  const params_ = rule.params ?? [];
  const issuesHref = `${projectHref(slug, "issues", { a: analysisParam })}${analysisParam ? "&" : "?"}rule=${encodeURIComponent(rule.id)}`;

  return (
    <>
      {header}
      <div className="wrap">
        <div className="card rule-hero">
          <div className="eyebrow">
            <Link href={projectHref(slug, "rules", { a: analysisParam })}>Rules</Link>
            <ChevronRight aria-hidden className="size-3" />
            <span>{rule.plugin}</span>
          </div>
          <div className="title-row">
            <div className="flex min-w-0 items-start gap-4">
              <span className="rule-ic">
                <Icon aria-hidden strokeWidth={1.75} className={`ty-${rule.type}`} />
              </span>
              <div className="min-w-0">
                <h1 className="title flex items-center gap-2.5">
                  {rule.name}
                  {!rule.external && <DocLink href={`/docs/rules/${encodeURIComponent(rule.plugin)}/${encodeURIComponent(rule.id.slice(rule.id.indexOf(":") + 1))}`} label="Documentation of this rule" />}
                </h1>
                <div className="chips">
                  <span className="chip">
                    <code>{rule.id}</code>
                  </span>
                  <TypeBadge type={rule.type} />
                  <span className="chip">
                    <SeverityBadge severity={rule.severity} />
                    {overridden && <span className="text-faint">(default {SEVERITY_LABEL[rule.defaultSeverity]})</span>}
                  </span>
                  <span className="chip">
                    <Clock aria-hidden strokeWidth={1.75} />
                    {fDebt(rule.effortMinutes)} per issue
                  </span>
                  {rule.languages.map((l) => (
                    <span key={l} className="chip">
                      {l}
                    </span>
                  ))}
                  {rule.tags.map((t) => (
                    <span key={t} className="chip">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <Link className={`btn${issues.length ? " primary" : ""}`} href={issuesHref}>
              {fInt(issues.length)} issues in this project <ChevronRight aria-hidden />
            </Link>
          </div>
        </div>

        <div className="cards mt lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid min-w-0 content-start gap-3.5">
            <div className="card">
              <CardHeader title="Description" />
              <div className="card-bd prose">
                <RichText text={rule.description} />
              </div>
            </div>
            <div className="card">
              <CardHeader title="Why it matters" />
              <div className="card-bd prose">
                <RichText text={rule.rationale} />
              </div>
            </div>
            {rule.exceptions && (
              <div className="card">
                <CardHeader title="Exceptions and limitations" />
                <div className="card-bd prose">
                  <RichText text={rule.exceptions} />
                </div>
              </div>
            )}
            <div className="card">
              <CardHeader title="Examples" />
              <div className="card-bd">
                {rule.noncompliantExample || rule.compliantExample ? (
                  <CodeExamples rule={rule} />
                ) : (
                  <div className="text-[13px] text-faint">This rule publishes no examples.{rule.references.length > 0 && " The references describe it in detail."}</div>
                )}
              </div>
            </div>
            <div className="card">
              <CardHeader
                title="Parameters"
                subtitle={
                  <>
                    Set in <code className="mono">rules[&quot;{rule.id}&quot;].params</code>
                  </>
                }
              />
              {params_.length ? (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Description</th>
                        <th>Type</th>
                        <th className="num">Default</th>
                        <th className="num">Effective</th>
                      </tr>
                    </thead>
                    <tbody>
                      {params_.map((p) => {
                        const value = rule.paramValues[p.name] ?? p.default;
                        return (
                          <tr key={p.name}>
                            <td className="mono text-fg">{p.name}</td>
                            <td className="wrap" style={{ minWidth: 200 }}>
                              {p.description}
                            </td>
                            <td>{p.type}</td>
                            <td className="num tabular">{String(p.default)}</td>
                            <td className="num tabular">
                              <b>{String(value)}</b>
                              {value !== p.default && <span className="badge b-new ml-1.5">changed</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty icon={SlidersHorizontal} title="No parameters">This rule has nothing to configure besides severity, exclusions and on/off.</Empty>
              )}
            </div>
            {issues.length > 0 && (
              <div className="card">
                <CardHeader
                  title="Issues of this rule"
                  action={
                    <Link className="btn sm" href={issuesHref}>
                      All {fInt(issues.length)}
                    </Link>
                  }
                />
                {issues.slice(0, 5).map((i) => (
                  <div key={i.id} className="iss">
                    <span className={`ic ty-${i.type}`}>
                      <Icon aria-hidden strokeWidth={1.75} />
                    </span>
                    <Link className="msg" href={projectHref(slug, "file", { a: analysisParam, path: i.path, issue: i.id })}>
                      <InlineCode text={i.message} />
                    </Link>
                    <div className="side">
                      <SeverityBadge severity={i.severity} />
                    </div>
                    <div className="meta">
                      <span className="mono">
                        {i.path}:{i.range.startLine}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="grid min-w-0 content-start gap-3.5">
            <div className="card">
              <CardHeader title="Details" />
              <div className="card-bd py-1">
                <dl className="kv narrow">
                  {rule.external ? (
                    <>
                      <div>
                        <dt>Source</dt>
                        <dd>
                          {rule.external.tool} <span className="text-faint">· imported report</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Tool rule</dt>
                        <dd className="mono">
                          {rule.external.helpUri?.startsWith("https://") ? (
                            <a className="link" href={rule.external.helpUri} target="_blank" rel="noreferrer">
                              {rule.external.ruleId}
                            </a>
                          ) : (
                            rule.external.ruleId
                          )}
                        </dd>
                      </div>
                    </>
                  ) : (
                    <div>
                      <dt>Plugin</dt>
                      <dd className="mono">{rule.plugin}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Type</dt>
                    <dd>
                      {TYPE_LABEL[rule.type].label} <span className="text-faint">→ {TYPE_LABEL[rule.type].characteristic}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Severity</dt>
                    <dd>
                      <SeverityBadge severity={rule.severity} /> <span className="text-faint">{overridden ? `overrides ${SEVERITY_LABEL[rule.defaultSeverity]}` : "default"}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Effort</dt>
                    <dd>{fDebt(rule.effortMinutes)} per issue</dd>
                  </div>
                  <div>
                    <dt>Enabled by default</dt>
                    <dd>{rule.enabledByDefault ? "Yes" : "No"}</dd>
                  </div>
                </dl>
              </div>
            </div>
            {(rule.supersedes?.length || supersededBy.length > 0) && (
              <div className="card">
                <CardHeader
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      <ArrowLeftRight aria-hidden className="size-3.5" strokeWidth={1.75} /> Supersession
                    </span>
                  }
                />
                <div className="card-bd grid gap-2.5 text-[13px]">
                  {rule.supersedes?.length ? (
                    <div>
                      <div className="mb-1 text-xs text-faint">Supersedes · these rules do not run while this one is enabled</div>
                      {rule.supersedes.map((s) => (
                        <Link key={s} className="link mono block text-[12.5px]" href={ruleHref(s)}>
                          {s}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {supersededBy.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs text-faint">Superseded by</div>
                      {supersededBy.map((s) => (
                        <Link key={s} className="link mono block text-[12.5px]" href={ruleHref(s)}>
                          {s}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="card">
              <CardHeader title="References" action={<span className="text-xs text-faint">{rule.references.length}</span>} />
              <div className="card-bd">
                <References references={rule.references} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
