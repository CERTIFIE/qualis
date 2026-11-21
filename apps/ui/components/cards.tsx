import Link from "next/link";
import type { Ratings } from "@qualis/schema";
import { FavButton, FavMark } from "./favorites";
import { CircleCheck, CircleMinus, CircleX, Clock, FileUpload, Folder, FolderOpen, Folders, GitBranch, Info, TriangleAlert } from "./icons";
import { TrendChart } from "./TrendChart";
import { Badge, Empty, RatingBadge, Ring, StatusBadge } from "./ui";
import { fAgo, fInt, fPct } from "@/lib/format";
import { staleLabel, staleness, type Staleness } from "@/lib/staleness";
import { aggregateSolution, type GateSummary } from "@/lib/solutions";
import { memberOf, type ProjectView, type SolutionView } from "@/lib/store";

// The cards of the Projects page and of a solution dashboard: one per project, one per solution.

export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+|(?=[A-Z][a-z])/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((w) => w[0]) : [name.slice(0, 2)]).join("").toUpperCase();
}

export const solutionHref = (id: string) => `/s/${encodeURIComponent(id)}`;

/** The newest commit of a stale analysis, for a tooltip: "<branch> is now at 3a2b1c0 (2 hours ago)". */
function staleTitle(s: Exclude<Staleness, { state: "current" }>, revision: string | null): string {
  const now = `${s.branch} is now at ${s.last.revision.slice(0, 7)} (${fAgo(s.last.date)})`;
  return s.state === "behind" ? `Analysed at ${revision?.slice(0, 7) ?? "?"}; ${now}` : `The analysed commit is no longer on ${s.branch}; ${now}`;
}

/** Whether a project's latest analysis is behind its branch (git, in the project folder); nothing when unknown. */
async function StaleChip({ folder, branch, revision }: { folder: string | null; branch: string | null; revision: string | null }) {
  const s = await staleness(folder, branch, revision);
  if (!s) return null;
  if (s.state === "current") return <span className="fresh">Up to date</span>;
  return (
    <span className="stale" title={staleTitle(s, revision)}>
      <i className="stale-dot" aria-hidden />
      {staleLabel(s)}
    </span>
  );
}

/** How many projects of a solution have an analysis behind its branch. */
async function SolutionStaleChip({ members }: { members: ProjectView[] }) {
  const known = (
    await Promise.all(members.map(async (p) => ({ p, s: p.analyses[0] ? await staleness(p.folder, p.analyses[0].branch, p.analyses[0].revision) : null })))
  ).filter((x): x is { p: ProjectView; s: Staleness } => x.s !== null);
  if (!known.length) return null;
  const stale = known.filter((x): x is { p: ProjectView; s: Exclude<Staleness, { state: "current" }> } => x.s.state !== "current");
  if (!stale.length) return known.length === members.length ? <span className="fresh">Up to date</span> : null;
  return (
    <span className="stale" title={stale.map((x) => `${x.p.name}: ${staleLabel(x.s)}`).join(" · ")}>
      <i className="stale-dot" aria-hidden />
      {stale.length} of {members.length} behind
    </span>
  );
}

function FolderFoot({ folder }: { folder: string }) {
  return (
    <span className="min-w-0" title={folder}>
      <Folder aria-hidden />
      <span className="mono path">{folder}</span>
    </span>
  );
}

function SourceFoot({ p }: { p: ProjectView }) {
  return p.folder ? (
    <FolderFoot folder={p.folder} />
  ) : (
    <span>
      <FileUpload aria-hidden />
      {fInt(p.uploads)} uploaded {p.uploads === 1 ? "analysis" : "analyses"}
    </span>
  );
}

/** The three ratings with their short names; the badge carries the full name for screen readers. */
export function RatingCells({ ratings }: { ratings: Ratings }) {
  return (
    <div className="v prt">
      {(
        [
          ["Rel", "Reliability", ratings.reliability],
          ["Sec", "Security", ratings.security],
          ["Maint", "Maintainability", ratings.maintainability],
        ] as const
      ).map(([short, long, r]) => (
        <span key={short} title={`${long} rating ${r}`}>
          <RatingBadge rating={r} label={long} />
          <small aria-hidden>{short}</small>
        </span>
      ))}
    </div>
  );
}

