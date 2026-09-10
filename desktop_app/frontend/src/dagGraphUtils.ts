import type { Connection, Edge } from '@xyflow/react';

/** Ops with no positional inputs (only params / source columns). */
export const ZERO_INPUT_OPS = new Set(['filter_extract', 'groupby_agg', 'load_constant']);

export const BINARY_ELEMENTWISE_OPS = new Set([
  'add', 'subtract', 'multiply', 'divide', 'pow',
  'percentage_change', 'dot_product',
  'eq', 'ne', 'gt', 'ge', 'lt', 'le',
  'logical_and', 'logical_or',
  'concat_str', 'isin_from_node',
  'sum_if', 'mean_if',
]);

const SCALAR_OUTPUT_OPS = new Set([
  'mean', 'sum', 'max', 'min', 'std', 'median', 'mode', 'nunique',
  'count', 'percentage_change', 'dot_product', 'idxmax', 'idxmin',
  'count_if', 'sum_if', 'mean_if', 'quantile',
]);

const INHERIT_SCOPE_OPS = new Set([
  'to_datetime', 'str', 'isnan', 'startswith', 'isin', 'between',
  'logical_not', 'abs', 'round', 'pow', 'sqrt', 'log',
  'nlargest', 'nsmallest', 'sort_values', 'head', 'tail',
  'extract_year', 'extract_month', 'extract_day',
  'truncate_to', 'rank', 'cumsum', 'cumshare',
  'dropna', 'fillna', 'contains', 'lower', 'upper', 'isin_from_node',
  'date_add', 'shift', 'diff', 'rolling_mean', 'rolling_sum',
]);

/** Human-readable port labels (mirrors query_operations._PORT_NAMES). */
export const INPUT_PORT_LABELS: Record<string, string[]> = {
  add: ['left', 'right'],
  subtract: ['left', 'right'],
  multiply: ['left', 'right'],
  divide: ['numerator', 'denominator'],
  pow: ['base', 'exponent'],
  percentage_change: ['old', 'new'],
  dot_product: ['left', 'right'],
  eq: ['left', 'right'],
  ne: ['left', 'right'],
  gt: ['left', 'right'],
  ge: ['left', 'right'],
  lt: ['left', 'right'],
  le: ['left', 'right'],
  logical_and: ['left', 'right'],
  logical_or: ['left', 'right'],
  concat_str: ['left', 'right'],
  isin_from_node: ['target', 'values'],
  sum_if: ['values', 'mask'],
  mean_if: ['values', 'mask'],
  abs: ['values'],
  round: ['values'],
  sqrt: ['values'],
  log: ['values'],
  mean: ['values'],
  sum: ['values'],
  max: ['values'],
  min: ['values'],
  nunique: ['values'],
  unique: ['values'],
  mode: ['values'],
  median: ['values'],
  std: ['values'],
  count: ['values'],
  value_counts: ['values'],
  idxmax: ['values'],
  idxmin: ['values'],
  nlargest: ['values'],
  nsmallest: ['values'],
  sort_values: ['values'],
  head: ['values'],
  tail: ['values'],
  index: ['values'],
  get_index: ['values'],
  to_datetime: ['values'],
  str: ['values'],
  lower: ['values'],
  upper: ['values'],
  isnan: ['values'],
  startswith: ['values'],
  contains: ['values'],
  isin: ['values'],
  between: ['values'],
  logical_not: ['mask'],
  extract_year: ['values'],
  extract_month: ['values'],
  extract_day: ['values'],
  truncate_to: ['values'],
  date_add: ['values'],
  count_if: ['mask'],
  quantile: ['values'],
  rank: ['values'],
  cumsum: ['values'],
  cumshare: ['values'],
  shift: ['values'],
  diff: ['values'],
  rolling_mean: ['values'],
  rolling_sum: ['values'],
  dropna: ['values'],
  fillna: ['values'],
};

