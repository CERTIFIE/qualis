import { fPct } from "@/lib/format";

// The compact visuals of the Technical debt and Coverage tiles.

const LETTERS = ["A", "B", "C", "D", "E"] as const;

/** Square-root scale over 0–100 %: the narrow A and B bands stay readable next to D and E. */
const scale = (ratio: number) => Math.sqrt(Math.min(100, Math.max(0, ratio)) / 100) * 100;

/**
 * The debt ratio on the A–E maintainability bands (default thresholds 5/10/20/50 %): band widths follow the
 * thresholds on a square-root scale, a dark marker shows the current ratio, letters below name the bands.
 */
export function DebtMeter({ ratio, rating, thresholds = [5, 10, 20, 50] }: { ratio: number; rating: string; thresholds?: readonly number[] }) {
  const edges = [0, ...thresholds, 100];
  const bands = LETTERS.map((l, i) => ({ l, from: scale(edges[i]!), to: scale(edges[i + 1]!) }));
  const label = `Debt ratio ${fPct(ratio, 2)}, rating ${rating}. Bands: ${LETTERS.map((l, i) => (i < thresholds.length ? `${l} up to ${thresholds[i]}%` : `${l} above ${thresholds[thresholds.length - 1]}%`)).join(", ")}.`;
  return (
    <div className="meter" role="img" aria-label={label}>
      <div className="m-track bands">
        {bands.map((b) => (
          <i key={b.l} style={{ left: `${b.from}%`, width: `${b.to - b.from}%`, background: `var(--r-${b.l.toLowerCase()})` }} />
        ))}
        <span className="m-mark" style={{ left: `${scale(ratio)}%` }} />
      </div>
      <div className="m-labels">
        {bands.map((b) => (
          <span key={b.l} className={b.l === rating ? "on" : undefined} style={{ left: `${(b.from + b.to) / 2}%` }}>
            {b.l}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Coverage as a progress bar, with a tick at the quality-gate target when the gate has a coverage condition. */
export function CoverageMeter({ coverage, line, branch, target }: { coverage: number; line: number | null; branch: number | null; target: number | null }) {
  const label = `Coverage ${fPct(coverage)}${target !== null ? `, quality-gate target ${target}%` : ""}.`;
  return (
    <div className="meter" role="img" aria-label={label}>
      <div className="m-track">
        <i className="m-fill" style={{ width: `${Math.min(100, Math.max(0, coverage))}%` }} />
        {target !== null && <span className="m-mark" style={{ left: `${Math.min(100, Math.max(0, target))}%` }} />}
      </div>
      <div className="m-ends">
        <span>lines {fPct(line)}</span>
        <span>{target !== null ? `gate ${target}%` : branch !== null ? `branch ${fPct(branch)}` : ""}</span>
      </div>
    </div>
  );
}
