import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GateSummaryBadge, ProjectCard } from "@/components/cards";
import { FavButton } from "@/components/favorites";
import { ChevronRight, CircleCheck, CircleMinus, CircleX, Clock, Code, Folder, Folders, Hourglass, History, Layers, Bug, Target } from "@/components/icons";
import { DebtMeter } from "@/components/meters";
import { AddProjectsButton, SolutionMenu } from "@/components/solution-dialogs";
import { CardHeader, Empty, HeaderField, Note, RatingBadge, RatingScale, StatusBadge, Tile } from "@/components/ui";
import { store } from "@/lib/data";
import { fDate, fDebt, fInt, fPct } from "@/lib/format";
import { aggregateSolution, ratingOfDebtRatio, RATING_KEYS, type SolutionMetrics } from "@/lib/solutions";
import { memberOf } from "@/lib/store";

type Props = { params: Promise<{ solution: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const solution = await store().solution(decodeURIComponent((await params).solution));
  return { title: solution?.name ?? "Solution" };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const RATING_LABEL = { reliability: "Reliability", security: "Security", maintainability: "Maintainability" } as const;

/** Coverage weighted by lines to cover, with a red tick at the project with the lowest coverage. */
function CoverageBar({ m }: { m: SolutionMetrics }) {
  if (m.coverage === null) return null;
  const low = m.lowestCoverage;
  return (
    <div className="meter" role="img" aria-label={`Coverage ${fPct(m.coverage)} weighted by lines to cover${low ? `; lowest ${low.name} ${fPct(low.coverage)}` : ""}.`}>
      <div className="m-track">
        <i className="m-fill" style={{ width: `${Math.min(100, m.coverage)}%` }} />
        {low && <span className="m-mark lo" style={{ left: `${Math.min(100, low.coverage)}%` }} title={`Lowest: ${low.name}`} />}
      </div>
      <div className="m-ends">
        <span>weighted</span>
        {low && <span>lowest {fPct(low.coverage)}</span>}
      </div>
    </div>
  );
}

/** Lines of code per project, largest first. */
function ShareBar({ m }: { m: SolutionMetrics }) {
  const top = m.shares[0];
  if (!top || !m.ncloc) return null;
  const opacity = [1, 0.72, 0.52, 0.38, 0.28, 0.2];
  return (
    <div className="meter" role="img" aria-label={`Lines of code by project: ${m.shares.map((s) => `${s.name} ${fInt(s.ncloc)}`).join(", ")}.`}>
      <div className="m-track share">
        {m.shares.map((s, i) => (
          <i key={s.key} style={{ flex: `${Math.max(s.ncloc, 1)} 1 0`, opacity: opacity[Math.min(i, opacity.length - 1)] }} title={`${s.name}: ${fInt(s.ncloc)} lines`} />
        ))}
      </div>
      <div className="m-ends">
        <span>largest {top.name}</span>
        <span>{Math.round((top.ncloc / m.ncloc) * 100)}%</span>
      </div>
    </div>
  );
}

export default async function SolutionPage({ params }: Props) {
  const id = decodeURIComponent((await params).solution);
  const s = store();
  const snapshot = await s.scan();
  const solution = snapshot.solutions.find((x) => x.id === id);
  if (!solution) notFound();
  const projects = snapshot.projects.filter((p) => solution.projects.includes(p.key));
  const m = aggregateSolution(projects.map(memberOf));
  const failing = m.gate.failed;
  const GateIcon = m.gate.status === "failed" ? CircleX : m.gate.status === "passed" ? CircleCheck : CircleMinus;

  return (
    <>
      <section className="band">
        <div className="wrap">
          <div className="page-hd">
            <div className="eyebrow">
              <Link href="/">Projects</Link>
              <ChevronRight aria-hidden className="size-3" />
              <span className="normal-case tracking-normal text-fg">{solution.name}</span>
            </div>
            <div className="title-row">
              <div className="min-w-0">
                <h1 className="title flex items-center gap-2.5">
                  {solution.name}
                  <FavButton kind="solutions" id={solution.id} name={solution.name} inline />
                </h1>
                <div className="chips">
                  {solution.folder ? (
                    <span className="chip" title={`Projects found under ${solution.folder}`}>
                      <Folder aria-hidden />
                      <code>{solution.folder}</code>
                    </span>
                  ) : (
                    <span className="chip">
                      <Folders aria-hidden />
                      Manual solution
                    </span>
                  )}
                  <span className="chip">
                    <Layers aria-hidden />
                    {plural(m.projects, "project", "projects")}
                  </span>
                  <span className="chip">
                    <History aria-hidden />
                    {plural(m.analyses, "analysis", "analyses")}
                  </span>
                  {m.latest && (
                    <span className="chip">
                      <Clock aria-hidden />
                      latest {fDate(m.latest)}
                    </span>
                  )}
                </div>
              </div>
              <div className="hd-actions">
                <div className="hd-pair">
                  <SolutionMenu id={solution.id} name={solution.name} folder={solution.folder} projects={m.projects} />
                </div>
                <HeaderField label="Quality gates">
                  <span className={`gate ${m.gate.status === "failed" ? "fail" : m.gate.status === "passed" ? "ok" : "none"}`}>
                    <GateIcon aria-hidden strokeWidth={1.75} />
                    {m.gate.status === "none" ? "No analysis" : failing.length ? `${failing.length} of ${m.gate.analysed} failing` : `All ${m.gate.analysed} passed`}
                  </span>
                </HeaderField>
              </div>
            </div>
            {failing.length > 0 && (
              <div className="sub flex flex-wrap items-center gap-1.5 text-danger">
                <CircleX aria-hidden className="size-3.5" />
                <span>
                  Failing:{" "}
                  {failing.map((f, i) => (
                    <span key={f.key}>
                      {i > 0 && ", "}
                      <b className="font-medium">{f.name}</b>
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        </div>
      </section>
      <div className="wrap">
        {!projects.length ? (
          <div className="card">
            <Empty icon={Folders} title="No projects in this solution yet">
              Add projects that are already in Qualis, or import a folder with several projects as a new solution.
            </Empty>
            <div className="flex justify-center px-5 pb-6">
              <AddProjectsButton id={solution.id} name={solution.name} primary />
            </div>
          </div>
        ) : (
          <>
            <div className="cards g4">
              <Tile icon={Bug} label="Issues" value={fInt(m.issues)} sub={`sum of ${plural(m.analysed, "project", "projects")}`} {...(m.trend ? { trend: m.trend, better: "lower" as const } : {})} />
              <Tile
                icon={Hourglass}
                label="Technical debt"
                value={fDebt(m.debtMinutes)}
                sub={m.debtRatio === null ? "no analysis" : `${fPct(m.debtRatio, 2)} debt ratio · weighted`}
                {...(m.debtRatio !== null ? { visual: <DebtMeter ratio={m.debtRatio} rating={ratingOfDebtRatio(m.debtRatio)} /> } : {})}
              />
              <Tile
                icon={Target}
                label="Coverage"
                value={
                  m.coverage === null ? (
                    "—"
                  ) : (
                    <>
                      {m.coverage.toFixed(1)}
                      <small>%</small>
                    </>
                  )
                }
                sub={m.lowestCoverage ? `lowest: ${m.lowestCoverage.name}` : "no coverage reports"}
                {...(m.coverage !== null ? { visual: <CoverageBar m={m} /> } : {})}
              />
              <Tile icon={Code} label="Lines of code" value={fInt(m.ncloc)} sub={plural(m.analysed, "project", "projects")} {...(m.shares.length ? { visual: <ShareBar m={m} /> } : {})} />
            </div>
            <div className="cards split-sol mt">
              <div className="card">
                <CardHeader title="Quality gates" docs={{ href: "/docs/quality-gate", label: "How the quality gate works" }} subtitle="Each project keeps its own gate; the solution only counts them." action={<GateSummaryBadge gate={m.gate} />} />
                <div className="card-bd py-1">
                  {[...projects]
                    .sort((a, b) => (a.analyses[0]?.gate === "failed" ? 0 : a.analyses[0] ? 1 : 2) - (b.analyses[0]?.gate === "failed" ? 0 : b.analyses[0] ? 1 : 2))
                    .map((p) => (
                      <div key={p.key} className="grow-row">
                        <Link href={`/p/${encodeURIComponent(p.key)}`} className="nm hover:underline">
                          {p.name}
                        </Link>
                        <span className="mono text-[11.5px] text-faint">{p.analyses[0]?.branch ?? ""}</span>
                        <StatusBadge status={p.analyses[0]?.gate ?? "no-data"} {...(p.analyses[0] ? {} : { label: "No analysis" })} />
                      </div>
                    ))}
                </div>
              </div>
              <div className="card">
                <CardHeader title={`Ratings · worst of ${plural(m.analysed, "project", "projects")}`} docs={{ href: "/docs/ratings", label: "How the ratings are computed" }} subtitle="A solution is only as good as its weakest project." />
                {m.ratings ? (
                  RATING_KEYS.map((k) => (
                    <div key={k} className="rrow">
                      <RatingBadge rating={m.ratings![k]} size="lg" label={RATING_LABEL[k]} />
                      <div className="min-w-0">
                        <div className="lbl">{RATING_LABEL[k]}</div>
                        <div className="d">worst: {m.worstBy[k].join(", ")}</div>
                      </div>
                      <RatingScale rating={m.ratings![k]} />
                    </div>
                  ))
                ) : (
                  <Note>No project has an analysis yet.</Note>
                )}
              </div>
            </div>
            <div className="mt">
              <Note>Issues, debt and lines of code are sums. Coverage is weighted by lines to cover, duplications by lines and the debt ratio by lines of code. Ratings are the worst among the projects.</Note>
            </div>
          </>
        )}
        {projects.length > 0 && (
          <>
            <div className="section-title">
              <h2>Projects in this solution</h2>
              <div className="st-tools">
                <AddProjectsButton id={solution.id} name={solution.name} />
                <span className="eyebrow m-0 hide-sm">Sorted by latest analysis</span>
              </div>
            </div>
            <div className="pgrid">
              {projects.map((p) => (
                <ProjectCard key={p.key} p={p} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
