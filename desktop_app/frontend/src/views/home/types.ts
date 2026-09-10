export interface PreviewData {
  columns: string[];
  rows: Record<string, unknown>[];
  total_rows: number;
  sampled_rows: number;
  is_sampled: boolean;
  page: number;
  page_size: number;
}

export interface InsightsData {
  total_rows: number;
  total_cols: number;
  completeness_pct: number;
  missing_cells: number;
  duplicate_rows: number;
  duplicate_pct: number;
  num_numeric_cols: number;
  num_categorical_cols: number;
  avg_cardinality_ratio: number;
  avg_skew: number;
  high_missing_cols: number;
  numeric_ratio: number;
}

export type InsightColor = "green" | "amber" | "red";

export interface InsightDef {
  id: string;
  label: string;
  getValue: (ins: InsightsData) => string;
  getColor: (ins: InsightsData) => InsightColor;
  getHeadline: (ins: InsightsData) => string;
  getPhrase: (ins: InsightsData) => string;
}
