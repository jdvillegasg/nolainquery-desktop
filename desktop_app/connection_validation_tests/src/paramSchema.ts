/**
 * Connectable param widgets mirrored from DAGEditor.tsx PARAM_SCHEMA.
 * Only widget kinds matter for validateConnection — not Zod schemas.
 */
export const PARAM_SCHEMA: Record<string, Record<string, { widget: string }>> = {
  filter_extract: {
    column: { widget: 'source_column' },
    condition: { widget: 'condition' },
  },
  groupby_agg: {
    groupby_column: { widget: 'source_column' },
    groupby_columns: { widget: 'column_or_node_list' },
    agg_column: { widget: 'column_or_node' },
    agg_function: { widget: 'agg_function' },
  },
  load_constant: {
    value: { widget: 'literal_scalar' },
  },
  index: {
    indices: { widget: 'node_id' },
  },
};
