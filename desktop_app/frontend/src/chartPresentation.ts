import type { VisualizationSpec } from "./DAGEditor";

export interface ChartPresentation {
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
}

export function humanizeFieldName(name: string): string {
  const cleaned = name.trim().replace(/[_-]+/g, " ");
  if (!cleaned) return "Value";
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function resolveChartPresentation(spec: VisualizationSpec): ChartPresentation {
  const primaryY = spec.y[0] ?? "Value";
  return {
    title: spec.title.trim() || "Chart",
    xAxisLabel: spec.x_label?.trim() || humanizeFieldName(spec.x),
    yAxisLabel: spec.y_label?.trim() || humanizeFieldName(primaryY),
  };
}

export const RECHARTS_X_AXIS_LABEL = {
  position: "insideBottom" as const,
  offset: -4,
};

export const RECHARTS_Y_AXIS_LABEL = {
  angle: -90,
  position: "insideLeft" as const,
};

export function rechartsXAxisLabel(label: string) {
  return { value: label, ...RECHARTS_X_AXIS_LABEL };
}

export function rechartsYAxisLabel(label: string) {
  return { value: label, ...RECHARTS_Y_AXIS_LABEL };
}

export function resolveColumnPresentation(columnName: string): ChartPresentation {
  const label = humanizeFieldName(columnName);
  return {
    title: label,
    xAxisLabel: label,
    yAxisLabel: "Value",
  };
}