const PARAM_CONNECT_WIDGETS = new Set(['column_or_node', 'node_id', 'column_or_node_list']);

export interface GraphNodeState {
  id: string;
  op: string;
  params: Record<string, unknown>;
  inputs: string[];
}

export function getInputPortCount(op: string): number {
  if (ZERO_INPUT_OPS.has(op)) return 0;
  if (BINARY_ELEMENTWISE_OPS.has(op)) return 2;
  return 1;
}

export function getInputPortLabel(op: string, index: number): string {
  const labels = INPUT_PORT_LABELS[op];
  if (labels?.[index]) return labels[index];
  return index === 0 ? 'input' : `input ${index + 1}`;
}

export function getConnectableParams(
  op: string,
  paramWidgets: Record<string, Record<string, { widget: string }>>,
): string[] {
  const schema = paramWidgets[op];
  if (!schema) return [];
  return Object.entries(schema)
    .filter(([, def]) => PARAM_CONNECT_WIDGETS.has(def.widget))
    .map(([k]) => k);
}

export function formatScopeLabel(scope: string): string {
  if (scope === 'Scalar') return 'scalar';
  if (scope === 'Global') return 'all rows';
  if (scope === 'Derived') return 'derived (reordered)';
  if (scope.startsWith('Condition:')) return `filter: ${scope.slice('Condition:'.length)}`;
  if (scope.startsWith('Grouped:')) return `grouped by ${scope.slice('Grouped:'.length)}`;
  return scope;
}

export function inferNodeScope(
  node: GraphNodeState,
  nodeScopes: Record<string, string>,
): string {
  const inputScopes = node.inputs.map((id) => nodeScopes[id] ?? 'Unknown');

  if (node.op === 'filter_extract') {
    const cond = node.params.condition;
    return typeof cond === 'string' && cond.trim()
      ? `Condition:${cond.trim()}`
      : 'Global';
  }
  if (node.op === 'load_constant') return 'Scalar';
  if (node.op === 'groupby_agg') {
    const cols = node.params.groupby_columns;
    if (Array.isArray(cols) && cols.length > 0) {
      return `Grouped:${[...cols].map(String).sort().join('+')}`;
    }
    const col = node.params.groupby_column;
    return `Grouped:${col ?? '?'}`;
  }
  if (BINARY_ELEMENTWISE_OPS.has(node.op)) {
    const nonScalar = inputScopes.filter((s) => s && s !== 'Scalar');
    return nonScalar[0] ?? 'Scalar';
  }
  if (SCALAR_OUTPUT_OPS.has(node.op)) return 'Scalar';
  if (['unique', 'value_counts', 'get_index'].includes(node.op)) return 'Derived';
  if (node.op === 'index') {
    const indices = node.params.indices;
    if (typeof indices === 'number') return 'Scalar';
    return inputScopes[0] ?? 'Global';
  }
  if (INHERIT_SCOPE_OPS.has(node.op)) return inputScopes[0] ?? 'Global';
  return inputScopes[0] ?? 'Global';
}

export function computeAllScopes(nodes: GraphNodeState[]): Record<string, string> {
  const scopes: Record<string, string> = {};
  for (const node of nodes) {
    scopes[node.id] = inferNodeScope(node, scopes);
  }
  return scopes;
}

function scopesAlignForElementwise(
  sourceScope: string,
  peerScopes: string[],
): string | null {
  const all = [sourceScope, ...peerScopes].filter((s) => s && s !== 'Scalar');
  if (all.length <= 1) return null;
  const first = all[0];
  for (let i = 1; i < all.length; i++) {
    if (all[i] !== first) {
      return `Scope mismatch: cannot combine "${formatScopeLabel(first)}" with "${formatScopeLabel(all[i])}". Both inputs must use the same row filter (or be scalars).`;
    }
  }
  return null;
}

