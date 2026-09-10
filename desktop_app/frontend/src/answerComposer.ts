/**
 * Answer composition — turns raw execution outcomes into a structured,
 * user-facing answer with usefulness framing and an auditable recipe.
 */

import { parsePythonSteps } from './pythonNotebook';

// ── Types ────────────────────────────────────────────────────────────────────

export type AnswerOutcome =
  | 'answered'
  | 'couldnt_compute'
  | 'partial'
  | 'empty'
  | 'need_input';

export type CrossCheckStatus = 'agree' | 'disagree' | 'partial' | 'pending' | 'single' | 'none';

export type ResultsCompareVerdict = 'agree' | 'disagree' | 'unknown';

export interface RecipeStep {
  id: string;
  label: string;
  detail?: string;
  nodeId?: string;
  cellIndex?: number;
  source: 'dag' | 'code';
}

export interface AnswerPayload {
  outcome: AnswerOutcome;
  /** Opening sentence that answers the question (may end before a list). */
  headline: string;
  body?: string;
  /** Formatted bullet lines for multi-row / multi-value results. */
  resultItems?: string[];
  usefulFor?: string;
  caveats?: string[];
  assumptions?: string[];
  coverage?: string;
  crossCheck?: CrossCheckStatus;
  crossCheckNote?: string;
  recipe?: RecipeStep[];
  suggestions?: string[];
  copyText: string;
  /** CSV preview of at most RESULT_PREVIEW_ROW_LIMIT result rows. */
  tableCsv?: string;
  /** Number of rows in the complete tabular result, when applicable. */
  tableRowCount?: number;
  /** Formatted result text for LLM synthesis (scalars and list items). */
  synthesisResultSummary?: string;
  /** DAG path summary when cross-check awaits LLM resolution. */
  dagSynthesisResultSummary?: string;
  /** True when deterministic cross-check was inconclusive and synthesis must decide. */
  crossCheckPending?: boolean;
}

export const RESULT_PREVIEW_ROW_LIMIT = 30;

interface DagNodeLike {
  id: string;
  op: string;
  params?: Record<string, unknown>;
  inputs?: string[];
}

interface DagLike {
  nodes: DagNodeLike[];
  output_node: string;
}

export interface ComposeAnswerInput {
  question: string;
  dagValue: unknown;
  dagError: string | null;
  pandasValue: unknown;
  pandasError: string | null;
  hasPandasCode: boolean;
  hasValidGraph: boolean;
  compilationFailed: boolean;
  compilationError: string | null;
  dag: DagLike | null;
  pandasCode: string | null;
  clarifications?: { term: string; chosen_interpretation: string }[] | null;
  rowCount?: number | null;
  resultRowCount?: number | null;
  pandasWarnings?: string[];
  /** True when the code path was actually executed locally (not skipped). */
  pandasExecuted?: boolean;
  /** True when the DAG path was actually executed locally (not skipped). */
  dagExecuted?: boolean;
  /** User requested compile_dag for this query (Computation graph toggle). */
  computationGraphRequested?: boolean;
  /** Server artifact slot reports the DAG artifact failed to produce. */
  dagArtifactFailed?: boolean;
  dagArtifactFailureReason?: string | null;
}

// ── Op labels (mirrors DAGEditor OP_META — keep in sync for recipe wording) ──

const NODE_ID_RE = /^node_\d+$/;

function isNodeId(value: string): boolean {
  return NODE_ID_RE.test(value);
}

const OP_LABELS: Record<string, string> = {
  filter_extract: 'Read Column',
  groupby_agg: 'Group & Aggregate',
  load_constant: 'Constant value',
  add: 'Add',
  subtract: 'Subtract',
  multiply: 'Multiply',
  divide: 'Divide',
  abs: 'Absolute value',
  round: 'Round',
  pow: 'Power',
  sqrt: 'Square root',
  log: 'Natural log',
  percentage_change: 'Growth rate',
  mean: 'Average',
  sum: 'Sum',
  max: 'Maximum',
  min: 'Minimum',
  nunique: 'Count distinct',
  unique: 'Distinct values',
  mode: 'Most frequent',
  median: 'Median',
  std: 'Standard deviation',
  count: 'Count',
  value_counts: 'Frequency table',
  idxmax: 'Label of max',
  idxmin: 'Label of min',
  nlargest: 'Top N',
  nsmallest: 'Bottom N',
  sort_values: 'Sort',
  head: 'First N rows',
  tail: 'Last N rows',
  cumshare: 'Cumulative share',
  shift: 'Shift',
  rolling_mean: 'Rolling average',
  eq: 'Equals',
  ne: 'Not equal',
  gt: 'Greater than',
  ge: 'Greater or equal',
  lt: 'Less than',
  le: 'Less or equal',
  and_op: 'And',
  or_op: 'Or',
  not_op: 'Not',
  where: 'Conditional select',
  fillna: 'Fill missing',
  dropna: 'Drop missing',
  clip: 'Clip range',
  concat: 'Concatenate',
  merge: 'Merge',
  to_datetime: 'Parse Date',
  truncate_to: 'Round Date To',
  extract_year: 'Extract Year',
  extract_month: 'Extract Month',
  extract_day: 'Extract Day',
};

// ── Formatting ───────────────────────────────────────────────────────────────

const LABEL_KEY_HINTS = [
  'month', 'year', 'date', 'week', 'quarter', 'period', 'day',
  'name', 'label', 'category', 'segment', 'region', 'country',
  'product', 'customer', 'city', 'state', 'type', 'status', 'id',
];
const MEASURE_KEY_HINTS = [
  'revenue', 'sales', 'amount', 'total', 'sum', 'count', 'value',
  'price', 'profit', 'qty', 'quantity', 'avg', 'average', 'mean',
  'rate', 'pct', 'percent', 'share', 'growth',
];

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
}

function pickLabelAndMeasureKeys(keys: string[]): { labelKey?: string; measureKey?: string } {
  const lower = keys.map((k) => ({ k, l: k.toLowerCase() }));
  const labelKey =
    lower.find((x) => LABEL_KEY_HINTS.some((h) => x.l === h || x.l.includes(h)))?.k ??
    (keys.length === 2 ? keys[0] : undefined);
  const measureKey =
    lower.find((x) => MEASURE_KEY_HINTS.some((h) => x.l === h || x.l.includes(h)))?.k ??
    (keys.length === 2 ? keys.find((k) => k !== labelKey) : undefined) ??
    (keys.length === 1 ? keys[0] : undefined);
  return { labelKey, measureKey };
}

function formatRowAsBullet(row: Record<string, unknown>): string {
  const keys = Object.keys(row);
  if (!keys.length) return '(empty row)';
  const { labelKey, measureKey } = pickLabelAndMeasureKeys(keys);

  if (labelKey && measureKey && labelKey !== measureKey) {
    const value = formatResultValue(row[measureKey]);
    const label = formatResultValue(row[labelKey]);
    return `${value} for the ${humanizeKey(labelKey)} ${label}`;
  }
  if (measureKey && keys.length === 1) {
    return formatResultValue(row[measureKey]);
  }
  return keys
    .map((k) => `${humanizeKey(k)} ${formatResultValue(row[k])}`)
    .join(', ');
}

