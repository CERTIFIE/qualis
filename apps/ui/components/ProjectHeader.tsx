import Link from "next/link";
import { Suspense } from "react";
import type { Report } from "@qualis/schema";
import { AnalysisSelect, CopyButton } from "./client";
import { ChevronRight, CircleX, Clock, FileUpload, Folder, GitBranch, GitCommit, History, TriangleAlert } from "./icons";
import { FavButton } from "./favorites";
import { ProjectMenu } from "./ProjectMenu";
import { GatePill } from "./ui";
import { fAgo, fDate, fDay, fInt } from "@/lib/format";
import { staleness } from "@/lib/staleness";
import { projectHref } from "@/lib/project";
import type { AnalysisSummary, ProjectView } from "@/lib/store";

export type ProjectTab = "overview" | "issues" | "code" | "rules";

/** Where a project's analyses come from: its folder's .qualis, uploads, or both. */
export function SourceChips({ project }: { project: ProjectView }) {
  return (
    <>
      {project.folder ? (
        <span className="chip" title={`Analyses read from ${project.folder}/.qualis`}>
          <Folder aria-hidden />
          <code>{project.folder}</code>
        </span>
      ) : (
        <span className="chip">
          <FileUpload aria-hidden />
          Uploaded · {fInt(project.uploads)} {project.uploads === 1 ? "analysis" : "analyses"}
        </span>
      )}
      {project.folder && project.uploads > 0 && (
        <span className="chip">
          <FileUpload aria-hidden />+{fInt(project.uploads)} uploaded
        </span>
      )}
    </>
  );
}

/**
 * A thin strip under the header when the analysis shown is behind its branch in the project folder: how many commits,
 * the newest one, and the command that brings the project up to date.
 */
async function StaleStrip({ folder, analysis }: { folder: string | null; analysis: AnalysisSummary }) {
  const s = await staleness(folder, analysis.branch, analysis.revision);
  if (!s || s.state === "current") return null;
  return (
    <div className="stale-strip" role="status">
      <i className="stale-dot" aria-hidden />
      <span>
        {s.state === "behind" ? (
          <>
            This analysis is{" "}
            <b>
              {s.commits} commit{s.commits === 1 ? "" : "s"} behind {s.branch}
            </b>
          </>
        ) : (
          <>
            <b>{s.branch} has moved</b>: the analysed commit is no longer on it
          </>
        )}{" "}
        · latest commit {fAgo(s.last.date)} (<code>{s.last.revision.slice(0, 7)}</code>)
      </span>
      <CopyButton text={`qualis analyze "${folder}"`} label="Copy qualis analyze" />
    </div>
  );
}

export function ProjectHeader({
  project,
  analysis,
  report,
  active,
  analysisParam,
}: {
  project: ProjectView;
  analysis?: AnalysisSummary;
  report?: Report;
  active: ProjectTab;
  analysisParam?: string | undefined;
}) {
  const a = report?.analysis;
  const gate = report?.qualityGate;
  const failed = gate?.conditions.filter((c) => c.status === "failed").length ?? 0;
  const ap = { a: analysisParam };
  const tabs: Array<[ProjectTab, string, string, number | null]> = report
    ? [
        ["overview", "Overview", projectHref(project.key, "", ap), null],
        ["issues", "Issues", projectHref(project.key, "issues", ap), report.issues.length],
        ["code", "Code", projectHref(project.key, "code", ap), report.files.length],
        ["rules", "Rules", projectHref(project.key, "rules", ap), report.rules.length],
      ]
    : [];
  return (
    <section className="band">
      <div className="wrap">
        <div className="page-hd">
          <div className="eyebrow">
            <Link href="/">Projects</Link>
            <ChevronRight aria-hidden className="size-3" />
            {project.solution && (
              <>
                <Link href={`/s/${encodeURIComponent(project.solution.id)}`} className="normal-case tracking-normal">
                  {project.solution.name}
                </Link>
                <ChevronRight aria-hidden className="size-3" />
              </>
            )}
            <span className="mono normal-case tracking-normal text-fg">{project.key}</span>
          </div>
          <div className="title-row">
            <div className="min-w-0">
              <h1 className="title flex items-center gap-2.5">
                {project.name}
                <FavButton kind="projects" id={project.key} name={project.name} inline />
              </h1>
              <div className="chips">
                <SourceChips project={project} />
                <span className="chip">
                  <History aria-hidden />
                  {fInt(project.analyses.length)} {project.analyses.length === 1 ? "analysis" : "analyses"}
                </span>
                {a?.vcs?.branch && (
                  <span className="chip">
                    <GitBranch aria-hidden />
                    {a.vcs.branch}
                  </span>
                )}
                {a?.vcs?.revision && (
                  <span className="chip" title={a.vcs.revision}>
                    <GitCommit aria-hidden />
                    <code>{a.vcs.revision.slice(0, 7)}</code>
                  </span>
                )}
                {a && (
                  <span className="chip">
                    <Clock aria-hidden />
                    {fDate(a.finishedAt)}
                  </span>
                )}
              </div>
            </div>
            <div className="hd-actions">
              <div className="hd-pair">
                {analysis && project.analyses.length > 1 && (
                  <Suspense>
                    <AnalysisSelect
                      current={analysis.id}
                      options={project.analyses.map((x, i) => ({
                        id: x.id,
                        label: `${fDay(x.finishedAt)}${x.branch ? ` · ${x.branch}` : ""} · ${i === 0 ? "latest" : x.origin === "upload" ? "uploaded" : "history"}`,
                      }))}
                    />
                  </Suspense>
                )}
                <ProjectMenu projectKey={project.key} name={project.name} folder={project.folder} uploads={project.uploadFiles} solution={project.solution} />
              </div>
              <GatePill status={gate?.status ?? null} {...(report ? { href: projectHref(project.key, "", ap) } : {})} />
            </div>
          </div>
          {analysis && <StaleStrip folder={project.folder} analysis={analysis} />}
          {project.folderState === "missing" && (
            <div className="sub flex items-center gap-1.5 text-warning">
              <TriangleAlert aria-hidden className="size-3.5" />
              The folder {project.folder} is not reachable (moved, deleted or not mounted); only uploaded analyses are shown.
            </div>
          )}
          {gate?.status === "failed" && (
            <div className="sub flex items-center gap-1.5 text-danger">
              <CircleX aria-hidden className="size-3.5" />
              {failed} of {gate.conditions.length} conditions failed on <b className="font-medium">{gate.name}</b>
            </div>
          )}
        </div>
        {tabs.length > 0 && (
          <nav className="tabs" aria-label="Project">
            {tabs.map(([key, label, href, count]) => (
              <Link key={key} href={href} aria-current={key === active ? "page" : undefined}>
                {label}
                {count !== null && <span className="count">· {fInt(count)}</span>}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </section>
  );
}