function edgeListWithPending(edges: Edge[], pending?: Connection | Edge): Edge[] {
  if (!pending?.source || !pending?.target || !pending.targetHandle) return edges;
  return [
    ...edges.filter(
      (e) => !(e.target === pending.target && e.targetHandle === pending.targetHandle),
    ),
    {
      id: '__pending__',
      source: pending.source,
      target: pending.target,
      targetHandle: pending.targetHandle,
      sourceHandle: pending.sourceHandle ?? 'output',
    },
  ];
}

export function graphStateFromFlow(nodes: FlowNodeLike[], edges: Edge[]): GraphNodeState[] {
  return nodes.map((n) => ({
    id: n.id,
    op: n.data.op as string,
    params: { ...(n.data.params ?? {}) },
    inputs: deriveInputs(n.id, n.data.op as string, edges),
  }));
}

export function deriveInputs(nodeId: string, op: string, edges: Edge[]): string[] {
  const count = getInputPortCount(op);
  const inputs: string[] = Array(count).fill('');
  edges
    .filter((e) => e.target === nodeId && e.targetHandle?.startsWith('input-'))
    .forEach((e) => {
      const idx = parseInt(e.targetHandle!.split('-')[1] ?? '0', 10);
      if (idx >= 0 && idx < count) inputs[idx] = e.source;
    });
  return inputs.filter(Boolean);
}

export function deriveParamsFromEdges(
  nodeId: string,
  baseParams: Record<string, unknown>,
  edges: Edge[],
): Record<string, unknown> {
  const params = { ...baseParams };
  edges
    .filter((e) => e.target === nodeId && e.targetHandle?.startsWith('param-'))
    .forEach((e) => {
      const key = e.targetHandle!.slice('param-'.length);
      params[key] = key === 'groupby_columns' ? [e.source] : e.source;
    });
  return params;
}

export function syncNodesFromEdges<T extends { id: string; data: Record<string, unknown> }>(
  nodes: T[],
  edges: Edge[],
): T[] {
  return nodes.map((n) => {
    const op = n.data.op as string;
    const inputs = deriveInputs(n.id, op, edges);
    const params = deriveParamsFromEdges(n.id, (n.data.params as Record<string, unknown>) ?? {}, edges);
    const portConnections: Record<string, string> = {};
    edges
      .filter((e) => e.target === n.id && e.targetHandle)
      .forEach((e) => { portConnections[e.targetHandle!] = e.source; });

    const prevInputs = (n.data.inputs as string[] | undefined) ?? [];
    const prevParams = (n.data.params as Record<string, unknown>) ?? {};
    const prevPorts = (n.data.portConnections as Record<string, string>) ?? {};
    const sameInputs = prevInputs.length === inputs.length && prevInputs.every((v, i) => v === inputs[i]);
    const sameParams = JSON.stringify(prevParams) === JSON.stringify(params);
    const samePorts = JSON.stringify(prevPorts) === JSON.stringify(portConnections);
    if (sameInputs && sameParams && samePorts) return n;

    return {
      ...n,
      data: {
        ...n.data,
        inputs,
        params,
        portConnections,
      },
    };
  });
}

function wouldCreateCycle(edges: Edge[], source: string, target: string): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.target)!.push(e.source);
  }
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  return false;
}

type FlowNodeLike = { id: string; data: Record<string, unknown> };