/** Bullet lines for multi-row / multi-value results; empty when a single scalar fits inline. */
export function formatResultItems(result: unknown, maxItems = RESULT_PREVIEW_ROW_LIMIT): string[] {
  if (result === null || result === undefined) return [];

  if (Array.isArray(result)) {
    if (result.length === 0) return [];
    // Single value / single row → keep inline in the lead sentence.
    if (result.length === 1) return [];
    if (result.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))) {
      const rows = result as Record<string, unknown>[];
      const items = rows.slice(0, maxItems).map(formatRowAsBullet);
      if (rows.length > maxItems) {
        items.push(`… and ${rows.length - maxItems} more`);
      }
      return items;
    }
    const items = result.slice(0, maxItems).map((r) => formatResultValue(r));
    if (result.length > maxItems) items.push(`… and ${result.length - maxItems} more`);
    return items;
  }

  if (typeof result === 'object') {
    const keys = Object.keys(result as object);
    if (keys.length <= 1) return [];
    // Prefer a single inline sentence for compact objects; list only when many keys.
    if (keys.length > 4) {
      return keys.map(
        (k) => `${formatResultValue((result as Record<string, unknown>)[k])} for ${humanizeKey(k)}`,
      );
    }
    return [];
  }
  return [];
}

/** Compact inline value for the lead sentence (scalars, single rows, small objects). */
export function formatInlineResult(result: unknown): string {
  if (result === null || result === undefined) return '(no result)';
  if (Array.isArray(result) && result.length === 1) {
    const only = result[0];
    if (only !== null && typeof only === 'object' && !Array.isArray(only)) {
      return formatRowAsBullet(only as Record<string, unknown>);
    }
    return formatResultValue(only);
  }
  if (typeof result === 'object' && !Array.isArray(result)) {
    const keys = Object.keys(result as object);
    if (keys.length > 1 && keys.length <= 4) {
      return keys
        .map((k) => `${formatResultValue((result as Record<string, unknown>)[k])} for ${humanizeKey(k)}`)
        .join(', ');
    }
  }
  return formatResultValue(result);
}

export function formatResultValue(result: unknown): string {
  if (result === null || result === undefined) return '(no result)';
  if (typeof result === 'number') {
    return Number.isFinite(result)
      ? result.toLocaleString(undefined, { maximumFractionDigits: 4 })
      : String(result);
  }
  if (typeof result === 'string') return result;
  if (typeof result === 'boolean') return String(result);
  if (Array.isArray(result)) {
    if (result.length === 0) return '(empty)';
    const items = formatResultItems(result);
    if (items.length) return items.join('; ');
    if (result.length === 1) return formatResultValue(result[0]);
    if (result.length <= 4) return result.map((r) => formatResultValue(r)).join(', ');
    return `${result.slice(0, 3).map((r) => formatResultValue(r)).join(', ')} … (${result.length} items)`;
  }
  if (typeof result === 'object') {
    const keys = Object.keys(result as object);
    if (keys.length === 1) return formatResultValue((result as Record<string, unknown>)[keys[0]]);
    const items = formatResultItems(result);
    if (items.length) return items.join('; ');
    if (keys.length <= 4) {
      return keys
        .map((k) => `${k}: ${formatResultValue((result as Record<string, unknown>)[k])}`)
        .join(', ');
    }
    try {
      return JSON.stringify(result).slice(0, 300);
    } catch {
      return String(result);
    }
  }
  return String(result);
}

