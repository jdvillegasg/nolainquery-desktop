import { INPUT_PORT_LABELS, ZERO_INPUT_OPS } from '../../frontend/src/dagGraphUtils';

/** Ops exposed in the DAG editor node library (DAGEditor OP_META keys). */
export const OP_META_OPS = new Set([
  'filter_extract', 'groupby_agg', 'load_constant',
  'add', 'subtract', 'multiply', 'divide',
  'abs', 'round', 'pow', 'sqrt', 'log',
  'percentage_change', 'dot_product',
  'mean', 'sum', 'max', 'min', 'nunique', 'unique', 'mode', 'median', 'std', 'count', 'value_counts',
  'idxmax', 'idxmin',
  'nlargest', 'nsmallest', 'sort_values', 'head', 'tail', 'cumshare', 'shift', 'rolling_mean', 'diff', 'rolling_sum',
  'eq', 'ne', 'gt', 'ge', 'lt', 'le', 'between',
  'logical_and', 'logical_or', 'logical_not',
  'isnan', 'startswith', 'isin', 'contains',
  'to_datetime', 'str', 'index', 'get_index',
  'extract_year', 'extract_month', 'extract_day', 'truncate_to', 'date_add',
  'concat_str', 'fillna', 'dropna', 'lower', 'upper',
  'quantile', 'rank', 'cumsum',
]);

/** All ops that appear in the graph utils port registry. */
export const GRAPH_UTILS_OPS = new Set([
  ...Object.keys(INPUT_PORT_LABELS),
  ...ZERO_INPUT_OPS,
]);

/** Union used as matrix targets — includes utils-only ops so drift is visible. */
export const ALL_TARGET_OPS = [...GRAPH_UTILS_OPS].sort();
