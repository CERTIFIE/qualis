"use client";

import { AreaTrend, type ChartFormat, type TrendPoint } from "./AreaTrend";

export type { ChartFormat as TrendFormat, TrendPoint };

/**
 * The one entry point for history charts (Issues and Lines of code tiles, the Projects analyses tile and the
 * Activity card): swapping the chart type means changing this component only. It draws a soft area sparkline.
 */
export function TrendChart(props: { points: TrendPoint[]; format: ChartFormat; label: string; better?: "lower" | "higher" | null; big?: boolean }) {
  return <AreaTrend {...props} />;
}
