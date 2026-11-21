import Link from "next/link";
import type { GateMetric, QualityGateConditionResult, Report } from "@qualis/schema";
import type { ReactNode } from "react";
import { ChevronRight, Code, FlaskConical, GitBranch, Gauge, Hourglass, Layers, Bug, Target, TriangleAlert } from "@/components/icons";
import { HistoryChart, type HistoryPoint } from "./HistoryChart";
import { CoverageMeter, DebtMeter } from "./meters";
import { Badge, CardHeader, Empty, Note, RatingBadge, RatingScale, Ring, Stack, StatusBadge, Tile, cx } from "./ui";
import { debtBandPosition, deltaLabel, worstSeverity } from "@/lib/derive";
import { fDate, fDebt, fInt, fPct, fSeconds } from "@/lib/format";
import { ISSUE_TYPES, LANGUAGE, METRIC, SEVERITIES, SEVERITY_COLOR, SEVERITY_LABEL, TYPE_COLOR, TYPE_COUNT_KEY, TYPE_LABEL, type MetricKind } from "@/lib/vocab";
import { TYPE_ICON, SEVERITY_ICON } from "./ui";

export interface OverviewLinks {
  /** Same page with other search params. */
  self: (patch: Record<string, string | null>) => string;
  issues?: (query: string) => string;
  file?: (path: string, line?: number) => string;
  code?: string;
}

function fmtMetric(v: number | string | null, kind: MetricKind): string {
  if (v === null) return "—";
  if (typeof v === "string") return v;
  if (kind === "pct") return fPct(v);
  if (kind === "debt") return fDebt(v);
  return fInt(v);
}

function thresholdText(c: QualityGateConditionResult): string {
  const kind = METRIC[c.metric as GateMetric].kind;
  if (kind === "rating") return `worse than ${c.threshold}`;
  return c.operator === "gt" ? `fails above ${fmtMetric(c.threshold, kind)}` : `fails below ${fmtMetric(c.threshold, kind)}`;
}

function noDataReason(c: QualityGateConditionResult): string {
  if (c.scope === "new") return "no new code in this analysis";
  if (c.metric.startsWith("test")) return "no test reports";
  if (["coverage", "lineCoverage", "branchCoverage"].includes(c.metric)) return "no coverage report";
  return "no data";
}

const HOTSPOT_TABS = { complexity: "Cyclomatic", cognitiveComplexity: "Cognitive", maintainabilityIndex: "Lowest MI" } as const;
type HotspotTab = keyof typeof HOTSPOT_TABS;
const HISTORY_TABS = { issues: "Issues", coverage: "Coverage", debt: "Technical debt", loc: "Lines of code" } as const;
export type HistoryMetric = keyof typeof HISTORY_TABS;

