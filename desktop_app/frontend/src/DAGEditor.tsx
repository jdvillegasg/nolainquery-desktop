import { useState, useEffect, useCallback, useRef, useMemo, type ButtonHTMLAttributes, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EXAMPLE_DAGS } from './exampleDags';
import { canPinKind, pinnedKindLabel } from './pinnedArtifacts';
import type { CanvasManifest } from './canvasManifest';
import { slotForKind } from './canvasManifest';
import {
  ReactFlow,
  Controls,
  Background,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Position,
  Handle,
  NodeProps,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './DAGEditor.css';
import './views/query/QueryTheme.css';
import './views/query/QueryView.css';
import { Pin } from 'lucide-react';
import dagre from 'dagre';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { AnswerPayload } from './answerComposer';
import { SIDECAR_API, sidecarFetch } from './lib/cloudApi';
import {
  fetchSandboxEnvironment,
  type SandboxEnvironmentSpec,
  FALLBACK_SANDBOX_ENVIRONMENT,
} from './lib/sandboxEnvironment';
import VisualizationView from './VisualizationView';
import {
  humanizeFieldName,
  rechartsXAxisLabel,
  rechartsYAxisLabel,
} from './chartPresentation';
import { ModelSelect } from './components/ModelSelect';
import { ComputationGraphToggle } from './views/query/ComputationGraphToggle';

/** Token / LLM timing captured for one generation turn. */
export interface QueryUsage {
  inputTokens: number;
  outputTokens: number;
  /** Total LLM time in seconds when reported by the generation job. */
  llmTimeSec: number;
}
import { buildAnswerProse, translateError } from './answerComposer';
import { parsePythonSteps, stripImportLines } from './pythonNotebook';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { z } from 'zod';
import {
  getInputPortCount,
  getInputPortLabel,
  getConnectableParams,
  validateConnection,
  syncNodesFromEdges,
  graphStateFromFlow,
} from './dagGraphUtils';

// ── Operations Registry (frontend mirror) ─────────────────────────────────────
// Human-readable labels and descriptions for each operation in the registry.
const OP_META: Record<string, { label: string; icon: string; summary: string; example: string; category: string; params: string[]; required_params: string[] }> = {
  filter_extract:      { label: 'Read Column', icon: '📥', summary: 'Reads a column from the source table, optionally filtered by a condition.', example: 'Read "Revenue" where Country == "UK"', category: 'extraction', params: ['column', 'condition'], required_params: ['column'] },
  groupby_agg:         { label: 'Group & Aggregate', icon: '🗂️', summary: 'Groups rows by one or more columns and aggregates a value per group (sum, mean, count…).', example: 'Sum of Revenue grouped by Month', category: 'extraction', params: ['groupby_column', 'groupby_columns', 'agg_column', 'agg_function'], required_params: ['agg_column', 'agg_function'] },
  load_constant:       { label: 'Constant Value', icon: '🔢', summary: 'Adds a fixed number or text value for use in calculations.', example: 'Tax rate: 0.08', category: 'extraction', params: ['value'], required_params: ['value'] },
  add:                 { label: 'Add', icon: '➕', summary: 'Adds two values or columns together, row by row.', example: 'Revenue + Tax', category: 'arithmetic', params: [], required_params: [] },
  subtract:            { label: 'Subtract', icon: '➖', summary: 'Subtracts the second value from the first, row by row.', example: 'Price - Discount', category: 'arithmetic', params: [], required_params: [] },
  multiply:            { label: 'Multiply', icon: '✖️', summary: 'Multiplies two values or columns together, row by row.', example: 'Quantity × Price = Revenue', category: 'arithmetic', params: [], required_params: [] },
  divide:              { label: 'Divide', icon: '➗', summary: 'Divides the first value by the second, row by row.', example: 'Revenue / Units', category: 'arithmetic', params: [], required_params: [] },
  abs:                 { label: 'Absolute Value', icon: '📐', summary: 'Returns the absolute (non-negative) value of each value.', example: 'Size of a loss, ignoring the minus sign', category: 'math', params: [], required_params: [] },
  round:              { label: 'Round', icon: '🔵', summary: 'Rounds each value to a fixed number of decimal places.', example: 'Round to 2 decimals', category: 'math', params: ['decimals'], required_params: [] },
  pow:                 { label: 'Power', icon: '⚡', summary: 'Raises each value to a power (e.g. squared, cubed).', example: 'Compounding: (1 + rate) ^ years', category: 'math', params: [], required_params: [] },
  sqrt:                { label: 'Square Root', icon: '√', summary: 'Returns the square root of each value.', example: 'Standard deviation = square root of variance', category: 'math', params: [], required_params: [] },
  log:                 { label: 'Natural Log', icon: '📉', summary: 'Natural logarithm (base e) of each value.', example: 'Log-transform revenue to reduce the effect of outliers', category: 'math', params: [], required_params: [] },
  percentage_change:   { label: 'Growth Rate', icon: '📈', summary: 'Percent change from old to new: (new − old) / old. First input is OLD, second is NEW.', example: 'MoM revenue growth', category: 'statistical', params: [], required_params: [] },
  dot_product:         { label: 'Weighted Sum', icon: '·', summary: 'Weighted sum of two columns (dot product).', example: 'Total score = weights · ratings', category: 'statistical', params: [], required_params: [] },
  mean:                { label: 'Average', icon: '📊', summary: 'Average of all values in the column.', example: 'Average price', category: 'aggregation', params: [], required_params: [] },
  sum:                 { label: 'Sum', icon: 'Σ', summary: 'Sum of all values in the column.', example: 'Total revenue', category: 'aggregation', params: [], required_params: [] },
  max:                 { label: 'Maximum', icon: '⬆️', summary: 'Largest value in the column.', example: 'Max order value', category: 'aggregation', params: [], required_params: [] },
  min:                 { label: 'Minimum', icon: '⬇️', summary: 'Smallest value in the column.', example: 'Min price', category: 'aggregation', params: [], required_params: [] },
  nunique:             { label: 'Count Distinct', icon: '#', summary: 'Number of distinct values in the column.', example: 'How many unique customers?', category: 'aggregation', params: [], required_params: [] },
  unique:              { label: 'Distinct Values', icon: '🔍', summary: 'The actual distinct values in the column (the values themselves, not their count).', example: 'List of unique countries', category: 'aggregation', params: [], required_params: [] },
  mode:                { label: 'Most Frequent', icon: '🔝', summary: 'The most common value in a numeric column.', example: 'Most common order size', category: 'aggregation', params: [], required_params: [] },
  median:              { label: 'Median', icon: '〰️', summary: 'Middle value of the sorted distribution.', example: 'Median salary', category: 'aggregation', params: [], required_params: [] },
  std:                 { label: 'Standard Deviation', icon: '📏', summary: 'Measures how spread out the values are.', example: 'Volatility of revenue', category: 'aggregation', params: [], required_params: [] },
  count:               { label: 'Count', icon: '🔢', summary: 'Number of filled-in values in the column.', example: 'How many transactions?', category: 'aggregation', params: [], required_params: [] },
  value_counts:        { label: 'Frequency Table', icon: '📋', summary: 'Counts occurrences of each distinct value, sorted most → least frequent.', example: 'Orders per country', category: 'aggregation', params: [], required_params: [] },
  idxmax:              { label: 'Label of Max', icon: '🏷️', summary: 'Returns the category name (e.g., month or product) of the maximum value.', example: 'Which month had highest revenue?', category: 'aggregation', params: [], required_params: [] },
  idxmin:              { label: 'Label of Min', icon: '🏷️', summary: 'Returns the category name (e.g., month or product) of the minimum value.', example: 'Worst-performing product?', category: 'aggregation', params: [], required_params: [] },
  nlargest:            { label: 'Top N', icon: '🥇', summary: 'Returns the N largest values, sorted descending.', example: 'Top 10 customers by spend', category: 'ranking', params: ['n'], required_params: ['n'] },
  nsmallest:           { label: 'Bottom N', icon: '🥉', summary: 'Returns the N smallest values, sorted ascending.', example: 'Bottom 5 products by revenue', category: 'ranking', params: ['n'], required_params: ['n'] },
  sort_values:         { label: 'Sort', icon: '↕️', summary: 'Sorts values ascending or descending.', example: 'Sort revenue high → low', category: 'ranking', params: ['ascending'], required_params: [] },
  head:                { label: 'First N Rows', icon: '⏫', summary: 'Returns the first N rows of the column.', example: 'First 5 rows after sorting', category: 'ranking', params: ['n'], required_params: ['n'] },
  tail:                { label: 'Last N Rows', icon: '⏬', summary: 'Returns the last N rows of the column.', example: 'Last 5 rows after sorting', category: 'ranking', params: ['n'], required_params: ['n'] },
  cumshare:            { label: 'Cumulative Share', icon: '🥧', summary: 'Running percentage share of the total.', example: 'Pareto: cumulative % of revenue', category: 'windowing', params: [], required_params: [] },
  shift:               { label: 'Shift', icon: '⏩', summary: 'Moves each value down by N rows so you can compare against a prior period.', example: 'Previous month revenue', category: 'windowing', params: ['periods'], required_params: [] },
  rolling_mean:        { label: 'Rolling Average', icon: '〰️', summary: 'Moving average over a sliding window of N rows.', example: '7-day rolling average', category: 'windowing', params: ['window'], required_params: ['window'] },
  eq:                  { label: 'Equals (==)', icon: '=', summary: 'True where first input equals second input.', example: 'Country == "UK"', category: 'comparison', params: [], required_params: [] },
  ne:                  { label: 'Not Equal (!=)', icon: '≠', summary: 'True where first input does not equal second input.', example: 'Status != "cancelled"', category: 'comparison', params: [], required_params: [] },
  gt:                  { label: 'Greater Than (>)', icon: '>', summary: 'True where first input is greater than second.', example: 'Revenue > 1000', category: 'comparison', params: [], required_params: [] },
  ge:                  { label: 'Greater or Equal (≥)', icon: '≥', summary: 'True where first input is greater than or equal to second.', example: 'Score ≥ 90', category: 'comparison', params: [], required_params: [] },
  lt:                  { label: 'Less Than (<)', icon: '<', summary: 'True where first input is less than second.', example: 'Price < 50', category: 'comparison', params: [], required_params: [] },
  le:                  { label: 'Less or Equal (≤)', icon: '≤', summary: 'True where first input is less than or equal to second.', example: 'CumulativeShare ≤ 0.8', category: 'comparison', params: [], required_params: [] },
  between:             { label: 'Between', icon: '↔️', summary: 'True where a value falls between two numbers (both included).', example: 'Revenue between 500 and 2000', category: 'comparison', params: ['low', 'high'], required_params: ['low', 'high'] },
  logical_and:         { label: 'AND', icon: '&&', summary: 'True where BOTH input masks are true.', example: 'Filter A AND Filter B', category: 'logical', params: [], required_params: [] },
  logical_or:          { label: 'OR', icon: '||', summary: 'True where AT LEAST ONE input mask is true.', example: 'Country == "UK" OR Country == "US"', category: 'logical', params: [], required_params: [] },
  logical_not:         { label: 'NOT', icon: '!', summary: 'Flips a boolean mask (true → false, false → true).', example: 'Exclude cancelled orders', category: 'logical', params: [], required_params: [] },
  isnan:               { label: 'Is Missing', icon: '❓', summary: 'True where value is missing (NaN/null).', example: 'Find rows with missing Customer ID', category: 'predicate', params: [], required_params: [] },
  startswith:          { label: 'Starts With', icon: 'Aa', summary: 'True where text starts with a given prefix.', example: 'Date starts with "2010"', category: 'predicate', params: ['prefix'], required_params: ['prefix'] },
  isin:                { label: 'Is In List', icon: '📌', summary: 'True where value appears in a provided list.', example: 'Country in ["UK", "France", "Germany"]', category: 'predicate', params: ['values'], required_params: ['values'] },
  to_datetime:         { label: 'Parse Date', icon: '📅', summary: 'Converts text or numbers to date/time values.', example: 'Parse "2021-03-15" as a date', category: 'type_conversion', params: ['format'], required_params: [] },
  str:                 { label: 'To Text', icon: 'T', summary: 'Converts values to text.', example: 'Convert year number to text', category: 'type_conversion', params: [], required_params: [] },
  index:               { label: 'Select Rows', icon: '🎯', summary: 'Picks rows by position number, a list of positions, or a true/false mask.', example: 'Keep only rows where mask is true', category: 'indexing', params: ['indices'], required_params: ['indices'] },
  get_index:           { label: 'Get Labels', icon: '🔑', summary: 'Extracts the group or category names produced by a Group & Aggregate step.', example: 'Get group names from aggregation result', category: 'indexing', params: [], required_params: [] },
  extract_year:        { label: 'Extract Year', icon: '📆', summary: 'Extracts the year (e.g., 2021) from a date column.', example: 'Year of invoice', category: 'datetime', params: [], required_params: [] },
  extract_month:       { label: 'Extract Month', icon: '📆', summary: 'Extracts the month number (1–12) from a date column.', example: 'Month of order', category: 'datetime', params: [], required_params: [] },
  extract_day:         { label: 'Extract Day', icon: '📆', summary: 'Extracts the day of month from a date column.', example: 'Invoice day', category: 'datetime', params: [], required_params: [] },
  truncate_to:         { label: 'Round Date To', icon: '✂️', summary: 'Rounds a date down to the nearest unit (month, day, week…).', example: 'Group dates by month', category: 'datetime', params: ['unit'], required_params: ['unit'] },
  concat_str:          { label: 'Join Text', icon: '🔗', summary: 'Joins two text values together, side by side.', example: 'Join year + "-" + month', category: 'type_conversion', params: [], required_params: [] },
  fillna:              { label: 'Fill Missing', icon: '🩹', summary: 'Fills missing values (NaN/null) with a constant.', example: 'Fill missing values with 0', category: 'type_conversion', params: ['value'], required_params: ['value'] },
  contains:            { label: 'Contains', icon: '🔎', summary: 'True where text contains a given piece of text.', example: 'Where description contains "apple"', category: 'predicate', params: ['substring', 'case'], required_params: ['substring'] },
  date_add:            { label: 'Add to Date', icon: '📅', summary: 'Adds a specified amount of days/months/years to a date.', example: 'Add 7 days to invoice date', category: 'datetime', params: ['amount', 'unit'], required_params: ['amount', 'unit'] },
  diff:                { label: 'Change vs. Previous', icon: 'Δ', summary: 'Change from the value N rows earlier.', example: 'Day-over-day change', category: 'windowing', params: ['periods'], required_params: [] },
  rolling_sum:         { label: 'Rolling Sum', icon: '〰️', summary: 'Moving sum over a sliding window of N rows.', example: '7-day rolling total', category: 'windowing', params: ['window'], required_params: ['window'] },
  quantile:            { label: 'Percentile', icon: '📊', summary: 'The value below which a given percentage of the data falls (e.g. the 90th percentile).', example: '90th percentile of revenue', category: 'statistical', params: ['q'], required_params: ['q'] },
  rank:                { label: 'Rank', icon: '🏅', summary: 'Assigns a rank number to each row.', example: 'Rank customers by spend', category: 'ranking', params: ['ascending'], required_params: [] },
  cumsum:              { label: 'Cumulative Sum', icon: 'Σ', summary: 'Running total of values in the column.', example: 'Cumulative revenue over time', category: 'windowing', params: [], required_params: [] },
  dropna:              { label: 'Drop Missing', icon: '🗑️', summary: 'Removes missing values (NaN/null) from the column, leaving only filled-in values.', example: 'Remove missing values before calculating a total', category: 'type_conversion', params: [], required_params: [] },
  lower:               { label: 'Lowercase', icon: '🔡', summary: 'Converts text to lowercase.', example: 'Normalize country names', category: 'type_conversion', params: [], required_params: [] },
  upper:               { label: 'Uppercase', icon: '🔠', summary: 'Converts text to uppercase.', example: 'Standardize product codes for comparison', category: 'type_conversion', params: [], required_params: [] },
};

// ── Param type definitions (Zod-based) ────────────────────────────────────
//
// Each field has a Zod schema (type + validation rules) and a "widget" (how to
// render the input control). The Zod type determines whether to render a number
// input, text input, dropdown, etc.

interface ParamField {
  widget: string;   // 'source_column' | 'agg_function' | 'literal_scalar' | 'literal_int' | 'literal_bool' | 'literal_list' | 'column_or_node' | 'node_id' | 'condition' | 'format_string'
  schema: z.ZodTypeAny;
}

const PARAM_SCHEMA: Record<string, Record<string, ParamField>> = {
  filter_extract: {
    column: { widget: 'source_column', schema: z.string().min(1) },
    condition: { widget: 'condition', schema: z.string().optional().or(z.literal('')) },
  },
  groupby_agg: {
    groupby_column: { widget: 'source_column', schema: z.string().optional().or(z.literal('')) },
    groupby_columns: { widget: 'column_or_node_list', schema: z.array(z.string().min(1)).min(1).optional().or(z.literal('')) },
    agg_column: { widget: 'column_or_node', schema: z.string().min(1) },
    agg_function: { widget: 'agg_function', schema: z.enum(['sum', 'mean', 'count', 'max', 'min', 'std', 'median', 'nunique']) },
  },
  load_constant: {
    value: { widget: 'literal_scalar', schema: z.union([z.number(), z.string()]) },
  },
  round: {
    decimals: { widget: 'literal_int', schema: z.number().int().optional().or(z.literal('')) },
  },
  between: {
    low: { widget: 'literal_scalar', schema: z.number() },
    high: { widget: 'literal_scalar', schema: z.number() },
  },
  nlargest: {
    n: { widget: 'literal_int', schema: z.number().int().min(1) },
  },
  nsmallest: {
    n: { widget: 'literal_int', schema: z.number().int().min(1) },
  },
  sort_values: {
    ascending: { widget: 'literal_bool', schema: z.enum(['true', 'false']).optional().or(z.literal('')) },
  },
  head: {
    n: { widget: 'literal_int', schema: z.number().int().min(1) },
  },
  tail: {
    n: { widget: 'literal_int', schema: z.number().int().min(1) },
  },
  shift: {
    periods: { widget: 'literal_int', schema: z.number().int().optional().or(z.literal('')) },
  },
  diff: {
    periods: { widget: 'literal_int', schema: z.number().int().optional().or(z.literal('')) },
  },
  rolling_mean: {
    window: { widget: 'literal_int', schema: z.number().int().min(1) },
  },
  rolling_sum: {
    window: { widget: 'literal_int', schema: z.number().int().min(1) },
  },
  to_datetime: {
    format: { widget: 'format_string', schema: z.string().optional().or(z.literal('')) },
  },
  startswith: {
    prefix: { widget: 'literal_scalar', schema: z.string().min(1) },
  },
  isin: {
    values: { widget: 'literal_string_list', schema: z.array(z.string().min(1)).min(1) },
  },
  contains: {
    substring: { widget: 'literal_scalar', schema: z.string().min(1) },
    case: { widget: 'literal_bool', schema: z.enum(['true', 'false']).optional().or(z.literal('')) },
  },
  index: {
    indices: { widget: 'node_id', schema: z.string().regex(/^node_\d+$/, 'Must be a node id (e.g. node_3)') },
  },
  truncate_to: {
    unit: { widget: 'literal_scalar', schema: z.enum(['year', 'month', 'day', 'week', 'quarter']) },
  },
  date_add: {
    amount: { widget: 'literal_int', schema: z.number().int() },
    unit: { widget: 'literal_scalar', schema: z.enum(['days', 'months', 'years']) },
  },
  fillna: {
    value: { widget: 'literal_scalar', schema: z.string().min(1) },
  },
  quantile: {
    q: { widget: 'literal_scalar', schema: z.number().min(0).max(1, 'Quantile must be between 0 and 1') },
  },
  rank: {
    ascending: { widget: 'literal_bool', schema: z.enum(['true', 'false']).optional().or(z.literal('')) },
  },
};

// ── Zod helper utilities ─────────────────────────────────────────────────────

/** Extract enum string values from a Zod schema (handles optional wrapping). */
function zodEnumValues(schema: z.ZodTypeAny): string[] {
  const s = schema instanceof z.ZodOptional ? schema.unwrap() : schema;
  if (s instanceof z.ZodDefault) return zodEnumValues((s as any).innerType ?? (s as any).def.innerType);
  if (s instanceof z.ZodEnum) return [...(s as any).options];
  if (s instanceof z.ZodUnion)
    return (s as any).options
      .filter((o: z.ZodTypeAny) => o instanceof z.ZodLiteral)
      .map((o: z.ZodLiteral<any>) => String((o as any).value));
  return [];
}

/** Unwrap Optional/Default/Nullable to get the inner Zod type. */
function zodInner(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s: z.ZodTypeAny = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodDefault || s instanceof z.ZodNullable)
    s = (s as any).unwrap?.() ?? (s as any).innerType ?? (s as any).def?.innerType ?? s;
  return s;
}

/** Derive HTML input props from a Zod schema: type, step, key/paste/range guards. */
function zodInputProps(schema: z.ZodTypeAny) {
  const s = zodInner(schema);
  const isInt = (s as any).isInt === true;
  const isNum = typeof (s as any).isInt === 'boolean';

  if (isNum) {
    const minV = (s as any).minValue;
    const maxV = (s as any).maxValue;
    const min = minV !== undefined && minV !== -Infinity ? minV : undefined;
    const max = maxV !== undefined && maxV !== Infinity ? maxV : undefined;

    const allowedKeys = new Set([
      'Backspace', 'Delete', 'Tab', 'Enter', 'Escape',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Home', 'End',
    ]);
    const isCtrl = (e: React.KeyboardEvent) => e.ctrlKey || e.metaKey;
    return {
      type: 'number' as const,
      step: isInt ? '1' : 'any',
      min,
      max,
      inputMode: isInt ? 'numeric' as const : 'decimal' as const,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (isCtrl(e)) return;
        if (allowedKeys.has(e.key)) return;
        if (e.key.length !== 1) return;
        if (isInt) {
          if (e.key === '-') {
            if (min !== undefined && min >= 0) e.preventDefault();
            return;
          }
          if (!/^[0-9]$/.test(e.key)) e.preventDefault();
          return;
        }
        if (!/^[0-9eE.-]$/.test(e.key)) e.preventDefault();
      },
      onPaste: (e: React.ClipboardEvent) => {
        const text = e.clipboardData.getData('text');
        if (isInt && !/^-?\d+$/.test(text)) e.preventDefault();
        else if (!isInt && !/^-?\d*\.?\d*(e-?\d+)?$/i.test(text)) e.preventDefault();
      },
    };
  }

  return { type: 'text' as const };
}

const NODE_ID_RE = /^node_\d+$/;

function isNodeId(value: string): boolean {
  return NODE_ID_RE.test(value);
}

/** Parse a numeric input; returns null when the value must be rejected (out of schema bounds). */
function parseBoundedNumber(schema: z.ZodTypeAny, raw: string): number | '' | null {
  if (raw === '' || raw === '-') return '';
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  const result = schema.safeParse(n);
  if (!result.success) return null;
  return result.data as number;
}

/** Get the "is required" status from a Zod schema (not optional/nullable/default). */
function isZodRequired(schema: z.ZodTypeAny): boolean {
  if (schema.isOptional()) return false;
  if (schema instanceof z.ZodDefault) return false;
  if (schema instanceof z.ZodNullable) return false;
  if (schema instanceof z.ZodUnion) {
    return !(schema as any).options.some(
      (o: z.ZodTypeAny) => o instanceof z.ZodUndefined || o instanceof z.ZodNull || (o instanceof z.ZodLiteral)
    );
  }
  return true;
}

