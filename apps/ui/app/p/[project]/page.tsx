import type { Metadata } from "next";
import { EmptyProject } from "@/components/EmptyProject";
import { Overview } from "@/components/Overview";
import { ProjectHeader } from "@/components/ProjectHeader";
import { historyPoints, loadProject, param, projectHref, type SearchParams } from "@/lib/project";

type Props = { params: Promise<{ project: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: decodeURIComponent((await params).project) };
}

export default async function OverviewPage({ params, searchParams }: Props) {
  const slug = decodeURIComponent((await params).project);
  const sp = await searchParams;
  const loaded = await loadProject(slug, sp);
  if ("empty" in loaded) return <EmptyProject project={loaded.project} />;
  const { project, analysis, report, analysisParam } = loaded;
  const keep = { a: analysisParam, scope: param(sp, "scope"), hs: param(sp, "hs"), hm: param(sp, "hm") };
  return (
    <>
      <ProjectHeader project={project} analysis={analysis} report={report} active="overview" analysisParam={analysisParam} />
      <div className="wrap">
        <Overview
          report={report}
          history={historyPoints(project, analysis)}
          scope={keep.scope}
          hotspot={keep.hs}
          historyMetric={keep.hm}
          links={{
            self: (patch) => projectHref(slug, "", { ...keep, ...patch }),
            issues: (q) => `${projectHref(slug, "issues", { a: analysisParam })}${q ? (analysisParam ? "&" : "?") + q : ""}`,
            file: (path, line) => projectHref(slug, "file", { a: analysisParam, path, line }),
            code: projectHref(slug, "code", { a: analysisParam }),
          }}
        />
      </div>
    </>
  );
}