export function Overview({
  report,
  history,
  scope: scopeParam,
  hotspot: hotspotParam,
  historyMetric: historyParam,
  links,
}: {
  report: Report;
  /** Oldest first; the last point is this report. */
  history: HistoryPoint[];
  scope?: string | undefined;
  hotspot?: string | undefined;
  historyMetric?: string | undefined;
  links: OverviewLinks;
}) {
  const o = report.measures.overall;
  const nc = report.measures.newCode;
  const scope = scopeParam === "new" || scopeParam === "overall" ? scopeParam : nc ? "new" : "overall";
  const isNew = scope === "new";
  const gate = report.qualityGate;
  const counts = { passed: 0, failed: 0, "no-data": 0 };
  for (const c of gate.conditions) counts[c.status]++;
  const newIssues = report.issues.filter((i) => i.isNew);
  const scoped = isNew ? newIssues : report.issues;
  const nq = isNew ? "&new=1" : "";
  const issuesLink = (q: string) => links.issues?.(q);

  const scopeBar = (
    <div className="mb-[18px] flex flex-wrap items-center justify-between gap-3">
      <div className="seg" role="group" aria-label="Scope">
        <Link href={links.self({ scope: "new" })} aria-current={isNew ? "true" : undefined}>
          New code{nc && <span className="count">{fInt(nc.issues.total)}</span>}
        </Link>
        <Link href={links.self({ scope: "overall" })} aria-current={!isNew ? "true" : undefined}>
          Overall code<span className="count">{fInt(o.issues.total)}</span>
        </Link>
      </div>
      <div className="text-[12.5px] text-faint">
        {report.analysis.newCode && nc ? (
          <>
            {fInt(nc.lines)} lines changed since <code className="mono">{report.analysis.newCode.reference}</code> · merge base{" "}
            <code className="mono">{report.analysis.newCode.baseRevision.slice(0, 7)}</code>
          </>
        ) : (
          "No new-code reference: this analysis ran without one (for example on the default branch)."
        )}
      </div>
    </div>
  );

  const gateCard = (
    <div className="card">
      <CardHeader title={`Quality gate · ${gate.name}`} docs={{ href: "/docs/quality-gate", label: "How the quality gate works" }} subtitle="Fails when at least one condition fails; conditions without data do not fail it." action={<StatusBadge status={gate.status} />} />
      <div className="gate-sum">
        {counts.passed > 0 && <StatusBadge status="passed" label={`${counts.passed} passed`} />}
        {counts.failed > 0 && <StatusBadge status="failed" label={`${counts.failed} failed`} />}
        {counts["no-data"] > 0 && <StatusBadge status="no-data" label={`${counts["no-data"]} no data`} />}
      </div>
      <div>
        {gate.conditions.map((c, i) => {
          const meta = METRIC[c.metric as GateMetric];
          return (
            <div key={i} className={cx("cond", c.status)}>
              <div>
                <div className="nm">
                  {meta.label}
                  <span className={cx("scope-tag", c.scope === "new" && "new")}>{c.scope === "new" ? "New code" : "Overall"}</span>
                </div>
                <div className="th">
                  {thresholdText(c)}
                  {c.status === "no-data" && <i> · {noDataReason(c)}</i>}
                </div>
              </div>
              <div className="act">{c.actual === null ? <span className="muted">—</span> : meta.kind === "rating" ? <RatingBadge rating={c.actual as "A"} size="md" /> : fmtMetric(c.actual, meta.kind)}</div>
              <div className="st">
                <StatusBadge status={c.status} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (isNew && !nc) {
    return (
      <>
        {scopeBar}
        <div className="cards split-7-5">
          {gateCard}
          <div className="card grid content-center">
            <Empty icon={GitBranch} title="No new code to measure">
              This analysis has no new-code reference, so there is nothing to compare with. New code is measured on branches and pull requests, against <code>origin/HEAD</code> or{" "}
              <code>newCode.reference</code>; the new-code conditions of the gate report <i>no data</i>.
            </Empty>
            <div className="px-5 pb-6 text-center">
              <Link className="btn primary" href={links.self({ scope: "overall" })}>
                Show overall code
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  const m = isNew && nc ? nc : o;
  const prev = history.length > 1 ? history[history.length - 2] : undefined;
  const series = (key: "issues" | "debt" | "coverage" | "loc") => (history.length ? history.map((h) => ({ date: h.finishedAt, value: Number(h[key] ?? 0) })) : undefined);
  const cov = m.coverage;
  // The quality-gate coverage target of this scope (or of any scope), drawn as a tick on the coverage bar.
  const coverageCondition = gate.conditions.find((c) => c.metric === "coverage" && c.scope === (isNew ? "new" : "overall")) ?? gate.conditions.find((c) => c.metric === "coverage");
  const coverageTarget = typeof coverageCondition?.threshold === "number" ? coverageCondition.threshold : null;
  const coverageDelta = !isNew && o.coverage?.coverage != null ? deltaLabel(o.coverage.coverage, prev?.coverage ?? undefined, false, (v) => `${v.toFixed(1)} pt`) : null;
  const coverageSub = !cov
    ? "no coverage report"
    : coverageTarget !== null || coverageDelta
      ? [coverageTarget !== null ? `target ${coverageTarget}%` : null, coverageDelta?.text].filter(Boolean).join(" · ")
      : `line ${fPct(cov.lineCoverage)} · branch ${fPct(cov.branchCoverage)}`;

  const tiles = (
    <div className="cards g4">
      <Tile
        icon={Bug}
        label={isNew ? "New issues" : "Issues"}
        value={fInt(m.issues.total)}
        sub={`${fInt(m.issues.bugs + m.issues.vulnerabilities)} bugs and vulnerabilities`}
        {...(links.issues ? { href: links.issues(isNew ? "new=1" : "") } : {})}
        {...(!isNew ? { delta: deltaLabel(o.issues.total, prev?.issues, true, fInt), trend: series("issues"), trendFormat: "int" as const, better: "lower" as const } : {})}
      />
      <Tile
        icon={Hourglass}
        label="Technical debt"
        value={fDebt(m.technicalDebtMinutes)}
        sub={`${fPct(m.debtRatio, 2)} debt ratio`}
        {...(links.issues ? { href: links.issues(`type=code-smell${nq}`) } : {})}
        visual={<DebtMeter ratio={m.debtRatio} rating={m.ratings.maintainability} />}
        {...(!isNew ? { delta: deltaLabel(o.technicalDebtMinutes, prev?.debt, true, fDebt) } : {})}
      />
      <Tile
        icon={Target}
        label={isNew ? "Coverage on new code" : "Coverage"}
        value={
          cov?.coverage != null ? (
            <>
              {cov.coverage.toFixed(1)}
              <small>%</small>
            </>
          ) : (
            "—"
          )
        }
        sub={coverageSub}
        {...(cov?.coverage != null ? { visual: <CoverageMeter coverage={cov.coverage} line={cov.lineCoverage} branch={cov.branchCoverage} target={coverageTarget} /> } : {})}
      />
      {isNew && nc ? (
        <Tile icon={GitBranch} label="New lines" value={fInt(nc.lines)} sub={`${fInt(nc.ncloc)} lines of code`} />
      ) : (
        <Tile
          icon={Code}
          label="Lines of code"
          value={fInt(o.ncloc)}
          sub={`${fInt(o.files)} files · ${fInt(o.functions)} functions`}
          {...(links.code ? { href: links.code } : {})}
          delta={deltaLabel(o.ncloc, prev?.loc, false, fInt)}
          {...(series("loc") ? { trend: series("loc"), trendFormat: "int" as const } : {})}
        />
      )}
    </div>
  );

  const rel = m.ratings.reliability;
  const sec = m.ratings.security;
  const mai = m.ratings.maintainability;
  const maybeLink = (q: string, text: string) => {
    const href = issuesLink(q);
    return href ? (
      <Link className="link" href={href}>
        {text}
      </Link>
    ) : (
      text
    );
  };
  const worstBug = worstSeverity(scoped, "bug");
  const ratingRow = (label: string, r: typeof rel, desc: ReactNode) => (
    <div className="rrow">
      <RatingBadge rating={r} size="lg" />
      <div className="min-w-0">
        <div className="lbl">{label}</div>
        <div className="d">{desc}</div>
      </div>
      <RatingScale rating={r} />
    </div>
  );
  const ratingsCard = (
    <div className="card">
      <CardHeader title="Ratings" subtitle="A is best, E is worst" docs={{ href: "/docs/ratings", label: "How the ratings are computed" }} />
      {ratingRow(
        "Reliability",
        rel,
        <>
          {maybeLink(`type=bug${nq}`, `${fInt(m.issues.bugs)} bugs`)} · worst {worstBug ? SEVERITY_LABEL[worstBug].toLowerCase() : "none"}
        </>,
      )}
      {ratingRow(
        "Security",
        sec,
        <>
          {maybeLink(`type=vulnerability${nq}`, `${fInt(m.issues.vulnerabilities)} vulnerabilities`)} · {maybeLink(`type=security-hotspot${nq}`, `${fInt(m.issues.securityHotspots)} hotspots`)} to review
        </>,
      )}
      {ratingRow(
        "Maintainability",
        mai,
        <>
          {maybeLink(`type=code-smell${nq}`, `${fInt(m.issues.codeSmells)} code smells`)} · debt ratio {fPct(m.debtRatio, 2)}
        </>,
      )}
      <div className="p-4">
        <Note>Security hotspots need a manual review; they are counted but do not lower the security rating.</Note>
      </div>
    </div>
  );

  const notInReports = report.files.filter((f) => f.coverage?.notInReports).length;
  const covCard = (
    <div className="card">
      <CardHeader
        title={isNew ? "Coverage on new code" : "Coverage"}
        docs={{ href: "/docs/coverage-and-tests#coverage", label: "How coverage is measured" }}
        subtitle={isNew ? "New lines the coverage reports know about" : report.coverageReports.length ? `${report.coverageReports.length} coverage report${report.coverageReports.length === 1 ? "" : "s"}` : "No coverage report"}
      />
      <div className="card-bd">
        {cov && cov.coverage !== null ? (
          <>
            <div className="health-cov flex items-center gap-6">
              <Ring pct={cov.coverage} center={<><b>{cov.coverage.toFixed(1)}%</b><small>combined</small></>} label={`Coverage ${cov.coverage}%`} />
              <div className="grid w-full min-w-0 flex-1 gap-3.5">
                <CoverageBar label="Line coverage" pct={cov.lineCoverage} detail={`${fInt(cov.coveredLines)} of ${fInt(cov.linesToCover)} lines · ${fInt(cov.uncoveredLines)} uncovered`} />
                <CoverageBar label="Branch coverage" pct={cov.branchCoverage} detail={cov.conditionsToCover ? `${fInt(cov.coveredConditions)} of ${fInt(cov.conditionsToCover)} conditions` : "no branch data"} />
              </div>
            </div>
            {!isNew && notInReports > 0 && (
              <div className="mt-4">
                <Note warn icon={TriangleAlert}>
                  <b>{notInReports} files</b> are not in any coverage report and count as not covered (<code>coverage.missingFiles</code>).
                </Note>
              </div>
            )}
          </>
        ) : (
          <Empty icon={Target} title="No coverage report">
            Add <code>coverage.reports</code> (LCOV, Cobertura or OpenCover) or <code>--coverage</code> to the analysis.
          </Empty>
        )}
      </div>
    </div>
  );

  const dupDensity = isNew && nc ? nc.duplicatedLinesDensity : o.duplication.duplicatedLinesDensity;
  const dupLines = isNew && nc ? nc.duplicatedLines : o.duplication.duplicatedLines;
  const dupCard = (
    <div className="card">
      <CardHeader title="Duplications" docs={{ href: "/docs/duplications", label: "How duplications are detected" }} subtitle={isNew ? "New lines in duplicated blocks" : "Duplicated lines over all lines"} />
      <div className="card-bd grid justify-items-center gap-3 text-center">
        <Ring pct={dupDensity} size={108} stroke={7} color="var(--dup)" center={<><b>{dupDensity.toFixed(1)}%</b><small>duplicated</small></>} label={`Duplicated lines ${dupDensity}%`} />
        <div className="text-[13px] text-muted">
          {fInt(dupLines)} lines{!isNew && ` · ${fInt(o.duplication.duplicatedBlocks)} blocks · ${fInt(o.duplication.duplicatedFiles)} files`}
        </div>
        {dupLines === 0 ? <StatusBadge status="passed" label="No duplicated blocks" /> : null}
      </div>
    </div>
  );

  const debtCard = (
    <div className="card">
      <CardHeader title="Technical debt" subtitle="Remediation effort of the code smells" docs={{ href: "/docs/ratings#technical-debt", label: "How technical debt is estimated" }} />
      <div className="card-bd">
        <div className="big-num">{fDebt(m.technicalDebtMinutes)}</div>
        <div className="mt-1 text-[12.5px] text-faint">
          {fInt(m.technicalDebtMinutes)} min over {fInt(m.ncloc)} lines of code
        </div>
        <div className="mt-4 flex items-center justify-between text-[13px]">
          <span>Debt ratio</span>
          <b className="tabular inline-flex items-center gap-1.5 font-medium">
            {fPct(m.debtRatio, 2)} → <RatingBadge rating={mai} />
          </b>
        </div>
        <DebtBands ratio={m.debtRatio} />
      </div>
    </div>
  );

  const tests = report.measures.overall.tests;
  const testsCard = (
    <div className="card">
      <CardHeader title="Tests" subtitle="JUnit XML or TRX reports" docs={{ href: "/docs/coverage-and-tests#tests", label: "How test reports are read" }} action={tests ? <StatusBadge status={tests.failed + tests.errors > 0 ? "failed" : "passed"} label={tests.failed + tests.errors > 0 ? `${tests.failed + tests.errors} failing` : "All passing"} /> : <StatusBadge status="no-data" />} />
      {tests ? (
        <div className="card-bd">
          <div className="grid grid-cols-3 gap-3.5">
            <div className="mstat"><div className="l">Tests</div><div className="v">{fInt(tests.total)}</div><div className="s">{fSeconds(tests.durationMs)}</div></div>
            <div className="mstat"><div className="l">Success</div><div className="v">{fPct(tests.successDensity)}</div><div className="s">{fInt(tests.passed)} passed</div></div>
            <div className="mstat"><div className="l">Failed</div><div className="v">{fInt(tests.failed + tests.errors)}</div><div className="s">{fInt(tests.skipped)} skipped</div></div>
          </div>
          <div className="mt-4">
            <Stack
              label="Tests by result"
              total={tests.total}
              rows={[
                { key: "passed", label: "Passed", text: "Passed", value: tests.passed, color: "#8aa83a" },
                { key: "failed", label: "Failed", text: "Failed", value: tests.failed, color: "#a32d2d" },
                { key: "errors", label: "Errors", text: "Errors", value: tests.errors, color: "#d08040" },
                { key: "skipped", label: "Skipped", text: "Skipped", value: tests.skipped, color: "#dcdad2" },
              ]}
            />
          </div>
        </div>
      ) : (
        <Empty icon={FlaskConical} title="No test reports in this analysis">
          Qualis reads the reports your test runner produces. Add <code>tests.reports</code> or <code>--tests &quot;**/junit.xml&quot;</code> to see totals, failures and durations. <i>Test failures</i> reports no data until
          then.
        </Empty>
      )}
    </div>
  );

  const effort = scoped.reduce((a, i) => a + i.effortMinutes, 0);
  const allIssuesHref = issuesLink(isNew ? "new=1" : "");
  const issuesCard = (
    <div className="card">
      <CardHeader
        title={isNew ? "Issues on new code" : "Issues"}
        subtitle={`${fInt(m.issues.total)} issues · ${fDebt(effort)} estimated effort`}
        action={
          allIssuesHref && (
            <Link className="btn sm" href={allIssuesHref}>
              Open issues <ChevronRight aria-hidden />
            </Link>
          )
        }
      />
      <div className="card-bd grid gap-7 md:grid-cols-2">
        <div>
          <div className="sec-label">By type</div>
          <Stack
            label="Issues by type"
            total={m.issues.total}
            rows={ISSUE_TYPES.map((t) => {
              const Icon = TYPE_ICON[t];
              return { key: t, label: <><Icon aria-hidden strokeWidth={1.75} className={`ty-${t}`} />{TYPE_LABEL[t].plural}</>, text: TYPE_LABEL[t].plural, value: m.issues[TYPE_COUNT_KEY[t]], color: TYPE_COLOR[t] };
            })}
          />
        </div>
        <div>
          <div className="sec-label">By severity</div>
          <Stack
            label="Issues by severity"
            total={m.issues.total}
            rows={SEVERITIES.map((s) => {
              const Icon = SEVERITY_ICON[s];
              return { key: s, label: <><Icon aria-hidden strokeWidth={1.75} className={`sev-${s}`} />{SEVERITY_LABEL[s]}</>, text: SEVERITY_LABEL[s], value: m.issues[s], color: SEVERITY_COLOR[s] };
            })}
          />
        </div>
      </div>
    </div>
  );

  const fs = o.functionStats;
  const cd = fs.complexityDistribution;
  const md = fs.maintainabilityDistribution;
  const complexityCard = (
    <div className="card">
      <CardHeader title="Size and complexity" docs={{ href: "/docs/metrics", label: "How the metrics are computed" }} subtitle={isNew ? "Overall code" : `${fInt(o.files)} files · ${fInt(o.functions)} functions · ${fInt(o.classes)} classes`} />
      <div className="card-bd">
        <div className="mb-[22px] grid grid-cols-3 gap-3.5">
          <div className="mstat"><div className="l">Lines of code</div><div className="v">{fInt(o.ncloc)}</div><div className="s">{fPct(o.commentLinesDensity)} comments</div></div>
          <div className="mstat"><div className="l">Cyclomatic</div><div className="v">{fInt(o.complexity)}</div><div className="s">{o.complexityDensity} / 1k LOC · avg {fs.averageComplexity}</div></div>
          <div className="mstat"><div className="l">Cognitive</div><div className="v">{fInt(o.cognitiveComplexity)}</div><div className="s">max {fs.maxCognitiveComplexity} in one function</div></div>
        </div>
        <div className="grid gap-7 md:grid-cols-2">
          <div>
            <div className="sec-label">Functions by complexity</div>
            <Stack
              label="Functions by cyclomatic complexity"
              total={fs.count}
              rows={[
                { key: "low", label: <>Low <span className="muted">1–10</span></>, text: "Low", value: cd.low, color: "#8aa83a" },
                { key: "moderate", label: <>Moderate <span className="muted">11–20</span></>, text: "Moderate", value: cd.moderate, color: "#d9b04a" },
                { key: "high", label: <>High <span className="muted">21–50</span></>, text: "High", value: cd.high, color: "#d08040" },
                { key: "veryHigh", label: <>Very high <span className="muted">&gt;50</span></>, text: "Very high", value: cd.veryHigh, color: "#a32d2d" },
              ]}
            />
          </div>
          <div>
            <div className="sec-label">Maintainability index{fs.averageMaintainabilityIndex !== null && ` · avg ${fs.averageMaintainabilityIndex}`}</div>
            {md ? (
              <Stack
                label="Functions by maintainability index"
                total={fs.count}
                rows={[
                  { key: "high", label: <>High <span className="muted">20–100</span></>, text: "High", value: md.high, color: "#8aa83a" },
                  { key: "moderate", label: <>Moderate <span className="muted">10–19</span></>, text: "Moderate", value: md.moderate, color: "#d9b04a" },
                  { key: "low", label: <>Low <span className="muted">0–9</span></>, text: "Low", value: md.low, color: "#a32d2d" },
                ]}
              />
            ) : (
              <Empty icon={Gauge} title="No Halstead data">No plugin provided Halstead counts.</Empty>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const hsTab: HotspotTab = hotspotParam && hotspotParam in HOTSPOT_TABS ? (hotspotParam as HotspotTab) : "complexity";
  const hsList = o.hotspots[hsTab];
  const hsMax = Math.max(1, ...hsList.map((h) => h.value));
  const hotspotsCard = (
    <div className="card">
      <CardHeader
        title="Hotspots"
        docs={{ href: "/docs/metrics#hotspots", label: "How hotspots are ranked" }}
        subtitle="Functions to look at first"
        action={
          <div className="seg" role="group" aria-label="Hotspot metric">
            {(Object.keys(HOTSPOT_TABS) as HotspotTab[]).map((k) => (
              <Link key={k} href={links.self({ hs: k })} aria-current={k === hsTab ? "true" : undefined} scroll={false}>
                {HOTSPOT_TABS[k]}
              </Link>
            ))}
          </div>
        }
      />
      {hsList.length ? (
        <ul className="hs">
          {hsList.map((h, i) => {
            const body = (
              <>
                <span className="rank">{i + 1}</span>
                <div className="min-w-0">
                  <div className="fn">{h.name}</div>
                  <div className="pth" title={h.path}>
                    <bdi>
                      {h.path}:{h.startLine}
                    </bdi>
                  </div>
                </div>
                <div className="val">
                  <span className="bar">
                    <i style={{ width: `${hsTab === "maintainabilityIndex" ? h.value : (h.value / hsMax) * 100}%` }} />
                  </span>
                  {h.value}
                </div>
              </>
            );
            return <li key={`${h.path}:${h.startLine}:${i}`}>{links.file ? <Link href={links.file(h.path, h.startLine)}>{body}</Link> : <a>{body}</a>}</li>;
          })}
        </ul>
      ) : (
        <Empty icon={Gauge} title="No function data">No plugin reported per-function measures.</Empty>
      )}
    </div>
  );

  const hm: HistoryMetric = historyParam && historyParam in HISTORY_TABS ? (historyParam as HistoryMetric) : "issues";
  const historyCard = (
    <div className="card">
      <CardHeader
        title="Activity"
        subtitle={history.length > 1 ? `Last ${Math.min(history.length, 30)} analyses; the dot marks this one` : "Analyses of this project over time"}
        action={
          history.length > 0 && (
            <div className="seg" role="group" aria-label="History metric">
              {(Object.keys(HISTORY_TABS) as HistoryMetric[]).map((k) => (
                <Link key={k} href={links.self({ hm: k })} aria-current={k === hm ? "true" : undefined} scroll={false}>
                  {HISTORY_TABS[k]}
                </Link>
              ))}
            </div>
          )
        }
      />
      <div className="card-bd">
        {history.length > 0 ? (
          <HistoryChart points={history} metric={hm} />
        ) : (
          <Empty icon={Gauge} title="One analysis so far">
            The history chart appears with the second report of this project. Every <code>report.json</code> in the project folder is one point.
          </Empty>
        )}
      </div>
    </div>
  );

  const langs = new Map<string, { ncloc: number; files: number }>();
  for (const f of report.files) {
    if (f.test) continue; // test code is shown on its own line
    const l = langs.get(f.language) ?? { ncloc: 0, files: 0 };
    l.ncloc += f.measures.ncloc;
    l.files++;
    langs.set(f.language, l);
  }
  const diags = report.diagnostics;
  const infoCard = (
    <div className="card">
      <CardHeader title="Analysis" subtitle={<span className="mono text-[11.5px]">{report.analysis.id}</span>} />
      <div className="card-bd">
        <div className="sec-label">Languages · lines of code</div>
        <Stack
          label="Lines of code by language"
          total={o.ncloc}
          rows={[...langs.entries()]
            .sort((a, b) => b[1].ncloc - a[1].ncloc)
            .map(([k, v]) => ({ key: k, label: <>{LANGUAGE[k]?.name ?? k} <span className="muted">{v.files} files</span></>, text: LANGUAGE[k]?.name ?? k, value: v.ncloc, color: LANGUAGE[k]?.color ?? "#b9b7ad" }))}
        />
        <dl className="kv mt-4">
          {o.testCode && o.testCode.files > 0 && (
            <div>
              <dt>Test code</dt>
              <dd>
                {fInt(o.testCode.ncloc)} lines of code · {fInt(o.testCode.files)} files{" "}
                <span className="text-xs text-faint">not in the measures above</span>
              </dd>
            </div>
          )}
          <div>
            <dt>Plugins</dt>
            <dd className="flex flex-wrap gap-1.5">
              {report.tool.plugins.map((p) => (
                <span key={p.id} className="chip" title={`${p.kind} · ${p.transport}`}>
                  {p.name} <span className="muted">{p.version}</span>
                </span>
              ))}
            </dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>
              {fDate(report.analysis.startedAt)} · {fSeconds(report.analysis.durationMs)}
            </dd>
          </div>
          <div>
            <dt>Report schema</dt>
            <dd>
              {report.schemaVersion} · Qualis {report.tool.version}
            </dd>
          </div>
          <div>
            <dt>Diagnostics</dt>
            <dd>
              {diags.length ? (
                <details>
                  <summary className="inline-flex cursor-pointer flex-wrap items-center gap-1.5">
                    <Badge className="b-warn">
                      <TriangleAlert aria-hidden strokeWidth={1.75} />
                      {diags.length} {diags.length === 1 ? "message" : "messages"}
                    </Badge>
                    <span className="text-xs text-faint">from {[...new Set(diags.map((d) => d.source))].join(", ")}</span>
                  </summary>
                  <ul className="mt-2 list-disc pl-[18px] text-xs text-muted">
                    {diags.slice(0, 8).map((d, i) => (
                      <li key={i} className="mb-1">
                        {d.message}
                      </li>
                    ))}
                    {diags.length > 8 && <li className="text-faint">…and {diags.length - 8} more</li>}
                  </ul>
                </details>
              ) : (
                <span className="text-faint">None</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );

  return (
    <>
      {scopeBar}
      {tiles}
      <div className="cards split-7-5 mt">
        {gateCard}
        {ratingsCard}
      </div>
      <div className="cards split-2-1-1 mt">
        {covCard}
        {dupCard}
        {debtCard}
      </div>
      <div className="cards split-7-5 mt">
        {issuesCard}
        {testsCard}
      </div>
      <div className="cards g2 mt">
        {complexityCard}
        {hotspotsCard}
      </div>
      <div className="cards split-7-5 mt">
        {historyCard}
        {infoCard}
      </div>
    </>
  );
}

function CoverageBar({ label, pct, detail }: { label: string; pct: number | null; detail: string }) {
  return (
    <div>
      <div className="flex justify-between text-[13px]">
        <span>{label}</span>
        <b className="tabular font-medium">{fPct(pct)}</b>
      </div>
      <div className="bar mt-1.5">
        <i style={{ width: `${pct ?? 0}%` }} />
      </div>
      <div className="tabular mt-1 text-xs text-faint">{detail}</div>
    </div>
  );
}

function DebtBands({ ratio }: { ratio: number }) {
  const pos = debtBandPosition(ratio);
  return (
    <div className="relative mt-3.5" role="img" aria-label={`Debt ratio ${ratio}% on the A to E bands`}>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[3px]">
        {(["a", "b", "c", "d", "e"] as const).map((l) => (
          <i key={l} className="flex-1" style={{ background: `var(--r-${l})`, opacity: 0.85 }} />
        ))}
      </div>
      <span className="absolute -top-1 h-[18px] w-1 rounded-sm bg-fg" style={{ left: `calc(${pos}% - 2px)`, boxShadow: "0 0 0 2px #fff" }} />
      <div className="mt-1.5 flex text-[10.5px] text-faint">
        {["A ≤5%", "B ≤10%", "C ≤20%", "D ≤50%", "E"].map((l) => (
          <span key={l} className="mono flex-1 text-center">
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

