// Pure geometry and series helpers for the trend charts (no React, so they are unit-tested).

/** Height of the chart's viewBox; the width is always 100. */
export const VH = 40;

export interface TrendGeometry {
  /** Points in viewBox units, oldest first. */
  pts: Array<[number, number]>;
  /** Every value is the same: the chart draws a level line at mid-height, without the area. */
  flat: boolean;
}

/**
 * Places the values in a 100 × VH box. The vertical domain fits the values (min–max plus 15 % padding), so small
 * changes stay visible; a flat series sits at mid-height instead of hugging an edge above a solid block.
 */
export function trendGeometry(values: number[]): TrendGeometry {
  const n = values.length;
  if (!n) return { pts: [], flat: true };
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const lo0 = Math.min(...values);
  const hi0 = Math.max(...values);
  if (hi0 === lo0) return { pts: values.map((_, i) => [x(i), VH / 2]), flat: true };
  const pad = (hi0 - lo0) * 0.15;
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  return { pts: values.map((v, i) => [x(i), 3 + (1 - (v - lo) / (hi - lo)) * (VH - 6)]), flat: false };
}

/**
 * One point per analysis, oldest first, valued with the running total of analyses: analyses on the same day stay
 * separate points instead of collapsing into one.
 */
export function analysesOverTime(dates: string[]): Array<{ date: string; value: number }> {
  return [...dates].sort((a, b) => a.localeCompare(b)).map((date, i) => ({ date, value: i + 1 }));
}