// Derive backward-compatible PARAM_KINDS from schema (just widget string)
const PARAM_KINDS: Record<string, Record<string, string>> = {};
for (const [op, params] of Object.entries(PARAM_SCHEMA)) {
  PARAM_KINDS[op] = {};
  for (const [k, def] of Object.entries(params)) {
    PARAM_KINDS[op][k] = def.widget;
  }
}

// Derive AGG_FUNCTIONS from Zod schema
const AGG_FUNCTIONS = zodEnumValues(PARAM_SCHEMA.groupby_agg?.agg_function?.schema);

const CATEGORY_ICONS: Record<string, string> = {
  extraction: '📥',
  arithmetic: '🔣',
  math: '📐',
  statistical: '📈',
  aggregation: '🗂️',
  ranking: '🏆',
  windowing: '〰️',
  comparison: '⚖️',
  logical: '🔀',
  predicate: '🔍',
  type_conversion: '🔄',
  datetime: '📆',
  indexing: '🎯',
};

const CATEGORY_LABELS: Record<string, string> = {
  extraction: 'Data Extraction',
  arithmetic: 'Arithmetic',
  math: 'Math Functions',
  statistical: 'Statistical',
  aggregation: 'Aggregation',
  ranking: 'Ranking & Ordering',
  windowing: 'Window & Time Series',
  comparison: 'Comparison',
  logical: 'Logical',
  predicate: 'Predicate (Filters)',
  type_conversion: 'Type Conversion',
  datetime: 'Date & Time',
  indexing: 'Indexing & Selection',
};

// ── Human-readable param labels ───────────────────────────────────────────────
const PARAM_LABELS: Record<string, string> = {
  column: 'Column',
  condition: 'Where',
  value: 'Value',
  groupby_column: 'Group by',
  groupby_columns: 'Group by',
  agg_column: 'Aggregate',
  agg_function: 'Function',
  ascending: 'Order',
  n: 'How Many',
  decimals: 'Decimals',
  prefix: 'Prefix',
  values: 'In list',
  format: 'Format',
  unit: 'Unit',
  low: 'From',
  high: 'To',
  periods: 'Periods',
  window: 'Window',
  indices: 'Select',
  substring: 'Substring',
  case: 'Case Sensitive',
  amount: 'Amount',
  q: 'Percentile',
};

const COMPARATORS = ['==', '!=', '>=', '<=', '>', '<'];

const CONDITION_RE = /^`?([^`]+?)`?\s+(==|!=|>=|<=|>|<)\s+(.+)$/;
const CONDITION_SPLIT_RE = /\s+(and|or)\s+/gi;

interface SubCondition {
  raw: string;
  parsed?: { column: string; comparator: string; value: string };
  error?: string;
  join?: 'and' | 'or'; // join connector BEFORE this sub-condition
}

function parseCondition(condition: string): { column: string; comparator: string; value: string } | null {
  if (!condition) return null;
  const m = condition.match(CONDITION_RE);
  if (!m) return null;
  return { column: m[1].trim(), comparator: m[2], value: m[3].trim() };
}

function parseCompoundCondition(condition: string): SubCondition[] {
  if (!condition) return [];
  const parts = condition.split(CONDITION_SPLIT_RE);
  const result: SubCondition[] = [];
  let joinOp: 'and' | 'or' | null = null;
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase() === 'and' || trimmed.toLowerCase() === 'or') {
      // If this is a logical operator, it becomes the join for the NEXT condition
      // But only if we already have a condition before it
      joinOp = trimmed.toLowerCase() as 'and' | 'or';
      continue;
    }
    const entry: SubCondition = { raw: trimmed, join: joinOp || undefined };
    const p = parseCondition(trimmed);
    if (p) entry.parsed = p;
    // Non-parseable conditions (e.g. InvoiceDate.str.startswith('2010')) are
    // valid Python expressions — keep the raw text, no error.
    result.push(entry);
    joinOp = null;
  }
  return result;
}

function formatCondition(column: string, comparator: string, value: string): string {
  const needsBacktick = /\s/.test(column) || /[^a-zA-Z0-9_]/.test(column);
  const col = needsBacktick ? `\`${column}\`` : column;
  const isNum = /^-?\d+(\.\d+)?$/.test(value);
  const alreadyQuoted = (value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'));
  const val = isNum ? value : (alreadyQuoted ? value : `'${value}'`);
  return `${col} ${comparator} ${val}`;
}

function isEmptyParamValue(value: unknown): boolean {
  return value === '' || value === undefined || value === null
    || (Array.isArray(value) && value.length === 0);
}

/** Normalize bool params from JSON/Python into editor enum strings ('true' | 'false'). */
function normalizeLiteralBool(value: unknown): unknown {
  if (value === '' || value === undefined || value === null) return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === 'false') return lower;
  }
  return value;
}

function isLiteralFalse(value: unknown): boolean {
  return normalizeLiteralBool(value) === 'false';
}

function normalizeNodeParams(op: string, params: Record<string, any> | undefined): Record<string, any> {
  if (!params) return {};
  const fields = PARAM_SCHEMA[op];
  if (!fields) return { ...params };
  const out = { ...params };
  for (const [key, field] of Object.entries(fields)) {
    if (field.widget === 'literal_bool' && key in out) {
      out[key] = normalizeLiteralBool(out[key]);
    }
  }
  return out;
}

/** True when the user has not configured any parameters yet (newly placed node). */
function isNodeParamsPristine(op: string, params: Record<string, any>): boolean {
  const schemaKeys = Object.keys(PARAM_SCHEMA[op] || {});
  const keysToCheck = schemaKeys.length > 0 ? schemaKeys : Object.keys(params);
  if (keysToCheck.length === 0) return true;
  return keysToCheck.every((k) => isEmptyParamValue(params[k]));
}

export function formatNodeDisplayId(id: string): string {
  const m = id.match(/^node_(\d+)$/);
  return m ? m[1] : id;
}

function formatRecipeStepNumber(
  step: { nodeId?: string; cellIndex?: number },
  fallbackIndex: number,
): string {
  if (step.nodeId) return `#${formatNodeDisplayId(step.nodeId)}`;
  if (typeof step.cellIndex === 'number') return String(step.cellIndex + 1);
  return String(fallbackIndex + 1);
}

