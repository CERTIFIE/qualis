import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, CircleCheck, Clock, EyeOff, Info, TriangleAlert } from "@/components/icons";
import { resolveSource } from "@/lib/source";
import type { ActiveRule, FileReport, Issue } from "@qualis/schema";
import { CodeFrame, ScrollToLine } from "@/components/client";
import { EmptyProject } from "@/components/EmptyProject";
import { ProjectHeader } from "@/components/ProjectHeader";
import { CodeExamples, References } from "@/components/RuleParts";
import { Empty, FileMark, Note, RichText, SeverityBadge, TYPE_ICON, TypeBadge, cx, InlineCode } from "@/components/ui";
import { lineCoverage } from "@/lib/derive";
import { markRanges, tokenize, type RangeMark } from "@/lib/highlight";
import { fDebt, fInt, fPct } from "@/lib/format";
import { loadProject, param, projectHref, type SearchParams } from "@/lib/project";
import { LANGUAGE, SEVERITY_LABEL, TYPE_LABEL } from "@/lib/vocab";

type Props = { params: Promise<{ project: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const path = param(await searchParams, "path") ?? "File";
  return { title: path.split("/").pop() };
}

function rangesOn(line: number, issues: Issue[]): RangeMark[] {
  return issues
    .filter((i) => line >= i.range.startLine && line <= i.range.endLine)
    .map((i) => ({
      start: line === i.range.startLine ? i.range.startColumn - 1 : 0,
      end: line === i.range.endLine ? i.range.endColumn - 1 : Number.MAX_SAFE_INTEGER,
      cls: i.type === "security-hotspot" ? "hot" : i.type === "code-smell" ? "smell" : "",
    }));
}

function SourceTable({ file, text: source, issues, selected, target, issueHref, lineHref, duplicated }: { file: FileReport; text: string; issues: Issue[]; selected: Issue | undefined; target: number; issueHref: (i: Issue) => string; lineHref: (line: number) => string; duplicated: (line: number) => boolean }) {
  const text = source.endsWith("\n") ? source.slice(0, -1) : source;
  const lines = text.split("\n");
  const tokens = tokenize(lines);
  const coverage = new Map<number, "ok" | "no" | "part">();
  const partial = new Map<number, { covered: number; total: number }>();
  for (const l of file.coverage?.coveredLines ?? []) coverage.set(l, "ok");
  for (const l of file.coverage?.uncoveredLines ?? []) coverage.set(l, "no");
  for (const p of file.coverage?.partialLines ?? []) {
    coverage.set(p.line, "part");
    partial.set(p.line, p);
  }
  const newLines = new Set(file.newLines ?? []);
  const byEnd = new Map<number, Issue[]>();
  for (const i of issues) byEnd.set(i.range.endLine, [...(byEnd.get(i.range.endLine) ?? []), i]);

  return (
    <table>
      <tbody>
        {lines.map((_, k) => {
          const ln = k + 1;
          const cv = coverage.get(ln);
          const marks = rangesOn(ln, issues);
          const p = partial.get(ln);
          const title = cv === "ok" ? "Covered" : cv === "no" ? "Not covered" : cv === "part" && p ? `Partially covered: ${p.covered} of ${p.total} conditions` : undefined;
          const dup = duplicated(ln);
          return [
            <tr key={ln} id={`L${ln}`} className={cx(cv && `c-${cv}`, dup && "dup", newLines.has(ln) && "new", ln === target && "hl", marks.length > 0 && "issue-line")}>
              <td className="ln">
                <Link href={lineHref(ln)} scroll={false}>
                  {ln}
                </Link>
              </td>
              <td className="gut cov" title={title}>
                <i />
              </td>
              <td className="gut dupg" title={dup ? "Duplicated block" : undefined}>
                <i />
              </td>
              <td className="src">
                {markRanges(tokens[k]!, marks).map((piece, j) => {
                  const inner = piece.kind ? <span className={`tk-${piece.kind}`}>{piece.text}</span> : piece.text;
                  return piece.mark !== undefined ? (
                    <span key={j} className={cx("rng", piece.mark)}>
                      {inner}
                    </span>
                  ) : (
                    <span key={j}>{inner}</span>
                  );
                })}
                {tokens[k]!.length === 0 && " "}
              </td>
            </tr>,
            ...(byEnd.get(ln) ?? []).map((i) => {
              const Icon = TYPE_ICON[i.type];
              return (
                <tr key={`i-${i.id}`} className="ibox">
                  <td className="ln" />
                  <td className="gut" />
                  <td className="gut" />
                  <td className="src">
                    <Link href={issueHref(i)} className={cx("ibx", i.type, selected === i && "sel")} scroll={false}>
                      <span className={`sev sev-${i.severity}`} title={SEVERITY_LABEL[i.severity]}>
                        <Icon aria-hidden strokeWidth={1.75} className={`ty-${i.type}`} />
                      </span>
                      <span className="text-fg"><InlineCode text={i.message} /></span>
                      {i.isNew ? <span className="badge b-new">New</span> : <span />}
                      <span className="x">
                        <TypeBadge type={i.type} />
                        <SeverityBadge severity={i.severity} />
                        <span className="mono">{i.ruleId}</span>
                        <span>
                          <Clock aria-hidden strokeWidth={1.75} /> {fDebt(i.effortMinutes)}
                        </span>
                      </span>
                    </Link>
                  </td>
                </tr>
              );
            }),
          ];
        })}
      </tbody>
    </table>
  );
}

export default async function FilePage({ params, searchParams }: Props) {
  const slug = decodeURIComponent((await params).project);
  const sp = await searchParams;
  const loaded = await loadProject(slug, sp);
  if ("empty" in loaded) return <EmptyProject project={loaded.project} />;
  const { project, analysis, report, analysisParam } = loaded;
  const path = param(sp, "path");
  const file = report.files.find((f) => f.path === path);
  if (!path || !file) notFound();

  const fromIssues = param(sp, "from") === "issues";
  const fileIssues = report.issues.filter((i) => i.path === path).sort((a, b) => a.range.startLine - b.range.startLine || a.range.startColumn - b.range.startColumn);
  const selected = fileIssues.find((i) => i.id === param(sp, "issue"));
  const index = selected ? fileIssues.indexOf(selected) : -1;
  const rule: ActiveRule | undefined = selected ? report.rules.find((r) => r.id === selected.ruleId) : undefined;
  const target = selected ? selected.range.startLine : Number(param(sp, "line")) || 0;
  const base = { a: analysisParam, path, ...(fromIssues ? { from: "issues" } : {}) };
  const issueHref = (i: Issue) => projectHref(slug, "file", { ...base, issue: i.id });
  const lineHref = (line: number) => projectHref(slug, "file", { ...base, line });
  const dups = report.duplications.flatMap((g) => g.occurrences.filter((o) => o.path === path).map((o) => ({ ...o, group: g })));
  const duplicated = (line: number) => dups.some((d) => line >= d.startLine && line <= d.endLine);
  const dupLines = file.measures.duplicatedLines;
  const cov = lineCoverage(file);
  const segs = path.split("/");
  const src = await resolveSource(file, project.folder);
  const sourceText = "text" in src ? src.text : null;
  const hasSource = sourceText !== null;
  const lang = LANGUAGE[file.language]?.name ?? file.language;

  const crumbs = (
    <div className="crumbs">
      {segs.map((s, k) =>
        k < segs.length - 1 ? (
          <span key={k} className="contents">
            <Link href={projectHref(slug, "code", { a: analysisParam, dir: segs.slice(0, k + 1).join("/") })}>{s}</Link>
            <span className="sep">/</span>
          </span>
        ) : (
          <b key={k} className="font-normal text-fg">
            {s}
          </b>
        ),
      )}
    </div>
  );

  const strip = (
    <div className="measures-strip mt">
      <div>
        <div className="l">Lines of code</div>
        <div className="v tabular">
          {fInt(file.measures.ncloc)} <span className="text-xs font-normal text-faint">/ {fInt(file.measures.lines)}</span>
        </div>
      </div>
      <div>
        <div className="l">Issues</div>
        <div className="v tabular">{fInt(file.measures.issues)}</div>
      </div>
      <div>
        <div className="l">Technical debt</div>
        <div className="v tabular">{fDebt(file.measures.technicalDebtMinutes)}</div>
      </div>
      <div>
        <div className="l">Coverage</div>
        <div className="v tabular">
          {file.coverage ? fPct(cov) : <span className="text-faint">—</span>}
          {file.coverage?.notInReports && <TriangleAlert aria-label="Not in any coverage report" className="size-3.5 text-warning" strokeWidth={1.75} />}
        </div>
      </div>
      <div>
        <div className="l">Complexity</div>
        <div className="v tabular">
          {fInt(file.measures.complexity)} <span className="text-xs font-normal text-faint">cog. {fInt(file.measures.cognitiveComplexity)}</span>
        </div>
      </div>
      <div>
        <div className="l">Min. maintainability</div>
        <div className="v tabular">{file.measures.maintainabilityIndex ?? "—"}</div>
      </div>
      <div>
        <div className="l">Duplicated lines</div>
        <div className="v tabular">{fInt(dupLines)}</div>
      </div>
    </div>
  );

  const notes = (
    <>
      {src.mode === "disk" && (
        <div className="px-3.5 pt-2.5">
          <Note icon={Check}>
            Read from <code>{src.path}</code> · unchanged since the analysis (sha256 matches the report).
          </Note>
        </div>
      )}
      {src.mode === "disk-unverified" && (
        <div className="px-3.5 pt-2.5">
          <Note>
            Read from <code>{src.path}</code>. The report has no checksum for this file, so changes since the analysis cannot be detected.
          </Note>
        </div>
      )}
      {src.mode === "changed" && (
        <div className="px-3.5 pt-2.5" role="status">
          <Note warn icon={TriangleAlert}>
            <b>This file changed since the analysis.</b> Showing the current version from <code>{src.path}</code>: its sha256 differs from the report, so lines, issues and coverage may not line up.
          </Note>
        </div>
      )}
      {src.mode === "embedded" && (
        <div className="px-3.5 pt-2.5">
          <Note>
            Source embedded in the report (<code>--include-sources</code>).
          </Note>
        </div>
      )}
      {file.coverage?.notInReports && (
        <div className="px-3.5 pt-2.5">
          <Note warn icon={TriangleAlert}>
            No coverage report mentions this file, so its {fInt(file.coverage.uncoveredLines.length)} executable lines count as <b>not covered</b> (<code>coverage.missingFiles: &quot;uncovered&quot;</code>).
          </Note>
        </div>
      )}
      {!file.coverage && report.coverageReports.length > 0 && (
        <div className="px-3.5 pt-2.5">
          <Note>
            This file is excluded from coverage (<code>coverage.exclude</code>).
          </Note>
        </div>
      )}
    </>
  );

  const legend = (
    <div className="legend">
      <span>
        <i className="sw-cov" style={{ background: "var(--cov-ok)" }} />
        Covered
      </span>
      <span>
        <i className="sw-cov" style={{ background: "var(--cov-no)" }} />
        Not covered
      </span>
      <span>
        <i className="sw-cov" style={{ background: "repeating-linear-gradient(180deg,var(--cov-part) 0 4px,transparent 4px 6px)" }} />
        Partial
      </span>
      <span>
        <i className="sw-cov" style={{ background: "var(--dup)" }} />
        Duplicated
      </span>
      {(file.newLines?.length ?? 0) > 0 && (
        <span>
          <i className="sw-cov" style={{ background: "var(--accent)" }} />
          New code
        </span>
      )}
    </div>
  );

  const codeCard = hasSource ? (
    <CodeFrame toolbar={{ issues: fileIssues.length, duplications: dups.length }} legend={legend} notes={notes}>
      <SourceTable file={file} text={sourceText!} issues={fileIssues} selected={selected} target={target} issueHref={issueHref} lineHref={lineHref} duplicated={duplicated} />
    </CodeFrame>
  ) : (
    <div className="card">
      <Empty icon={EyeOff} title="Source not available">
        {src.mode === "no-folder" ? (
          <>
            This project has no folder to read the file from and the report does not embed the source. Link the project folder (Project menu) or analyse with <code>--include-sources</code>.
          </>
        ) : src.mode === "missing" && src.reason === "too-large" ? (
          <>
            <code>{src.path}</code> is larger than 2 MB. Issues and coverage are listed by line below.
          </>
        ) : src.mode === "missing" && src.reason === "binary" ? (
          <>
            <code>{src.path}</code> is not a text file. Issues and coverage are listed by line below.
          </>
        ) : (
          <>
            <code>{src.mode === "missing" ? src.path : path}</code> is not in the project folder any more, and the report does not embed the source. Issues and coverage are listed by line below.
          </>
        )}
      </Empty>
      <div className="card-hd border-t border-line">
        <h2>Issues in this file</h2>
        <span className="text-faint">{fileIssues.length}</span>
      </div>
      {fileIssues.length ? (
        fileIssues.map((i) => {
          const Icon = TYPE_ICON[i.type];
          return (
            <div key={i.id} className="iss">
              <span className={`ic ty-${i.type}`}>
                <Icon aria-hidden strokeWidth={1.75} />
              </span>
              <Link className="msg" href={issueHref(i)} scroll={false}>
                <InlineCode text={i.message} />
              </Link>
              <div className="side">
                <SeverityBadge severity={i.severity} />
              </div>
              <div className="meta">
                <TypeBadge type={i.type} />
                <span className="mono">
                  Line {i.range.startLine}
                  {i.range.endLine !== i.range.startLine && `–${i.range.endLine}`}, col {i.range.startColumn}
                </span>
                <span className="mono">{i.ruleId}</span>
                <span>{fDebt(i.effortMinutes)}</span>
              </div>
            </div>
          );
        })
      ) : (
        <Empty icon={CircleCheck} title="No issues">This file has no issues.</Empty>
      )}
      {file.coverage && (
        <>
          <div className="card-hd border-t border-line">
            <h2>Coverage</h2>
            <span className="tabular">{fPct(cov)}</span>
          </div>
          <div className="card-bd text-[13px] text-muted">
            {fInt(file.coverage.coveredLines.length)} covered · {fInt(file.coverage.uncoveredLines.length)} not covered · {fInt(file.coverage.partialLines.length)} partially covered lines
            {file.coverage.notInReports && " · not in any coverage report"}.
          </div>
        </>
      )}
    </div>
  );

  const functions = [...file.functions].sort((a, b) => b.complexity - a.complexity).slice(0, 8);
  const panel = selected ? (
    <aside className="card panel" aria-label="Issue details">
      <div className="panel-sec">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2">
            <TypeBadge type={selected.type} />
            <span className="eyebrow m-0">{TYPE_LABEL[selected.type].characteristic}</span>
          </span>
          <span className="flex gap-1">
            {index > 0 ? (
              <Link className="btn sm" href={issueHref(fileIssues[index - 1]!)} aria-label="Previous issue" scroll={false}>
                <ChevronLeft aria-hidden />
              </Link>
            ) : (
              <span className="btn sm" aria-disabled="true">
                <ChevronLeft aria-hidden />
              </span>
            )}
            {index < fileIssues.length - 1 ? (
              <Link className="btn sm" href={issueHref(fileIssues[index + 1]!)} aria-label="Next issue" scroll={false}>
                <ChevronRight aria-hidden />
              </Link>
            ) : (
              <span className="btn sm" aria-disabled="true">
                <ChevronRight aria-hidden />
              </span>
            )}
          </span>
        </div>
        <div className="issue-title text-[15px] leading-snug font-medium"><InlineCode text={selected.message} /></div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-faint">
          <SeverityBadge severity={selected.severity} />
          {selected.isNew && <span className="badge b-new">New</span>}
          <span className="inline-flex items-center gap-1">
            <Clock aria-hidden className="size-3" strokeWidth={1.75} /> {fDebt(selected.effortMinutes)} effort
          </span>
          <span className="mono">
            L{selected.range.startLine}:{selected.range.startColumn}
            {selected.range.endLine !== selected.range.startLine && `–L${selected.range.endLine}`}
          </span>
        </div>
        <div className="mono mt-2 text-[11px] text-faint" title="Stable fingerprint: survives line shifts">
          id {selected.id} · {index + 1} of {fileIssues.length} in file
        </div>
      </div>
      {rule ? (
        <>
          <div className="panel-sec">
            <h3>Rule</h3>
            <Link className="link text-sm font-medium" href={projectHref(slug, "rules/" + encodeURIComponent(rule.id), { a: analysisParam })}>
              {rule.name}
            </Link>
            <div className="mono mt-0.5 text-xs text-faint">{rule.id}</div>
          </div>
          <div className="panel-sec">
            <h3>Why is this an issue?</h3>
            <div className="prose">
              <RichText text={rule.description} />
              <RichText text={rule.rationale} />
            </div>
          </div>
          {rule.exceptions && (
            <div className="panel-sec">
              <h3>Exceptions</h3>
              <div className="prose">
                <RichText text={rule.exceptions} />
              </div>
            </div>
          )}
          {rule.noncompliantExample && (
            <div className="panel-sec">
              <h3>How to fix it</h3>
              <CodeExamples rule={rule} stacked />
            </div>
          )}
          <div className="panel-sec">
            <h3>References</h3>
            <References references={rule.references} />
          </div>
        </>
      ) : (
        <div className="panel-sec">
          <Note>The rule {selected.ruleId} is not described in this report.</Note>
        </div>
      )}
    </aside>
  ) : (
    <aside className="card panel" aria-label="File details">
      <div className="panel-sec">
        <h3>File</h3>
        <dl className="kv narrow">
          <div>
            <dt>Language</dt>
            <dd>
              {lang} <span className="text-faint">· {file.plugin} plugin</span>
            </dd>
          </div>
          <div>
            <dt>Functions</dt>
            <dd className="tabular">
              {file.measures.functions} functions · {file.measures.classes} classes
            </dd>
          </div>
          <div>
            <dt>Comments</dt>
            <dd className="tabular">{file.measures.commentLines} lines</dd>
          </div>
          <div>
            <dt>Statements</dt>
            <dd className="tabular">{file.measures.statements}</dd>
          </div>
        </dl>
      </div>
      {fileIssues.length > 0 && (
        <div className="panel-sec">
          <h3>Issues</h3>
          <div className="prose mb-2">Select an issue in the code to see its rule, the explanation and the references.</div>
          <Link className="btn sm" href={issueHref(fileIssues[0]!)} scroll={false}>
            Go to the first issue (line {fileIssues[0]!.range.startLine})
          </Link>
        </div>
      )}
      {functions.length > 0 && (
        <div className="panel-sec">
          <h3>Most complex functions</h3>
          <ul className="fnlist">
            {functions.map((fn) => (
              <li key={`${fn.name}:${fn.range.startLine}`}>
                <Link href={lineHref(fn.range.startLine)} scroll={false}>
                  <span className="mono">{fn.name}</span>
                  <span className="tabular text-faint" title="Cyclomatic / cognitive">
                    CC {fn.complexity} · cog {fn.cognitiveComplexity}
                  </span>
                  <span className="tabular" title="Maintainability index">
                    MI {fn.maintainabilityIndex ?? "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {dups.length > 0 && (
        <div className="panel-sec">
          <h3>Duplications</h3>
          {dups.map((d) => (
            <div key={`${d.group.id}:${d.startLine}`} className="mb-2 text-xs">
              <div className="text-faint">
                Lines {d.startLine}–{d.endLine} · {d.group.tokens} tokens, also in:
              </div>
              {d.group.occurrences
                .filter((o) => o.path !== path || o.startLine !== d.startLine)
                .map((o) => (
                  <Link key={`${o.path}:${o.startLine}`} className="mono block py-0.5 text-fg hover:underline" href={projectHref(slug, "file", { a: analysisParam, path: o.path, line: o.startLine })}>
                    {o.path}:{o.startLine}–{o.endLine}
                  </Link>
                ))}
            </div>
          ))}
        </div>
      )}
      {!hasSource && (
        <div className="panel-sec">
          <Note icon={Info}>{project.folder ? "The file is not readable in the project folder." : "Link the project folder from the Project menu to see the code here."}</Note>
        </div>
      )}
    </aside>
  );

  return (
    <>
      <ProjectHeader project={project} analysis={analysis} report={report} active={fromIssues ? "issues" : "code"} analysisParam={analysisParam} />
      <div className="wrap">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {crumbs}
            <div className="file-title">
              <FileMark path={path} />
              <h2>{segs[segs.length - 1]}</h2>
              {(file.newLines?.length ?? 0) > 0 && <span className="badge b-new">Changed</span>}
            </div>
          </div>
          <Link className="btn sm" href={fromIssues ? projectHref(slug, "issues", { a: analysisParam }) : projectHref(slug, "code", { a: analysisParam, dir: segs.slice(0, -1).join("/") })}>
            <ChevronLeft aria-hidden />
            Back to {fromIssues ? "issues" : "code"}
          </Link>
        </div>
        {strip}
        <div className="file-layout mt">
          {codeCard}
          {panel}
        </div>
        {target > 0 && hasSource && <ScrollToLine line={target} />}
      </div>
    </>
  );
}