/** Insert “(interpretation)” after each clarified term that appears in the question. */
export function annotateQuestionWithClarifications(
  question: string,
  clarifications?: { term: string; chosen_interpretation: string }[] | null,
): string {
  let text = question.trim().replace(/[?.!]+$/, '').trim();
  if (!clarifications?.length) return text;

  const sorted = [...clarifications].sort(
    (a, b) => b.term.length - a.term.length,
  );
  for (const { term, chosen_interpretation } of sorted) {
    const t = term.trim();
    const interp = chosen_interpretation.trim();
    if (!t || !interp) continue;
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b(${escaped})\\b(?!\\s*\\()`, 'i');
    if (re.test(text)) {
      text = text.replace(re, `$1 (${interp})`);
    }
  }
  return text;
}

/**
 * Turn the user question into an answer stem, with clarifications inline.
 * e.g. "What is the monthly revenue of the UK?" + clarifications
 *   → "The monthly revenue (Amount) of the UK (United Kingdom) is"
 */
export function buildAnswerLead(
  question: string,
  clarifications?: { term: string; chosen_interpretation: string }[] | null,
  options?: { hasList?: boolean; inlineValue?: string; failed?: boolean },
): string {
  const annotated = annotateQuestionWithClarifications(question, clarifications);
  let stem = annotated;

  // Patterns for common question forms that can be safely transformed.
  // For any unmatched pattern, we fall back to a generic safe prefix.
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    [/^what\s+is\s+(.+)$/i, (m) => {
      const rest = m[1].trim();
      return /^the\s+/i.test(rest) ? rest.replace(/^the/i, 'The') : `The ${rest}`;
    }],
    [/^what\s+are\s+(.+)$/i, (m) => {
      const rest = m[1].trim();
      return /^the\s+/i.test(rest) ? rest.replace(/^the/i, 'The') : `The ${rest}`;
    }],
    [/^what(?:'s|s)\s+(.+)$/i, (m) => {
      const rest = m[1].trim();
      return /^the\s+/i.test(rest) ? rest.replace(/^the/i, 'The') : `The ${rest}`;
    }],
    [/^how\s+much\s+(?:is\s+|are\s+)?(.+)$/i, (m) => {
      const rest = m[1].trim();
      return /^the\s+/i.test(rest) ? rest.replace(/^the/i, 'The') : `The ${rest}`;
    }],
    [/^how\s+many\s+(.+)$/i, (m) => `The number of ${m[1].trim()}`],
  ];

  let matched = false;
  for (const [re, fn] of patterns) {
    const m = stem.match(re);
    if (m) {
      stem = fn(m);
      matched = true;
      break;
    }
  }

  // If no pattern matched, use a generic safe fallback instead of
  // trying to transform arbitrary text (which leads to broken grammar).
  if (!matched) {
    if (options?.failed) {
      return 'Could not compute a result for this question.';
    }
    if (options?.hasList) {
      return 'Here is the result:';
    }
    if (options?.inlineValue != null && options.inlineValue !== '') {
      return `The result is ${options.inlineValue}.`;
    }
    return 'Here is the result:';
  }

  // Pattern matched — apply standard transformations.
  if (/^the\b/i.test(stem)) {
    stem = stem.replace(/^the/i, 'The');
  }

  if (options?.failed) {
    return `I could not determine ${stem.replace(/^The\s+/i, 'the ')}.`;
  }

  if (options?.hasList) {
    return /(?:is|are)$/i.test(stem) ? `${stem}:` : `${stem} is:`;
  }

  if (options?.inlineValue != null && options.inlineValue !== '') {
    const bare = stem.replace(/\s+(is|are)$/i, '');
    return `${bare} is ${options.inlineValue}.`;
  }

  return /(?:is|are)$/i.test(stem) ? stem : `${stem} is`;
}

export function resultToCsv(result: unknown, maxRows?: number): string | null {
  if (!Array.isArray(result) || result.length === 0) return null;
  if (typeof result[0] !== 'object' || result[0] === null || Array.isArray(result[0])) return null;
  const rows = (maxRows == null ? result : result.slice(0, maxRows)) as Record<string, unknown>[];
  const keys = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  );
  if (!keys.length) return null;
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
}

export function isEmptyResult(result: unknown): boolean {
  if (result === null || result === undefined) return true;
  if (Array.isArray(result) && result.length === 0) return true;
  return false;
}

export function describeResultKind(result: unknown): string {
  if (result === null || result === undefined) return 'no value';
  if (typeof result === 'number' || typeof result === 'string' || typeof result === 'boolean') {
    return 'a single value';
  }
  if (Array.isArray(result)) {
    if (result.length === 0) return 'an empty list';
    if (result.length > 0 && typeof result[0] === 'object' && result[0] !== null) {
      return `a table with ${result.length} row${result.length === 1 ? '' : 's'}`;
    }
    return `a list of ${result.length} item${result.length === 1 ? '' : 's'}`;
  }
  if (typeof result === 'object') return 'a structured result';
  return 'a result';
}

// ── Friendly error translation ───────────────────────────────────────────────

export function translateError(raw: string | null | undefined): string {
  if (!raw) return 'Something went wrong while answering your question.';
  const msg = raw.trim();
  const lower = msg.toLowerCase();

  if (lower.includes('x-api-key') || lower.includes('api key')) {
    return 'Your API key is missing or invalid. Open Settings and paste a valid Nolain API key.';
  }
  if (lower.includes('402') || lower.includes('no credits remaining') || lower.includes('not linked to a portal')) {
    return 'You have no credits remaining. Open Settings and top up at the portal, then try again.';
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return 'The service is busy right now. Meta questions about your columns still work; try again in a moment.';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return 'Could not reach the cloud service. Check that it is running and try again.';
  }
  if (lower.includes('connection refused') || lower.includes('econnrefused')) {
    return 'The local data engine is not reachable. Restart the desktop app and try again.';
  }
  if (lower.includes('unknown column') || lower.includes('not in index') || /column ['"]/.test(lower)) {
    return `Your question refers to a column that is not in this file. ${msg}`;
  }
  if (lower.includes('parquet') && (lower.includes('csv') || lower.includes('read_csv'))) {
    return 'This file format could not be loaded for code execution. Try converting to CSV, or re-open the file and retry.';
  }
  if (lower.includes('scope') || lower.includes('topolog')) {
    return `The calculation steps could not be assembled correctly. Try rephrasing your question more specifically.\n\nDetails: ${msg}`;
  }
  if (lower.includes('security')) {
    return `The generated code was blocked for safety. Try rephrasing your question.\n\nDetails: ${msg}`;
  }
  if (
    lower.includes('invalid frequency')
    || (lower.includes("'m'") && lower.includes('me'))
    || lower.includes('no longer supported for offsets')
  ) {
    return (
      'This calculation used a date grouping frequency that is not supported by the installed pandas version. ' +
      'Update or restart the desktop app so the local engine uses a supported pandas release, then run the step again.'
    );
  }
  return msg;
}

export function suggestRephrases(question: string): string[] {
  const q = question.trim();
  const suggestions = [
    'Ask for a single metric (e.g. total, average, count) for a clear segment.',
    'Name the columns you care about if you know them.',
  ];
  if (/\b(uk|united kingdom|france|germany|spain)\b/i.test(q)) {
    suggestions.unshift('Confirm the country/region spelling matches values in your data.');
  }
  if (/\b(2010|2009|2020|month|year|quarter)\b/i.test(q)) {
    suggestions.unshift('Mention the exact date column or year range present in the file.');
  }
  if (/\brevenue|profit|sales\b/i.test(q)) {
    suggestions.unshift('Clarify how the metric is defined (e.g. Quantity × Price, excluding returns).');
  }
  return suggestions.slice(0, 3);
}

// ── Recipe builders ──────────────────────────────────────────────────────────

function formatParamDetail(params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'object') continue;
    parts.push(`${k}: ${String(v)}`);
  }
  return parts.length ? parts.join(', ') : undefined;
}

/** Upstream node ids from `inputs` and param refs (e.g. groupby_columns: ['node_2']). */
function collectInputIds(node: DagNodeLike): string[] {
  const ids = [...(node.inputs || [])];
  if (!node.params) return ids;

  for (const v of Object.values(node.params)) {
    if (typeof v === 'string' && isNodeId(v)) {
      ids.push(v);
      continue;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string' && isNodeId(item)) ids.push(item);
      }
    }
  }
  return ids;
}

/** Fallback topo sort when node list order is unknown (e.g. hand-edited graphs). */
export function topoOrderNodes(dag: DagLike): DagNodeLike[] {
  const byId = new Map(dag.nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const order: DagNodeLike[] = [];

  const visit = (id: string) => {
    if (visited.has(id) || !byId.has(id)) return;
    visited.add(id);
    const node = byId.get(id)!;
    for (const inp of collectInputIds(node)) visit(inp);
    order.push(node);
  };

  if (dag.output_node) visit(dag.output_node);
  for (const n of dag.nodes) {
    if (!visited.has(n.id)) visit(n.id);
  }
  return order;
}

function dagNodesInExecutionOrder(dag: DagLike): DagNodeLike[] {
  // Generated graphs store nodes in topological order (canvas #0, #1, …).
  // Re-sort only when that invariant clearly breaks (e.g. param-only edges missing from list order).
  const fromList = dag.nodes;
  const fromTopo = topoOrderNodes(dag);
  if (fromList.length !== fromTopo.length) return fromTopo;

  const listIndex = new Map(fromList.map((n, i) => [n.id, i]));
  let lastIdx = -1;
  for (const node of fromTopo) {
    const idx = listIndex.get(node.id);
    if (idx === undefined || idx < lastIdx) return fromTopo;
    lastIdx = idx;
  }
  return fromList;
}

export function buildDagRecipe(dag: DagLike | null): RecipeStep[] {
  if (!dag?.nodes?.length) return [];
  return dagNodesInExecutionOrder(dag).map((node) => ({
    id: `dag-${node.id}`,
    label: OP_LABELS[node.op] ?? node.op.replace(/_/g, ' '),
    detail: formatParamDetail(node.params),
    nodeId: node.id,
    source: 'dag' as const,
  }));
}

/** True when generated code has notebook section titles (matches CodeView cells). */
export function codeHasDescriptiveHeaders(code: string | null): boolean {
  if (!code?.trim()) return false;
  return parsePythonSteps(code).some((s) => !!s.desc?.trim());
}

const LEADING_FILLER =
  /^(please\s+)?(can you\s+|could you\s+|would you\s+)?(show me\s+|tell me\s+|give me\s+|what (is|are|was|were)\s+|what's\s+|whats\s+|which\s+|how many\s+|how much\s+)?/i;

const VERB_START =
  /^(find|calculate|compute|count|compare|identify|list|sum|average|rank|filter|group|analyse|analyze|estimate|measure|determine|get)\b/i;

/** Turn a user question into a short action title for an uncommented code block. */
export function titleFromQuestion(question: string, maxLen = 72): string {
  let q = question.replace(/\s+/g, ' ').trim();
  q = q.replace(/[?!.]+$/g, '').trim();
  if (!q) return 'Compute the answer';

  q = q.replace(LEADING_FILLER, '').trim();
  if (!q) q = question.replace(/[?!.]+$/g, '').trim();

  let title: string;
  if (VERB_START.test(q)) {
    title = q.charAt(0).toUpperCase() + q.slice(1);
  } else {
    const lower = q.toLowerCase();
    let verb = 'Compute';
    if (/\b(top|highest|largest|most|rank|whale)\b/.test(lower)) verb = 'Find';
    else if (/\b(average|mean|median|total|sum|revenue|sales|profit|rate|ratio)\b/.test(lower)) {
      verb = 'Calculate';
    } else if (/\b(how many|count|number of|nunique)\b/.test(lower) || /^(many|number)\b/.test(lower)) {
      verb = 'Count';
    } else if (/\b(correlat|relationship|vs\.?|versus|compare)\b/.test(lower)) {
      verb = 'Compare';
    } else if (/\b(which|who|what)\b/.test(question.toLowerCase())) {
      verb = 'Find';
    }
    title = `${verb} ${q.charAt(0).toLowerCase()}${q.slice(1)}`;
  }

  if (title.length > maxLen) {
    title = `${title.slice(0, maxLen - 1).trimEnd()}…`;
  }
  return title;
}

/** One-line detail under a recipe step when code has no descriptive headers. */
export function detailForUncommentedCode(
  code: string | null,
  opts?: { hasDag?: boolean },
): string {
  const src = code ?? '';
  const lower = src.toLowerCase();

  if (/\.groupby\s*\(/.test(lower) && /\.(sum|mean|count|agg|size)\s*\(/.test(lower)) {
    return 'Groups data, then aggregates';
  }
  if (/\.(nlargest|nsmallest)\s*\(/.test(lower) || (/\.sort_values\s*\(/.test(lower) && /\.head\s*\(/.test(lower))) {
    return 'Ranks results and keeps the top ones';
  }
  if (/\.query\s*\(/.test(lower) || /\.loc\s*\[/.test(lower) || /\.isin\s*\(/.test(lower)) {
    return 'Filters rows, then computes the metric';
  }
  if (opts?.hasDag) {
    return 'Open the calculation used for this answer';
  }
  return 'Open the full calculation code';
}

export function buildCodeRecipe(
  pandasCode: string | null,
  question: string,
  opts?: { hasDag?: boolean },
): RecipeStep[] {
  if (!pandasCode?.trim()) return [];
  const steps = parsePythonSteps(pandasCode);
  const hasDescriptive = steps.some((s) => !!s.desc?.trim());

  // Uncommented (or empty headers only): one meaningful step from the question.
  if (!hasDescriptive) {
    return [
      {
        id: 'code-0',
        label: titleFromQuestion(question),
        detail: detailForUncommentedCode(pandasCode, opts),
        cellIndex: 0,
        source: 'code',
      },
    ];
  }

  return steps.map((step, i) => ({
    id: `code-${i}`,
    label: step.desc?.trim() || titleFromQuestion(question),
    detail: step.desc?.trim() ? undefined : detailForUncommentedCode(step.code, opts),
    cellIndex: i,
    source: 'code' as const,
  }));
}

/** Formatted result text for LLM synthesis (list bullets or inline scalar). */
export function buildSynthesisResultSummary(value: unknown): string {
  const items = formatResultItems(value);
  if (items.length > 0) return items.join('\n');
  if (value !== null && value !== undefined && !isEmptyResult(value)) {
    return formatInlineResult(value);
  }
  return '';
}

/**
 * Choose the recipe to show:
 * - Successful path wins when one computation failed and the other succeeded
 * - Valid DAG → DAG steps in execution order (matches canvas #0, #1, …)
 * - Descriptive code `#` headers only → code sections
 * - Uncommented code only → one question-derived step
 */
export function selectRecipe(
  question: string,
  pandasCode: string | null,
  dag: DagLike | null,
  hasValidGraph: boolean,
  opts?: { dagOk?: boolean; pandasOk?: boolean },
): RecipeStep[] {
  const dagOk = opts?.dagOk ?? false;
  const pandasOk = opts?.pandasOk ?? false;
  const dagRecipe = buildDagRecipe(hasValidGraph ? dag : null);

  const codeRecipe = (): RecipeStep[] => {
    if (codeHasDescriptiveHeaders(pandasCode)) {
      return buildCodeRecipe(pandasCode, question, { hasDag: hasValidGraph });
    }
    if (pandasCode?.trim()) {
      return buildCodeRecipe(pandasCode, question, { hasDag: hasValidGraph });
    }
    return [];
  };

  if (pandasOk && !dagOk) return codeRecipe();
  if (dagOk && !pandasOk) return dagRecipe.length > 0 ? dagRecipe : codeRecipe();
  if (pandasOk && dagOk) {
    const code = codeRecipe();
    return code.length > 0 ? code : dagRecipe;
  }

  const code = codeRecipe();
  if (code.length > 0) return code;
  return dagRecipe;
}

export function extractNoneResultReason(code: string | null): string | null {
  if (!code) return null;
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*result\s*=\s*None\b/.test(lines[i])) continue;
    // Prefer nearby comment above the assignment
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
      const t = lines[j].trim();
      if (t.startsWith('#')) {
        const reason = t.replace(/^#\s*/, '').trim();
        if (reason) return reason;
      }
      if (t && !t.startsWith('#')) break;
    }
    // Or inline comment
    const inline = lines[i].split('#').slice(1).join('#').trim();
    if (inline) return inline;
    return 'The calculation concluded that this question cannot be answered with the available columns.';
  }
  return null;
}

// ── Usefulness / assumptions ─────────────────────────────────────────────────

export function buildAssumptions(
  clarifications?: { term: string; chosen_interpretation: string }[] | null,
): string[] {
  if (!clarifications?.length) return [];
  return clarifications.map(
    (c) => `Interpreted “${c.term}” as ${c.chosen_interpretation}`,
  );
}

export function buildUsefulFor(question: string, result: unknown, outcome: AnswerOutcome): string {
  // Failure paths: keep the answer as explanation + next steps, not framing copy.
  if (outcome === 'empty' || outcome === 'couldnt_compute') {
    return '';
  }
  const kind = describeResultKind(result).replace(/^an?\s+/i, '');
  const q = question.toLowerCase();
  if (/\b(trend|over time|monthly|daily|growth)\b/.test(q)) {
    return `This ${kind} helps you spot direction and pace of change so you can decide whether to investigate further or compare periods.`;
  }
  if (/\b(top|highest|largest|whale|rank)\b/.test(q)) {
    return `This ${kind} highlights where concentration sits — useful for prioritising customers, products, or markets.`;
  }
  if (/\b(average|mean|median|typical)\b/.test(q)) {
    return `This ${kind} gives a typical level you can use as a baseline when comparing segments or time periods.`;
  }
  if (/\b(total|sum|revenue|sales|profit)\b/.test(q)) {
    return `This ${kind} quantifies overall contribution — useful for sizing opportunity or comparing markets.`;
  }
  if (/\b(churn|dormant|retention|retain)\b/.test(q)) {
    return `This ${kind} flags retention risk — useful for deciding who to re-engage or which segments need attention.`;
  }
  if (/\b(correlat|relationship|vs\.?|versus)\b/.test(q)) {
    return `This ${kind} shows how two measures move together — useful before betting on a driver or lever.`;
  }
  return `This ${kind} answers your question directly so you can decide the next comparison, filter, or follow-up question.`;
}

export function buildCoverage(rowCount?: number | null, result?: unknown): string | undefined {
  const parts: string[] = [];
  if (typeof rowCount === 'number' && rowCount > 0) {
    parts.push(`Dataset has ${rowCount.toLocaleString()} rows`);
  }
  if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object') {
    parts.push(`answer shows ${result.length.toLocaleString()} row${result.length === 1 ? '' : 's'}`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}

// ── Cross-check equality (DAG vs code) ─────────────────────────────────────

const NUMERIC_STRING = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function normalizeScalarForCompare(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 1e10) / 1e10;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (NUMERIC_STRING.test(trimmed)) {
      return normalizeScalarForCompare(Number(trimmed));
    }
    return trimmed;
  }
  if (typeof value === 'boolean') return value;
  return value;
}