export function validateConnection(
  connection: Connection | Edge,
  nodes: FlowNodeLike[],
  edges: Edge[],
  connectableParamOps: Record<string, Record<string, { widget: string }>>,
): string | null {
  const { source, target, targetHandle, sourceHandle } = connection;
  if (!source || !target || !targetHandle) return 'Incomplete connection';
  if (source === target) return 'A node cannot connect to itself';

  const sourceNode = nodes.find((n) => n.id === source);
  const targetNode = nodes.find((n) => n.id === target);
  if (!sourceNode || !targetNode) return 'Unknown node';

  if (sourceHandle && sourceHandle !== 'output') return 'Connections must start from the Output port';

  const tentative = edgeListWithPending(edges, connection);
  // Check existing edges only — including the pending edge would always find
  // target → source and falsely report a cycle.
  if (wouldCreateCycle(edges, source, target)) {
    return 'This connection would create a cycle in the graph';
  }

  const graphNodes = graphStateFromFlow(nodes, tentative).map((n) => {
    if (n.id !== target) return n;
    if (targetHandle.startsWith('param-')) {
      const key = targetHandle.slice('param-'.length);
      return { ...n, params: { ...n.params, [key]: source } };
    }
    return n;
  });

  const scopes = computeAllScopes(graphNodes);
  const sourceScope = scopes[source] ?? 'Unknown';
  const targetOp = targetNode.data.op as string;

  if (targetHandle.startsWith('input-')) {
    const idx = parseInt(targetHandle.split('-')[1] ?? '0', 10);
    const portCount = getInputPortCount(targetOp);
    if (idx < 0 || idx >= portCount) {
      return `"${targetOp}" does not have this input port`;
    }
    const label = getInputPortLabel(targetOp, idx);
    const existing = edges.find((e) => e.target === target && e.targetHandle === targetHandle);
    if (existing && existing.source !== source) {
      return `Port "${label}" is already connected — disconnect it first`;
    }

    const peerScopes = graphNodes
      .find((n) => n.id === target)!
      .inputs
      .map((id, i) => (i === idx ? '' : id))
      .filter(Boolean)
      .map((id) => scopes[id]);

    if (BINARY_ELEMENTWISE_OPS.has(targetOp)) {
      const err = scopesAlignForElementwise(sourceScope, peerScopes);
      if (err) return err;
    } else if (targetOp === 'sum_if' || targetOp === 'mean_if') {
      if (label === 'mask' && sourceScope !== 'Scalar' && peerScopes[0] && peerScopes[0] !== 'Scalar' && sourceScope !== peerScopes[0]) {
        return `Scope mismatch: mask scope "${formatScopeLabel(sourceScope)}" does not match values scope "${formatScopeLabel(peerScopes[0])}"`;
      }
      if (label === 'values' && peerScopes[0] && peerScopes[0] !== 'Scalar' && sourceScope !== 'Scalar' && sourceScope !== peerScopes[0]) {
        return `Scope mismatch: values scope "${formatScopeLabel(sourceScope)}" does not match mask scope "${formatScopeLabel(peerScopes[0])}"`;
      }
    } else if (['logical_and', 'logical_or'].includes(targetOp)) {
      const err = scopesAlignForElementwise(sourceScope, peerScopes);
      if (err) return err.replace('row filter', 'mask scope');
    }

    return null;
  }

  if (targetHandle.startsWith('param-')) {
    const paramKey = targetHandle.slice('param-'.length);
    const allowed = getConnectableParams(targetOp, connectableParamOps);
    if (!allowed.includes(paramKey)) {
      return `Parameter "${paramKey}" cannot be wired from another node`;
    }
    const existing = edges.find((e) => e.target === target && e.targetHandle === targetHandle);
    if (existing && existing.source !== source) {
      return `Parameter "${paramKey}" is already connected`;
    }

    if (targetOp === 'groupby_agg' && paramKey === 'agg_column') {
      const aggScope = scopes[source];
      if (aggScope?.startsWith('Grouped:')) {
        return 'Cannot aggregate a column that is already grouped — connect an ungrouped series';
      }
    }
    if (targetOp === 'index' && paramKey === 'indices') {
      const valuesId = graphNodes.find((n) => n.id === target)?.inputs[0];
      const valuesScope = valuesId ? scopes[valuesId] : 'Global';
      if (sourceScope !== 'Scalar' && valuesScope && sourceScope !== valuesScope) {
        return `Scope mismatch: mask "${formatScopeLabel(sourceScope)}" cannot index data with scope "${formatScopeLabel(valuesScope)}"`;
      }
    }
    return null;
  }

  return 'Invalid connection target';
}
