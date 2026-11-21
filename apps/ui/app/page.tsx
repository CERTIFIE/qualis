import { CircleX, Clock, Folder, History, Layers, TriangleAlert } from "@/components/icons";
import { AnalyzeSnippet } from "@/components/AnalyzeSnippet";
import { ProjectCard, SolutionCard } from "@/components/cards";
import { ImportButton, ReadButton } from "@/components/dialogs";
import { ProjectsBrowser } from "@/components/favorites";
import { NewSolutionButton } from "@/components/solution-dialogs";
import { Badge, Empty, Note, Tile } from "@/components/ui";
import { store } from "@/lib/data";
import { fDay, fInt } from "@/lib/format";
import { analysesOverTime } from "@/lib/trend";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const snapshot = await store().scan();
  const text = (q ?? "").toLowerCase();
  const all = snapshot.projects;
  const matches = (p: { name: string; key: string }) => !text || p.name.toLowerCase().includes(text) || p.key.toLowerCase().includes(text);
  const projects = all.filter(matches);
  // A solution matches by its name or by one of its projects.
  const solutions = snapshot.solutions.filter((s) => !text || s.name.toLowerCase().includes(text) || projects.some((p) => s.projects.includes(p.key)));
  const analysed = all.filter((p) => p.analyses.length);
  const failing = analysed.filter((p) => p.analyses[0]!.gate === "failed");
  const totalAnalyses = all.reduce((a, p) => a + p.analyses.length, 0);
  const latest = analysed.map((p) => ({ p, a: p.analyses[0]! })).sort((x, y) => y.a.finishedAt.localeCompare(x.a.finishedAt))[0];
  // One point per analysis (running total), so analyses of the same day are not merged into one.
  const analysesTrend = analysesOverTime(all.flatMap((p) => p.analyses.map((a) => a.finishedAt)));
  const diagnostics = all.flatMap((p) => p.diagnostics.map((d) => ({ ...d, project: p.name })));
  const actions = (
    <div className="flex flex-wrap gap-1.5">
      <ImportButton primary />
      <ReadButton primary />
      <NewSolutionButton />
    </div>
  );

  return (
    <>
      <section className="band">
        <div className="wrap">
          <div className="page-hd">
            <div className="eyebrow">Qualis</div>
            <div className="title-row">
              <div>
                <h1 className="title">Projects</h1>
                <div className="sub">
                  {all.length
                    ? "Imported folders are re-read on every visit, so new analyses in .qualis appear by themselves. Group related projects in a solution."
                    : "No projects yet."}
                </div>
              </div>
              {actions}
            </div>
          </div>
        </div>
      </section>
      <div className="wrap">
        {all.length === 0 ? (
          <div className="card">
            <Empty icon={Folder} title="Add your first project">
              Import a project folder that contains a <code>.qualis</code> folder, or read a single <code>report.json</code>. Qualis keeps the project and shows every new analysis by itself.
            </Empty>
            <div className="flex justify-center gap-2 px-5 pb-5">{actions}</div>
            <div className="mx-auto max-w-[640px] px-5 pb-6">
              <AnalyzeSnippet />
            </div>
          </div>
        ) : (
          <>
            <div className="cards g4">
              <Tile icon={Layers} label="Projects" value={fInt(all.length)} sub={`${snapshot.solutions.length} ${snapshot.solutions.length === 1 ? "solution" : "solutions"} · ${all.filter((p) => p.folder).length} folders · ${all.filter((p) => !p.folder).length} uploaded`} />
              <Tile icon={CircleX} label="Failing quality gate" value={fInt(failing.length)} sub={failing.map((p) => p.name).join(", ") || "none"} />
              <Tile icon={History} label="Analyses" value={fInt(totalAnalyses)} sub=".qualis history and uploads" trend={analysesTrend} trendFormat="count" />
              <Tile icon={Clock} label="Latest analysis" value={latest ? fDay(latest.a.finishedAt) : "—"} sub={latest ? `${latest.p.name}${latest.a.branch ? ` · ${latest.a.branch}` : ""}` : "none yet"} />
            </div>
            {diagnostics.length > 0 && (
              <details className="mt">
                <summary className="inline-flex cursor-pointer items-center gap-2">
                  <Badge className="b-warn">
                    <TriangleAlert aria-hidden />
                    {diagnostics.length} {diagnostics.length === 1 ? "problem" : "problems"}
                  </Badge>
                  <span className="text-xs text-faint">unreadable files or folders</span>
                </summary>
                <ul className="mt-2 grid gap-1 text-xs text-muted">
                  {diagnostics.map((d) => (
                    <li key={d.file}>
                      <b className="font-medium text-fg">{d.project}</b> · <code className="mono">{d.file}</code> — {d.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {projects.length || solutions.length ? (
              <>
                {text && <div className="mt-6 text-xs text-faint">{`${projects.length} ${projects.length === 1 ? "project" : "projects"} matching “${q}”`}</div>}
                <ProjectsBrowser
                  solutions={solutions.map((s) => ({ id: s.id, projects: s.projects, latest: s.latest }))}
                  projects={projects.map((p) => ({ key: p.key, latest: p.analyses[0]?.finishedAt ?? null }))}
                  solutionCards={Object.fromEntries(solutions.map((s) => [s.id, <SolutionCard key={s.id} solution={s} projects={all} />]))}
                  projectCards={Object.fromEntries(projects.filter((p) => !p.solution).map((p) => [p.key, <ProjectCard key={p.key} p={p} />]))}
                  flatCards={Object.fromEntries(projects.filter((p) => p.solution).map((p) => [p.key, <ProjectCard key={p.key} p={p} inSolution={p.solution} />]))}
                />
              </>
            ) : (
              <div className="card mt-8">
                <Note>No project matches “{q}”.</Note>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