/** Stable object for compare — lowercase keys, sorted, normalized scalars. */
function canonicalRecord(row: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(row).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'accent' }),
  );
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[k.toLowerCase()] = normalizeScalarForCompare(row[k]);
  }
  return out;
}

/** Full row with normalized keys/scalars — column order and extras must not break compare. */
function comparableTabularRow(row: Record<string, unknown>): Record<string, unknown> {
  return canonicalRecord(row);
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizeForCompare(value));
}

function normalizeForCompare(value: unknown): unknown {
  const scalar = normalizeScalarForCompare(value);
  if (scalar !== value && (typeof value !== 'object' || value === null)) {
    return scalar;
  }
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return normalizeScalarForCompare(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    if (
      value.every(
        (item) => item !== null && typeof item === 'object' && !Array.isArray(item),
      )
    ) {
      const rows = (value as Record<string, unknown>[]).map(comparableTabularRow);
      rows.sort((ra, rb) => stableJson(ra).localeCompare(stableJson(rb)));
      return rows;
    }
    const items = value.map((item) => normalizeForCompare(item));
    items.sort((x, y) => stableJson(x).localeCompare(stableJson(y)));
    return items;
  }
  if (typeof value === 'object') {
    return canonicalRecord(value as Record<string, unknown>);
  }
  return String(value);
}

