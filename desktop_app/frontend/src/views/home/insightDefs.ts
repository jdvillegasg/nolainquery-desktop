import type { InsightDef } from "./types";

export const INSIGHT_DEFS: InsightDef[] = [
  {
    id: "total_rows",
    label: "Dataset Size",
    getValue: (ins) =>
      ins.total_rows >= 1_000_000
        ? `${(ins.total_rows / 1_000_000).toFixed(1)}M rows`
        : ins.total_rows >= 1_000
        ? `${(ins.total_rows / 1_000).toFixed(1)}K rows`
        : `${ins.total_rows} rows`,
    getColor: (ins) =>
      ins.total_rows >= 100_000 ? "green" : ins.total_rows >= 1_000 ? "amber" : "red",
    getHeadline: (ins) => {
      if (ins.total_rows >= 1_000_000)
        return "This dataset is large enough to support high-confidence business decisions.";
      if (ins.total_rows >= 100_000)
        return "You have enough records to spot reliable trends and meaningful segments.";
      if (ins.total_rows >= 10_000)
        return "The sample is moderate — patterns are visible, but more data would strengthen conclusions.";
      if (ins.total_rows >= 1_000)
        return "This is a small dataset — treat findings as preliminary until you gather more records.";
      return "Very few rows — avoid making major decisions from this sample alone.";
    },
    getPhrase: (ins) => {
      if (ins.total_rows >= 1_000_000)
        return "Enterprise-scale dataset — statistical conclusions carry high confidence.";
      if (ins.total_rows >= 100_000)
        return "Solid dataset size for reliable trend analysis and segmentation.";
      if (ins.total_rows >= 10_000)
        return "Moderate size — patterns are visible but consider expanding data collection.";
      if (ins.total_rows >= 1_000)
        return "Small dataset — validate findings with additional data sources before acting.";
      return "Critically small sample. Decisions based on this data carry significant risk.";
    },
  },
  {
    id: "completeness",
    label: "Data Completeness",
    getValue: (ins) => `${ins.completeness_pct}%`,
    getColor: (ins) =>
      ins.completeness_pct >= 95 ? "green" : ins.completeness_pct >= 80 ? "amber" : "red",
    getHeadline: (ins) => {
      if (ins.completeness_pct >= 99)
        return "Almost every value is present — you can report totals with full confidence.";
      if (ins.completeness_pct >= 95)
        return "The data is largely complete — small gaps are unlikely to change your conclusions.";
      if (ins.completeness_pct >= 80)
        return `${ins.missing_cells.toLocaleString()} values are missing — review gaps before publishing KPIs.`;
      if (ins.completeness_pct >= 60)
        return "Many values are missing — treat KPIs and totals as rough estimates.";
      return "Large portions of this file are empty — fix the data pipeline before relying on it.";
    },
    getPhrase: (ins) => {
      if (ins.completeness_pct >= 99)
        return "Near-perfect data completeness — full confidence in aggregations.";
      if (ins.completeness_pct >= 95)
        return "Highly complete dataset. Minor gaps are unlikely to skew analysis.";
      if (ins.completeness_pct >= 80)
        return `${ins.missing_cells.toLocaleString()} missing values detected — impute or filter before reporting.`;
      if (ins.completeness_pct >= 60)
        return "Significant data gaps. Any KPIs derived from sparse columns must be treated as estimates.";
      return "Critical data quality issue. Over 40% of cells are empty — validate data pipeline immediately.";
    },
  },
  {
    id: "duplicates",
    label: "Duplicate Rows",
    getValue: (ins) => `${ins.duplicate_pct}%`,
    getColor: (ins) =>
      ins.duplicate_pct === 0 ? "green" : ins.duplicate_pct <= 5 ? "amber" : "red",
    getHeadline: (ins) => {
      if (ins.duplicate_pct === 0)
        return "No duplicate rows — your counts and totals are not inflated.";
      if (ins.duplicate_pct <= 1)
        return `${ins.duplicate_rows} duplicate rows found — deduplicate before aggregating KPIs.`;
      if (ins.duplicate_pct <= 5)
        return `${ins.duplicate_rows.toLocaleString()} duplicates may be inflating revenue and customer counts.`;
      if (ins.duplicate_pct <= 20)
        return "Many duplicate rows — totals and averages in this file are unreliable.";
      return "Heavy duplication — do not use this file for decision-making until it is cleaned.";
    },
    getPhrase: (ins) => {
      if (ins.duplicate_pct === 0)
        return "Zero duplicate records — data integrity is confirmed.";
      if (ins.duplicate_pct <= 1)
        return `${ins.duplicate_rows} duplicate rows found. Low impact, but deduplicate before KPI aggregation.`;
      if (ins.duplicate_pct <= 5)
        return `${ins.duplicate_rows.toLocaleString()} duplicates inflate counts and revenue metrics. Deduplicate now.`;
      if (ins.duplicate_pct <= 20)
        return "High duplication rate — totals and averages are unreliable. Data collection process needs review.";
      return "Severe duplication detected. All aggregated figures are likely inflated. Do not use for decisions.";
    },
  },
  {
    id: "high_missing_cols",
    label: "Sparse Columns",
    getValue: (ins) => `${ins.high_missing_cols} of ${ins.total_cols}`,
    getColor: (ins) =>
      ins.high_missing_cols === 0 ? "green" : ins.high_missing_cols <= 2 ? "amber" : "red",
    getHeadline: (ins) => {
      if (ins.high_missing_cols === 0)
        return "Every column is well populated — all fields are usable for analysis.";
      if (ins.high_missing_cols === 1)
        return "One column has many missing values — check it before using it in filters or reports.";
      if (ins.high_missing_cols <= 3)
        return `${ins.high_missing_cols} columns have large gaps — exclude or impute them in key reports.`;
      return `${ins.high_missing_cols} columns are mostly empty — data collection gaps may affect every analysis.`;
    },
    getPhrase: (ins) => {
      if (ins.high_missing_cols === 0)
        return "All columns are well-populated. No dimension is dangerously sparse.";
      if (ins.high_missing_cols === 1)
        return "One column has >20% missing data. Review it before using it as a filter or segment.";
      if (ins.high_missing_cols <= 3)
        return `${ins.high_missing_cols} columns are sparse. Exclude them from key metrics or impute strategically.`;
      return `${ins.high_missing_cols} sparse columns detected. Data collection gaps could affect every dimension of analysis.`;
    },
  },
  {
    id: "numeric_ratio",
    label: "Measurable Columns",
    getValue: (ins) => `${ins.numeric_ratio}%`,
    getColor: (ins) =>
      ins.numeric_ratio >= 40 ? "green" : ins.numeric_ratio >= 20 ? "amber" : "red",
    getHeadline: (ins) => {
      if (ins.numeric_ratio >= 60)
        return "Most columns are numbers — ideal for KPI dashboards and trend charts.";
      if (ins.numeric_ratio >= 40)
        return "Good mix of numbers and categories — supports both totals and breakdowns.";
      if (ins.numeric_ratio >= 20)
        return "Most columns are text or categories — define numeric KPIs carefully.";
      return "Almost no numeric columns — you'll need derived metrics to measure performance.";
    },
    getPhrase: (ins) => {
      if (ins.numeric_ratio >= 60)
        return "Highly quantitative dataset — rich ground for KPI dashboards and trend analysis.";
      if (ins.numeric_ratio >= 40)
        return "Good balance of numeric and categorical data — supports both aggregation and segmentation.";
      if (ins.numeric_ratio >= 20)
        return "Mostly categorical data. Quantitative insights will require aggregation of few numeric columns.";
      return "Nearly all columns are categorical. Define clear numeric KPIs or derive ratios to measure performance.";
    },
  },
  {
    id: "avg_skew",
    label: "Distribution Skew",
    getValue: (ins) => ins.avg_skew.toFixed(2),
    getColor: (ins) =>
      ins.avg_skew <= 1 ? "green" : ins.avg_skew <= 3 ? "amber" : "red",
    getHeadline: (ins) => {
      if (ins.avg_skew <= 0.5)
        return "Your numeric values are evenly distributed — averages represent typical values well.";
      if (ins.avg_skew <= 1)
        return "Numeric values are slightly uneven — averages are still generally reliable.";
      if (ins.avg_skew <= 3)
        return "Outliers are pulling averages up or down — use medians in executive summaries.";
      return "Averages are misleading here — report medians instead of means.";
    },
    getPhrase: (ins) => {
      if (ins.avg_skew <= 0.5)
        return "Numeric distributions are symmetric. Averages accurately represent central tendency.";
      if (ins.avg_skew <= 1)
        return "Mild skew across numeric columns. Means are reliable; review outlier handling.";
      if (ins.avg_skew <= 3)
        return "Moderate skew detected — outliers are pulling averages. Use medians for executive summaries.";
      return "Severe distribution skew. Averages are misleading. Report medians and apply log-transforms for analysis.";
    },
  },
  {
    id: "categorical_diversity",
    label: "Categorical Diversity",
    getValue: (ins) => `${ins.avg_cardinality_ratio}%`,
    getColor: (ins) =>
      ins.avg_cardinality_ratio >= 5 && ins.avg_cardinality_ratio <= 50
        ? "green"
        : ins.avg_cardinality_ratio < 5
        ? "amber"
        : "red",
    getHeadline: (ins) => {
      if (ins.avg_cardinality_ratio > 80)
        return "Some columns look like IDs — avoid using them as report categories.";
      if (ins.avg_cardinality_ratio > 50)
        return "Some categories have too many unique values — group them before segmenting.";
      if (ins.avg_cardinality_ratio >= 5)
        return "Category fields have useful variety — good for segmentation and group analysis.";
      return "Categories have few distinct values — segmentation options will be limited.";
    },
    getPhrase: (ins) => {
      if (ins.avg_cardinality_ratio > 80)
        return "Categories are nearly unique per row — likely ID or free-text fields mistaken as dimensions.";
      if (ins.avg_cardinality_ratio > 50)
        return "High cardinality. Some categorical columns may need bucketing before segmentation.";
      if (ins.avg_cardinality_ratio >= 5)
        return "Healthy categorical diversity — segmentation and groupby analyses will yield meaningful clusters.";
      return "Very low cardinality. Few distinct categories limit the depth of segmentation analysis.";
    },
  },
];