function Metrics({ coverage, issues, duplication, ncloc, ratings, coverageLabel }: { coverage: number | null; issues: number; duplication: number | null; ncloc: number; ratings: Ratings; coverageLabel: string }) {
  return (
    <div className="pcard-mid">
      <Ring
        pct={coverage}
        size={72}
        stroke={5}
        small
        center={
          <>
            <b>{coverage === null ? "—" : `${coverage.toFixed(1)}%`}</b>
            <small>coverage</small>
          </>
        }
        label={coverage === null ? "No coverage data" : coverageLabel}
      />
      <div className="pcard-metrics">
        <div>
          <div className="l">Issues</div>
          <div className="v">{fInt(issues)}</div>
        </div>
        <div>
          <div className="l">Duplications</div>
          <div className="v">{fPct(duplication)}</div>
        </div>
        <div>
          <div className="l">Lines of code</div>
          <div className="v">{fInt(ncloc)}</div>
        </div>
        <div className="pm-ratings">
          <div className="l">Ratings</div>
          <RatingCells ratings={ratings} />
        </div>
      </div>
    </div>
  );
}

/** A project; `inSolution` adds the "in <solution>" hint (a favorite shown on its own). */
export function ProjectCard({ p, inSolution }: { p: ProjectView; inSolution?: { id: string; name: string } | null }) {
  const a = p.analyses[0];
  const href = `/p/${encodeURIComponent(p.key)}`;
  const hint = inSolution ? (
    <Link className="in-sol" href={solutionHref(inSolution.id)} title="Open the solution">
      <Folders aria-hidden />
      in {inSolution.name}
    </Link>
  ) : null;
  if (!a) {
    return (
      <div className="card pcard ghost">
        <Link href={href} className="pcard-main">
          <div className="pcard-hd">
            <span className="avatar">{initials(p.name)}</span>
            <div className="min-w-0 flex-1">
              <div className="nm">{p.name}</div>
              <div className="key">{p.key}</div>
            </div>
            <span className="flex flex-col items-end gap-1">
              <StatusBadge status="no-data" label="No analysis" />
            </span>
          </div>
          {p.folderState === "missing" ? (
            <Empty icon={TriangleAlert} title="Folder not reachable">
              <code>{p.folder}</code> was moved, deleted or is not mounted.
            </Empty>
          ) : (
            <Empty icon={FolderOpen} title="No analyses yet">
              {p.folder ? (
                <>
                  <code>{p.folder}/.qualis</code> has no report.json yet. Run <code>qualis analyze</code> in the project.
                </>
              ) : (
                "Add an analysis with Read analysis."
              )}
            </Empty>
          )}
        </Link>
        {hint && <div className="px-5 pb-3">{hint}</div>}
        <FavButton kind="projects" id={p.key} name={p.name} />
        <div className="pcard-ft">
          <SourceFoot p={p} />
          {p.folder && <span>Re-read on every visit</span>}
        </div>
      </div>
    );
  }
  const trend = [...p.analyses].reverse().map((x) => ({ date: x.finishedAt, value: x.issues, failed: x.gate === "failed" }));
  return (
    <div className="card pcard">
      <Link href={href} className="pcard-main">
        <div className="pcard-hd">
          <span className="avatar">{initials(p.name)}</span>
          <div className="min-w-0 flex-1">
            <div className="nm">{p.name}</div>
            <div className="key">
              {p.key}
              {a.branch && (
                <>
                  {" · "}
                  <GitBranch aria-hidden />
                  {a.branch}
                </>
              )}
              {` · ${fInt(p.analyses.length)} ${p.analyses.length === 1 ? "analysis" : "analyses"}`}
            </div>
          </div>
          <span className="flex flex-col items-end gap-1">
            <StatusBadge status={a.gate} />
            {!p.folder && (
              <Badge>
                <FileUpload aria-hidden />
                Uploaded
              </Badge>
            )}
          </span>
        </div>
        <Metrics coverage={a.coverage} issues={a.issues} duplication={a.duplication} ncloc={a.ncloc} ratings={a.ratings} coverageLabel={`Coverage ${a.coverage}%`} />
      </Link>
      {hint && <div className="-mt-2 px-5 pb-3">{hint}</div>}
      <FavButton kind="projects" id={p.key} name={p.name} />
      {trend.length > 1 && (
        <div className="pcard-trend">
          <div className="label">Issues · {trend.length > 30 ? "latest 30" : `${trend.length}`} analyses</div>
          <TrendChart points={trend} format="int" label={`${p.name} issues`} better="lower" />
        </div>
      )}
      <div className="pcard-ft">
        <SourceFoot p={p} />
        <StaleChip folder={p.folder} branch={a.branch} revision={a.revision} />
        <span className="shrink-0 whitespace-nowrap" title={a.finishedAt}>
          <Clock aria-hidden />
          {fAgo(a.finishedAt)}
        </span>
      </div>
    </div>
  );
}