function numbersClose(a: number, b: number): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= 1e-9 * scale;
}

function toCompareNumber(value: unknown): number | null {
  const n = normalizeScalarForCompare(value);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function isNumericLike(value: unknown): boolean {
  return toCompareNumber(value) !== null;
}

/**
 * Normalize tabular / series-like results to labeled numeric rows for cross-check.
 * Handles record lists, category→value dicts (Series JSON), and bare number arrays.
 */
function extractComparableEntries(result: unknown): Array<{ label: string; value: number }> {
  if (result === null || result === undefined) return [];

  if (typeof result === 'number') {
    const v = toCompareNumber(result);
    return v === null ? [] : [{ label: '', value: v }];
  }

  if (typeof result === 'object' && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length && keys.every((k) => isNumericLike(obj[k]))) {
      return keys.map((k) => ({
        label: k.trim().toLowerCase(),
        value: toCompareNumber(obj[k])!,
      }));
    }
    return [];
  }

  if (!Array.isArray(result) || result.length === 0) return [];

  if (result.every((item) => isNumericLike(item))) {
    return (result as unknown[]).map((item) => ({
      label: '',
      value: toCompareNumber(item)!,
    }));
  }

  if (
    result.every(
      (item) => item !== null && typeof item === 'object' && !Array.isArray(item),
    )
  ) {
    const entries: Array<{ label: string; value: number }> = [];
    for (const row of result as Record<string, unknown>[]) {
      const keys = Object.keys(row);
      const { labelKey, measureKey } = pickLabelAndMeasureKeys(keys);
      const measure = measureKey ?? keys.find((k) => isNumericLike(row[k]));
      if (!measure) continue;
      const value = toCompareNumber(row[measure]);
      if (value === null) continue;
      const label = labelKey ? String(row[labelKey] ?? '').trim().toLowerCase() : '';
      entries.push({ label, value });
    }
    return entries;
  }

  return [];
}

function comparableEntriesAgree(a: unknown, b: unknown): boolean {
  const ea = extractComparableEntries(a);
  const eb = extractComparableEntries(b);
  if (!ea.length || !eb.length) return false;
  if (ea.length !== eb.length) return false;

  const labeledA = ea.every((e) => e.label.length > 0);
  const labeledB = eb.every((e) => e.label.length > 0);
  if (labeledA && labeledB) {
    const sa = [...ea].sort((x, y) => x.label.localeCompare(y.label));
    const sb = [...eb].sort((x, y) => x.label.localeCompare(y.label));
    return sa.every((e, i) => e.label === sb[i].label && numbersClose(e.value, sb[i].value));
  }

  const va = ea.map((e) => e.value).sort((x, y) => x - y);
  const vb = eb.map((e) => e.value).sort((x, y) => x - y);
  return va.every((v, i) => numbersClose(v, vb[i]!));
}

function rowLookupValue(row: Record<string, unknown>, colNorm: string): unknown {
  const key = Object.keys(row).find((k) => k.toLowerCase() === colNorm);
  return key !== undefined ? row[key] : undefined;
}

function asTabularRows(result: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(result)) {
    if (result.length === 0) return [];
    if (result.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) {
      return result as Record<string, unknown>[];
    }
    return null;
  }
  if (result !== null && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return [];
    if (keys.every((k) => isNumericLike(obj[k]))) return null;
    return [obj];
  }
  return null;
}

