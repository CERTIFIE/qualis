"use client";

import { TrendChart, type TrendFormat as ChartFormat } from "./TrendChart";
import { fDate, fDebt, fInt, fPct } from "@/lib/format";

export interface HistoryPoint {
  id: string;
  finishedAt: string;
  issues: number;
  coverage: number | null;
  debt: number;
  loc: number;
  gate: "passed" | "failed";
}

type Metric = "issues" | "coverage" | "debt" | "loc";

const META: Record<Metric, { label: string; format: ChartFormat; better: "lower" | "higher" | null; fmt: (v: number) => string }> = {
  issues: { label: "Issues", format: "int", better: "lower", fmt: fInt },
  coverage: { label: "Coverage", format: "pct", better: "higher", fmt: (v) => fPct(v) },
  debt: { label: "Technical debt", format: "debt", better: "lower", fmt: fDebt },
  loc: { label: "Lines of code", format: "int", better: null, fmt: fInt },
};

/** The Activity chart: the soft area trend of the chosen metric, failed quality gates marked, with a legend and a table view. */
export function HistoryChart({ points, metric }: { points: HistoryPoint[]; metric: Metric }) {
  const m = META[metric];
  const value = (p: HistoryPoint) => (metric === "coverage" ? p.coverage : p[metric]) ?? 0;
  return (
    <div>
      <TrendChart big label={m.label} format={m.format} better={m.better} points={points.map((p) => ({ date: p.finishedAt, value: value(p), failed: p.gate === "failed" }))} />
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-faint">
        <span className="inline-flex items-center gap-1.5">
          <i className="lg-dot" />
          This analysis
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="lg-dot fail" />
          Quality gate failed
        </span>
      </div>
      <details className="astable">
        <summary>View as table</summary>
        <table className="tabular">
          <tbody>
            {points.map((p) => (
              <tr key={p.id}>
                <td>{fDate(p.finishedAt)}</td>
                <td style={{ color: "var(--fg)" }}>{m.fmt(value(p))}</td>
                <td>{p.gate === "failed" ? "gate failed" : "gate passed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
