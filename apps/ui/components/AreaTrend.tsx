"use client";

import { useRef, useState } from "react";
import { smoothPath } from "./smooth";
import { fDate, fDay, fDebt, fInt, fPct } from "@/lib/format";
import { VH, trendGeometry } from "@/lib/trend";

export type ChartFormat = "int" | "pct" | "debt" | "count";
const FORMAT: Record<ChartFormat, (v: number) => string> = {
  int: fInt,
  pct: (v) => fPct(v),
  debt: fDebt,
  count: (v) => `${fInt(v)} ${v === 1 ? "analysis" : "analyses"}`,
};

export interface TrendPoint {
  /** ISO timestamp of the analysis. */
  date: string;
  value: number;
  /** The quality gate of this analysis failed (marked on the large chart). */
  failed?: boolean;
}

/** At most this many points: the latest analyses. */
export const MAX_POINTS = 30;

/** Indices labelled under the large chart: every point when few, otherwise first, last and evenly spaced ones. */
export function labelIndices(n: number, max: number): number[] {
  if (n <= max) return [...Array(n).keys()];
  const out = new Set([0, n - 1]);
  const inner = max - 2;
  for (let k = 1; k <= inner; k++) out.add(Math.round((k * (n - 1)) / (inner + 1)));
  return [...out].sort((a, b) => a - b);
}

/**
 * Soft area sparkline: thin accent line, very light fill, a domain fitted to the values (min–max plus padding) and a
 * light baseline. At rest a dot marks the latest analysis; on hover or focus a cursor, a dot and a read-out show the
 * date, the value and the change from the previous analysis (green when better, red when worse; neutral when
 * `better` is null). Arrow keys, Home and End move between analyses; the values are also listed for screen readers.
 */
export function AreaTrend({ points: all, format, label, better = null, big = false }: { points: TrendPoint[]; format: ChartFormat; label: string; better?: "lower" | "higher" | null; big?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [pin, setPin] = useState<"left" | "right" | null>(null);
  const points = all.slice(-MAX_POINTS);
  const n = points.length;
  if (!n) return null;
  const fmt = FORMAT[format];
  const values = points.map((p) => p.value);
  const { pts, flat } = trendGeometry(values);
  const x = (i: number) => pts[i]![0];
  const line = smoothPath(pts);
  const at = index === null ? null : Math.max(0, Math.min(n - 1, index));
  const last = n - 1;
  const summary =
    n > 1 && flat
      ? `${label}: ${fmt(values[0]!)} in all ${n} analyses, from ${fDay(points[0]!.date)} to ${fDay(points[last]!.date)}. Arrow keys read each analysis.`
      : n === 1
      ? `${label}: one analysis, ${fmt(values[0]!)} on ${fDay(points[0]!.date)}.`
      : `${label}: ${n} analyses, from ${fmt(values[0]!)} on ${fDay(points[0]!.date)} to ${fmt(values[last]!)} on ${fDay(points[last]!.date)}. Arrow keys read each analysis.`;
  const show = (i: number) => {
    setPin(null);
    setIndex(Math.max(0, Math.min(n - 1, i)));
  };
  const pos = (i: number) => ({ left: `${pts[i]![0]}%`, top: `${(pts[i]![1] / VH) * 100}%` });

  let readout = null;
  if (at !== null) {
    const p = points[at]!;
    const d = at > 0 ? p.value - values[at - 1]! : null;
    const tone = !d || !better ? "flat" : (d < 0) === (better === "lower") ? "good" : "bad";
    const deltaText = d === null ? "first analysis shown" : d === 0 ? "±0 vs previous" : `${d > 0 ? "▲ +" : "▼ −"}${fmt(Math.abs(Math.round(d * 10) / 10))} vs previous`;
    const px = pts[at]![0];
    const style = pin === "left" ? { left: 0 } : pin === "right" ? { right: 0 } : px <= 50 ? { left: `calc(${px}% + 10px)` } : { right: `calc(${100 - px}% + 10px)` };
    readout = (
      <div
        ref={(el) => {
          // Narrow charts: when the read-out does not fit beside the point, pin it to the opposite edge.
          if (el && pin === null && plot.current && (el.offsetLeft < 0 || el.offsetLeft + el.offsetWidth > plot.current.clientWidth)) setPin(px <= 50 ? "right" : "left");
        }}
        className="a-tip"
        style={style}
      >
        <b className="tabular">{fmt(p.value)}</b>
        <span>{fDate(p.date)}</span>
        <span className={`dl ${tone}`}>
          {deltaText}
          {p.failed ? " · gate failed" : ""}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={root}
      className={`area${big ? " big" : ""}`}
      tabIndex={0}
      role="img"
      aria-label={summary}
      onPointerMove={(e) => {
        const r = plot.current?.getBoundingClientRect();
        if (r) show(Math.round(((e.clientX - r.left) / r.width) * (n - 1)));
      }}
      onPointerLeave={() => document.activeElement !== root.current && setIndex(null)}
      onFocus={() => show(index ?? last)}
      onBlur={() => setIndex(null)}
      onKeyDown={(e) => {
        const k = e.key;
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(k)) return;
        e.preventDefault();
        const cur = index ?? last;
        show(k === "Home" ? 0 : k === "End" ? last : cur + (k === "ArrowRight" ? 1 : -1));
      }}
    >
      <div ref={plot} className="a-plot">
        {big && (
          <>
            <span className="a-y top">{fmt(Math.max(...values))}</span>
            <span className="a-y bottom">{fmt(Math.min(...values))}</span>
          </>
        )}
        <svg viewBox={`0 0 100 ${VH}`} preserveAspectRatio="none" aria-hidden>
          <line className="a-base" x1={0} x2={100} y1={VH - 0.5} y2={VH - 0.5} vectorEffect="non-scaling-stroke" />
          {n > 1 && (
            <>
              {!flat && <path className="a-fill" d={`${line} L100,${VH} L0,${VH} Z`} />}
              <path className="a-line" d={line} vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
        {points.map((p, i) => (p.failed ? <i key={`f${i}`} className="a-fail" style={pos(i)} title="Quality gate failed" /> : null))}
        {at === null ? <i className="a-dot" style={pos(last)} /> : null}
        {at !== null && (
          <>
            <i className="a-cur" style={{ left: `${pts[at]![0]}%` }} />
            <i className="a-dot on" style={pos(at)} />
          </>
        )}
        {readout}
      </div>
      {big && (
        <div className="a-dates" aria-hidden>
          {labelIndices(n, 8).map((i) => {
            const align = n === 1 ? "c" : i === 0 ? "l" : i === last ? "r" : "c";
            return (
              <span key={i} className={align} style={align === "l" ? { left: 0 } : align === "r" ? { right: 0 } : { left: `${x(i)}%` }}>
                {fDay(points[i]!.date)}
              </span>
            );
          })}
        </div>
      )}
      {n === 1 && <div className="a-hint">Only one analysis so far: the next ones appear here.</div>}
      {n > 1 && flat && <div className="a-hint">No change in {n} analyses</div>}
      <span className="sr-only">{points.map((p) => `${fDay(p.date)}: ${fmt(p.value)}`).join("; ")}</span>
    </div>
  );
}