function normalizedLabel(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function scalarLabelMatchesTabular(scalar: unknown, tabular: unknown): boolean {
  if (typeof scalar !== 'string') return false;
  const target = scalar.trim().toLowerCase();
  if (!target) return false;
  const rows = asTabularRows(tabular);
  if (!rows || rows.length !== 1) return false;
  return Object.values(rows[0]).some((v) => normalizedLabel(v) === target);
}

function columnNameKind(key: string): 'label' | 'measure' | 'other' {
  const lower = key.toLowerCase();
  if (LABEL_KEY_HINTS.some((h) => lower === h || lower.includes(h))) return 'label';
  if (MEASURE_KEY_HINTS.some((h) => lower === h || lower.includes(h))) return 'measure';
  return 'other';
}

function sharedColumnCompare(a: unknown, b: unknown): ResultsCompareVerdict | null {
  const rowsA = asTabularRows(a);
  const rowsB = asTabularRows(b);
  if (rowsA === null || rowsB === null) return null;

  if (rowsA.length === 0 && rowsB.length === 0) return 'agree';
  if (rowsA.length !== rowsB.length) return 'disagree';

  const colsA = new Set<string>();
  const colsB = new Set<string>();
  for (const row of rowsA) for (const k of Object.keys(row)) colsA.add(k.toLowerCase());
  for (const row of rowsB) for (const k of Object.keys(row)) colsB.add(k.toLowerCase());
  const shared = [...colsA].filter((c) => colsB.has(c));
  if (shared.length === 0) return null;

  const labelCols = shared.filter((c) => columnNameKind(c) === 'label');
  const measureCols = shared.filter((c) => {
    if (labelCols.includes(c)) return false;
    return rowsA.some((r) => isNumericLike(rowLookupValue(r, c)))
      || rowsB.some((r) => isNumericLike(rowLookupValue(r, c)));
  });

  const labelCol = labelCols[0]
    ?? (measureCols.length > 0 && shared.length >= 2
      ? shared.find((c) => !measureCols.includes(c)) ?? shared[0]
      : undefined);

  if (labelCol && measureCols.length > 0) {
    const buildMap = (rows: Record<string, unknown>[]) => {
      const map = new Map<string, Record<string, number>>();
      for (const row of rows) {
        const lk = normalizedLabel(rowLookupValue(row, labelCol));
        if (!lk) continue;
        const measures: Record<string, number> = {};
        for (const mc of measureCols) {
          const n = toCompareNumber(rowLookupValue(row, mc));
          if (n !== null) measures[mc] = n;
        }
        map.set(lk, measures);
      }
      return map;
    };

    const mapA = buildMap(rowsA);
    const mapB = buildMap(rowsB);
    if (mapA.size === 0 || mapB.size === 0) return null;
    if (mapA.size !== mapB.size) return 'disagree';

    let comparedAny = false;
    for (const [label, measuresA] of mapA) {
      const measuresB = mapB.get(label);
      if (!measuresB) return 'disagree';
      for (const mc of measureCols) {
        const inA = mc in measuresA;
        const inB = mc in measuresB;
        if (inA && inB) {
          comparedAny = true;
          if (!numbersClose(measuresA[mc], measuresB[mc])) return 'disagree';
        }
      }
    }
    return comparedAny ? 'agree' : null;
  }

  const project = (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const c of shared) {
      out[c] = normalizeScalarForCompare(rowLookupValue(row, c));
    }
    const keys = Object.keys(out).sort();
    const sorted: Record<string, unknown> = {};
    for (const k of keys) sorted[k] = out[k];
    return JSON.stringify(sorted);
  };

  const sigA = rowsA.map(project).sort();
  const sigB = rowsB.map(project).sort();
  if (sigA.length !== sigB.length) return 'disagree';
  return sigA.every((s, i) => s === sigB[i]) ? 'agree' : 'disagree';
}

function extractRowMeasureMaps(result: unknown): Map<string, Record<string, number>> | null {
  const rows = asTabularRows(result);
  if (!rows || rows.length === 0) return null;

  const maps = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const keys = Object.keys(row);
    const { labelKey } = pickLabelAndMeasureKeys(keys);
    const label = labelKey
      ? normalizedLabel(row[labelKey])
      : stableJson(canonicalRecord(row));
    const measures: Record<string, number> = {};
    for (const k of keys) {
      if (labelKey && k === labelKey) continue;
      const n = toCompareNumber(row[k]);
      if (n !== null) measures[k.toLowerCase()] = n;
    }
    if (Object.keys(measures).length === 0) return null;
    maps.set(label, measures);
  }
  return maps;
}

function comparableEntriesClearlyDisagree(a: unknown, b: unknown): boolean {
  const mapA = extractRowMeasureMaps(a);
  const mapB = extractRowMeasureMaps(b);
  if (!mapA || !mapB || mapA.size === 0 || mapB.size === 0) return false;

  for (const [label, measuresA] of mapA) {
    const measuresB = mapB.get(label);
    if (!measuresB) continue;
    for (const [key, valueA] of Object.entries(measuresA)) {
      if (key in measuresB && !numbersClose(valueA, measuresB[key])) return true;
    }
  }
  return false;
}

function formatAlternateResult(dagValue: unknown): string {
  return formatResultItems(dagValue).length
    ? formatResultItems(dagValue).join('; ')
    : formatResultValue(dagValue);
}

/**
 * Compare DAG vs code results. Returns `unknown` when deterministic checks
 * are inconclusive and LLM cross-check should decide.
 */