function allocateNodeId(existingIds: string[]): string {
  let max = 0;
  for (const nid of existingIds) {
    const m = nid.match(/^node_(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `node_${max + 1}`;
}

function validateNodeParams(
  op: string,
  params: Record<string, any>,
  colInfo: ColumnInfo,
  nodeIds: string[] = [],
  forSave = false
): Record<string, string> {
  if (!forSave && isNodeParamsPristine(op, params)) {
    return {};
  }

  const errors: Record<string, string> = {};
  const fields = PARAM_SCHEMA[op] || {};
  const hasColumns = colInfo.names.length > 0;
  const knownNodes = new Set(nodeIds);

  // groupby_agg: require exactly one grouping mode
  if (op === 'groupby_agg') {
    const hasSingle = typeof params.groupby_column === 'string' && params.groupby_column !== '';
    const hasMulti = Array.isArray(params.groupby_columns) && params.groupby_columns.length > 0;
    if (!hasSingle && !hasMulti) {
      errors.groupby_column = 'Select a column to group by, or switch to multiple columns';
      errors.groupby_columns = 'Add at least one column, or switch to single column';
    }
  }

  for (const [key, value] of Object.entries(params)) {
    const field = fields[key];
    if (!field) continue;
    const isEmpty = value === '' || value === undefined || value === null
      || (Array.isArray(value) && value.length === 0);

    // ── Required check (before Zod) ──
    if (isEmpty && isZodRequired(field.schema)) {
      errors[key] = 'This parameter is required';
      continue;
    }
    if (isEmpty) continue; // optional empty = no error

    // ── Zod type validation ──
    let parsed = value;
    if (field.widget === 'literal_bool') {
      parsed = normalizeLiteralBool(value);
    } else {
      const inner = zodInner(field.schema);
      if (typeof value === 'boolean' && inner instanceof z.ZodEnum) {
        parsed = String(value);
      }
    }
    const result = field.schema.safeParse(parsed);
    if (!result.success) {
      errors[key] = result.error.issues[0]?.message || 'Invalid value';
      continue;
    }
    // Use the parsed/coerced value going forward
    const coerced: any = result.data;

    // ── Widget-specific validation (beyond type checks) ──
    switch (field.widget) {
      case 'source_column':
        if (hasColumns && !colInfo.names.includes(coerced)) {
          errors[key] = `"${coerced}" is not a valid column. Options: ${colInfo.names.join(', ') || '(none available)'}`;
        }
        break;

      case 'agg_function':
        // Zod's enum already validates this
        break;

      case 'condition': {
        const subConditions = parseCompoundCondition(coerced);
        if (subConditions.length === 0) {
          errors[key] = 'Invalid condition. Expected at least: column operator value (e.g. year == 2024)';
        } else {
          const subErrors: string[] = [];
          for (const sc of subConditions) {
            if (sc.parsed) {
              const p = sc.parsed;
              if (hasColumns && !colInfo.names.includes(p.column)) {
                subErrors.push(`"${p.column}" is not a valid column name`);
              } else if (!COMPARATORS.includes(p.comparator)) {
                subErrors.push(`"${p.comparator}" is not a valid operator`);
              } else if (hasColumns) {
                const colType = colInfo.types[p.column]?.data_type;
                if (colType === 'int' || colType === 'float') {
                  if (!/^-?\d+(\.\d+)?$/.test(p.value)) {
                    subErrors.push(`"${p.value}" is not a valid number for "${p.column}" (${colType})`);
                  }
                }
              }
            }
          }
          if (subErrors.length > 0) {
            errors[key] = subErrors.join('; ');
          }
        }
        break;
      }

      case 'column_or_node':
        if (isNodeId(coerced)) {
          if (knownNodes.size > 0 && !knownNodes.has(coerced)) {
            errors[key] = `"${coerced}" is not a node in this graph`;
          }
        } else if (!hasColumns) {
          errors[key] = `"${coerced}" must be a column name or a valid node id (e.g. node_3)`;
        } else if (!colInfo.names.includes(coerced)) {
          errors[key] = `"${coerced}" must be a column name or a valid node id (e.g. node_3)`;
        }
        break;

      case 'node_id':
        if (knownNodes.size > 0 && !knownNodes.has(coerced)) {
          errors[key] = `"${coerced}" is not a node in this graph`;
        }
        break;

      case 'column_or_node_list':
        if (Array.isArray(coerced)) {
          for (const item of coerced) {
            if (typeof item !== 'string' || !item) continue;
            if (isNodeId(item)) {
              if (knownNodes.size > 0 && !knownNodes.has(item)) {
                errors[key] = `"${item}" is not a node in this graph`;
                break;
              }
            } else if (hasColumns && !colInfo.names.includes(item)) {
              errors[key] = `"${item}" is not a valid column`;
              break;
            } else if (!hasColumns && !isNodeId(item)) {
              errors[key] = `"${item}" must be a column name or node id`;
              break;
            }
          }
        }
        break;

      case 'literal_list':
        if (Array.isArray(coerced)) {
          for (const item of coerced) {
            if (typeof item === 'string' && hasColumns && !colInfo.names.includes(item)) {
              errors[key] = `"${item}" is not a valid column`;
              break;
            }
          }
        }
        break;

      case 'literal_string_list':
        if (!Array.isArray(coerced) || coerced.length === 0) {
          errors[key] = 'Add at least one value';
        }
        break;

      case 'format_string':
        if (typeof coerced === 'string' && !coerced.startsWith('%')) {
          errors[key] = 'Format string should be strftime-style (e.g. %Y-%m-%d)';
        }
        break;

      case 'literal_int':
      case 'literal_bool':
      case 'literal_scalar':
        // Zod type + constraints already validated these
        break;
    }
  }
  return errors;
}

function formatParamValue(key: string, val: any): string {
  if (key === 'ascending') return isLiteralFalse(val) ? 'Descending' : 'Ascending';
  if (key === 'agg_function') return String(val).toUpperCase();
  if (Array.isArray(val)) return val.join(', ');
  return String(val);
}

function formatTooltipParamValue(key: string, val: unknown): string {
  if (val === undefined || val === null || val === '') return '—';
  if (typeof val === 'string' && isNodeId(val)) return `#${formatNodeDisplayId(val)}`;
  if (Array.isArray(val)) {
    return val
      .map((v) => (typeof v === 'string' && isNodeId(v) ? `#${formatNodeDisplayId(v)}` : String(v)))
      .join(', ');
  }
  return formatParamValue(key, val);
}

/** Keeps the canvas zoomed out; avoids fitView blowing up single/few nodes. */
export const CANVAS_FIT_VIEW = { padding: 0.35, maxZoom: 0.72, duration: 400 };

// ── Dagre layout ──────────────────────────────────────────────────────────────
const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const DAG_NODE_WIDTH = 168;
const DAG_NODE_HEIGHT = 60;

function getLayoutedElements(nodes: Node[], edges: Edge[]) {
  dagreGraph.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 96 });
  nodes.forEach((n) => dagreGraph.setNode(n.id, { width: DAG_NODE_WIDTH, height: DAG_NODE_HEIGHT }));
  edges.forEach((e) => dagreGraph.setEdge(e.source, e.target));
  dagre.layout(dagreGraph);
  return {
    nodes: nodes.map((n) => {
      const pos = dagreGraph.node(n.id);
      return {
        ...n,
        targetPosition: Position.Left,
        sourcePosition: Position.Right,
        position: { x: pos.x - DAG_NODE_WIDTH / 2, y: pos.y - DAG_NODE_HEIGHT / 2 },
      };
    }),
    edges: edges.map((e) => ({ ...e, type: 'smoothstep' })),
  };
}

export function buildDagFlowElements(
  dagData: DAGData,
  columnInfo: ColumnInfo = { names: [], types: {} },
  options?: { readOnly?: boolean },
): { nodes: Node[]; edges: Edge[] } {
  const readOnly = options?.readOnly ?? false;
  const rawNodes: Node[] = dagData.nodes.map((n) => ({
    id: n.id,
    type: 'dagNode',
    position: { x: 0, y: 0 },
    data: {
      op: n.op,
      params: normalizeNodeParams(n.op, n.params),
      inputs: n.inputs || [],
      columnNames: columnInfo.names,
      columnTypes: columnInfo.types,
      isOutput: n.id === dagData.output_node,
      readOnly,
      onDelete: () => {},
      onEdit: () => {},
      onSetOutput: () => {},
    },
    ...(readOnly ? { draggable: false, selectable: false, connectable: false } : {}),
  }));

  const rawEdges: Edge[] = [];
  const nodeIdSet = new Set(dagData.nodes.map((nd) => nd.id));
  dagData.nodes.forEach((n) => {
    (n.inputs || []).forEach((inp: string, idx: number) => {
      if (inp && nodeIdSet.has(inp)) {
        rawEdges.push({
          id: `e-${inp}-${n.id}-input-${idx}`,
          source: inp,
          target: n.id,
          sourceHandle: 'output',
          targetHandle: `input-${idx}`,
          animated: false,
        });
      }
    });
    const paramWidgets = PARAM_SCHEMA[n.op];
    if (paramWidgets) {
      for (const [paramKey] of Object.entries(paramWidgets)) {
        const val = n.params?.[paramKey];
        if (typeof val === 'string' && nodeIdSet.has(val)) {
          rawEdges.push({
            id: `e-${val}-${n.id}-param-${paramKey}`,
            source: val,
            target: n.id,
            sourceHandle: 'output',
            targetHandle: `param-${paramKey}`,
            animated: false,
          });
        } else if (paramKey === 'groupby_columns' && Array.isArray(val)) {
          const nodeRef = val.find((v) => typeof v === 'string' && nodeIdSet.has(v));
          if (nodeRef) {
            rawEdges.push({
              id: `e-${nodeRef}-${n.id}-param-${paramKey}`,
              source: nodeRef,
              target: n.id,
              sourceHandle: 'output',
              targetHandle: `param-${paramKey}`,
              animated: false,
            });
          }
        }
      }
    }
  });

  const { nodes: layoutNodes, edges: layoutEdges } = getLayoutedElements(rawNodes, rawEdges);
  return { nodes: syncNodesFromEdges(layoutNodes, layoutEdges), edges: layoutEdges };
}

// ── Types ──────────────────────────────────────────────────────────────────────
export interface DAGNodeDef {
  id: string;
  op: string;
  params: Record<string, any>;
  inputs: string[];
}

export interface DAGData {
  graph_id: string;
  nodes: DAGNodeDef[];
  output_node: string;
}

export type VisualizationKind = 'line' | 'bar' | 'area' | 'scatter' | 'pie';

/** Data-free chart mapping returned by the visualization formatter task. */
export interface VisualizationSpec {
  version: 1;
  kind: VisualizationKind;
  title: string;
  x: string;
  y: string[];
  series?: string | null;
  sort_by?: string | null;
  sort_direction: 'asc' | 'desc';
  x_label: string;
  y_label: string;
}

/** Serialized variable preview returned by the notebook session API. */
export interface NotebookVariable {
  type: 'scalar' | 'dataframe' | 'series' | 'collection' | 'object';
  value?: unknown;
  shape?: [number, number];
  length?: number;
  columns?: string[];
  preview?: unknown;
  repr?: string;
}

/** Per-cell output state for the notebook-style Code View. */
export interface PythonCellOutput {
  status: 'loading' | 'success' | 'error';
  result?: any;
  variables?: Record<string, NotebookVariable>;
  stdout?: string;
  error?: string;
  time?: number;
}

/** Query history entry with timestamp. */
export interface HistoryEntry {
  query: string;
  timestamp: number;
}

/** Generated calculation saved for one turn of a conversation. */
export interface ConversationArtifact {
  dagData: DAGData | null;
  dagName: string | null;
  pythonCode: string | null;
  query: string;
  kind?: 'analysis' | 'visualization' | 'transformation';
  resultPreview?: unknown;
  visualizationSpec?: VisualizationSpec;
}

/** Token / LLM timing captured for one generation turn. */
export interface QueryUsage {
  inputTokens: number;
  outputTokens: number;
  /** Total LLM time in seconds when reported by the generation job. */
  llmTimeSec: number;
}

/** A single message in the conversation thread. */
export interface ConversationMsg {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  type?: 'text' | 'generation' | 'clarification' | 'error';
  timestamp: number;
  /** Structured answer card (generation / error outcomes). */
  answer?: AnswerPayload;
  /** Calculation generated for this answer, retained locally with the thread. */
  artifact?: ConversationArtifact;
  /** User question that produced this assistant answer. */
  questionMessageId?: string;
  /** Token and LLM timing for this generation, when available. */
  usage?: QueryUsage;
}

export type FullCsvDownloadOutcome = 'saved' | 'failed' | 'cancelled' | 'no-data' | 'no-file';

/** An ambiguous concept returned by the semantic agent. */
export interface AmbiguousConcept {
  term: string;
  reason: string;
  interpretations: string[];
  source?: string | null;
}

/** Canonical DAG file format for the desktop app. */
export interface AppDAGFile {
  name: string;
  description?: string;
  version: string;
  dag: DAGData;
  python_code?: string;
  last_execution?: 'success' | 'failed';
  execution_time?: number;
}

/** True for `#` comments that are indented (inside blocks), used as inner-step markers. */
function isInnerComment(line: string): boolean {
  if (!line.trim()) return false;
  const stripped = line.trimStart();
  return stripped.startsWith('#') && line[0] !== '#';
}

// ── Notebook error formatting ────────────────────────────────────────────────────
interface NotebookCellErrorInfo {
  title: string;
  message: string;
  action?: string;
  detail?: string;
}

function stripErrorPrefix(raw: string): string {
  return raw
    .replace(/^Execution Error:\s*/i, '')
    .replace(/^Runtime error:\s*/i, '')
    .replace(/^Unexpected Error:\s*/i, '')
    .replace(/^Security Violation:\s*/i, '')
    .trim();
}

function findCellsDefiningVariable(
  sections: { desc?: string; code: string }[],
  varName: string,
  beforeIndex: number,
): number[] {
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const assignPattern = new RegExp(`^\\s*${escaped}\\s*=`, 'm');
  const indices: number[] = [];
  for (let i = 0; i < beforeIndex; i++) {
    if (assignPattern.test(sections[i].code)) indices.push(i);
  }
  return indices;
}

function formatCellList(indices: number[]): string {
  if (indices.length === 0) return '';
  const labels = indices.map(i => `[${i + 1}]`);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function formatNotebookError(
  raw: string,
  stepIndex: number,
  sections: { desc?: string; code: string }[],
  executedSteps: Set<number> = new Set(),
): NotebookCellErrorInfo {
  const detail = raw.trim();
  const msg = stripErrorPrefix(detail);

  const nameMatch = msg.match(/name ['"]([^'"]+)['"] is not defined/i);
  if (nameMatch) {
    const varName = nameMatch[1];
    const definingCells = findCellsDefiningVariable(sections, varName, stepIndex);
    if (varName === 'df') {
      return {
        title: 'Data not loaded',
        message: 'This step expects your dataset, but it isn\'t available in this run.',
        action: 'Open a data file on the Home tab, then run this cell again.',
        detail,
      };
    }
    if (definingCells.length > 0) {
      const pendingCells = definingCells.filter(i => !executedSteps.has(i));
      if (pendingCells.length > 0) {
        return {
          title: 'A previous step is required',
          message: `This step uses “${varName}”, which is created in an earlier cell.`,
          action: `Run cell ${formatCellList(pendingCells)} first, then run this cell again.`,
          detail,
        };
      }
      return {
        title: 'An earlier step needs to be re-run',
        message: `This step uses “${varName}”, which may have been cleared or changed.`,
        action: `Re-run cell ${formatCellList(definingCells)}, then run this cell again.`,
        detail,
      };
    }
    return {
      title: 'Something is missing',
      message: `This step references “${varName}”, but that value hasn't been created yet.`,
      action: stepIndex > 0
        ? `Run the cells above (starting from [1]) in order, then try this cell again.`
        : 'Check that this cell defines everything it needs, or run earlier cells first.',
      detail,
    };
  }

  const keyMatch = msg.match(/KeyError:\s*['"]?([^'"\s]+)['"]?/i) ?? msg.match(/['"]?([^'"\s]+)['"]?\s*not in index/i);
  if (keyMatch) {
    return {
      title: 'Column or key not found',
      message: `The data doesn't contain “${keyMatch[1]}”.`,
      action: 'Run the cells that prepare your data first, or check that your file has the expected columns.',
      detail,
    };
  }

  const attrMatch = msg.match(/['"]?(\w+)['"]?\s+object has no attribute ['"]([^'"]+)['"]/i);
  if (attrMatch) {
    return {
      title: 'Unexpected data shape',
      message: `This step tried to use “.${attrMatch[2]}” on a ${attrMatch[1]} value.`,
      action: 'Run the previous cells in order so intermediate results are ready, then try again.',
      detail,
    };
  }

  if (/syntax error/i.test(msg)) {
    return {
      title: 'Code syntax issue',
      message: 'This cell contains code that Python cannot parse.',
      action: 'Review the highlighted code in this cell for typos or incomplete lines.',
      detail,
    };
  }

  if (/security violation|not allowed|prohibited|banned/i.test(msg)) {
    return {
      title: 'This operation isn\'t permitted',
      message: 'For safety, this step uses an operation that isn\'t allowed.',
      action: 'Try rephrasing your question or simplifying the analysis steps.',
      detail,
    };
  }

  if (/failed to load data|invalid source/i.test(msg)) {
    return {
      title: 'Data file problem',
      message: 'The app couldn\'t read your data file.',
      action: 'Go to the Home tab, open a valid CSV file, then run this cell again.',
      detail,
    };
  }

  if (/timedelta64|dtype|cannot convert|unsupported operand|invalid literal/i.test(msg)) {
    return {
      title: 'This step hit a data-type problem',
      message: 'The code ran, but Python could not process the values in the expected format.',
      action: 'This is usually an issue with the generated analysis code for this query, not with your data file. Try re-running the query to regenerate the steps.',
      detail,
    };
  }

  if (stepIndex > 0 && executedSteps.size > 0) {
    return {
      title: 'This step couldn\'t finish',
      message: msg.length > 160 ? `${msg.slice(0, 157)}…` : msg,
      action: 'Run previous cells in order first, then try this cell again.',
      detail: detail !== msg ? detail : undefined,
    };
  }

  return {
    title: 'This step couldn\'t finish',
    message: msg.length > 160 ? `${msg.slice(0, 157)}…` : msg,
    action: stepIndex > 0
      ? 'Run earlier cells in order, then try this cell again.'
      : 'Check the code in this cell and try again.',
    detail: detail !== msg ? detail : undefined,
  };
}

// ── Notebook result visualization ──────────────────────────────────────────────
const NOTEBOOK_MAX_TABLE_ROWS = 20;
const NOTEBOOK_CHART_HEIGHT = 220;
const NOTEBOOK_CHART_MARGIN = { top: 12, right: 12, left: 8, bottom: 28 };
const NOTEBOOK_MAX_CHART_POINTS = 200;

const NOTEBOOK_CHART_TOOLTIP = {
  background: '#ffffff',
  border: '2px solid #111',
  borderRadius: 0,
  fontFamily: 'var(--font-ui)',
  fontSize: 12,
} as const;

const RESERVED_VAR_NAMES = new Set([
  'result', 'pd', 'np', 'pandas', 'numpy', 'math', 'datetime', 'scipy', '__builtins__',
]);

const ASSIGNMENT_OPS = ['//=', '>>=', '<<=', '+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '='] as const;

/** Root variable name from an assignment target (mirrors notebook_session._target_names). */
function rootNameFromAssignTarget(target: string): string | null {
  const match = target.trim().match(/^([a-zA-Z_]\w*)/);
  if (!match) return null;
  const name = match[1];
  return RESERVED_VAR_NAMES.has(name) ? null : name;
}

function splitAssignmentTarget(line: string): { target: string; op: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  let depth = 0;
  let inString: '"' | "'" | null = null;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inString) {
      if (c === inString && trimmed[i - 1] !== '\\') inString = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;

    for (const op of ASSIGNMENT_OPS) {
      if (!trimmed.startsWith(op, i)) continue;
      if (op === '=') {
        const prev = i > 0 ? trimmed[i - 1] : '';
        const next = trimmed[i + 1] ?? '';
        if (prev === '=' || prev === '!' || prev === '<' || prev === '>' || next === '=') continue;
      }
      return { target: trimmed.slice(0, i).trim(), op };
    }
  }
  return null;
}

function namesFromAssignTarget(target: string): string[] {
  const trimmed = target.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(part => rootNameFromAssignTarget(part))
      .filter((name): name is string => name != null);
  }

  const root = rootNameFromAssignTarget(trimmed);
  return root ? [root] : [];
}

function extractAssignedNamesFromLine(line: string): string[] {
  const split = splitAssignmentTarget(line);
  if (!split) return [];
  return namesFromAssignTarget(split.target);
}


interface ParsedCodeLine {
  index: number;
  text: string;
  kind: 'code' | 'section-title' | 'blank';
  assignedNames: string[];
}

function parseCodeLines(code: string): ParsedCodeLine[] {
  return code.split('\n').map((text, index) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return { index, text, kind: 'blank' as const, assignedNames: [] };
    }
    if (isInnerComment(text)) {
      return {
        index,
        text: trimmed.replace(/^#\s*/, ''),
        kind: 'section-title' as const,
        assignedNames: [],
      };
    }
    return {
      index,
      text,
      kind: 'code' as const,
      assignedNames: extractAssignedNamesFromLine(text),
    };
  });
}

function VariableTag({ name, compact }: { name: string; compact?: boolean }) {
  return (
    <code className={`notebook-var-name${compact ? ' notebook-var-name--compact' : ''}`}>
      {name}
    </code>
  );
}

function isNumericValue(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

function isDateLikeValue(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return /^\d{4}-\d{2}(-\d{2})?/.test(v) || /^\d{4}-\d{2}$/.test(v);
}

function pickDateColumn(cols: string[], rows: Record<string, unknown>[]): string | null {
  for (const c of cols) {
    if (/date|time|month|year|period|day/i.test(c)) return c;
    const sample = rows[0]?.[c];
    if (isDateLikeValue(sample)) return c;
  }
  return null;
}

function pickNumericColumns(cols: string[], rows: Record<string, unknown>[], exclude: string): string[] {
  return cols.filter(c => {
    if (c === exclude) return false;
    return rows.every(r => r[c] === null || r[c] === undefined || isNumericValue(r[c]));
  });
}

function formatScalarValue(value: number | string | boolean): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  if (Math.abs(value) >= 1_000_000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(value) <= 1 && value !== 0 && Number.isFinite(value)) {
    const pct = value * 100;
    if (Math.abs(pct) <= 100) return `${pct.toFixed(2)}%`;
  }
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function recordsFromResult(result: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(result)) {
    if (result.length === 0) return [];
    if (typeof result[0] === 'object' && result[0] !== null && !Array.isArray(result[0])) {
      return result as Record<string, unknown>[];
    }
    return null;
  }
  if (typeof result === 'object' && result !== null) {
    const obj = result as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return [];
    const firstVal = obj[keys[0]];
    if (typeof firstVal === 'object' && firstVal !== null) {
      const indices = Object.keys(firstVal as object);
      return indices.map(idx => {
        const row: Record<string, unknown> = {};
        for (const k of keys) row[k] = (obj[k] as Record<string, unknown>)?.[idx];
        return row;
      });
    }
    return [obj];
  }
  return null;
}

function NotebookFriendlyTable({
  rows,
  cols,
  variableName,
  totalRows,
  totalCols,
}: {
  rows: Record<string, unknown>[];
  cols: string[];
  variableName?: string;
  totalRows?: number;
  totalCols?: number;
}) {
  const preview = rows.slice(0, NOTEBOOK_MAX_TABLE_ROWS);
  const rowCount = totalRows ?? rows.length;
  const colCount = totalCols ?? cols.length;
  const isPreview = variableName != null && rowCount > preview.length;

  let metaMessage: string;
  if (variableName) {
    metaMessage = `${variableName} is a table with ${rowCount.toLocaleString()} ${rowCount === 1 ? 'row' : 'rows'} × ${colCount} ${colCount === 1 ? 'column' : 'columns'}.`;
  } else {
    metaMessage = `${rowCount.toLocaleString()} ${rowCount === 1 ? 'row' : 'rows'} × ${colCount} ${colCount === 1 ? 'column' : 'columns'}.`;
  }

  return (
    <div className="notebook-result-table-wrap">
      <div className="notebook-result-meta">{metaMessage}</div>
      <table className="notebook-result-table">
        <thead>
          <tr>{cols.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {preview.map((row, i) => (
            <tr key={i}>
              {cols.map(c => {
                const v = row[c];
                const s = v === null || v === undefined ? '—' : String(v);
                return <td key={c} title={s}>{s}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {isPreview && (
        <div className="notebook-result-footnote">
          Showing only {preview.length} rows and {colCount} columns.
        </div>
      )}
      {!isPreview && rows.length > NOTEBOOK_MAX_TABLE_ROWS && (
        <div className="notebook-result-footnote">
          Showing {NOTEBOOK_MAX_TABLE_ROWS} of {rows.length.toLocaleString()} rows.
        </div>
      )}
    </div>
  );
}

function NotebookVariableCard({ name, variable }: { name: string; variable: NotebookVariable }) {
  if (variable.type === 'dataframe' && variable.preview && Array.isArray(variable.preview)) {
    const cols = variable.columns ?? Object.keys((variable.preview[0] as object) ?? {});
    const rowCount = variable.shape?.[0] ?? variable.preview.length;
    const colCount = variable.shape?.[1] ?? cols.length;
    return (
      <div className="notebook-variable-card">
        <div className="notebook-variable-header">
          <VariableTag name={name} />
          <span className="notebook-variable-badge">Table</span>
        </div>
        <NotebookFriendlyTable
          rows={variable.preview as Record<string, unknown>[]}
          cols={cols}
          variableName={name}
          totalRows={rowCount}
          totalCols={colCount}
        />
      </div>
    );
  }

  if (variable.type === 'series' && variable.preview && typeof variable.preview === 'object') {
    const entries = Object.entries(variable.preview as Record<string, unknown>).slice(0, 8);
    const length = variable.length ?? entries.length;
    return (
      <div className="notebook-variable-card">
        <div className="notebook-variable-header">
          <VariableTag name={name} />
          <span className="notebook-variable-badge">List</span>
        </div>
        <div className="notebook-result-meta">
          {name} is a list with {length.toLocaleString()} {length === 1 ? 'value' : 'values'}.
        </div>
        <dl className="notebook-result-kv-list">
          {entries.map(([k, v]) => (
            <div key={k} className="notebook-result-kv-item">
              <dt>{k}</dt>
              <dd>{v === null || v === undefined ? '—' : String(v)}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  if (variable.type === 'scalar') {
    return (
      <div className="notebook-variable-card notebook-variable-card--scalar">
        <div className="notebook-variable-header">
          <VariableTag name={name} />
          <span className="notebook-variable-badge">Value</span>
        </div>
        <div className="notebook-result-meta">{name} holds a single value.</div>
        <div className="notebook-result-kpi-value notebook-result-kpi-value--compact">
          {variable.value === null || variable.value === undefined
            ? '—'
            : formatScalarValue(variable.value as number | string | boolean)}
        </div>
      </div>
    );
  }

  return (
    <div className="notebook-variable-card">
      <div className="notebook-variable-header">
        <VariableTag name={name} />
        <span className="notebook-variable-badge">{variable.type}</span>
      </div>
      <div className="notebook-result-fallback">
        {variable.repr ?? JSON.stringify(variable.preview ?? variable.value ?? '—')}
      </div>
    </div>
  );
}

function SubcellDetailPanel({
  lineIndex,
  variableNames,
  variables,
  onClose,
  inline = false,
}: {
  lineIndex: number;
  variableNames: string[];
  variables: Record<string, NotebookVariable>;
  onClose: () => void;
  inline?: boolean;
}) {
  return (
    <div
      className={`dag-notebook-var-panel${inline ? ' dag-notebook-var-panel--inline' : ''}`}
      role="dialog"
      aria-label={`Line ${lineIndex + 1} results`}
    >
      <div className="dag-notebook-var-panel-header">
        <div className="dag-notebook-var-panel-heading">
          <span className="dag-notebook-var-panel-kicker">{inline ? 'Inspect' : 'Details'}</span>
          <span className="dag-notebook-var-panel-label">Line {lineIndex + 1}</span>
          <span className="dag-notebook-var-panel-tags">
            {variableNames.map(n => <VariableTag key={n} name={n} compact />)}
          </span>
        </div>
        <button
          type="button"
          className="dag-notebook-var-panel-close"
          onClick={onClose}
          aria-label="Close variable view"
        >
          ×
        </button>
      </div>
      <div className="dag-notebook-var-panel-body">
        {variableNames.map(varName => (
          variables[varName]
            ? <NotebookVariableCard key={varName} name={varName} variable={variables[varName]} />
            : (
              <div key={varName} className="notebook-variable-card">
                <VariableTag name={varName} />
                <p className="dag-notebook-var-panel-empty">Run this cell to inspect <code>{varName}</code>.</p>
              </div>
            )
        ))}
      </div>
    </div>
  );
}

function CellCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(stripImportLines(code).trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      className="dag-notebook-cell-copy"
      onClick={handleCopy}
      title="Copy cell code"
      aria-label="Copy cell code"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}


function NotebookResultView({
  result,
  hideScalarLabel = false,
}: {
  result?: unknown;
  hideScalarLabel?: boolean;
}) {
  if (result === null || result === undefined) {
    return null;
  }
  return renderNotebookResultValue(result, hideScalarLabel);
}

function renderNotebookResultValue(result: unknown, hideScalarLabel = false): React.ReactNode {
  if (typeof result === 'number' || typeof result === 'boolean') {
    return (
      <div className="notebook-result-kpi">
        {!hideScalarLabel && <div className="notebook-result-kpi-label">Answer</div>}
        <div className="notebook-result-kpi-value">{formatScalarValue(result)}</div>
      </div>
    );
  }

  if (typeof result === 'string') {
    return (
      <div className="notebook-result-kpi">
        {!hideScalarLabel && <div className="notebook-result-kpi-label">Answer</div>}
        <div className="notebook-result-kpi-value notebook-result-kpi-value--text">{result}</div>
      </div>
    );
  }

  if (Array.isArray(result)) {
    if (result.length === 0) {
      return (
        <div className="notebook-result-empty">
          <span className="notebook-result-empty-icon">∅</span>
          <p>No matching records were found.</p>
        </div>
      );
    }
    if (typeof result[0] !== 'object' || result[0] === null || Array.isArray(result[0])) {
      const preview = result.slice(0, NOTEBOOK_MAX_TABLE_ROWS);
      return (
        <div className="notebook-result-table-wrap">
          <div className="notebook-result-meta">{result.length} values</div>
          <table className="notebook-result-table">
            <thead><tr><th>#</th><th>Value</th></tr></thead>
            <tbody>
              {preview.map((v, i) => (
                <tr key={i}>
                  <td className="notebook-result-idx">{i + 1}</td>
                  <td>{v === null || v === undefined ? '—' : String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }

  const records = recordsFromResult(result);
  if (!records) {
    return <div className="notebook-result-fallback">{JSON.stringify(result)}</div>;
  }

  if (records.length === 0) {
    return (
      <div className="notebook-result-empty">
        <span className="notebook-result-empty-icon">∅</span>
        <p>No matching records were found.</p>
      </div>
    );
  }

  const cols = Object.keys(records[0]);
  const dateCol = pickDateColumn(cols, records);
  const numericCols = pickNumericColumns(cols, records, dateCol ?? '');

  if (records.length === 1 && cols.length <= 6) {
    return (
      <div className="notebook-result-kv">
        <div className="notebook-result-meta">The answer is a single record with {cols.length} {cols.length === 1 ? 'field' : 'fields'}.</div>
        <dl className="notebook-result-kv-list">
          {cols.map(c => (
            <div key={c} className="notebook-result-kv-item">
              <dt>{c}</dt>
              <dd>{records[0][c] === null || records[0][c] === undefined ? '—' : String(records[0][c])}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  if (dateCol && numericCols.length > 0 && records.length >= 2) {
    const yCol = numericCols[0];
    const chartStep = Math.max(1, Math.ceil(records.length / NOTEBOOK_MAX_CHART_POINTS));
    const chartData = records.filter((_, i) => i % chartStep === 0).map(r => ({
      ...r,
      [dateCol]: String(r[dateCol]),
    }));
    return (
      <div className="notebook-result-chart-wrap">
        <div className="notebook-result-meta">
          {humanizeFieldName(yCol)} over time · {records.length} data points
        </div>
        <ResponsiveContainer width="100%" height={NOTEBOOK_CHART_HEIGHT}>
          <AreaChart data={chartData} margin={NOTEBOOK_CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.07)" />
            <XAxis
              dataKey={dateCol}
              tick={{ fontSize: 10, fill: '#666' }}
              interval="preserveStartEnd"
              label={rechartsXAxisLabel(humanizeFieldName(dateCol))}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#666' }}
              width={56}
              label={rechartsYAxisLabel(humanizeFieldName(yCol))}
            />
            <Tooltip contentStyle={NOTEBOOK_CHART_TOOLTIP} />
            <Area type="monotone" dataKey={yCol} stroke="#111" fill="var(--accent-dim, rgba(0,255,65,0.25))" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
        {numericCols.length > 1 && (
          <div className="notebook-result-footnote">Chart shows {yCol.replace(/_/g, ' ')}</div>
        )}
      </div>
    );
  }

  if (cols.length === 2 && numericCols.length === 1 && records.length >= 2 && records.length <= 40) {
    const catCol = cols.find(c => c !== numericCols[0]) ?? cols[0];
    const numCol = numericCols[0];
    return (
      <div className="notebook-result-chart-wrap">
        <div className="notebook-result-meta">
          {humanizeFieldName(numCol)} by {humanizeFieldName(catCol)} · {records.length} categories
        </div>
        <ResponsiveContainer width="100%" height={NOTEBOOK_CHART_HEIGHT}>
          <BarChart data={records} margin={NOTEBOOK_CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.07)" />
            <XAxis
              dataKey={catCol}
              tick={{ fontSize: 10, fill: '#666' }}
              interval={0}
              angle={records.length > 8 ? -35 : 0}
              textAnchor={records.length > 8 ? 'end' : 'middle'}
              height={records.length > 8 ? 56 : 32}
              label={rechartsXAxisLabel(humanizeFieldName(catCol))}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#666' }}
              width={56}
              label={rechartsYAxisLabel(humanizeFieldName(numCol))}
            />
            <Tooltip contentStyle={NOTEBOOK_CHART_TOOLTIP} cursor={{ fill: 'rgba(0,255,65,0.06)' }} />
            <Bar dataKey={numCol} fill="#111" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (cols.length === 1 && numericCols.length === 1 && records.length >= 2) {
    const numCol = numericCols[0];
    const chartStep = Math.max(1, Math.ceil(records.length / NOTEBOOK_MAX_CHART_POINTS));
    const chartData = records
      .filter((_, i) => i % chartStep === 0)
      .map((r, i) => ({ idx: i * chartStep + 1, [numCol]: r[numCol] }));
    return (
      <div className="notebook-result-chart-wrap">
        <div className="notebook-result-meta">
          {humanizeFieldName(numCol)} · {records.length} values
        </div>
        <ResponsiveContainer width="100%" height={NOTEBOOK_CHART_HEIGHT}>
          <AreaChart data={chartData} margin={NOTEBOOK_CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.07)" />
            <XAxis
              dataKey="idx"
              tick={{ fontSize: 10, fill: '#666' }}
              label={rechartsXAxisLabel("Index")}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#666' }}
              width={56}
              label={rechartsYAxisLabel(humanizeFieldName(numCol))}
            />
            <Tooltip contentStyle={NOTEBOOK_CHART_TOOLTIP} />
            <Area type="monotone" dataKey={numCol} stroke="#111" fill="var(--accent-dim, rgba(0,255,65,0.25))" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return <NotebookFriendlyTable rows={records} cols={cols} />;
}

// ── Info Panel result renderer ─────────────────────────────────────────────────
const PANEL_MAX_ROWS = 50;

function renderPanelResult(result: any): React.ReactNode {
  if (result === null || result === undefined) return null;

  if (typeof result === 'number' || typeof result === 'string' || typeof result === 'boolean') {
    return <div className="dag-panel-result-scalar">{String(result)}</div>;
  }

  if (Array.isArray(result)) {
    if (result.length === 0) return <div className="dag-panel-result-empty">Empty result</div>;

    if (typeof result[0] === 'object' && result[0] !== null && !Array.isArray(result[0])) {
      const cols = Object.keys(result[0]);
      const rows = result.slice(0, PANEL_MAX_ROWS);
      return (
        <div className="dag-panel-result-table-wrap">
          <table className="dag-panel-result-table">
            <thead><tr>{cols.map(c => <th key={c} title={c}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>{cols.map(c => {
                  const v = row[c];
                  const s = v === null || v === undefined ? '—' : String(v);
                  return <td key={c} title={s}>{s}</td>;
                })}</tr>
              ))}
            </tbody>
          </table>
          {result.length > PANEL_MAX_ROWS && (
            <div className="dag-panel-result-note">Showing {PANEL_MAX_ROWS} of {result.length} rows</div>
          )}
        </div>
      );
    }

    const rows = result.slice(0, PANEL_MAX_ROWS);
    return (
      <div className="dag-panel-result-table-wrap">
        <table className="dag-panel-result-table">
          <thead><tr><th>#</th><th>value</th></tr></thead>
          <tbody>
            {rows.map((v, i) => {
              const s = v === null || v === undefined ? '—' : String(v);
              return <tr key={i}><td className="dag-panel-result-idx">{i}</td><td title={s}>{s}</td></tr>;
            })}
          </tbody>
        </table>
        {result.length > PANEL_MAX_ROWS && (
          <div className="dag-panel-result-note">Showing {PANEL_MAX_ROWS} of {result.length} rows</div>
        )}
      </div>
    );
  }

  if (typeof result === 'object') {
    const cols = Object.keys(result);
    if (cols.length > 0) {
      const firstVal = result[cols[0]];
      if (typeof firstVal === 'object' && firstVal !== null) {
        const indices = Object.keys(firstVal);
        const rows = indices.slice(0, PANEL_MAX_ROWS);
        return (
          <div className="dag-panel-result-table-wrap">
            <table className="dag-panel-result-table">
              <thead><tr><th>#</th>{cols.map(c => <th key={c} title={c}>{c}</th>)}</tr></thead>
              <tbody>
                {rows.map(idx => (
                  <tr key={idx}>
                    <td className="dag-panel-result-idx">{idx}</td>
                    {cols.map(c => {
                      const v = (result[c] as any)?.[idx];
                      const s = v === null || v === undefined ? '—' : String(v);
                      return <td key={c} title={s}>{s}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {indices.length > PANEL_MAX_ROWS && (
              <div className="dag-panel-result-note">Showing {PANEL_MAX_ROWS} of {indices.length} rows</div>
            )}
          </div>
        );
      }
    }
  }

  return <div className="dag-panel-result-empty">{JSON.stringify(result)}</div>;
}

// ── Info Panel ─────────────────────────────────────────────────────────────────
function InfoPanel({
  dagName,
  description,
  onDescriptionChange,
  onDescriptionSave,
  descriptionDirty,
  canSaveDescriptionToFile,
  descriptionSaving,
  nodes,
  execResult,
  execError,
  execLoading,
  execTime,
  pythonCode,
}: {
  dagName: string | null;
  description: string;
  onDescriptionChange: (d: string) => void;
  onDescriptionSave?: () => Promise<void>;
  descriptionDirty: boolean;
  canSaveDescriptionToFile: boolean;
  descriptionSaving: boolean;
  nodes: Node[];
  execResult: any;
  execError: string | null | undefined;
  execLoading: boolean;
  execTime: number | null;
  pythonCode: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(true);
  const [dagOpen, setDagOpen] = useState(true);
  const [pythonOpen, setPythonOpen] = useState(true);
  const [execOpen, setExecOpen] = useState(true);
  const [descriptionSaved, setDescriptionSaved] = useState(false);
  const [execHighlighted, setExecHighlighted] = useState(false);
  const execSectionRef = useRef<HTMLDivElement>(null);

  const hasExecActivity = execLoading
    || (execResult !== null && execResult !== undefined)
    || !!execError;

  // Auto-open panel and surface execution results at the top
  useEffect(() => {
    if (!hasExecActivity) return;

    setOpen(true);
    setExecOpen(true);

    if (execLoading) {
      setInfoOpen(false);
      setDagOpen(false);
      setPythonOpen(false);
      return;
    }

    if ((execResult !== null && execResult !== undefined) || execError) {
      setInfoOpen(false);
      setDagOpen(false);
      setPythonOpen(false);
      setExecHighlighted(true);
      const highlightTimer = window.setTimeout(() => setExecHighlighted(false), 1600);
      const scrollTimer = window.requestAnimationFrame(() => {
        execSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      return () => {
        window.clearTimeout(highlightTimer);
        window.cancelAnimationFrame(scrollTimer);
      };
    }
  }, [execResult, execError, execLoading, hasExecActivity]);

  const handleDescriptionSave = async () => {
    if (!onDescriptionSave || !descriptionDirty) return;
    try {
      await onDescriptionSave();
      setDescriptionSaved(true);
      setTimeout(() => setDescriptionSaved(false), 2000);
    } catch {
      // Error surfaced by App.tsx
    }
  };

  let execStatus: 'not_run' | 'loading' | 'success' | 'error' = 'not_run';
  if (execLoading) execStatus = 'loading';
  else if (execError) execStatus = 'error';
  else if (execResult !== null && execResult !== undefined) execStatus = 'success';

  const nodeCount = nodes.length;
  const opCounts: Record<string, number> = {};
  nodes.forEach((n) => {
    const op = (n.data as any).op as string;
    if (op) opCounts[op] = (opCounts[op] || 0) + 1;
  });
  const outputNode = nodes.find((n) => (n.data as any).isOutput as boolean);

  const statusLabel = execStatus === 'not_run' ? 'Not run'
    : execStatus === 'loading' ? 'Running…'
    : execStatus === 'success' ? 'Success' : 'Error';
  const statusClass = execStatus === 'success' ? 'success'
    : execStatus === 'error' ? 'failed' : 'neutral';

  const parsedSteps = pythonCode ? parsePythonSteps(pythonCode) : [];

  return (
    <div className={`dag-info-wrap${open ? ' open' : ''}`}>
      <button
        type="button"
        className="dag-info-tab"
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Collapse info panel' : 'Expand info panel'}
        aria-label={open ? 'Collapse info panel' : 'Expand info panel'}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {open
            ? <polyline points="15 18 9 12 15 6" />
            : <polyline points="9 18 15 12 9 6" />}
        </svg>
      </button>
      <aside className={`dag-info-panel${open ? ' open' : ''}`}>
        <div className="dag-info-panel-inner">

          {/* ── DAG Execution (first — results surface here) ── */}
          <div
            ref={execSectionRef}
            className={[
              'dag-info-section',
              'dag-info-section--exec',
              hasExecActivity ? 'dag-info-section--exec-active' : '',
              execHighlighted ? 'dag-info-section--exec-fresh' : '',
              execOpen && execStatus === 'success' ? 'dag-info-section--exec-results' : '',
            ].filter(Boolean).join(' ')}
          >
            <button type="button" className="dag-info-section-header" onClick={() => setExecOpen(o => !o)}>
              <span className="dag-panel-title">DAG Execution</span>
              <svg className={`dag-info-chevron${execOpen ? ' open' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {execOpen && (
              <div className="dag-info-section-body">
                <div className="dag-info-exec-row">
                  <span className={`dag-meta-status dag-meta-status--${statusClass}`}>{statusLabel}</span>
                  {execTime !== null && execStatus === 'success' && (
                    <span className="dag-info-exec-time">{execTime.toFixed(2)}s</span>
                  )}
                </div>
                {execStatus === 'loading' && (
                  <div className="dag-info-loading">
                    <div className="loading-dot-row">
                      <div className="loading-dot" /><div className="loading-dot" /><div className="loading-dot" />
                    </div>
                  </div>
                )}
                {execStatus === 'error' && execError && (
                  <pre className="dag-info-error">{translateError(execError)}</pre>
                )}
                {execStatus === 'success' && (
                  <div className="dag-info-result">{renderPanelResult(execResult)}</div>
                )}
              </div>
            )}
          </div>

          {/* ── Information (shared) ──────────────── */}
          <div className="dag-info-section">
            <button type="button" className="dag-info-section-header" onClick={() => setInfoOpen(o => !o)}>
              <span className="dag-panel-title">Information</span>
              <svg className={`dag-info-chevron${infoOpen ? ' open' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {infoOpen && (
              <div className="dag-info-section-body">
                <textarea
                  id="dag-info-description-input"
                  className="dag-info-description-inline"
                  placeholder={dagName || 'Add a description…'}
                  value={description}
                  onChange={(e) => onDescriptionChange(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  aria-label="Description"
                />
                {canSaveDescriptionToFile && (
                  <div className="dag-info-description-actions">
                    <button
                      type="button"
                      className="dag-info-description-save"
                      onClick={handleDescriptionSave}
                      disabled={!descriptionDirty || descriptionSaving}
                    >
                      {descriptionSaving ? 'Saving…' : descriptionSaved ? 'Saved' : 'Save'}
                    </button>
                  </div>
                )}
                {descriptionDirty && !canSaveDescriptionToFile && (
                  <div className="dag-info-description-hint">
                    Open the DAG via Browse to save changes to the file.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── DAG (summary) ───────────────────── */}
          <div className="dag-info-section">
            <button type="button" className="dag-info-section-header" onClick={() => setDagOpen(o => !o)}>
              <span className="dag-panel-title">DAG</span>
              <svg className={`dag-info-chevron${dagOpen ? ' open' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {dagOpen && (
              <div className="dag-info-section-body">
                {nodeCount === 0 ? (
                  <div className="dag-info-empty">No nodes yet</div>
                ) : (
                  <dl className="dag-meta-fields">
                    <div className="dag-meta-field">
                      <dt>Nodes</dt>
                      <dd>{nodeCount}</dd>
                    </div>
                    <div className="dag-meta-field">
                      <dt>Output</dt>
                      <dd>{outputNode ? outputNode.id : '—'}</dd>
                    </div>
                    {Object.keys(opCounts).length > 0 && (
                      <div className="dag-meta-field">
                        <dt>Operations</dt>
                        <dd>
                          {Object.entries(opCounts)
                            .sort(([, a], [, b]) => b - a)
                            .map(([op, cnt]) => (
                              <div key={op} className="dag-info-op-row">
                                <span className="dag-info-op-label">{OP_META[op]?.label || op}</span>
                                <span className="dag-info-op-count">×{cnt}</span>
                              </div>
                            ))}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            )}
          </div>

          {/* ── Python (summary) ──────────────────── */}
          <div className="dag-info-section">
            <button type="button" className="dag-info-section-header" onClick={() => setPythonOpen(o => !o)}>
              <span className="dag-panel-title">Python</span>
              <svg className={`dag-info-chevron${pythonOpen ? ' open' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {pythonOpen && (
              <div className="dag-info-section-body">
                {!pythonCode ? (
                  <div className="dag-info-empty">No Python code available</div>
                ) : (
                  <dl className="dag-meta-fields">
                    <div className="dag-meta-field">
                      <dt>Steps</dt>
                      <dd>{parsedSteps.length}</dd>
                    </div>
                  </dl>
                )}
              </div>
            )}
          </div>

        </div>
      </aside>
    </div>
  );
}
// The former information-panel implementation is intentionally retained only
// as unreachable legacy code while downstream builds transition to the
// answer-first workspace.
void InfoPanel;

interface ColumnInfo {
  names: string[];
  types: Record<string, { data_type: string; semantic_type: string; sample_values?: any[] }>;
}

interface EditState {
  nodeId: string;
  op: string;
  params: Record<string, any>;
}

// ── Custom Node Component ──────────────────────────────────────────────────────
function DAGNodeComponent({ id, data }: NodeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    op, params, columnNames, columnTypes, isOutput, onDelete, onEdit, portConnections, readOnly,
  } = data as any;

  const meta = OP_META[op] || { label: op, icon: '⚙️', summary: '', example: '', category: '' };
  const errors = validateNodeParams(op, params || {}, { names: columnNames || [], types: columnTypes || {} }, [], false);
  const displayId = formatNodeDisplayId(id);
  const inputPortCount = getInputPortCount(op);
  const paramPorts = getConnectableParams(op, PARAM_SCHEMA);
  const connections: Record<string, string> = portConnections || {};

  const handleMouseEnter = () => {
    setIsHovered(true);
    tooltipTimer.current = setTimeout(() => setShowTooltip(true), 600);
  };
  const handleMouseLeave = () => {
    setIsHovered(false);
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setShowTooltip(false);
  };

  const hasErrors = Object.keys(errors).length > 0;
  const schemaParamKeys = Object.keys(PARAM_SCHEMA[op] || {});
  const tooltipParamKeys = schemaParamKeys.length > 0
    ? schemaParamKeys
    : Object.keys(params || {}).filter((k) => !isEmptyParamValue(params[k]));
  const tooltipInputs = inputPortCount > 0
    ? Array.from({ length: inputPortCount }, (_, idx) => {
        const handleId = `input-${idx}`;
        const connected = connections[handleId];
        return {
          label: getInputPortLabel(op, idx),
          value: connected ? `#${formatNodeDisplayId(connected)}` : '—',
        };
      })
    : [];
  const tooltipParams = tooltipParamKeys.map((paramKey) => {
    const handleId = `param-${paramKey}`;
    const connected = connections[handleId];
    const rawValue = params?.[paramKey];
    const value = connected
      ? `#${formatNodeDisplayId(connected)}`
      : formatTooltipParamValue(paramKey, rawValue);
    return { label: PARAM_LABELS[paramKey] || paramKey, value };
  });

  return (
    <div
      className={[
        'dag-node',
        isOutput ? 'output-node' : '',
        hasErrors ? 'dag-node--has-errors' : '',
        paramPorts.length > 0 ? 'dag-node--has-params' : '',
        isHovered ? 'dag-node--hovered' : '',
        showTooltip ? 'dag-node--tooltip-open' : '',
      ].filter(Boolean).join(' ')}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {!readOnly && (
        <button
          type="button"
          className="dag-node-delete"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label="Delete node"
          title="Delete node"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              fill="currentColor"
              d="M5.5 1.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V2h3.5a.5.5 0 0 1 0 1H13v9.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 12.5V3H1.5a.5.5 0 0 1 0-1H5v-.5zm1 0V2h3v-.5H6.5zM4 3v9.5a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V3H4zm2 2h1v6H6V5zm3 0h1v6H9V5z"
            />
          </svg>
        </button>
      )}

      {paramPorts.length > 0 && (
        <div className="dag-node-ports dag-node-ports--params">
          {paramPorts.map((paramKey) => {
            const handleId = `param-${paramKey}`;
            const connected = connections[handleId];
            return (
              <div
                key={handleId}
                className={`dag-port dag-port--param${connected ? ' dag-port--connected' : ''}`}
              >
                <span className="dag-port-label" title={connected ? `from #${formatNodeDisplayId(connected)}` : undefined}>
                  {PARAM_LABELS[paramKey] || paramKey}
                </span>
                <Handle
                  type="target"
                  position={Position.Top}
                  id={handleId}
                  className="dag-port-handle"
                />
              </div>
            );
          })}
        </div>
      )}

      {inputPortCount > 0 && (
        <div className={`dag-node-ports dag-node-ports--in${inputPortCount > 1 ? ' dag-node-ports--dual' : ''}`}>
          {Array.from({ length: inputPortCount }, (_, idx) => {
            const handleId = `input-${idx}`;
            const label = getInputPortLabel(op, idx);
            const connected = connections[handleId];
            return (
              <div
                key={handleId}
                className={`dag-port dag-port--target${connected ? ' dag-port--connected' : ''}`}
                style={inputPortCount > 1 ? { top: idx === 0 ? '30%' : '70%' } : undefined}
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={handleId}
                  className="dag-port-handle"
                />
                <span className="dag-port-label" title={connected ? `from #${formatNodeDisplayId(connected)}` : undefined}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="dag-node-ports dag-node-ports--out">
        <span className="dag-port-label">output</span>
        <Handle type="source" position={Position.Right} id="output" className="dag-port-handle" />
      </div>

      {showTooltip && (
        <div className="dag-node-tooltip">
          <div className="dag-node-tooltip-title">{meta.icon} {meta.label}</div>
          <div className="dag-node-tooltip-desc">{meta.summary}</div>
          {meta.example && <div className="dag-node-tooltip-example">e.g. {meta.example}</div>}
          {(tooltipInputs.length > 0 || tooltipParams.length > 0) && (
            <div className="dag-node-tooltip-params">
              {tooltipInputs.length > 0 && (
                <>
                  <div className="dag-node-tooltip-params-heading">Inputs</div>
                  {tooltipInputs.map(({ label, value }) => (
                    <div key={label} className="dag-node-tooltip-param-row">
                      <span className="dag-node-tooltip-param-label">{label}</span>
                      <span className="dag-node-tooltip-param-value">{value}</span>
                    </div>
                  ))}
                </>
              )}
              {tooltipParams.length > 0 && (
                <>
                  <div className="dag-node-tooltip-params-heading">Parameters</div>
                  {tooltipParams.map(({ label, value }) => (
                    <div key={label} className="dag-node-tooltip-param-row">
                      <span className="dag-node-tooltip-param-label">{label}</span>
                      <span className="dag-node-tooltip-param-value">{value}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="dag-node-header">
        <span className="dag-node-id" title={id}>#{displayId}</span>
        <span className="dag-node-icon">{meta.icon}</span>
        <span className="dag-node-title">{meta.label}</span>
        {isOutput && <span className="dag-node-badge output">Output</span>}
        {hasErrors && <span className="dag-node-badge error-badge">⚠</span>}
      </div>

      {hasErrors && (
        <div className="dag-node-errors">
          <button className="dag-node-errors-toggle" onClick={() => setShowErrors(!showErrors)}>
            ⚠ {Object.keys(errors).length} error{Object.keys(errors).length > 1 ? 's' : ''}
          </button>
          {showErrors && (
            <div className="dag-node-errors-list">
              {Object.entries(errors).map(([k, msg]) => (
                <div key={k} className="dag-node-error-item">
                  <strong>{PARAM_LABELS[k] || k}:</strong> {msg}
                </div>
              ))}
              <button className="dag-node-errors-close" onClick={() => setShowErrors(false)}>✕</button>
            </div>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="dag-node-footer">
          <button className="dag-node-action-btn info-btn" onClick={() => onEdit()}>Edit</button>
        </div>
      )}
    </div>
  );
}

export const dagNodeTypes = { dagNode: DAGNodeComponent };
const nodeTypes = dagNodeTypes;

// ── Examples Gallery Modal ────────────────────────────────────────────────────
function ExamplesModal({
  onClose,
  onLoad,
}: {
  onClose: () => void;
  onLoad: (file: AppDAGFile) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(
    () =>
      search.trim()
        ? EXAMPLE_DAGS.filter((ex) =>
            ex.name.toLowerCase().includes(search.toLowerCase()),
          )
        : EXAMPLE_DAGS,
    [search],
  );

  return (
    <div className="dag-modal-backdrop" onClick={onClose}>
      <div
        className="dag-modal dag-modal--examples"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Example queries"
      >
        <div className="dag-modal-header">
          <span className="dag-modal-title">Example Queries</span>
          <button className="dag-modal-close" onClick={onClose} aria-label="Close examples">×</button>
        </div>
        <p className="dag-examples-hint">
          These examples use the Online Retail dataset. Select one to load it into the editor.
        </p>
        <input
          className="dag-examples-search"
          type="search"
          placeholder="Filter examples…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Filter example queries"
        />
        <div className="dag-examples-list">
          {filtered.map((ex, i) => (
            <button
              key={i}
              className="dag-examples-item"
              onClick={() => { onLoad(ex); onClose(); }}
            >
              <span className="dag-examples-item-name">{ex.name}</span>
              {ex.python_code && (
                <span className="dag-examples-item-badge">Python</span>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="dag-examples-empty">No examples match "{search}"</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Node Library Modal ─────────────────────────────────────────────────────────
function NodeLibraryModal({ onClose, onAdd }: { onClose: () => void; onAdd: (op: string) => void }) {
  const [search, setSearch] = useState('');
  const filtered = Object.entries(OP_META).filter(([op, m]) => {
    const q = search.toLowerCase();
    return !q || op.includes(q) || m.label.toLowerCase().includes(q) || m.summary.toLowerCase().includes(q);
  });

  const grouped: Record<string, typeof filtered> = {};
  filtered.forEach(([op, m]) => {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push([op, m]);
  });

  return (
    <div className="dag-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dag-modal">
        <div className="dag-modal-header">
          <div className="dag-modal-title">Add Operation</div>
          <input
            className="dag-modal-search"
            placeholder="Search operations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="dag-modal-body">
          {Object.entries(grouped).map(([cat, ops]) => (
            <div key={cat} className="dag-modal-category">
              <div className="dag-modal-category-title">{CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat] || cat}</div>
              <div className="dag-modal-ops-grid">
                {ops.map(([op, m]) => (
                  <div key={op} className="dag-op-tile" onClick={() => { onAdd(op); onClose(); }}>
                    <div className="dag-op-tile-icon">{m.icon}</div>
                    <div className="dag-op-tile-name">{m.label}</div>
                    <div className="dag-op-tile-sum">{m.summary.substring(0, 55)}{m.summary.length > 55 ? '…' : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Edit Node Modal ────────────────────────────────────────────────────────────
function EditNodeModal({ edit, onSave, onDelete, onClose, columnInfo, filePath, nodeIds }: { edit: EditState; onSave: (params: Record<string, any>) => void; onDelete: () => void; onClose: () => void; columnInfo: ColumnInfo; filePath: string; nodeIds: string[] }) {
  const meta = OP_META[edit.op];
  const allowedParams = meta?.params || Object.keys(edit.params);
  const requiredSet = new Set(meta?.required_params || []);
  const opParamKinds = PARAM_KINDS[edit.op] || {};
  const opSchema = PARAM_SCHEMA[edit.op] || {};

  const [params, setParams] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    if (meta) {
      for (const p of allowedParams) {
        init[p] = edit.params[p] !== undefined ? edit.params[p] : '';
      }
    } else {
      Object.assign(init, edit.params);
    }
    return init;
  });

  // ── groupby_column vs groupby_columns mutual exclusivity ──
  const hasGroupbyCol = edit.op === 'groupby_agg';
  const [groupbyMode, setGroupbyMode] = useState<'single' | 'multiple'>(() => {
    if (edit.params.groupby_columns && Array.isArray(edit.params.groupby_columns) && edit.params.groupby_columns.length > 0) return 'multiple';
    return 'single';
  });

  // ── Condition multi-row editor ──
  const conditionKey = meta?.params?.includes('condition') ? 'condition' : null;
  const [condRows, setCondRows] = useState<SubCondition[]>(() => {
    if (conditionKey && params[conditionKey]) {
      return parseCompoundCondition(params[conditionKey]);
    }
    return [];
  });
  const [columnValues, setColumnValues] = useState<Record<string, string[]>>({});
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [nodeIdDraft, setNodeIdDraft] = useState('');
  const [stringListDraft, setStringListDraft] = useState('');
  const [saveAttempted, setSaveAttempted] = useState(false);

  const graphNodeIds = nodeIds.filter((id) => id !== edit.nodeId);

  const saveErrors: Record<string, string> = validateNodeParams(edit.op, params, columnInfo, graphNodeIds, true);
  const canSave = Object.keys(saveErrors).length === 0;

  const updateParam = (key: string, value: any) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const handleNumericChange = (key: string, schema: z.ZodTypeAny, raw: string) => {
    const parsed = parseBoundedNumber(schema, raw);
    if (parsed === null) return;
    updateParam(key, parsed);
  };

  // Fetch distinct column values for categorical columns
  const fetchColumnValues = async (col: string) => {
    if (!filePath || !col || columnValues[col]) return;
    try {
      const r = await sidecarFetch(`${SIDECAR_API}/column_values?source_path=${encodeURIComponent(filePath)}&column=${encodeURIComponent(col)}&limit=200`);
      const data = await r.json();
      if (data.status === 'success' && data.values) {
        setColumnValues((prev) => ({ ...prev, [col]: data.values }));
      }
    } catch { /* ignore */ }
  };

  // Sync condition rows back to params
  useEffect(() => {
    if (!conditionKey) return;
    const validRows = condRows.filter(r => r.raw);
    if (validRows.length === 0) {
      if (params[conditionKey] !== '') updateParam(conditionKey, '');
      return;
    }
    let formatted = '';
    for (const row of validRows) {
      if (row.join) formatted += ` ${row.join} `;
      if (row.parsed) {
        formatted += formatCondition(row.parsed.column, row.parsed.comparator, row.parsed.value);
      } else {
        formatted += row.raw;
      }
    }
    if (params[conditionKey] !== formatted) {
      updateParam(conditionKey, formatted);
    }
  }, [condRows]);

  // Fetch full column values from API on mount for any condition columns
  useEffect(() => {
    if (!conditionKey || !filePath) return;
    for (const row of condRows) {
      const col = row.parsed?.column;
      if (col && !columnValues[col]) fetchColumnValues(col);
    }
  }, []); // only on mount

  // Surface loading state when columns are not yet available
  useEffect(() => {
    if (!filePath || columnInfo.names.length > 0) {
      setColumnsLoading(false);
      return;
    }
    setColumnsLoading(true);
    let cancelled = false;
    sidecarFetch(`${SIDECAR_API}/data_summary?source_path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.status !== 'success') setColumnsLoading(false);
      })
      .catch(() => { if (!cancelled) setColumnsLoading(false); });
    return () => { cancelled = true; };
  }, [filePath, columnInfo.names.length]);

  const updateCondRow = (idx: number, upd: Partial<SubCondition>) => {
    setCondRows((prev) => {
      const next = [...prev];
      const row = { ...next[idx], ...upd };
      // Re-parse if raw changed
      if (upd.raw !== undefined && upd.raw !== row.raw) {
        const p = parseCondition(row.raw);
        if (p) { row.parsed = p; row.error = undefined; }
        else row.error = 'Does not match format: column operator value';
      }
      // Re-parse if parsed components changed
      if (upd.parsed !== undefined) {
        const p = row.parsed;
        if (p) {
          row.raw = formatCondition(p.column, p.comparator, p.value);
          row.error = undefined;
        }
      }
      next[idx] = row;
      return next;
    });
  };

  const addCondRow = () => {
    setCondRows((prev) => {
      const join = prev.length > 0 ? 'and' : undefined;
      return [...prev, { raw: '', join: join as 'and' | 'or' | undefined }];
    });
  };

  const removeCondRow = (idx: number) => {
    setCondRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const renderField = (k: string) => {
    const kind = opParamKinds[k] || '';
    const label = PARAM_LABELS[k] || k;

    // ── source_column: dropdown of available column names ──
    if (kind === 'source_column') {
      const noColumns = columnInfo.names.length === 0;
      return (
        <div key={k} className="dag-edit-field">
          <div className="dag-edit-label">
            {label}
            {requiredSet.has(k) && <span className="dag-required-star">*</span>}
          </div>
          <select
            className="dag-edit-select"
            value={params[k] ?? ''}
            disabled={noColumns}
            onChange={(e) => updateParam(k, e.target.value)}
          >
            <option value="">{noColumns ? (columnsLoading ? 'Loading columns…' : 'No columns available') : 'Select column...'}</option>
            {columnInfo.names.map((col) => (
              <option key={col} value={col}>{col}</option>
            ))}
          </select>
          {noColumns && !columnsLoading && (
            <div className="dag-edit-field-note">
              {filePath ? 'Could not load columns for this file.' : 'Open a data file on the Home tab first.'}
            </div>
          )}
        </div>
      );
    }

    // ── agg_function: dropdown of aggregation functions ──
    if (kind === 'agg_function') {
      return (
        <div key={k} className="dag-edit-field">
          <div className="dag-edit-label">
            {label}
            {requiredSet.has(k) && <span className="dag-required-star">*</span>}
          </div>
          <select
            className="dag-edit-select"
            value={params[k] ?? ''}
            onChange={(e) => updateParam(k, e.target.value)}
          >
            <option value="">Select function...</option>
            {AGG_FUNCTIONS.map((fn) => (
              <option key={fn} value={fn}>{fn}</option>
            ))}
          </select>
        </div>
      );
    }

    // ── literal_bool: dropdown ──
    if (kind === 'literal_bool') {
      const fieldSchema = opSchema[k]?.schema;
      const optional = fieldSchema ? !isZodRequired(fieldSchema) : false;
      const normalizedBool = normalizeLiteralBool(params[k]);
      const boolVal = normalizedBool === 'true' || normalizedBool === 'false' ? normalizedBool : '';
      return (
        <div key={k} className="dag-edit-field">
          <div className="dag-edit-label">
            {label}
            {requiredSet.has(k) && <span className="dag-required-star">*</span>}
          </div>
          <select
            className="dag-edit-select"
            value={boolVal}
            onChange={(e) => updateParam(k, e.target.value === '' ? '' : e.target.value)}
          >
            {optional && <option value="">Default</option>}
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </div>
      );
    }

    // ── literal_int: number input (integers only) — delegates to zodInputProps ──
    if (kind === 'literal_int') {
      const fieldSchema = opSchema[k]?.schema ?? z.number().int();
      const ip = zodInputProps(fieldSchema);
      return (
        <div key={k} className="dag-edit-field">
          <div className="dag-edit-label">
            {label}
            {requiredSet.has(k) && <span className="dag-required-star">*</span>}
          </div>
          <input
            className="dag-edit-input"
            type="number"
            step={ip.step}
            min={ip.min}
            max={ip.max}
            inputMode={ip.inputMode}
            value={params[k] ?? ''}
            onKeyDown={ip.onKeyDown}
            onPaste={ip.onPaste}
            onChange={(e) => handleNumericChange(k, fieldSchema, e.target.value)}
          />
        </div>
      );
    }

    // ── node_id: dropdown of graph node ids ──
    if (kind === 'node_id') {
      return (
        <div key={k} className="dag-edit-field">
          <div className="dag-edit-label">
            {label}
            {requiredSet.has(k) && <span className="dag-required-star">*</span>}
          </div>
          <select
            className="dag-edit-select"
            value={params[k] ?? ''}
            onChange={(e) => updateParam(k, e.target.value)}
          >
            <option value="">Select node...</option>
            {graphNodeIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
          {graphNodeIds.length === 0 && (
            <div className="dag-edit-field-note">Connect upstream nodes to this operation first.</div>
          )}
        </div>
      );
    }

    // ── column_or_node_list: multi-select columns + optional node ids ──
    if (kind === 'column_or_node_list') {
      const selected: string[] = Array.isArray(params[k]) ? params[k] : [];
      const unusedCols = columnInfo.names.filter((c) => !selected.includes(c));
      const unusedNodes = graphNodeIds.filter((id) => !selected.includes(id));

      const addEntry = (entry: string) => {
        if (!entry || selected.includes(entry)) return;
        updateParam(k, [...selected, entry]);
      };
      const removeEntry = (entry: string) => {
        updateParam(k, selected.filter((x) => x !== entry));
      };

      return (
        <div key={k} className="dag-edit-field">
          <div className="dag-edit-label">
            {label}
            {requiredSet.has(k) && <span className="dag-required-star">*</span>}
          </div>
          {selected.length > 0 && (
            <div className="dag-column-list">
              {selected.map((item) => (
                <div key={item} className="dag-column-list-item">
                  <span>{item}{isNodeId(item) ? ' (node)' : ''}</span>
                  <button type="button" className="dag-column-list-remove" onClick={() => removeEntry(item)}>✕</button>
                </div>
              ))}
            </div>
          )}
          <select
            className="dag-edit-select"
            value=""
            disabled={unusedCols.length === 0}
            onChange={(e) => { if (e.target.value) addEntry(e.target.value); }}
          >
            <option value="">{unusedCols.length ? 'Add column…' : 'All columns added'}</option>
            {unusedCols.map((col) => (
              <option key={col} value={col}>{col}</option>
            ))}
          </select>
          {unusedNodes.length > 0 && (
            <div className="dag-column-list-add-node">
              <select
                className="dag-edit-select"
                value={nodeIdDraft}
                onChange={(e) => {
                  const v = e.target.value;
                  setNodeIdDraft(v);
                  if (v) { addEntry(v); setNodeIdDraft(''); }
                }}
              >
                <option value="">Add computed column (node)…</option>
                {unusedNodes.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      );
    }

    // ── literal_string_list: tag list of free-form strings (e.g. isin values) ──
    if (kind === 'literal_string_list') {
      const selected: string[] = Array.isArray(params[k]) ? params[k] : [];
      return (
        <div key={k} className="dag-edit-field">
          <div className="dag-edit-label">
            {label}
            {requiredSet.has(k) && <span className="dag-required-star">*</span>}
          </div>
          {selected.length > 0 && (
            <div className="dag-column-list">
              {selected.map((item) => (
                <div key={item} className="dag-column-list-item">
                  <span>{item}</span>
                  <button
                    type="button"
                    className="dag-column-list-remove"
                    onClick={() => updateParam(k, selected.filter((x) => x !== item))}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="dag-string-list-add">
            <input
              className="dag-edit-input"
              value={stringListDraft}
              placeholder="Type a value and press Add"
              onChange={(e) => setStringListDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && stringListDraft.trim()) {
                  e.preventDefault();
                  const v = stringListDraft.trim();
                  if (!selected.includes(v)) updateParam(k, [...selected, v]);
                  setStringListDraft('');
                }
              }}
            />
            <button
              type="button"
              className="dag-cond-add-btn"
              disabled={!stringListDraft.trim()}
              onClick={() => {
                const v = stringListDraft.trim();
                if (!v || selected.includes(v)) return;
                updateParam(k, [...selected, v]);
                setStringListDraft('');
              }}
            >Add</button>
          </div>
        </div>
      );
    }

    // ── condition: structured editor with multi-row + and/or connectors ──
    if (kind === 'condition') {
      return (
        <div key={k} className="dag-edit-field">
          <div className="dag-edit-label">
            {label} (Where)
            {requiredSet.has(k) && <span className="dag-required-star">*</span>}
          </div>

          {condRows.map((row, idx) => (
            <div key={idx}>
              {/* Join connector (and/or) between rows */}
              {row.join && idx > 0 && (
                <div className="dag-cond-connector">
                  <select
                    className="dag-cond-join-select"
                    value={row.join}
                    onChange={(e) => updateCondRow(idx, { join: e.target.value as 'and' | 'or' })}
                  >
                    <option value="and">AND</option>
                    <option value="or">OR</option>
                  </select>
                </div>
              )}

              <div className="dag-condition-row">
                <select
                  className="dag-edit-select dag-condition-col"
                  value={row.parsed?.column || ''}
                  onChange={(e) => {
                    const col = e.target.value;
                    const p = row.parsed || { column: '', comparator: '==', value: '' };
                    const newParsed = { ...p, column: col };
                    const raw = col ? formatCondition(newParsed.column, newParsed.comparator, newParsed.value) : '';
                    setCondRows((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], parsed: newParsed, raw, error: undefined };
                      return next;
                    });
                    if (col) fetchColumnValues(col);
                  }}
                >
                  <option value="">Column...</option>
                  {columnInfo.names.map((col) => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>

                <select
                  className="dag-edit-select dag-condition-comp"
                  value={row.parsed?.comparator || '=='}
                  onChange={(e) => {
                    const p = row.parsed || { column: '', comparator: '==', value: '' };
                    const newParsed = { ...p, comparator: e.target.value };
                    const raw = newParsed.column ? formatCondition(newParsed.column, newParsed.comparator, newParsed.value) : '';
                    setCondRows((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], parsed: newParsed, raw, error: undefined };
                      return next;
                    });
                  }}
                >
                  {COMPARATORS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>

                {/* Value: type-aware input */}
                {renderCondValueInput(row, idx, columnValues, setCondRows, columnInfo)}
              </div>

              {row.error && (
                <div className="dag-cond-row-error">{row.error}</div>
              )}
              {!row.parsed && !row.error && (
                <div className="dag-cond-raw-hint">{row.raw}</div>
              )}

              <button className="dag-cond-row-remove" onClick={() => removeCondRow(idx)}>✕ Remove</button>
            </div>
          ))}

          <button className="dag-cond-add-btn" onClick={addCondRow}>+ Add Condition</button>
        </div>
      );
    }

    // ── column_or_node: column dropdown or upstream node id ──
    if (kind === 'column_or_node') {
      const currentVal = params[k] ?? '';
      const isColumn = columnInfo.names.includes(currentVal);
      const isKnownNode = isNodeId(currentVal) && graphNodeIds.includes(currentVal);
      const selectValue = isColumn ? currentVal : (isKnownNode ? currentVal : (graphNodeIds.length ? '__node__' : ''));
      return (
        <div key={k} className="dag-edit-field">
          <div className="dag-edit-label">
            {label}
            {requiredSet.has(k) && <span className="dag-required-star">*</span>}
          </div>
          <select
            className="dag-edit-select"
            value={selectValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__node__') {
                updateParam(k, graphNodeIds[0] || '');
              } else {
                updateParam(k, v);
              }
            }}
          >
            <option value="">Select column or node...</option>
            {columnInfo.names.map((col) => (
              <option key={col} value={col}>{col}</option>
            ))}
            {graphNodeIds.length > 0 && <option value="__node__">Upstream node…</option>}
          </select>
          {(selectValue === '__node__' || (isKnownNode && !isColumn)) && graphNodeIds.length > 0 && (
            <select
              className="dag-edit-select"
              style={{ marginTop: 6 }}
              value={isKnownNode ? currentVal : (graphNodeIds[0] || '')}
              onChange={(e) => updateParam(k, e.target.value)}
            >
              {graphNodeIds.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          )}
        </div>
      );
    }

    // ── literal_list: JSON array text input ──
    if (kind === 'literal_list') {
      return (
        <div key={k} className="dag-edit-field">
          <div className="dag-edit-label">
            {label}
            {requiredSet.has(k) && <span className="dag-required-star">*</span>}
          </div>
          <input
            className="dag-edit-input"
            value={Array.isArray(params[k]) ? JSON.stringify(params[k]) : String(params[k] ?? '')}
            placeholder='e.g. ["USA","UK"]'
            onChange={(e) => {
              let parsed: any = e.target.value;
              try { parsed = JSON.parse(e.target.value); } catch { parsed = e.target.value; }
              updateParam(k, parsed);
            }}
          />
        </div>
      );
    }

    // ── Zod enum dropdown (catch-all for truncate_to.unit, date_add.unit, etc.) ──
    const paramField = opSchema[k];
    const enumOptions = paramField ? zodEnumValues(paramField.schema) : [];
    if (enumOptions.length > 0) {
      return (
        <div key={k} className="dag-edit-field">
          <div className="dag-edit-label">
            {label}
            {requiredSet.has(k) && <span className="dag-required-star">*</span>}
          </div>
          <select
            className="dag-edit-select"
            value={String(params[k] ?? '')}
            onChange={(e) => updateParam(k, e.target.value)}
          >
            <option value="">Select {label.toLowerCase()}...</option>
            {enumOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    }

    // ── Default: free-form input (literal_scalar, format_string, node_id, etc.) ──
    // Zod type tells us number vs text input, and which key/paste/range guards to apply
    const inputProps = paramField ? zodInputProps(paramField.schema) : { type: 'text' as const };
    if (inputProps.type === 'number') {
      return (
        <div key={k} className="dag-edit-field">
          <div className="dag-edit-label">
            {label}
            {requiredSet.has(k) && <span className="dag-required-star">*</span>}
          </div>
          <input
            className="dag-edit-input"
            type="number"
            step={inputProps.step}
            min={inputProps.min}
            max={inputProps.max}
            inputMode={inputProps.inputMode}
            value={params[k] ?? ''}
            onKeyDown={inputProps.onKeyDown}
            onPaste={inputProps.onPaste}
            onChange={(e) => handleNumericChange(k, paramField!.schema, e.target.value)}
          />
        </div>
      );
    }
    return (
      <div key={k} className="dag-edit-field">
        <div className="dag-edit-label">
          {label}
          {requiredSet.has(k) && <span className="dag-required-star">*</span>}
        </div>
        <input
          className="dag-edit-input"
          value={typeof params[k] === 'object' ? JSON.stringify(params[k]) : String(params[k] ?? '')}
          onChange={(e) => {
            const fieldSchema = paramField?.schema;
            if (fieldSchema && zodInner(fieldSchema) instanceof z.ZodString) {
              const result = fieldSchema.safeParse(e.target.value);
              if (!result.success) return;
              updateParam(k, result.data);
              return;
            }
            updateParam(k, e.target.value);
          }}
        />
      </div>
    );
  };

  function renderCondValueInput(
    row: SubCondition,
    idx: number,
    columnValues: Record<string, string[]>,
    setCondRows: React.Dispatch<React.SetStateAction<SubCondition[]>>,
    columnInfo: ColumnInfo
  ) {
    const col = row.parsed?.column || '';
    const colType = columnInfo.types[col]?.data_type;
    const colSemType = columnInfo.types[col]?.semantic_type;
    const vals = columnValues[col] || [];

    // For categorical / string columns with known values, show searchable dropdown
    if (col && (colType === 'string' || colSemType === 'categorical') && vals.length > 0) {
      return (
        <div className="dag-cond-val-wrapper">
          <input
            className="dag-edit-input dag-condition-val"
            list={`cond-vals-${idx}`}
            value={row.parsed?.value || ''}
            placeholder="Select or type value..."
            onChange={(e) => {
              const p = row.parsed || { column: col, comparator: '==', value: '' };
              const newParsed = { ...p, value: e.target.value };
              const raw = newParsed.column ? formatCondition(newParsed.column, newParsed.comparator, newParsed.value) : '';
              setCondRows((prev) => {
                const next = [...prev];
                next[idx] = { ...next[idx], parsed: newParsed, raw, error: undefined };
                return next;
              });
            }}
          />
          <datalist id={`cond-vals-${idx}`}>
            {vals.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>
      );
    }

    if (colType === 'int' || colType === 'float') {
      const ip = zodInputProps(colType === 'int' ? z.number().int() : z.number());
      return (
        <input
          className="dag-edit-input dag-condition-val"
          type="number"
          step={ip.step}
          inputMode={ip.inputMode}
          value={row.parsed?.value || ''}
          placeholder="value"
          onKeyDown={ip.onKeyDown}
          onPaste={ip.onPaste}
          onChange={(e) => {
            const p = row.parsed || { column: col, comparator: '==', value: '' };
            const newParsed = { ...p, value: e.target.value };
            const raw = newParsed.column ? formatCondition(newParsed.column, newParsed.comparator, newParsed.value) : '';
            setCondRows((prev) => {
              const next = [...prev];
              next[idx] = { ...next[idx], parsed: newParsed, raw, error: undefined };
              return next;
            });
          }}
        />
      );
    }

    if (colType === 'date') {
      return (
        <input
          className="dag-edit-input dag-condition-val"
          type="text"
          value={row.parsed?.value || ''}
          placeholder="YYYY-MM-DD"
          onChange={(e) => {
            const p = row.parsed || { column: col, comparator: '==', value: '' };
            const newParsed = { ...p, value: e.target.value };
            const raw = newParsed.column ? formatCondition(newParsed.column, newParsed.comparator, newParsed.value) : '';
            setCondRows((prev) => {
              const next = [...prev];
              next[idx] = { ...next[idx], parsed: newParsed, raw, error: undefined };
              return next;
            });
          }}
        />
      );
    }

    // Default: text input with datalist from API column_values (full list, not just metadata samples)
    const apiVals = columnValues[col];
    if (col && apiVals && apiVals.length > 0) {
      const currentVal = row.parsed?.value || '';
      const isKnown = apiVals.some(v => String(v) === currentVal.replace(/^['"]|['"]$/g, ''));
      return (
        <div className="dag-cond-val-wrapper">
          <input
            className={`dag-edit-input dag-condition-val${currentVal && !isKnown ? ' dag-cond-val--unknown' : ''}`}
            list={`cond-vals-${idx}`}
            value={currentVal}
            placeholder="Select or type value..."
            onChange={(e) => {
              const p = row.parsed || { column: col, comparator: '==', value: '' };
              const newParsed = { ...p, value: e.target.value };
              const raw = newParsed.column ? formatCondition(newParsed.column, newParsed.comparator, newParsed.value) : '';
              setCondRows((prev) => {
                const next = [...prev];
                next[idx] = { ...next[idx], parsed: newParsed, raw, error: undefined };
                return next;
              });
            }}
          />
          <datalist id={`cond-vals-${idx}`}>
            {apiVals.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          {currentVal && !isKnown && (
            <div className="dag-cond-val-warning">Value not found in known column values</div>
          )}
        </div>
      );
    }

    return (
      <input
        className="dag-edit-input dag-condition-val"
        type="text"
        value={row.parsed?.value || ''}
        placeholder={col ? 'Loading values...' : 'value'}
        onChange={(e) => {
          const p = row.parsed || { column: col, comparator: '==', value: '' };
          const newParsed = { ...p, value: e.target.value };
          const raw = newParsed.column ? formatCondition(newParsed.column, newParsed.comparator, newParsed.value) : '';
          setCondRows((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], parsed: newParsed, raw, error: undefined };
            return next;
          });
        }}
      />
    );
  }

  return (
    <div className="dag-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dag-edit-modal">
        <div className="dag-edit-title">
          <span className="dag-edit-node-id">#{formatNodeDisplayId(edit.nodeId)}</span>
          {meta?.icon || '⚙️'} {meta?.label || edit.op}
        </div>

        {/* ── groupby_column / groupby_columns mutual exclusivity ── */}
        {hasGroupbyCol && (
          <div className="dag-edit-field">
            <div className="dag-edit-label">Group By</div>
            <div className="dag-groupby-toggle">
              <button
                className={`dag-groupby-btn${groupbyMode === 'single' ? ' active' : ''}`}
                onClick={() => {
                  setGroupbyMode('single');
                  updateParam('groupby_columns', []);
                }}
              >Single Column</button>
              <button
                className={`dag-groupby-btn${groupbyMode === 'multiple' ? ' active' : ''}`}
                onClick={() => {
                  setGroupbyMode('multiple');
                  updateParam('groupby_column', '');
                }}
              >Multiple Columns</button>
            </div>
          </div>
        )}

        {allowedParams.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1.5rem 0', color: '#5a5a80', fontSize: '0.78rem' }}>
            This operation has no configurable parameters.
          </div>
        ) : (
          allowedParams.map((k) => {
            // Skip rendering groupby_column in multi mode, groupby_columns in single mode
            if (hasGroupbyCol) {
              if (k === 'groupby_column' && groupbyMode === 'multiple') return null;
              if (k === 'groupby_columns' && groupbyMode === 'single') return null;
            }
            const error = saveAttempted ? saveErrors[k] : undefined;
            const showError = !!error;
            return (
              <div key={k}>
                {renderField(k)}
                {showError && <div className="dag-field-error">{error}</div>}
              </div>
            );
          })
        )}
        <div className="dag-edit-actions">
          <button className="btn-danger" onClick={onDelete}>🗑 Delete Node</button>
          <button className="dag-edit-cancel btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="dag-edit-save btn-primary"
            disabled={!canSave}
            title={!canSave ? 'Fix validation errors before saving' : undefined}
            onClick={() => {
              setSaveAttempted(true);
              const errors = validateNodeParams(edit.op, params, columnInfo, graphNodeIds, true);
              if (Object.keys(errors).length === 0) {
                onSave(params);
              }
            }}
          >Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Notebook cell output ───────────────────────────────────────────────────────
function NotebookCellOutput({
  output,
  stepIndex,
  sections,
  executedSteps,
  isLastCell,
}: {
  output: PythonCellOutput;
  stepIndex: number;
  sections: { desc?: string; code: string }[];
  executedSteps: Set<number>;
  isLastCell: boolean;
}) {
  if (output.status === 'loading') {
    return (
      <div className="dag-notebook-cell-output dag-notebook-cell-output--loading">
        <div className="loading-dot-row">
          <div className="loading-dot" /><div className="loading-dot" /><div className="loading-dot" />
        </div>
      </div>
    );
  }
  if (output.status === 'error' && output.error) {
    const errorInfo = formatNotebookError(output.error, stepIndex, sections, executedSteps);
    return (
      <div className="dag-notebook-cell-output dag-notebook-cell-output--error">
        <div className="dag-notebook-cell-error-card">
          <div className="dag-notebook-cell-error-title">{errorInfo.title}</div>
          <p className="dag-notebook-cell-error-message">{errorInfo.message}</p>
          {errorInfo.action && (
            <div className="dag-notebook-cell-error-action">
              <span className="dag-notebook-cell-error-action-label">What to do</span>
              <p>{errorInfo.action}</p>
            </div>
          )}
          {errorInfo.detail && errorInfo.detail !== errorInfo.message && (
            <details className="dag-notebook-cell-error-detail">
              <summary>Technical details</summary>
              <pre>{errorInfo.detail}</pre>
            </details>
          )}
        </div>
      </div>
    );
  }
  if (output.status === 'success') {
    const hasStdout = Boolean(output.stdout?.trim());
    const hasResult = output.result !== null && output.result !== undefined;
    const showResult = isLastCell && hasResult;
    if (!hasStdout && !showResult) {
      return null;
    }
    return (
      <div className="dag-notebook-cell-output dag-notebook-cell-output--success">
        {hasStdout && (
          <div className="dag-notebook-cell-stdout">
            <div className="dag-notebook-cell-result-header">
              <span className="dag-notebook-cell-result-kicker">Output</span>
            </div>
            <pre className="dag-notebook-cell-stdout-text">{output.stdout}</pre>
          </div>
        )}
        {showResult && (
          <div className="dag-notebook-cell-result">
            <div className="dag-notebook-cell-result-header">
              <span className="dag-notebook-cell-result-kicker">Result</span>
              <p className="dag-notebook-cell-result-subtitle">Final answer returned by this cell.</p>
            </div>
            <div className="dag-notebook-cell-result-body">
              <NotebookResultView result={output.result} hideScalarLabel />
            </div>
          </div>
        )}
      </div>
    );
  }
  return null;
}

function NotebookCodeLine({ code }: { code: string }) {
  return (
    <SyntaxHighlighter
      language="python"
      style={vscDarkPlus}
      PreTag="span"
      CodeTag="code"
      customStyle={{
        margin: 0,
        background: 'transparent',
        fontSize: '0.8rem',
        lineHeight: 1.5,
        display: 'inline',
        padding: 0,
      }}
    >
      {code || ' '}
    </SyntaxHighlighter>
  );
}

function AssignmentLineCode({ text }: { text: string }) {
  return <NotebookCodeLine code={text} />;
}

function InteractiveCellCode({
  code,
  variables,
  activeLineIndex,
  onLineSelect,
  renderLineDetail,
}: {
  code: string;
  variables?: Record<string, NotebookVariable>;
  activeLineIndex: number | null;
  onLineSelect: (lineIndex: number) => void;
  renderLineDetail?: (line: ParsedCodeLine) => ReactNode;
}) {
  const lines = parseCodeLines(stripImportLines(code.trim()));

  return (
    <div className="dag-notebook-code-lines">
      {lines.map(line => {
        if (line.kind === 'section-title') {
          return (
            <div key={line.index} className="dag-notebook-code-line dag-notebook-code-line--title">
              {line.text}
            </div>
          );
        }

        if (line.kind === 'blank') {
          return (
            <div
              key={line.index}
              className="dag-notebook-code-line dag-notebook-code-line--blank"
              aria-hidden="true"
            >
              {'\u00a0'}
            </div>
          );
        }

        const hasAssignment = line.assignedNames.length > 0;
        const hasComputed = hasAssignment && line.assignedNames.some(n => variables?.[n]);
        const isActive = activeLineIndex === line.index;

        if (!hasAssignment) {
          return (
            <div key={line.index} className="dag-notebook-code-line dag-notebook-code-line--plain">
              <span className="dag-notebook-code-line-content">
                <NotebookCodeLine code={line.text} />
              </span>
            </div>
          );
        }

        const lineDetail = isActive && renderLineDetail ? renderLineDetail(line) : null;

        return (
          <div key={line.index} className="dag-notebook-code-line-group">
            <button
              type="button"
              className={`dag-notebook-code-line dag-notebook-code-line--assign${isActive ? ' dag-notebook-code-line--active' : ''}${hasComputed ? ' dag-notebook-code-line--ready' : ''}`}
              onClick={() => onLineSelect(line.index)}
              title={
                hasComputed
                  ? `View ${line.assignedNames.join(', ')}`
                  : `Run this cell to inspect ${line.assignedNames.join(', ')}`
              }
            >
              <span className="dag-notebook-code-line-content">
                <AssignmentLineCode text={line.text} />
              </span>
            </button>
            {lineDetail}
          </div>
        );
      })}
    </div>
  );
}

// ── Sandbox environment reference ────────────────────────────────────────────

function SandboxEnvironmentModal({
  environment,
  onClose,
}: {
  environment: SandboxEnvironmentSpec;
  onClose: () => void;
}) {
  const copyStarter = async () => {
    try {
      await navigator.clipboard.writeText(environment.starter_snippet);
    } catch {
      // ignore clipboard failures
    }
  };

  return (
    <div className="dag-modal-backdrop" onClick={onClose}>
      <div
        className="dag-modal dag-modal--sandbox-env"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Python environment"
      >
        <div className="dag-modal-header">
          <span className="dag-modal-title">Python environment</span>
          <button className="dag-modal-close" onClick={onClose} aria-label="Close environment reference">×</button>
        </div>
        <p className="dag-sandbox-env-intro">
          These names are already available in every cell. You do not need to import them.
        </p>

        <section className="dag-sandbox-env-section">
          <h3 className="dag-sandbox-env-section-title">Preloaded</h3>
          <dl className="dag-sandbox-env-list">
            {environment.preloaded.map((item) => (
              <div key={item.name} className="dag-sandbox-env-item">
                <dt><code>{item.name}</code></dt>
                <dd>{item.description}</dd>
              </div>
            ))}
          </dl>
        </section>

        {environment.allowed_imports.length > 0 && (
          <section className="dag-sandbox-env-section">
            <h3 className="dag-sandbox-env-section-title">Optional imports</h3>
            <p className="dag-sandbox-env-note">
              You may import these explicitly, for example{' '}
              <code>from scipy import stats</code>.
            </p>
            <div className="dag-sandbox-env-chip-row">
              {environment.allowed_imports.map((name) => (
                <span key={name} className="dag-notebook-env-chip">{name}</span>
              ))}
            </div>
          </section>
        )}

        <section className="dag-sandbox-env-section">
          <h3 className="dag-sandbox-env-section-title">Builtins</h3>
          <p className="dag-sandbox-env-note dag-sandbox-env-note--wrap">
            {environment.builtins.join(', ')}
          </p>
        </section>

        <section className="dag-sandbox-env-section">
          <h3 className="dag-sandbox-env-section-title">Rules</h3>
          <ul className="dag-sandbox-env-rules">
            {environment.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </section>

        <section className="dag-sandbox-env-section">
          <div className="dag-sandbox-env-section-header">
            <h3 className="dag-sandbox-env-section-title">Starter snippet</h3>
            <button type="button" className="dag-sandbox-env-copy" onClick={() => void copyStarter()}>
              Copy
            </button>
          </div>
          <pre className="dag-sandbox-env-snippet">{environment.starter_snippet}</pre>
        </section>
      </div>
    </div>
  );
}

function SandboxEnvironmentBar({
  environment,
  onOpenReference,
}: {
  environment: SandboxEnvironmentSpec;
  onOpenReference: () => void;
}) {
  return (
    <div className="dag-notebook-env-bar">
      <span className="dag-notebook-env-label">Available:</span>
      <div className="dag-notebook-env-chip-row">
        {environment.toolbar_names.map((name) => (
          <span key={name} className="dag-notebook-env-chip">{name}</span>
        ))}
      </div>
      <button
        type="button"
        className="dag-notebook-env-reference"
        onClick={onOpenReference}
        aria-label="Open Python environment reference"
      >
        Environment
      </button>
    </div>
  );
}

// ── Code View (Jupyter-style notebook) ─────────────────────────────────────────

function cellSourceCode(
  sections: { desc?: string; code: string }[],
  editedCodes: Record<number, string>,
  index: number,
): string {
  return editedCodes[index] ?? sections[index].code;
}

function isCellCodeModified(
  sections: { desc?: string; code: string }[],
  editedCodes: Record<number, string>,
  index: number,
): boolean {
  return cellSourceCode(sections, editedCodes, index).trim() !== sections[index].code.trim();
}

function sectionsWithEdits(
  sections: { desc?: string; code: string }[],
  editedCodes: Record<number, string>,
): { desc?: string; code: string }[] {
  return sections.map((section, index) => ({
    ...section,
    code: cellSourceCode(sections, editedCodes, index),
  }));
}

function NotebookCellEditor({
  value,
  onChange,
  onRun,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  disabled?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 72)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!disabled) onRun();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = `${value.slice(0, start)}    ${value.slice(end)}`;
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 4;
      });
    }
  };

  return (
    <textarea
      ref={textareaRef}
      className="dag-notebook-cell-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      spellCheck={false}
      disabled={disabled}
      aria-label="Edit cell code"
    />
  );
}

function CodeView({
  code,
  onRunPython,
  onRunPythonFrom,
  onRunAllPythonCells,
  onInvalidatePythonOutputsFrom,
  filePath,
  pythonCellOutputs,
  pythonExecLoadingStep,
  highlightCellIndex,
}: {
  code: string;
  onRunPython?: (code: string, stepIndex: number, options?: { resetSession?: boolean }) => Promise<boolean>;
  onRunPythonFrom?: (cellCodes: string[], fromIndex: number) => Promise<boolean>;
  onRunAllPythonCells?: (cellCodes: string[]) => Promise<boolean>;
  onInvalidatePythonOutputsFrom?: (fromIndex: number) => void;
  filePath: string;
  pythonCellOutputs: Record<number, PythonCellOutput>;
  pythonExecLoadingStep: number | null;
  highlightCellIndex?: number | null;
}) {
  const sections = parsePythonSteps(code);
  const anyLoading = pythonExecLoadingStep !== null;
  const [editedCodes, setEditedCodes] = useState<Record<number, string>>({});
  const [editingCells, setEditingCells] = useState<Record<number, boolean>>({});
  const [runBaselineByCell, setRunBaselineByCell] = useState<Record<number, string>>({});
  const [openLinePanel, setOpenLinePanel] = useState<{ cell: number; lineIndex: number } | null>(null);
  const [showEnvironmentRef, setShowEnvironmentRef] = useState(false);
  const [sandboxEnvironment, setSandboxEnvironment] = useState<SandboxEnvironmentSpec>(
    FALLBACK_SANDBOX_ENVIRONMENT,
  );
  const codeRef = useRef(code);

  useEffect(() => {
    let cancelled = false;
    void fetchSandboxEnvironment(sidecarFetch, SIDECAR_API).then((spec) => {
      if (!cancelled) setSandboxEnvironment(spec);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (code !== codeRef.current) {
      codeRef.current = code;
      setEditedCodes({});
      setEditingCells({});
      setRunBaselineByCell({});
      setOpenLinePanel(null);
    }
  }, [code]);

  const resolvedSections = sectionsWithEdits(sections, editedCodes);
  const cellCodes = resolvedSections.map((section) => section.code.trim());
  const hasEdits = sections.some((_, index) => isCellCodeModified(sections, editedCodes, index));
  const executedSteps = new Set(
    Object.entries(pythonCellOutputs)
      .filter(([, o]) => o.status === 'success')
      .map(([k]) => Number(k)),
  );

  useEffect(() => {
    if (highlightCellIndex == null) return;
    const el = document.querySelector(`.dag-notebook-cell--highlight`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightCellIndex]);

  const updateCellCode = (cellIndex: number, nextCode: string) => {
    const generated = sections[cellIndex]?.code ?? '';
    setEditedCodes((prev) => {
      if (nextCode === generated) {
        if (!(cellIndex in prev)) return prev;
        const next = { ...prev };
        delete next[cellIndex];
        return next;
      }
      return { ...prev, [cellIndex]: nextCode };
    });
  };

  const resetCellCode = (cellIndex: number) => {
    setEditedCodes((prev) => {
      if (!(cellIndex in prev)) return prev;
      const next = { ...prev };
      delete next[cellIndex];
      return next;
    });
    setRunBaselineByCell((prev) => {
      if (!(cellIndex in prev)) return prev;
      const next = { ...prev };
      delete next[cellIndex];
      return next;
    });
    onInvalidatePythonOutputsFrom?.(cellIndex);
  };

  const resetAllEdits = () => {
    setEditedCodes({});
    setEditingCells({});
    setRunBaselineByCell({});
    onInvalidatePythonOutputsFrom?.(0);
  };

  const setCellEditing = (cellIndex: number, editing: boolean) => {
    setEditingCells((prev) => {
      if (editing) return { ...prev, [cellIndex]: true };
      if (!(cellIndex in prev)) return prev;
      const next = { ...prev };
      delete next[cellIndex];
      return next;
    });
    if (!editing) {
      setOpenLinePanel(null);
    }
  };

  const markCellRunBaseline = (stepIndex: number) => {
    setRunBaselineByCell((prev) => ({
      ...prev,
      [stepIndex]: cellCodes[stepIndex],
    }));
  };

  const runStep = async (stepIndex: number) => {
    const ok = await onRunPython?.(cellCodes[stepIndex], stepIndex);
    if (ok) markCellRunBaseline(stepIndex);
  };

  const runFromStep = (fromIndex: number) => {
    if (!onRunPythonFrom) {
      void runStep(fromIndex);
      return;
    }
    const firstModifiedBefore = sections.findIndex(
      (_, index) => index < fromIndex && isCellCodeModified(sections, editedCodes, index),
    );
    const startIndex = firstModifiedBefore >= 0 ? 0 : fromIndex;
    void onRunPythonFrom(cellCodes, startIndex).then((ok) => {
      if (!ok) return;
      setRunBaselineByCell((prev) => {
        const next = { ...prev };
        for (let i = startIndex; i < cellCodes.length; i++) {
          if (cellCodes[i]) next[i] = cellCodes[i];
        }
        return next;
      });
    });
  };

  const runAllSteps = () => {
    const run = onRunAllPythonCells
      ? onRunAllPythonCells(cellCodes)
      : onRunPythonFrom?.(cellCodes, 0);
    void run?.then((ok) => {
      if (!ok) return;
      setRunBaselineByCell(
        Object.fromEntries(cellCodes.map((snippet, index) => [index, snippet]).filter(([, snippet]) => snippet)),
      );
    });
  };

  const toggleLinePanel = (cellIndex: number, lineIndex: number) => {
    setOpenLinePanel(prev =>
      prev?.cell === cellIndex && prev?.lineIndex === lineIndex
        ? null
        : { cell: cellIndex, lineIndex },
    );
  };

  const firstStaleCell = sections.findIndex((_, index) => {
    if (!isCellCodeModified(sections, editedCodes, index)) return false;
    const output = pythonCellOutputs[index];
    if (output?.status !== 'success') return false;
    return runBaselineByCell[index] !== cellCodes[index];
  });

  return (
    <div className="dag-notebook">
      <div className="dag-notebook-toolbar">
        {filePath ? (
          <>
            <button
              type="button"
              className="dag-notebook-run-all"
              onClick={runAllSteps}
              disabled={anyLoading || sections.length === 0}
            >
              Run all cells
            </button>
            {hasEdits && (
              <button
                type="button"
                className="dag-notebook-run-all dag-notebook-reset-edits"
                onClick={resetAllEdits}
                disabled={anyLoading}
              >
                Reset edits
              </button>
            )}
          </>
        ) : (
          <span className="dag-notebook-toolbar-hint">Open a data file on Home first</span>
        )}
        {hasEdits && (
          <span className="dag-notebook-toolbar-note">
            Edited cells do not change the saved answer until you run them.
          </span>
        )}
      </div>

      <SandboxEnvironmentBar
        environment={sandboxEnvironment}
        onOpenReference={() => setShowEnvironmentRef(true)}
      />
      {showEnvironmentRef && (
        <SandboxEnvironmentModal
          environment={sandboxEnvironment}
          onClose={() => setShowEnvironmentRef(false)}
        />
      )}

      {sections.map((s, i) => {
        const output = pythonCellOutputs[i];
        const isLoading = pythonExecLoadingStep === i;
        const cellVariables = output?.status === 'success' ? output.variables : undefined;
        const activeLineIndex = openLinePanel?.cell === i ? openLinePanel.lineIndex : null;
        const modified = isCellCodeModified(sections, editedCodes, i);
        const isEditing = editingCells[i] === true;
        const isStale = modified
          && output?.status === 'success'
          && runBaselineByCell[i] !== cellCodes[i];
        const showPrereqHint = i > 0 && modified && firstStaleCell >= 0 && i > firstStaleCell;

        return (
          <div
            key={i}
            className={`dag-notebook-cell${isLoading ? ' dag-notebook-cell--running' : ''}${highlightCellIndex === i ? ' dag-notebook-cell--highlight' : ''}${modified ? ' dag-notebook-cell--modified' : ''}${isStale ? ' dag-notebook-cell--stale' : ''}`}
          >
            <div className="dag-notebook-cell-body">
              <div className="dag-notebook-cell-header">
                <div className="dag-notebook-cell-controls">
                  <span className="dag-notebook-cell-kicker">Cell</span>
                  <span className="dag-notebook-cell-index">{i + 1}</span>
                  <button
                    type="button"
                    className="dag-notebook-cell-run"
                    onClick={() => runStep(i)}
                    disabled={anyLoading || !filePath}
                    title="Run this cell only (Ctrl+Enter while editing)"
                    aria-label={`Run cell ${i + 1} only`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="dag-notebook-cell-run-from"
                    onClick={() => runFromStep(i)}
                    disabled={anyLoading || !filePath}
                    title="Run this cell and all cells below"
                    aria-label={`Run from cell ${i + 1}`}
                  >
                    Run from here
                  </button>
                  {modified && (
                    <span className="dag-notebook-cell-modified-badge">Modified</span>
                  )}
                  {output?.time !== undefined && output.status === 'success' && !isStale && (
                    <span className="dag-notebook-cell-time">{output.time.toFixed(2)}s</span>
                  )}
                </div>
                {s.desc && <div className="dag-notebook-cell-markdown">{s.desc}</div>}
                <div className="dag-notebook-cell-header-actions">
                  {modified && (
                    <button
                      type="button"
                      className="dag-notebook-cell-reset"
                      onClick={() => resetCellCode(i)}
                      disabled={anyLoading}
                    >
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    className={`dag-notebook-cell-edit${isEditing ? ' dag-notebook-cell-edit--active' : ''}`}
                    onClick={() => setCellEditing(i, !isEditing)}
                    aria-pressed={isEditing}
                  >
                    {isEditing ? 'Done' : 'Edit'}
                  </button>
                  <CellCopyButton code={cellSourceCode(sections, editedCodes, i)} />
                </div>
              </div>
              {isEditing && (
                <p className="dag-notebook-cell-edit-hint">
                  <code>pd</code>, <code>np</code>, <code>df</code>, and <code>math</code> are already
                  available — open <button type="button" className="dag-notebook-cell-edit-hint-link" onClick={() => setShowEnvironmentRef(true)}>Environment</button> for the full list.
                </p>
              )}
              <div
                className={`dag-notebook-cell-input${isEditing ? ' dag-notebook-cell-input--editing' : ''}`}
                onDoubleClick={() => {
                  if (!isEditing) setCellEditing(i, true);
                }}
              >
                {isEditing ? (
                  <NotebookCellEditor
                    value={cellSourceCode(sections, editedCodes, i)}
                    onChange={(nextCode) => updateCellCode(i, nextCode)}
                    onRun={() => runStep(i)}
                    disabled={anyLoading || !filePath}
                  />
                ) : (
                  <InteractiveCellCode
                    code={cellSourceCode(sections, editedCodes, i)}
                    variables={cellVariables}
                    activeLineIndex={activeLineIndex}
                    onLineSelect={(lineIndex) => toggleLinePanel(i, lineIndex)}
                    renderLineDetail={(line) => (
                      line.assignedNames.length > 0 ? (
                        <SubcellDetailPanel
                          inline
                          lineIndex={line.index}
                          variableNames={line.assignedNames}
                          variables={cellVariables ?? {}}
                          onClose={() => setOpenLinePanel(null)}
                        />
                      ) : null
                    )}
                  />
                )}
              </div>
              {showPrereqHint && (
                <div className="dag-notebook-cell-stale-hint">
                  An earlier cell was edited. Run all cells to refresh downstream results.
                </div>
              )}
              {output && (
                <NotebookCellOutput
                  output={output}
                  stepIndex={i}
                  sections={resolvedSections}
                  executedSteps={executedSteps}
                  isLastCell={i === resolvedSections.length - 1}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Answer card (continuous prose + recipe evidence) ─────────────────────────

function answerKickerLabel(outcome?: AnswerPayload['outcome']): string {
  if (outcome === 'partial') return 'Partial answer';
  if (outcome === 'couldnt_compute' || outcome === 'empty') return 'No result';
  return 'Answer';
}

function answerKickerClass(outcome?: AnswerPayload['outcome']): string {
  if (outcome === 'partial') return 'dag-conversation-kicker dag-conversation-kicker--partial';
  if (outcome === 'couldnt_compute' || outcome === 'empty') return 'dag-conversation-kicker dag-conversation-kicker--muted';
  return 'dag-conversation-kicker';
}

function AnswerCard({
  msg,
  onFollowStep,
  onSuggest,
  onDownloadFullCsv,
}: {
  msg: ConversationMsg;
  onFollowStep?: (message: ConversationMsg, step: { nodeId?: string; cellIndex?: number; source: 'dag' | 'code' }) => void;
  onSuggest?: (prompt: string) => void;
  onDownloadFullCsv?: (message: ConversationMsg) => Promise<FullCsvDownloadOutcome>;
}) {
  const answer = msg.answer;
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloadState, setDownloadState] = useState<'idle' | 'loading' | FullCsvDownloadOutcome>('idle');
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (exportRef.current && target instanceof globalThis.Node && !exportRef.current.contains(target)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [exportOpen]);

  const handleDownloadFullCsv = async () => {
    if (!onDownloadFullCsv || downloadState === 'loading') return;
    setDownloadState('loading');
    const outcome = await onDownloadFullCsv(msg);
    if (outcome === 'saved') {
      setDownloadState('saved');
      window.setTimeout(() => setDownloadState('idle'), 2200);
      return;
    }
    if (outcome === 'cancelled') {
      setDownloadState('idle');
      return;
    }
    setDownloadState(outcome);
    window.setTimeout(() => setDownloadState('idle'), 3200);
  };

  const downloadButtonLabel = (() => {
    if (downloadState === 'loading') return 'Preparing CSV…';
    if (downloadState === 'saved') return 'Saved to disk';
    if (downloadState === 'failed') return 'Download failed';
    if (downloadState === 'no-data') return 'No table to export';
    if (downloadState === 'no-file') return 'Open a data file first';
    if (downloadState === 'cancelled') return 'Download full CSV';
    return 'Download full CSV';
  })();

  const handleCopy = async () => {
    const text = answer?.copyText || msg.content;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setExportOpen(false);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  if (!answer) {
    const parts = msg.content.split(/(\*\*[^*]+\*\*)/g);
    return (
      <div
        id={msg.id ? `conversation-message-${msg.id}` : undefined}
        className="dag-conversation-answer"
      >
        <span className="dag-conversation-kicker">Answer</span>
        <div className="dag-conversation-answer-prose">
          <p>
            {parts.map((part, j) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={j}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        </div>
        <span className="dag-conversation-answer-time">
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    );
  }

  const prose = buildAnswerProse(answer);
  const headline = answer.headline?.trim() || prose.paragraphs[0] || '';
  const bodyParagraphs = prose.paragraphs.filter((para) => para !== headline);
  const showTrustEarly =
    !!prose.trust &&
    prose.trustEmphasized &&
    (answer.outcome === 'partial' || answer.outcome === 'couldnt_compute' || answer.outcome === 'empty');

  const handleCopyCsv = answer.tableCsv
    ? async () => {
        try {
          await navigator.clipboard.writeText(answer.tableCsv!);
          setCopied(true);
          setExportOpen(false);
          window.setTimeout(() => setCopied(false), 1600);
        } catch { /* ignore */ }
      }
    : undefined;

  const copyCsvLabel = answer.tableRowCount && answer.tableRowCount > 30
    ? 'Copy 30-row preview'
    : 'Copy data as CSV';
  const downloadMenuLabel = msg.artifact?.kind === 'transformation' && downloadState === 'idle'
    ? 'Download transformed copy'
    : downloadButtonLabel;

  return (
    <div
      id={msg.id ? `conversation-message-${msg.id}` : undefined}
      className={`dag-conversation-answer dag-conversation-answer--${answer.outcome}`}
    >
      <div className="dag-conversation-answer-body">
        <div className="dag-conversation-answer-head">
          <span className={answerKickerClass(answer.outcome)}>{answerKickerLabel(answer.outcome)}</span>
          {headline ? (
            <h3 className="dag-conversation-answer-headline">{headline}</h3>
          ) : null}
          {prose.coverageLine ? (
            <p className="dag-conversation-answer-subtitle">{prose.coverageLine}</p>
          ) : null}
        </div>
        <div className="dag-conversation-answer-prose">
          {prose.items && prose.items.length > 0 && (
            <ul className="dag-conversation-answer-list">
              {prose.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {showTrustEarly && prose.trust && <p>{prose.trust}</p>}
          {bodyParagraphs.map((para) => (
            <p key={para}>{para}</p>
          ))}
          {!showTrustEarly && prose.trust && <p>{prose.trust}</p>}
        </div>
        {typeof answer.tableRowCount === 'number' && answer.tableRowCount > 30 && (
          <p className="dag-conversation-answer-prose-inline dag-conversation-answer-table-note">
            Showing the first 30 of {answer.tableRowCount.toLocaleString()} rows. Use Export to download the complete result.
          </p>
        )}
      </div>
      {answer.suggestions && answer.suggestions.length > 0 && (
        <div className="dag-conversation-answer-secondary">
          <span className="dag-conversation-answer-section-label">Follow-up ideas</span>
          <div className="dag-conversation-answer-next-chips">
            {answer.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="dag-conversation-answer-next-chip"
                onClick={() => onSuggest?.(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {answer.recipe && answer.recipe.length > 0 && (
        <div className="dag-conversation-answer-evidence">
          <button
            type="button"
            className="dag-conversation-answer-recipe-toggle"
            onClick={() => setRecipeOpen((o) => !o)}
            aria-expanded={recipeOpen}
          >
            Calculation steps {recipeOpen ? '▾' : '▸'}
          </button>
          {recipeOpen && (
            <ol className="dag-conversation-answer-recipe-list">
              {answer.recipe.map((step, i) => (
                <li key={step.id}>
                  <button
                    type="button"
                    className="dag-conversation-answer-recipe-step"
                    onClick={() => onFollowStep?.(msg, {
                      nodeId: step.nodeId,
                      cellIndex: step.cellIndex,
                      source: step.source,
                    })}
                    title="Follow this step in the evidence panel"
                  >
                    <span className="dag-conversation-answer-recipe-num">
                      {formatRecipeStepNumber(step, i)}
                    </span>
                    <span className="dag-conversation-answer-recipe-label">
                      {step.label}
                      {step.detail ? <span className="dag-conversation-answer-recipe-detail">{step.detail}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <div className="dag-conversation-answer-actions">
        <div className="dag-conversation-answer-export-wrap" ref={exportRef}>
          <button
            type="button"
            className="dag-conversation-answer-btn dag-conversation-answer-export-trigger"
            aria-expanded={exportOpen}
            aria-haspopup="menu"
            onClick={() => setExportOpen((open) => !open)}
          >
            {copied ? 'Copied' : 'Export'}{exportOpen ? ' ▾' : ' ▸'}
          </button>
          {exportOpen && (
            <div className="dag-conversation-answer-export-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="dag-conversation-answer-export-item"
                onClick={() => void handleCopy()}
              >
                Copy answer
              </button>
              {handleCopyCsv && (
                <button
                  type="button"
                  role="menuitem"
                  className="dag-conversation-answer-export-item"
                  onClick={() => void handleCopyCsv()}
                >
                  {copyCsvLabel}
                </button>
              )}
              {msg.artifact && (
                <button
                  type="button"
                  role="menuitem"
                  className="dag-conversation-answer-export-item"
                  disabled={downloadState === 'loading'}
                  onClick={() => void handleDownloadFullCsv()}
                >
                  {downloadMenuLabel}
                </button>
              )}
            </div>
          )}
        </div>
        <span className="dag-conversation-answer-time">
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

function artifactQueryLabel(message: ConversationMsg, index: number): string {
  const artifact = message.artifact;
  return (artifact?.query || message.content || `Follow-up ${index + 1}`).trim();
}

function ConversationArtifactRail({
  messages,
  activeArtifactMessageId,
  onSelect,
}: {
  messages: ConversationMsg[];
  activeArtifactMessageId?: string | null;
  onSelect: (message: ConversationMsg) => void;
}) {
  const [hovered, setHovered] = useState<{
    index: number;
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const hidePreviewTimer = useRef<number | null>(null);

  const artifactMessages = useMemo(
    () => messages.filter((message) => message.artifact),
    [messages],
  );

  const activeMessage = useMemo(() => {
    if (activeArtifactMessageId) {
      const match = artifactMessages.find((message) => message.id === activeArtifactMessageId);
      if (match) return match;
    }
    return artifactMessages[artifactMessages.length - 1] ?? null;
  }, [artifactMessages, activeArtifactMessageId]);

  const clearHidePreviewTimer = () => {
    if (hidePreviewTimer.current != null) {
      window.clearTimeout(hidePreviewTimer.current);
      hidePreviewTimer.current = null;
    }
  };

  const showPreview = (index: number, label: string, element: HTMLButtonElement) => {
    clearHidePreviewTimer();
    const rect = element.getBoundingClientRect();
    setHovered({
      index,
      label,
      x: rect.right + 12,
      y: rect.top + rect.height / 2,
    });
  };

  const scheduleHidePreview = () => {
    clearHidePreviewTimer();
    hidePreviewTimer.current = window.setTimeout(() => setHovered(null), 120);
  };

  useEffect(() => () => clearHidePreviewTimer(), []);

  if (artifactMessages.length < 2) return null;

  return (
    <>
      <nav
        className="dag-conversation-artifact-rail-overlay"
        aria-label="Calculations in this conversation"
      >
        <div className="dag-conversation-artifact-rail-dots">
          {artifactMessages.map((message, index) => {
            const label = artifactQueryLabel(message, index);
            const isActive = !!activeMessage?.id && message.id === activeMessage.id;
            return (
              <button
                key={message.id ?? `artifact-${index}`}
                type="button"
                className={`dag-conversation-artifact-dot${isActive ? ' dag-conversation-artifact-dot--active' : ''}`}
                aria-label={`Calculation ${index + 1} of ${artifactMessages.length}: ${label}`}
                aria-current={isActive ? 'step' : undefined}
                onClick={() => onSelect(message)}
                onMouseEnter={(e) => showPreview(index + 1, label, e.currentTarget)}
                onMouseLeave={scheduleHidePreview}
                onFocus={(e) => showPreview(index + 1, label, e.currentTarget)}
                onBlur={scheduleHidePreview}
              />
            );
          })}
        </div>
      </nav>
      {hovered && createPortal(
        <div
          className="dag-conversation-artifact-hover-card"
          style={{ left: hovered.x, top: hovered.y }}
          role="tooltip"
          onMouseEnter={clearHidePreviewTimer}
          onMouseLeave={scheduleHidePreview}
        >
          <span className="dag-conversation-artifact-hover-card-label">
            Calculation {hovered.index}
          </span>
          <p className="dag-conversation-artifact-hover-card-query">{hovered.label}</p>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Inner ReactFlow component ──────────────────────────────────────────────────
// ── Clarification Panel ───────────────────────────────────────────────────────
function ClarificationPanel({
  concepts,
  onSubmit,
  onSkip,
  loading,
}: {
  concepts: AmbiguousConcept[];
  onSubmit: (choices: { term: string; chosen_interpretation: string }[]) => void;
  onSkip: () => void;
  loading: boolean;
}) {
  const [choices, setChoices] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    concepts.forEach((c) => { if (c.interpretations.length > 0) initial[c.term] = c.interpretations[0]; });
    return initial;
  });
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const OTHER = 'Other (please specify)';
  const allAnswered = concepts.every((c) => {
    const chosen = choices[c.term];
    if (!chosen) return false;
    if (chosen === OTHER) return !!(customValues[c.term]?.trim());
    return true;
  });

  const handleSubmit = () => {
    if (!allAnswered) return;
    const result = concepts.map((c) => {
      const chosen = choices[c.term] ?? c.interpretations[0];
      return {
        term: c.term,
        chosen_interpretation: chosen === OTHER
          ? (customValues[c.term] ?? '').trim().slice(0, 240)
          : chosen,
      };
    });
    onSubmit(result);
  };

  return (
    <div className="dag-clarification-panel">
      <div className="dag-clarification-header">
        <span className="dag-conversation-kicker">Clarification</span>
        <p className="dag-clarification-lead">
          A few terms need clarification before we can run your query.
        </p>
      </div>
      {concepts.map((concept, index) => (
        <div key={`${concept.term}-${index}`} className="dag-clarification-concept">
          <div className="dag-clarification-term">
            <strong>&ldquo;{concept.term}&rdquo;</strong>
            <span className="dag-clarification-reason">{concept.reason}</span>
          </div>
          <div className="dag-clarification-options">
            {concept.interpretations.map((interp) => (
              <label key={interp} className="dag-clarification-option">
                <input
                  type="radio"
                  name={`clarify-${index}`}
                  value={interp}
                  checked={choices[concept.term] === interp}
                  onChange={() => setChoices((prev) => ({ ...prev, [concept.term]: interp }))}
                />
                <span>{interp}</span>
              </label>
            ))}
          </div>
          {choices[concept.term] === OTHER && (
            <input
              type="text"
              className="dag-clarification-custom"
              placeholder="Describe your interpretation…"
              maxLength={240}
              value={customValues[concept.term] ?? ''}
              onChange={(e) => setCustomValues((prev) => ({ ...prev, [concept.term]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <div className="dag-clarification-actions">
        <button
          type="button"
          className="dag-query-action-btn dag-query-action-btn--emphasis"
          onClick={handleSubmit}
          disabled={loading || !allAnswered}
        >
          Continue
        </button>
        <button
          type="button"
          className="dag-query-action-btn"
          onClick={onSkip}
          disabled={loading}
        >
          Rephrase question
        </button>
      </div>
    </div>
  );
}

function CanvasModeButton({
  active,
  disabled = false,
  label,
  tooltip,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  tooltip: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`dag-canvas-mode-btn${active ? ' active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={active}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function BottomBarButton({
  tooltip,
  className = '',
  children,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tooltip: string; children: ReactNode }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);

  const showTip = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTipPos({ x: r.left + r.width / 2, y: r.top });
  };

  return (
    <>
      <button
        {...props}
        ref={btnRef}
        type="button"
        className={`dag-sidebar-btn ${className}`.trim()}
        aria-label={props['aria-label'] ?? tooltip}
        onMouseEnter={(e) => { showTip(); onMouseEnter?.(e); }}
        onMouseLeave={(e) => { setTipPos(null); onMouseLeave?.(e); }}
        onFocus={(e) => { showTip(); onFocus?.(e); }}
        onBlur={(e) => { setTipPos(null); onBlur?.(e); }}
      >
        {children}
      </button>
      {tipPos && createPortal(
        <span
          className="dag-sidebar-tooltip dag-sidebar-tooltip--floating"
          style={{ left: tipPos.x, top: tipPos.y }}
          role="tooltip"
        >
          {tooltip}
        </span>,
        document.body,
      )}
    </>
  );
}

interface InnerProps {
  dag: DAGData | null;
  dagName: string | null;
  code: string | null;
  mode: 'dag' | 'code' | 'dashboard';
  query: string;
  setQuery: (q: string) => void;
  onExecute: (question?: string) => void;
  onRunDAG?: (dag: DAGData) => void;
  loading: boolean;
  generationStep?: string | null;
  apiStatus?: 'checking' | 'ok' | 'error';
  generationRuntimeStatus?: 'checking' | 'ok' | 'error';
  onCancelQuery?: () => void;
  onOpenDAG: () => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearDAG: () => void;
  onModeChange: (m: 'dag' | 'code' | 'dashboard') => void;
  compileDag?: boolean;
  compileDagLocked?: boolean;
  onCompileDagChange?: (enabled: boolean) => void;
  includeVisualization?: boolean;
  includeVisualizationLocked?: boolean;
  onIncludeVisualizationChange?: (enabled: boolean) => void;
  llmModelId?: string | null;
  llmModels?: Array<{ id: string; label: string; default?: boolean }>;
  onLlmModelChange?: (modelId: string) => void;
  onExportDAG?: (dag: DAGData, name: string, code?: string | null) => void;
  onLoadExample?: (parsed: unknown, sourcePath: string | null) => void;
  filePath: string;
  pythonCellOutputs?: Record<number, PythonCellOutput>;
  pythonExecLoadingStep?: number | null;
  onRunPython?: (code: string, stepIndex: number, options?: { resetSession?: boolean }) => Promise<boolean>;
  onRunPythonFrom?: (cellCodes: string[], fromIndex: number) => Promise<boolean>;
  onRunAllPythonCells?: (cellCodes: string[]) => Promise<boolean>;
  onInvalidatePythonOutputsFrom?: (fromIndex: number) => void;
  conversationMessages?: ConversationMsg[];
  conversationLimitReached?: boolean;
  activeArtifactMessageId?: string | null;
  clarificationConcepts?: AmbiguousConcept[] | null;
  onClarify?: (choices: { term: string; chosen_interpretation: string }[]) => void;
  onRephrase?: () => void;
  engineStatus?: 'checking' | 'ok' | 'error';
  highlightNodeId?: string | null;
  highlightCellIndex?: number | null;
  onSelectArtifact?: (message: ConversationMsg) => void;
  onFollowStep?: (message: ConversationMsg, step: { nodeId?: string; cellIndex?: number; source: 'dag' | 'code' }) => void;
  onDownloadFullCsv?: (message: ConversationMsg) => Promise<FullCsvDownloadOutcome>;
  visualizationArtifact?: ConversationArtifact | null;
  canvasManifest?: CanvasManifest | null;
  includeVisualizationRequested?: boolean;
  onPinArtifact?: (kind: 'dag' | 'code' | 'dashboard', artifact: ConversationArtifact) => void;
  visible: boolean;
}

const CONVERSATION_PANEL_WIDTH_KEY = 'dag-conversation-panel-width';
const DEFAULT_CONVERSATION_RATIO = 0.38;
const MIN_CONVERSATION_WIDTH = 320;
const MIN_CANVAS_WIDTH = 280;
const PANEL_RESIZER_WIDTH = 6;
const MIN_WORKSPACE_WIDTH = MIN_CONVERSATION_WIDTH + MIN_CANVAS_WIDTH + PANEL_RESIZER_WIDTH;

function readStoredConversationWidth(): number | null {
  const stored = localStorage.getItem(CONVERSATION_PANEL_WIDTH_KEY);
  if (!stored) return null;
  const parsed = Number(stored);
  return Number.isFinite(parsed) && parsed >= MIN_CONVERSATION_WIDTH ? parsed : null;
}

function InnerDAGEditor({
  dag, dagName,
  code, mode, query, setQuery, onExecute, onRunDAG,
  loading, generationStep, apiStatus: _apiStatus, generationRuntimeStatus: _generationRuntimeStatus, engineStatus: _engineStatus, onCancelQuery,
  onOpenDAG, onUpload, onClearDAG, onModeChange,
  compileDag = true, compileDagLocked = false, onCompileDagChange,
  includeVisualization: _includeVisualization = true,
  includeVisualizationLocked: _includeVisualizationLocked = false,
  onIncludeVisualizationChange: _onIncludeVisualizationChange,
  llmModelId = null, llmModels = [], onLlmModelChange,
  onExportDAG, onLoadExample, filePath,
  pythonCellOutputs, pythonExecLoadingStep, onRunPython,
  onRunPythonFrom, onRunAllPythonCells, onInvalidatePythonOutputsFrom,
  conversationMessages, conversationLimitReached, activeArtifactMessageId, clarificationConcepts, onClarify, onRephrase,
  highlightNodeId, highlightCellIndex, onSelectArtifact, onFollowStep, onDownloadFullCsv, visualizationArtifact,
  canvasManifest, includeVisualizationRequested = false,
  onPinArtifact,
  visible,
}: InnerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [dagEditMode, setDagEditMode] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [columnInfo, setColumnInfo] = useState<ColumnInfo>({ names: [], types: {} });
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const pendingConnectionError = useRef<string | null>(null);
  const { fitView } = useReactFlow();
  const fileRef = useRef<HTMLInputElement>(null);
  const lastLoadedDagRef = useRef<string | null>(null);
  const submitStarterQuestion = (prompt: string) => {
    if (loading || conversationLimitReached) return;
    setQuery(prompt);
    onExecute(prompt);
  };

  // Highlight a DAG node when following a recipe step
  useEffect(() => {
    if (!highlightNodeId) {
      setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
      return;
    }
    setNodes((ns) =>
      ns.map((n) => ({
        ...n,
        selected: n.id === highlightNodeId,
      })),
    );
    const t = window.setTimeout(() => {
      fitView({ nodes: [{ id: highlightNodeId }], padding: 0.45, duration: 400 });
    }, 50);
    return () => window.clearTimeout(t);
  }, [highlightNodeId, setNodes, fitView]);

  // Build nodes/edges from DAG definition
  const buildGraph = useCallback((dagData: DAGData) => {
    const { nodes: ln, edges: le } = buildDagFlowElements(dagData, columnInfo);
    setNodes(ln.map((n) => ({
      ...n,
      data: {
        ...n.data,
        onDelete: () => {
          setNodes((ns) => ns.filter((x) => x.id !== n.id));
          setEdges((es) => es.filter((e) => e.source !== n.id && e.target !== n.id));
        },
        onEdit: () => {
          setEditState({ nodeId: n.id, op: n.data.op as string, params: { ...(n.data.params as Record<string, unknown>) } });
        },
        onSetOutput: () => {
          setNodes((ns) => ns.map((x) => ({ ...x, data: { ...x.data, isOutput: x.id === n.id } })));
        },
      },
    })));
    setEdges(le);
    setTimeout(() => fitView(CANVAS_FIT_VIEW), 100);
  }, [fitView, setNodes, setEdges, columnInfo]);

  // Rebuild graph only when the loaded DAG definition changes (not on columnInfo updates).
  useEffect(() => {
    if (!dag) {
      if (lastLoadedDagRef.current !== null) {
        setNodes([]);
        setEdges([]);
        setEditState(null);
        setConnectionError(null);
      }
      lastLoadedDagRef.current = null;
      return;
    }
    const serialized = JSON.stringify(dag);
    if (serialized !== lastLoadedDagRef.current) {
      lastLoadedDagRef.current = serialized;
      buildGraph(dag);
    }
  }, [dag, buildGraph]);

  // Refresh column metadata on existing nodes when schema loads or changes.
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => ({
        ...n,
        data: {
          ...n.data,
          columnNames: columnInfo.names,
          columnTypes: columnInfo.types,
        },
      }))
    );
  }, [columnInfo, setNodes]);

  // Fetch column schema info from the Python engine
  useEffect(() => {
    if (!filePath) { setColumnInfo({ names: [], types: {} }); return; }
    sidecarFetch(`${SIDECAR_API}/data_summary?source_path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'success' && data.summary) {
          const cols = data.summary.available_columns || [];
          const types = data.summary.column_semantics || {};
          setColumnInfo({ names: cols, types });
        }
      })
      .catch(() => {});
  }, [filePath]);

  useEffect(() => {
    setNodes((ns) => syncNodesFromEdges(ns, edges));
  }, [edges, setNodes]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const err = validateConnection(connection, nodes, edges, PARAM_SCHEMA);
      pendingConnectionError.current = err;
      if (!err) setConnectionError(null);
      return !err;
    },
    [nodes, edges],
  );

  const onConnectEnd = useCallback(() => {
    if (pendingConnectionError.current) {
      setConnectionError(pendingConnectionError.current);
      pendingConnectionError.current = null;
    }
  }, []);

  const onConnect = useCallback(
    (params: Connection) => {
      const err = validateConnection(params, nodes, edges, PARAM_SCHEMA);
      if (err) {
        setConnectionError(err);
        return;
      }
      setConnectionError(null);
      const edgeId = `e-${params.source}-${params.target}-${params.targetHandle}`;
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            id: edgeId,
            sourceHandle: params.sourceHandle ?? 'output',
            type: 'smoothstep',
          },
          eds.filter(
            (e) => !(e.target === params.target && e.targetHandle === params.targetHandle),
          ),
        ),
      );
    },
    [nodes, edges, setEdges],
  );

  const handleAddNode = (op: string) => {
    onModeChange('dag');
    setNodes((ns) => {
      const id = allocateNodeId(ns.map((n) => n.id));
      return [...ns, {
        id,
        type: 'dagNode',
        position: { x: 200 + Math.random() * 200, y: 200 + Math.random() * 200 },
        data: {
          op,
          params: {},
          inputs: [],
          columnNames: columnInfo.names,
          columnTypes: columnInfo.types,
          isOutput: false,
          onDelete: () => {
            setNodes((nss) => nss.filter((x) => x.id !== id));
            setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
          },
          onEdit: () => {
            setEditState({ nodeId: id, op, params: {} });
          },
          onSetOutput: () => {
            setNodes((nss) => nss.map((x) => ({ ...x, data: { ...x.data, isOutput: x.id === id } })));
          },
        },
      }];
    });
    setTimeout(() => fitView(CANVAS_FIT_VIEW), 100);
  };

  const handleRelayout = useCallback(() => {
    const { nodes: ln, edges: le } = getLayoutedElements(nodes, edges);
    setNodes(syncNodesFromEdges(ln, le));
    setEdges(le);
    setTimeout(() => fitView(CANVAS_FIT_VIEW), 100);
  }, [nodes, edges, setNodes, setEdges, fitView]);

  const handleRunDAG = useCallback(() => {
    if (!onRunDAG || nodes.length === 0) return;
    const outputNode =
      nodes.find((n) => n.data.isOutput as boolean) ??
      (() => {
        const sourceIds = new Set(edges.map((e) => e.source));
        const sinks = nodes.filter((n) => !sourceIds.has(n.id));
        return sinks[sinks.length - 1] ?? nodes[nodes.length - 1];
      })();
    const dagNodes = graphStateFromFlow(nodes, edges);
    const dagPayload: DAGData = {
      graph_id: `dag-${Date.now()}`,
      nodes: dagNodes,
      output_node: outputNode.id,
    };
    onRunDAG(dagPayload);
  }, [onRunDAG, nodes, edges]);

  const showDagCanvas = mode === 'dag';
  const dashboardSlot = slotForKind(canvasManifest, 'visualization_spec');
  const hasVisualization = !!visualizationArtifact?.visualizationSpec;

  const handleExportDAGCanvas = useCallback(() => {
    if (!onExportDAG) return;
    const outputNode =
      nodes.find((n) => n.data.isOutput as boolean) ??
      (() => {
        const sourceIds = new Set(edges.map((e) => e.source));
        const sinks = nodes.filter((n) => !sourceIds.has(n.id));
        return sinks[sinks.length - 1] ?? nodes[nodes.length - 1];
      })();
    if (!outputNode) return;
    const dagNodes = graphStateFromFlow(nodes, edges);
    const dagPayload: DAGData = {
      graph_id: `dag-${Date.now()}`,
      nodes: dagNodes,
      output_node: outputNode.id,
    };
    onExportDAG(dagPayload, dagName ?? 'untitled-dag', code);
  }, [onExportDAG, nodes, edges, dagName, code]);

  const handleEditSave = (params: Record<string, any>) => {
    if (!editState) return;
    const { nodeId } = editState;
    setNodes((ns) => ns.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, op: editState.op, params, onEdit: () => setEditState({ nodeId, op: editState.op, params: { ...params } }) } } : n));
    setEditState(null);
  };

  const handleEditDelete = () => {
    if (!editState) return;
    const { nodeId } = editState;
    setNodes((ns) => ns.filter((n) => n.id !== nodeId));
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setEditState(null);
  };

  const hasDagContent = dag != null || nodes.length > 0 || !!code;

  const handleClear = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setEditState(null);
    setConnectionError(null);
    lastLoadedDagRef.current = null;
    onClearDAG();
  }, [setNodes, setEdges, onClearDAG]);

  const dismissOverlays = () => {
    setShowLibrary(false);
    setShowExamples(false);
  };

  // Auto-scroll conversation to bottom when new messages arrive
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const conversationMessagesWrapRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const scrollSpyRafRef = useRef<number | null>(null);
  const scrollSpyDebounceRef = useRef<number | null>(null);

  const markProgrammaticScroll = useCallback(() => {
    programmaticScrollRef.current = true;
    if (programmaticScrollTimerRef.current != null) {
      window.clearTimeout(programmaticScrollTimerRef.current);
    }
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticScrollTimerRef.current = null;
    }, 900);
  }, []);

  useEffect(() => {
    markProgrammaticScroll();
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversationMessages, markProgrammaticScroll]);

  useEffect(() => () => {
    if (programmaticScrollTimerRef.current != null) {
      window.clearTimeout(programmaticScrollTimerRef.current);
    }
    if (scrollSpyDebounceRef.current != null) {
      window.clearTimeout(scrollSpyDebounceRef.current);
    }
    if (scrollSpyRafRef.current != null) {
      window.cancelAnimationFrame(scrollSpyRafRef.current);
    }
  }, []);

  const selectArtifactAndRevealQuestion = (message: ConversationMsg) => {
    markProgrammaticScroll();
    onSelectArtifact?.(message);
    const scrollTargetId = message.id ?? message.questionMessageId;
    if (!scrollTargetId) return;
    window.requestAnimationFrame(() => {
      document
        .getElementById(`conversation-message-${scrollTargetId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const resolvedActiveArtifactMessageId = useMemo(() => {
    const artifactMessages = (conversationMessages ?? []).filter((message) => message.artifact);
    if (artifactMessages.length === 0) return null;
    if (activeArtifactMessageId) {
      const match = artifactMessages.find((message) => message.id === activeArtifactMessageId);
      if (match) return match.id ?? null;
    }
    return artifactMessages[artifactMessages.length - 1]?.id ?? null;
  }, [conversationMessages, activeArtifactMessageId]);

  const artifactMessagesForScrollSpy = useMemo(
    () => (conversationMessages ?? []).filter((message) => message.artifact),
    [conversationMessages],
  );

  const syncActiveArtifactFromScroll = useCallback(() => {
    if (programmaticScrollRef.current || !onSelectArtifact) return;

    const container = conversationMessagesWrapRef.current;
    if (!container || artifactMessagesForScrollSpy.length < 2) return;

    const containerRect = container.getBoundingClientRect();
    const containerCenter = containerRect.top + containerRect.height / 2;

    let closestMessage: ConversationMsg | null = null;
    let closestDistance = Infinity;

    for (const message of artifactMessagesForScrollSpy) {
      if (!message.id) continue;
      const el = document.getElementById(`conversation-message-${message.id}`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - containerCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestMessage = message;
      }
    }

    if (closestMessage?.id && closestMessage.id !== resolvedActiveArtifactMessageId) {
      onSelectArtifact(closestMessage);
    }
  }, [artifactMessagesForScrollSpy, onSelectArtifact, resolvedActiveArtifactMessageId]);

  useEffect(() => {
    const container = conversationMessagesWrapRef.current;
    if (!container || artifactMessagesForScrollSpy.length < 2) return;

    const onScroll = () => {
      if (scrollSpyRafRef.current != null) return;
      scrollSpyRafRef.current = window.requestAnimationFrame(() => {
        scrollSpyRafRef.current = null;
        if (scrollSpyDebounceRef.current != null) {
          window.clearTimeout(scrollSpyDebounceRef.current);
        }
        scrollSpyDebounceRef.current = window.setTimeout(() => {
          scrollSpyDebounceRef.current = null;
          syncActiveArtifactFromScroll();
        }, 120);
      });
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (scrollSpyRafRef.current != null) {
        window.cancelAnimationFrame(scrollSpyRafRef.current);
        scrollSpyRafRef.current = null;
      }
      if (scrollSpyDebounceRef.current != null) {
        window.clearTimeout(scrollSpyDebounceRef.current);
        scrollSpyDebounceRef.current = null;
      }
    };
  }, [artifactMessagesForScrollSpy, syncActiveArtifactFromScroll]);

  const workspaceRef = useRef<HTMLDivElement>(null);
  const isResizingPanels = useRef(false);
  const [conversationWidth, setConversationWidth] = useState<number | null>(
    () => readStoredConversationWidth(),
  );

  const clampConversationWidth = useCallback((width: number, workspaceWidth: number) => {
    const maxWidth = workspaceWidth - MIN_CANVAS_WIDTH - PANEL_RESIZER_WIDTH;
    return Math.max(MIN_CONVERSATION_WIDTH, Math.min(width, maxWidth));
  }, []);

  useEffect(() => {
    if (!visible) return;

    const workspace = workspaceRef.current;
    if (!workspace) return;

    const syncWidth = () => {
      const workspaceWidth = workspace.getBoundingClientRect().width;
      if (workspaceWidth < MIN_WORKSPACE_WIDTH) return;

      setConversationWidth((prev) => {
        const base = prev ?? Math.round(workspaceWidth * DEFAULT_CONVERSATION_RATIO);
        return clampConversationWidth(base, workspaceWidth);
      });
    };

    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [clampConversationWidth, visible]);

  const onPanelResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    isResizingPanels.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!isResizingPanels.current || !workspaceRef.current) return;
      const rect = workspaceRef.current.getBoundingClientRect();
      const nextWidth = clampConversationWidth(event.clientX - rect.left, rect.width);
      setConversationWidth(nextWidth);
    };

    const onMouseUp = () => {
      if (!isResizingPanels.current) return;
      isResizingPanels.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setConversationWidth((prev) => {
        if (prev != null) {
          localStorage.setItem(CONVERSATION_PANEL_WIDTH_KEY, String(Math.round(prev)));
        }
        return prev;
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [clampConversationWidth]);

  const hasSavedArtifacts = (conversationMessages ?? []).some((message) => message.artifact);
  const hasEvidence = hasSavedArtifacts || !!dag || !!code || !!visualizationArtifact?.visualizationSpec;
  const activeMessageArtifact = useMemo(() => {
    if (!conversationMessages?.length) return null;
    const selected = activeArtifactMessageId
      ? conversationMessages.find((message) => message.id === activeArtifactMessageId)?.artifact
      : null;
    return selected
      ?? [...conversationMessages].reverse().find((message) => message.artifact)?.artifact
      ?? null;
  }, [conversationMessages, activeArtifactMessageId]);
  const activeCanvasArtifact = activeMessageArtifact ?? (
    visualizationArtifact ?? (
      (dag || code)
        ? {
            dagData: dag,
            dagName: dagName ?? null,
            pythonCode: code,
            query: query.trim(),
          } satisfies ConversationArtifact
        : null
    )
  );

  const canShowGraph = !!(dag || nodes.length > 0 || activeCanvasArtifact?.dagData);
  const canShowCode = !!(code || activeCanvasArtifact?.pythonCode);
  const canShowDashboard = hasVisualization;
  const pinKind = mode === 'dag' ? 'dag' : mode === 'code' ? 'code' : 'dashboard';
  const canPinCurrentView = !!(
    onPinArtifact &&
    activeCanvasArtifact &&
    canPinKind(pinKind, activeCanvasArtifact)
  );
  const selectedLlmModelId = llmModelId ?? llmModels.find((model) => model.default)?.id ?? llmModels[0]?.id ?? '';

  return (
    <>
      {/* ── Main workspace row ────────────────────────────────────── */}
      <div
        className={`dag-editor-workspace${hasEvidence ? '' : ' dag-editor-workspace--chat-only'}`}
        ref={workspaceRef}
      >

        {/* ── Analysis artifact: DAG or code ───────────────────────── */}
        <div className="dag-canvas" onClick={dismissOverlays}>
          {hasEvidence && (
            <div className="dag-canvas-header" onClick={(e) => e.stopPropagation()}>
              <div className="dag-canvas-header-evidence">
                <div className="dag-canvas-header-evidence-left">
                  <span className="dag-canvas-evidence-label">Calculation evidence</span>
                  <div className="dag-canvas-mode-switch" role="group" aria-label="Calculation evidence">
                    <CanvasModeButton
                      active={mode === 'dag'}
                      disabled={!canShowGraph}
                      label="Graph"
                      tooltip="View calculation graph"
                      onClick={() => onModeChange('dag')}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/>
                        <line x1="7" y1="6" x2="17" y2="6"/><line x1="7" y1="8" x2="12" y2="16"/><line x1="17" y1="8" x2="12" y2="16"/>
                      </svg>
                    </CanvasModeButton>
                    <CanvasModeButton
                      active={mode === 'code'}
                      disabled={!canShowCode}
                      label="Code"
                      tooltip="View generated code"
                      onClick={() => onModeChange('code')}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
                      </svg>
                    </CanvasModeButton>
                    <CanvasModeButton
                      active={mode === 'dashboard'}
                      disabled={!canShowDashboard}
                      label="Dashboard"
                      tooltip="View dashboard visualization"
                      onClick={() => onModeChange('dashboard')}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                      </svg>
                    </CanvasModeButton>
                  </div>
                  {mode === 'dag' && canShowGraph && (
                    <button
                      type="button"
                      className={`dag-canvas-edit-graph-btn${dagEditMode ? ' active' : ''}`}
                      onClick={() => setDagEditMode((v) => !v)}
                      aria-pressed={dagEditMode}
                    >
                      {dagEditMode ? 'Done editing' : 'Edit graph'}
                    </button>
                  )}
                </div>
                <div className="dag-canvas-header-evidence-right">
                  {canPinCurrentView && (
                    <button
                      type="button"
                      className="dag-canvas-pin-btn"
                      title={`Pin this ${pinnedKindLabel(pinKind).toLowerCase()} to Pinned`}
                      aria-label={`Pin this ${pinnedKindLabel(pinKind).toLowerCase()} to Pinned`}
                      onClick={() => onPinArtifact?.(pinKind, activeCanvasArtifact!)}
                    >
                      <Pin size={15} strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="dag-canvas-body">
          {mode === 'dag' && showDagCanvas && dagEditMode && (
            <div
              className={`dag-canvas-rail${showDagCanvas ? ' dag-canvas-rail--above-controls' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="dag-canvas-toolbar">
                <BottomBarButton tooltip="Open DAG JSON" onClick={onOpenDAG} aria-label="Open DAG JSON file">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={onUpload} />
                </BottomBarButton>

                <BottomBarButton
                  tooltip="Example Queries"
                  onClick={() => setShowExamples(true)}
                  aria-label="Browse example queries"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                </BottomBarButton>

                <BottomBarButton tooltip="Add Operation" onClick={() => setShowLibrary(true)} aria-label="Add operation">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                  </svg>
                </BottomBarButton>

                {hasDagContent && (
                  <>
                    {onExportDAG && (
                      <BottomBarButton
                        tooltip="Save DAG"
                        onClick={handleExportDAGCanvas}
                        aria-label="Save DAG to file"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                          <polyline points="17 21 17 13 7 13 7 21"/>
                          <polyline points="7 3 7 8 15 8"/>
                        </svg>
                      </BottomBarButton>
                    )}
                    <BottomBarButton tooltip="Clear DAG" onClick={handleClear} aria-label="Clear DAG">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                      </svg>
                    </BottomBarButton>
                  </>
                )}

                {showDagCanvas && (
                  <>
                    <BottomBarButton tooltip="Auto-layout" onClick={handleRelayout} aria-label="Auto-layout DAG">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="12" y1="3" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="21"/>
                        <polyline points="9 6 12 3 15 6"/><polyline points="9 18 12 21 15 18"/>
                        <line x1="3" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="21" y2="12"/>
                        <polyline points="6 9 3 12 6 15"/><polyline points="18 9 21 12 18 15"/>
                      </svg>
                    </BottomBarButton>
                    {onRunDAG && (
                      <BottomBarButton
                        tooltip="Execute DAG"
                        className="dag-sidebar-btn--run"
                        onClick={handleRunDAG}
                        disabled={loading}
                        aria-label="Execute DAG"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                          <polygon points="5,3 19,12 5,21"/>
                        </svg>
                      </BottomBarButton>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          {connectionError && showDagCanvas && (
            <div
              className="dag-connection-error"
              role="alert"
              onClick={(e) => { e.stopPropagation(); setConnectionError(null); }}
            >
              <span className="dag-connection-error-text">{connectionError}</span>
              <button type="button" className="dag-connection-error-dismiss" aria-label="Dismiss">×</button>
            </div>
          )}
          {mode === 'dashboard' ? (
            <div className="dag-canvas-scroll" onClick={(e) => e.stopPropagation()}>
              <VisualizationView
                artifact={visualizationArtifact ?? null}
                dashboardSlot={dashboardSlot}
                includeVisualizationRequested={includeVisualizationRequested}
              />
            </div>
          ) : mode === 'code' ? (
            code ? (
              <div className="dag-canvas-scroll" onClick={(e) => e.stopPropagation()}>
                <CodeView
                  code={code}
                  onRunPython={onRunPython}
                  onRunPythonFrom={onRunPythonFrom}
                  onRunAllPythonCells={onRunAllPythonCells}
                  onInvalidatePythonOutputsFrom={onInvalidatePythonOutputsFrom}
                  filePath={filePath}
                  pythonCellOutputs={pythonCellOutputs ?? {}}
                  pythonExecLoadingStep={pythonExecLoadingStep ?? null}
                  highlightCellIndex={highlightCellIndex}
                />
              </div>
            ) : (
              <div className="dag-canvas-empty dot-pattern">
                <div className="dag-canvas-empty-state">
                  <p className="dag-canvas-empty-state-title">Code evidence</p>
                  <p className="dag-canvas-empty-state-hint">
                    Ask a question to generate Python code you can inspect here.
                  </p>
                </div>
              </div>
            )
          ) : showDagCanvas ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              onPaneClick={() => { dismissOverlays(); setConnectionError(null); }}
              nodeTypes={nodeTypes}
              colorMode="light"
              defaultViewport={{ x: 0, y: 0, zoom: 0.72 }}
              minZoom={0.08}
              maxZoom={1.5}
              onInit={(instance) => {
                setTimeout(() => instance.fitView(CANVAS_FIT_VIEW), 50);
              }}
              deleteKeyCode={['Delete', 'Backspace']}
            >
              <Background color="rgba(0,0,0,0.12)" gap={20} size={0.6} />
              <Controls showInteractive={false} />
            </ReactFlow>
          ) : (
            <div className="dag-canvas-empty dot-pattern">
              <div className="dag-canvas-empty-state">
                <p className="dag-canvas-empty-state-title">Calculation graph</p>
                <p className="dag-canvas-empty-state-hint">
                  {filePath
                    ? 'Enable “Computation graph” when asking, or upload a DAG JSON to inspect steps here.'
                    : 'Open a dataset on Home, then ask a question to see the graph.'}
                </p>
              </div>
            </div>
          )}
          </div>
        </div>

        {/* ── Left: permanent conversation panel ──────────────────── */}
        <div
          className="dag-conversation-panel"
          style={hasEvidence && conversationWidth != null ? { width: conversationWidth } : undefined}
          onClick={(e) => e.stopPropagation()}
        >

          {/* Messages area */}
          <div className="dag-conversation-messages-layout">
            <div ref={conversationMessagesWrapRef} className="dag-conversation-messages-wrap">
            {(!conversationMessages || conversationMessages.length === 0) && (
              <div className="dag-conversation-empty">
                <span className="dag-conversation-kicker">Start an analysis</span>
                <h2 className="dag-query-empty-title">Ask a question about your data</h2>
                <p className="dag-query-empty-lead">
                  Get a clear answer with inspectable code, graph, and chart evidence.
                </p>
                {filePath && (
                  <div className="dag-starter-prompts">
                    {[
                      "What are the most important patterns in this dataset?",
                      "Which columns have missing or unreliable data?",
                      "What are the most useful metrics to explore first?",
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        disabled={loading}
                        onClick={() => submitStarterQuestion(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {(conversationMessages ?? []).map((msg, i) => {
              if (msg.content === 'clarification_request') {
                return (
                  <div key={msg.id ?? i} className="dag-chat-msg dag-chat-msg--assistant dag-chat-msg--clarify">
                    <span className="dag-chat-msg-label">Clarification needed — see below.</span>
                  </div>
                );
              }
              if (msg.type === 'generation' || msg.answer) {
                return (
                  <AnswerCard
                    key={msg.id ?? i}
                    msg={msg}
                    onFollowStep={onFollowStep}
                    onSuggest={submitStarterQuestion}
                    onDownloadFullCsv={onDownloadFullCsv}
                  />
                );
              }
              if (msg.type === 'error') {
                return (
                  <div key={msg.id ?? i} className="dag-chat-msg dag-chat-msg--assistant dag-chat-msg--error">
                    <span className="dag-chat-msg-text">{msg.content}</span>
                    <span className="dag-chat-msg-time">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              }
              return (
                <div
                  key={msg.id ?? i}
                  id={msg.id ? `conversation-message-${msg.id}` : undefined}
                  className={`dag-chat-msg dag-chat-msg--${msg.role}`}
                >
                  <span className="dag-chat-msg-text" style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                  <span className="dag-chat-msg-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              );
            })}
            <div ref={conversationEndRef} />
            </div>
            <ConversationArtifactRail
              messages={conversationMessages ?? []}
              activeArtifactMessageId={resolvedActiveArtifactMessageId}
              onSelect={selectArtifactAndRevealQuestion}
            />
          </div>

          {/* Query input area */}
          <div className="dag-conversation-input-area">
            {loading && generationStep && (
              <div className="dag-conversation-progress" aria-live="polite" aria-atomic="true">
                <span className="dag-conversation-progress-dot" />
                {generationStep}
              </div>
            )}

            {/* Clarification cards */}
            {!conversationLimitReached && clarificationConcepts && clarificationConcepts.length > 0 && (
              <ClarificationPanel
                concepts={clarificationConcepts}
                onSubmit={onClarify ?? (() => {})}
                onSkip={() => onRephrase?.()}
                loading={loading}
              />
            )}

            {/* Normal query input */}
            {conversationLimitReached ? (
              <div className="dag-conversation-limit" role="status">
                This conversation has reached its maximum of 10 saved analysis artifacts. Please create a new conversation to continue your analysis.
              </div>
            ) : !clarificationConcepts && (
              <>
                <textarea
                  className="dag-conversation-textarea"
                  rows={3}
                  placeholder="e.g. What is the monthly revenue trend for the UK?"
                  aria-label="Ask a data question"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (loading) return;
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onExecute();
                  }}
                />
                <div className="dag-query-composer-row">
                  <div className="dag-query-composer-left">
                    <ComputationGraphToggle
                      compileDag={compileDag}
                      compileDagLocked={compileDagLocked}
                      loading={loading}
                      onChange={onCompileDagChange}
                    />
                    {llmModels.length > 0 && (
                      <ModelSelect
                        models={llmModels}
                        value={selectedLlmModelId}
                        onChange={(modelId) => onLlmModelChange?.(modelId)}
                        disabled={loading}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    className={`dag-query-composer-ask${loading ? ' dag-query-composer-ask--stop' : ''}`}
                    onClick={() => loading ? onCancelQuery?.() : onExecute()}
                    disabled={loading && !onCancelQuery}
                    aria-label={loading ? 'Stop generation' : 'Ask question'}
                  >
                    {loading ? 'Stop' : 'Ask'}
                    {!loading && <span className="dag-query-composer-hint">⌘↵</span>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div
          className="dag-panel-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize conversation and analysis panels"
          onMouseDown={onPanelResizeStart}
        />

      </div>

      {/* ── Modals ──────────────────────────────────────────────────── */}
      {showLibrary && <NodeLibraryModal onClose={() => setShowLibrary(false)} onAdd={handleAddNode} />}
      {showExamples && (
        <ExamplesModal
          onClose={() => setShowExamples(false)}
          onLoad={(file) => { onLoadExample?.(file, null); }}
        />
      )}
      {editState && (
        <EditNodeModal
          edit={editState}
          onSave={handleEditSave}
          onDelete={handleEditDelete}
          onClose={() => setEditState(null)}
          columnInfo={columnInfo}
          filePath={filePath}
          nodeIds={nodes.map((n) => n.id)}
        />
      )}
    </>
  );
}

// ── Public DAGEditor (with ReactFlowProvider) ─────────────────────────────────
export interface DAGEditorProps {
  dag: DAGData | null;
  dagName: string | null;
  code: string | null;
  mode: 'dag' | 'code' | 'dashboard';
  query: string;
  setQuery: (q: string) => void;
  onExecute: (question?: string) => void;
  onRunDAG?: (dag: DAGData) => void;
  loading: boolean;
  generationStep?: string | null;
  apiStatus?: 'checking' | 'ok' | 'error';
  generationRuntimeStatus?: 'checking' | 'ok' | 'error';
  onCancelQuery?: () => void;
  onOpenDAG: () => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearDAG: () => void;
  onModeChange: (m: 'dag' | 'code' | 'dashboard') => void;
  compileDag?: boolean;
  compileDagLocked?: boolean;
  onCompileDagChange?: (enabled: boolean) => void;
  includeVisualization?: boolean;
  includeVisualizationLocked?: boolean;
  onIncludeVisualizationChange?: (enabled: boolean) => void;
  llmModelId?: string | null;
  llmModels?: Array<{ id: string; label: string; default?: boolean }>;
  onLlmModelChange?: (modelId: string) => void;
  onExportDAG?: (dag: DAGData, name: string, code?: string | null) => void;
  onLoadExample?: (parsed: unknown, sourcePath: string | null) => void;
  filePath: string;
  pythonCellOutputs?: Record<number, PythonCellOutput>;
  pythonExecLoadingStep?: number | null;
  onRunPython?: (code: string, stepIndex: number, options?: { resetSession?: boolean }) => Promise<boolean>;
  onRunPythonFrom?: (cellCodes: string[], fromIndex: number) => Promise<boolean>;
  onRunAllPythonCells?: (cellCodes: string[]) => Promise<boolean>;
  onInvalidatePythonOutputsFrom?: (fromIndex: number) => void;
  visible: boolean;
  // ── Conversation props ──────────────────────────────────────────────────
  conversationMessages?: ConversationMsg[];
  conversationLimitReached?: boolean;
  activeArtifactMessageId?: string | null;
  clarificationConcepts?: AmbiguousConcept[] | null;
  onClarify?: (choices: { term: string; chosen_interpretation: string }[]) => void;
  onRephrase?: () => void;
  engineStatus?: 'checking' | 'ok' | 'error';
  highlightNodeId?: string | null;
  highlightCellIndex?: number | null;
  onSelectArtifact?: (message: ConversationMsg) => void;
  onFollowStep?: (message: ConversationMsg, step: { nodeId?: string; cellIndex?: number; source: 'dag' | 'code' }) => void;
  onDownloadFullCsv?: (message: ConversationMsg) => Promise<FullCsvDownloadOutcome>;
  visualizationArtifact?: ConversationArtifact | null;
  canvasManifest?: CanvasManifest | null;
  includeVisualizationRequested?: boolean;
  onPinArtifact?: (kind: 'dag' | 'code' | 'dashboard', artifact: ConversationArtifact) => void;
}

export default function DAGEditor(props: DAGEditorProps) {
  return (
    <div className={`dag-editor-root${props.visible ? '' : ' hidden'}`}>
      <ReactFlowProvider>
        <InnerDAGEditor {...props} />
      </ReactFlowProvider>
    </div>
  );
}