export function GateSummaryBadge({ gate }: { gate: GateSummary }) {
  if (gate.status === "none")
    return (
      <Badge className="b-nd">
        <CircleMinus aria-hidden />
        No analysis
      </Badge>
    );
  if (gate.status === "failed")
    return (
      <Badge className="b-fail">
        <CircleX aria-hidden />
        {gate.failed.length} of {gate.analysed} failing
      </Badge>
    );
  return (
    <Badge className="b-ok">
      <CircleCheck aria-hidden />
      {gate.analysed === 1 ? "Passed" : `All ${gate.analysed} passed`}
    </Badge>
  );
}

export function SolutionAvatar() {
  return (
    <span className="avatar sol-av" aria-hidden>
      <Folders />
    </span>
  );
}

/** A solution: combined metrics of its projects, the count of their gates, its projects as chips. */
export function SolutionCard({ solution, projects }: { solution: SolutionView; projects: ProjectView[] }) {
  const members = projects.filter((p) => solution.projects.includes(p.key));
  const m = aggregateSolution(members.map(memberOf));
  const status = (p: ProjectView) => (!p.analyses[0] ? "nd" : p.analyses[0].gate === "failed" ? "fail" : "ok");
  const chips = [...members].sort((a, b) => Number(status(b) === "fail") - Number(status(a) === "fail"));
  return (
    // Two sheets behind the card: a solution is a pile of projects.
    <div className="sol-stack">
      <i className="sol-sheet back" aria-hidden />
      <i className="sol-sheet mid" aria-hidden />
      <div className="card pcard sol">
        <Link href={solutionHref(solution.id)} className="pcard-main">
          <div className="pcard-hd">
            <SolutionAvatar />
            <div className="min-w-0 flex-1">
              <div className="nm">{solution.name}</div>
              <div className="key">
                <span>
                  <span className="sol-tag">Solution</span>
                  {` · ${m.projects} ${m.projects === 1 ? "project" : "projects"}`}
                  {m.analysed < m.projects && ` · ${m.projects - m.analysed} not analysed`}
                  {` · ${fInt(m.analyses)} ${m.analyses === 1 ? "analysis" : "analyses"}`}
                </span>
              </div>
            </div>
            <span className="flex flex-col items-end gap-1">
              <GateSummaryBadge gate={m.gate} />
            </span>
          </div>
          {m.gate.failed.length > 0 && (
            <div className="sol-fail">
              <CircleX aria-hidden />
              <span>
                Failing:{" "}
                {m.gate.failed.map((f, i) => (
                  <span key={f.key}>
                    {i > 0 && ", "}
                    <b>{f.name}</b>
                  </span>
                ))}
              </span>
            </div>
          )}
          {m.ratings && (
            <>
              <Metrics coverage={m.coverage} issues={m.issues} duplication={m.duplication} ncloc={m.ncloc} ratings={m.ratings} coverageLabel={`Coverage ${m.coverage?.toFixed(1)}%, weighted by lines to cover`} />
              <div className="pcard-note">
                <Info aria-hidden />
                <span>
                  Ratings: worst of {m.analysed} {m.analysed === 1 ? "project" : "projects"} · coverage and duplications weighted by size
                </span>
              </div>
            </>
          )}
          <div className="members" aria-label={`Projects in ${solution.name}`}>
            {chips.length ? (
              chips.map((p) => (
                <span key={p.key} className="mchip" title={`${p.name} · ${status(p) === "nd" ? "no analysis" : status(p) === "fail" ? "quality gate failed" : "quality gate passed"}`}>
                  <i className={`dot ${status(p)}`} aria-hidden />
                  {p.name}
                  <FavMark projectKey={p.key} />
                </span>
              ))
            ) : (
              <span className="text-xs text-faint">No projects yet</span>
            )}
          </div>
        </Link>
        <FavButton kind="solutions" id={solution.id} name={solution.name} />
        {m.trend && (
          <div className="pcard-trend">
            <div className="label">Issues · all projects</div>
            <TrendChart points={m.trend} format="int" label={`${solution.name} issues, all projects`} better="lower" />
          </div>
        )}
        <div className="pcard-ft">
          {solution.folder ? (
            <FolderFoot folder={solution.folder} />
          ) : (
            <span>
              <Folders aria-hidden />
              Manual solution · no folder
            </span>
          )}
          <SolutionStaleChip members={members} />
          <span className="shrink-0 whitespace-nowrap" title={m.latest ?? undefined}>
            <Clock aria-hidden />
            {m.latest ? fAgo(m.latest) : "Never analysed"}
          </span>
        </div>
      </div>
    </div>
  );
}