export function compareResults(a: unknown, b: unknown): ResultsCompareVerdict {
  try {
    const largeTabularResult =
      (Array.isArray(a) && a.length > 100) ||
      (Array.isArray(b) && b.length > 100);
    if (!largeTabularResult && JSON.stringify(a) === JSON.stringify(b)) return 'agree';
    if (!largeTabularResult && stableJson(a) === stableJson(b)) return 'agree';
    if (scalarLabelMatchesTabular(a, b) || scalarLabelMatchesTabular(b, a)) return 'agree';

    const sharedVerdict = sharedColumnCompare(a, b);
    if (sharedVerdict !== null) return sharedVerdict;

    if (comparableEntriesAgree(a, b)) return 'agree';
    if (comparableEntriesClearlyDisagree(a, b)) return 'disagree';

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** True when DAG and code paths produced the same answer for the user. */
export function resultsAgree(a: unknown, b: unknown): boolean {
  return compareResults(a, b) === 'agree';
}

function applyDualPathCrossCheck(
  pandasValue: unknown,
  dagValue: unknown,
): {
  crossCheck: CrossCheckStatus;
  crossCheckNote: string;
  outcome: AnswerOutcome;
  caveats: string[];
  crossCheckPending: boolean;
  dagSynthesisResultSummary?: string;
} {
  const verdict = compareResults(pandasValue, dagValue);
  if (verdict === 'agree') {
    return {
      crossCheck: 'agree',
      crossCheckNote: 'Verified two ways — both calculation methods agree.',
      outcome: 'answered',
      caveats: [],
      crossCheckPending: false,
    };
  }
  if (verdict === 'disagree') {
    return {
      crossCheck: 'disagree',
      crossCheckNote:
        'We calculated this two ways and got different numbers. Follow the steps to see where they diverge.',
      outcome: 'partial',
      caveats: [`Alternate method result: ${formatAlternateResult(dagValue)}`],
      crossCheckPending: false,
    };
  }
  return {
    crossCheck: 'pending',
    crossCheckNote: 'Answer from the primary calculation path. Follow the steps to verify.',
    outcome: 'answered',
    caveats: [],
    crossCheckPending: true,
    dagSynthesisResultSummary: buildSynthesisResultSummary(dagValue) || undefined,
  };
}

/** Merge LLM cross-check verdict after synthesis when deterministic compare was inconclusive. */
export function applySynthesisCrossCheck(
  answer: AnswerPayload,
  narrative: {
    cross_check_agree?: boolean | null;
    cross_check_note?: string | null;
  },
): AnswerPayload {
  if (!answer.crossCheckPending) return answer;

  const next: AnswerPayload = {
    ...answer,
    crossCheckPending: false,
    dagSynthesisResultSummary: undefined,
  };

  if (narrative.cross_check_agree === true) {
    next.crossCheck = 'agree';
    next.crossCheckNote =
      (typeof narrative.cross_check_note === 'string' && narrative.cross_check_note.trim())
      || 'Verified two ways — both calculation methods agree.';
    next.outcome = 'answered';
    next.caveats = (next.caveats ?? []).filter((c) => !c.startsWith('Alternate method result:'));
    next.copyText = buildAnswerCopyText(next);
    return next;
  }

  next.crossCheck = 'disagree';
  next.outcome = 'partial';
  next.crossCheckNote =
    (typeof narrative.cross_check_note === 'string' && narrative.cross_check_note.trim())
    || 'We calculated this two ways and got different numbers. Follow the steps to see where they diverge.';
  const alt = answer.dagSynthesisResultSummary?.trim();
  if (alt) {
    next.caveats = [...(next.caveats ?? []), `Alternate method result: ${alt}`];
  }
  next.copyText = buildAnswerCopyText(next);
  return next;
}

// ── Main composer ────────────────────────────────────────────────────────────

export function composeAnswer(input: ComposeAnswerInput): AnswerPayload {
  const {
    question,
    dagValue,
    dagError,
    pandasValue,
    pandasError,
    hasValidGraph,
    compilationFailed,
    compilationError,
    dag,
    pandasCode,
    clarifications,
    rowCount,
    resultRowCount,
    pandasWarnings,
    pandasExecuted = false,
    dagExecuted = false,
    computationGraphRequested = false,
    dagArtifactFailed = false,
    dagArtifactFailureReason = null,
  } = input;

  const allAssumptions = buildAssumptions(clarifications);
  const assumptions = allAssumptions.filter((a) => {
    // Drop assumptions already visible via inline “(interpretation)” in the lead.
    const m = a.match(/^Interpreted [“"](.+?)[”"] as /);
    if (!m) return true;
    const term = m[1];
    return !new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(question);
  });

  // A Plan without compile_dag has no graph Artifact — that is not a DAG failure.
  const dagOk = dagExecuted && !dagError;
  const pandasOk = pandasExecuted && !pandasError;
  const recipe = selectRecipe(question, pandasCode, hasValidGraph ? dag : null, hasValidGraph, {
    dagOk,
    pandasOk,
  });
  const primaryValue = pandasOk ? pandasValue : dagOk ? dagValue : null;
  const noneReason =
    extractNoneResultReason(pandasCode) ||
    pandasWarnings?.find((w) => /cannot|could not|no result|not set/i.test(w));

  const failSuggestions = suggestRephrases(question);

  // ── Both failed ──────────────────────────────────────────────────────────
  if ((!dagOk || compilationFailed) && !pandasOk) {
    const details = [
      compilationError || dagError ? translateError(compilationError || dagError) : null,
      pandasError ? translateError(pandasError) : null,
    ].filter(Boolean) as string[];

    const headline = buildAnswerLead(question, clarifications, { failed: true });
    const body = [
      'We could not produce a reliable result for this question.',
      details.length ? details.map((d) => `— ${d}`).join('\n') : null,
    ]
      .filter(Boolean)
      .join('\n\n');

    const payload: AnswerPayload = {
      outcome: 'couldnt_compute',
      headline,
      body,
      assumptions: assumptions.length ? assumptions : undefined,
      suggestions: failSuggestions,
      recipe: recipe.length ? recipe : undefined,
      crossCheck: 'none',
      copyText: '',
    };
    payload.copyText = buildAnswerCopyText(payload);
    return payload;
  }

  // ── Empty / null primary ─────────────────────────────────────────────────
  if (pandasOk && isEmptyResult(pandasValue)) {
    const isNull = pandasValue === null || pandasValue === undefined;
    const headline = buildAnswerLead(question, clarifications, { failed: true });
    const body = isNull
      ? noneReason ||
        'The calculation finished without a final value. This often means the question cannot be answered with the columns in this file.'
      : 'No rows matched the filters used for this question. The segment may not exist, or the criteria may be too narrow.';

    const emptyDualVerdict = dagOk ? compareResults(dagValue, pandasValue) : null;
    const payload: AnswerPayload = {
      outcome: 'empty',
      headline,
      body,
      assumptions: assumptions.length ? assumptions : undefined,
      coverage: buildCoverage(rowCount, pandasValue),
      recipe,
      suggestions: isNull
        ? failSuggestions
        : [
            'Widen the filter (date range, country, or category).',
            'Ask what distinct values exist for the filtered column.',
            ...failSuggestions.slice(0, 1),
          ],
      crossCheck: dagOk
        ? emptyDualVerdict === 'agree'
          ? 'agree'
          : emptyDualVerdict === 'disagree'
            ? 'disagree'
            : 'pending'
        : 'single',
      crossCheckNote: dagOk
        ? emptyDualVerdict === 'agree'
          ? 'Verified two ways — both methods agree.'
          : emptyDualVerdict === 'disagree'
            ? 'Two calculation methods disagreed — follow the steps to compare.'
            : 'Answer from the primary calculation path.'
        : 'Answer from the primary calculation path.',
      crossCheckPending: emptyDualVerdict === 'unknown' ? true : undefined,
      dagSynthesisResultSummary:
        emptyDualVerdict === 'unknown'
          ? buildSynthesisResultSummary(dagValue) || undefined
          : undefined,
      copyText: '',
    };
    payload.copyText = buildAnswerCopyText(payload);
    return payload;
  }

  // ── Partial: one path works ──────────────────────────────────────────────
  const value = primaryValue;
  let crossCheck: CrossCheckStatus = 'single';
  let crossCheckNote = 'Answer from the primary calculation path. Follow the steps to verify.';
  let caveats: string[] = [];
  let outcome: AnswerOutcome = 'answered';
  let crossCheckPending = false;
  let dagSynthesisResultSummary: string | undefined;

  if (pandasOk && dagOk) {
    const dual = applyDualPathCrossCheck(pandasValue, dagValue);
    crossCheck = dual.crossCheck;
    crossCheckNote = dual.crossCheckNote;
    outcome = dual.outcome;
    caveats = dual.caveats;
    crossCheckPending = dual.crossCheckPending;
    dagSynthesisResultSummary = dual.dagSynthesisResultSummary;
  } else if (pandasOk && !dagOk) {
    if (!computationGraphRequested && !hasValidGraph && !compilationFailed) {
      // Plan completed without a graph Artifact (compile_dag disabled).
      crossCheck = 'single';
      crossCheckNote = 'Answer from the primary calculation path. Follow the steps to verify.';
    } else {
      crossCheck = 'partial';
      if (hasValidGraph) {
        crossCheckNote =
          'Answer from the code calculation. The computation graph is available as a visual guide — its execution could not be verified, so treat it as reference only.';
      } else if (computationGraphRequested || dagArtifactFailed) {
        const graphFailure = dagArtifactFailureReason || compilationError || dagError;
        crossCheckNote = graphFailure
          ? `Answer from the code calculation. The computation graph could not be produced (${translateError(graphFailure)}).`
          : 'Answer from the code calculation. The computation graph could not be produced for this query.';
      } else {
        crossCheckNote =
          'Primary calculation succeeded. The visual step graph could not be verified — treat the graph as reference only.';
      }
      if (compilationError || dagError) {
        const detail = translateError(compilationError || dagError);
        if (!crossCheckNote.includes(detail)) {
          caveats.push(detail);
        }
      }
      outcome = 'partial';
    }
  } else if (dagOk && !pandasOk) {
    crossCheck = 'partial';
    crossCheckNote =
      'Answer from the visual calculation graph. The code path failed — follow the graph steps to verify.';
    if (pandasError) caveats.push(translateError(pandasError));
    outcome = 'partial';
  }

  const usefulFor = buildUsefulFor(question, value, outcome);
  const coverage = buildCoverage(rowCount, value);
  const resultItems = formatResultItems(value);
  const hasList = resultItems.length > 0;
  const inlineValue = hasList ? undefined : formatInlineResult(value);
  const headline = buildAnswerLead(question, clarifications, {
    hasList,
    inlineValue,
  });
  const tableRowCount = typeof resultRowCount === 'number'
    ? resultRowCount
    : Array.isArray(value) &&
      value.length > 0 &&
      value[0] !== null &&
      typeof value[0] === 'object' &&
      !Array.isArray(value[0])
      ? value.length
      : undefined;
  const tableCsv = resultToCsv(value, RESULT_PREVIEW_ROW_LIMIT) ?? undefined;

  const payload: AnswerPayload = {
    outcome,
    headline,
    resultItems: hasList ? resultItems : undefined,
    synthesisResultSummary: buildSynthesisResultSummary(value) || undefined,
    usefulFor: usefulFor || undefined,
    caveats: caveats.length ? caveats : undefined,
    // Clarifications are already woven into the lead; keep assumptions only if
    // any term did not appear in the question text.
    assumptions: assumptions.length ? assumptions : undefined,
    coverage,
    crossCheck,
    crossCheckNote,
    crossCheckPending: crossCheckPending || undefined,
    dagSynthesisResultSummary,
    recipe: recipe.length ? recipe : undefined,
    copyText: '',
    tableCsv,
    tableRowCount,
  };
  payload.copyText = buildAnswerCopyText(payload);
  return payload;
}

/** Continuous prose derived from structured answer fields (for UI + copy). */
export interface AnswerProse {
  /** Full sequential paragraphs of the answer (same visual style). */
  paragraphs: string[];
  /** Row coverage / cross-check hint — shown under the Answer kicker in UI. */
  coverageLine?: string;
  items?: string[];
  trust?: string;
  trustEmphasized: boolean;
}

function weaveContext(usefulFor?: string, assumptions?: string[]): string | undefined {
  const parts: string[] = [];
  if (usefulFor?.trim()) parts.push(usefulFor.trim());
  if (assumptions?.length) parts.push(assumptions.map((a) => a.trim()).filter(Boolean).join(' '));
  if (!parts.length) return undefined;
  return parts.join(' ');
}

function weaveTrust(answer: AnswerPayload): { text?: string; emphasized: boolean } {
  const emphasized =
    answer.outcome === 'partial' ||
    answer.crossCheck === 'disagree' ||
    answer.crossCheck === 'partial' ||
    (answer.caveats?.length ?? 0) > 0;

  if (!emphasized) return { emphasized: false };

  const bits: string[] = [];
  const skipQuietSingle =
    answer.crossCheck === 'single' && answer.outcome === 'answered' && !(answer.caveats?.length);
  if (answer.crossCheckNote && answer.crossCheck !== 'agree' && !skipQuietSingle) {
    bits.push(answer.crossCheckNote.trim());
  }
  if (answer.caveats?.length) {
    for (const c of answer.caveats) {
      const t = c.trim();
      if (t && !bits.some((b) => b.includes(t))) bits.push(t);
    }
  }
  return { text: bits.length ? bits.join(' ') : undefined, emphasized };
}

function formatCoverageLine(answer: AnswerPayload): string | undefined {
  if (answer.coverage?.trim()) {
    return answer.crossCheck === 'agree'
      ? `${answer.coverage.trim()} · Checked two ways`
      : answer.coverage.trim();
  }
  if (answer.crossCheck === 'agree') {
    return 'Checked two ways.';
  }
  return undefined;
}

export function buildAnswerProse(answer: AnswerPayload): AnswerProse {
  const { text: trust, emphasized: trustEmphasized } = weaveTrust(answer);
  const isFailure = answer.outcome === 'couldnt_compute' || answer.outcome === 'empty';
  const paragraphs: string[] = [];

  if (answer.headline?.trim()) paragraphs.push(answer.headline.trim());
  if (answer.body?.trim()) paragraphs.push(answer.body.trim());

  // Useful-for / leftover assumptions become the next paragraph — not separate sections.
  if (!isFailure) {
    const context = weaveContext(answer.usefulFor, answer.assumptions);
    if (context) paragraphs.push(context);
  } else if (answer.assumptions?.length) {
    const leftover = answer.assumptions.map((a) => a.trim()).filter(Boolean).join(' ');
    if (leftover) paragraphs.push(leftover);
  }

  return {
    paragraphs,
    coverageLine: formatCoverageLine(answer),
    items: answer.resultItems?.length ? answer.resultItems : undefined,
    trust,
    trustEmphasized,
  };
}

/** Prose-first plain text for clipboard / message content. */
export function buildAnswerCopyText(answer: AnswerPayload): string {
  const prose = buildAnswerProse(answer);
  const parts: string[] = [...prose.paragraphs];
  if (prose.items?.length) {
    // Insert bullets after the lead (first paragraph).
    const bullets = prose.items.map((item) => `• ${item}`).join('\n');
    if (parts.length) {
      parts.splice(1, 0, bullets);
    } else {
      parts.push(bullets);
    }
  }
  if (prose.coverageLine) parts.push(prose.coverageLine);
  if (prose.trust) parts.push(prose.trust);
  if (answer.suggestions?.length) {
    parts.push(`You could try:\n${answer.suggestions.map((s) => `• ${s}`).join('\n')}`);
  }
  if (answer.recipe?.length) {
    parts.push(
      `Calculation steps:\n${answer.recipe.map((s, i) => `${i + 1}. ${s.label}${s.detail ? ` (${s.detail})` : ''}`).join('\n')}`,
    );
  }
  return parts.filter(Boolean).join('\n\n');
}

/** Flatten AnswerPayload to plain conversation content (fallback / copy). */
export function answerToPlainText(answer: AnswerPayload): string {
  return answer.copyText || buildAnswerCopyText(answer);
}

export function buildMetaAnswerLocal(metadata: Record<string, unknown>): string | null {
  const cols = (metadata.available_columns as string[]) ?? [];
  if (!cols.length) return null;
  const semantics = (metadata.column_semantics as Record<string, Record<string, unknown>>) ?? {};
  const rowCount = metadata.total_rows ?? metadata.total_rows_read;
  const lines = ['Here is what I know about your dataset:'];
  if (typeof rowCount === 'number') {
    lines.push(`\n**Rows:** ${Number(rowCount).toLocaleString()}`);
  }
  lines.push(`\n**Columns (${cols.length}):** ${cols.join(', ')}`);
  const typeInfo: string[] = [];
  for (const col of cols.slice(0, 20)) {
    const meta = semantics[col];
    if (!meta) continue;
    const dtype = (meta.data_type as string) || (meta.semantic_type as string) || 'unknown';
    const samples = Array.isArray(meta.sample_values)
      ? meta.sample_values.slice(0, 3).map(String).join(', ')
      : '';
    typeInfo.push(samples ? `${col} (${dtype}; e.g. ${samples})` : `${col} (${dtype})`);
  }
  if (typeInfo.length) lines.push(`\n**Column details:** ${typeInfo.join('; ')}`);
  return lines.join('');
}
