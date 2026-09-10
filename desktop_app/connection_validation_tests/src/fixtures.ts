import type { Edge } from '@xyflow/react';
import {
  computeAllScopes,
  getConnectableParams,
  getInputPortCount,
  graphStateFromFlow,
  validateConnection,
} from '../../frontend/src/dagGraphUtils';
import { PARAM_SCHEMA } from './paramSchema';

export type FlowNode = { id: string; data: Record<string, unknown> };

export function makeNode(id: string, op: string, params: Record<string, unknown> = {}): FlowNode {
  return { id, data: { op, params } };
}

export function makeEdge(source: string, target: string, targetHandle: string): Edge {
  return {
    id: `${source}->${target}:${targetHandle}`,
    source,
    target,
    targetHandle,
    sourceHandle: 'output',
  };
}

export function tryConnect(
  nodes: FlowNode[],
  edges: Edge[],
  source: string,
  target: string,
  targetHandle: string,
  sourceHandle = 'output',
): string | null {
  return validateConnection(
    { source, target, targetHandle, sourceHandle },
    nodes,
    edges,
    PARAM_SCHEMA,
  );
}

export function nodeScope(nodes: FlowNode[], edges: Edge[], nodeId: string): string {
  const graphNodes = graphStateFromFlow(nodes, edges);
  const scopes = computeAllScopes(graphNodes);
  return scopes[nodeId] ?? 'Unknown';
}

export function defaultParamsForOp(op: string): Record<string, unknown> {
  switch (op) {
    case 'filter_extract':
      return { column: 'Revenue' };
    case 'groupby_agg':
      return { groupby_column: 'Month', agg_column: 'Revenue', agg_function: 'sum' };
    case 'load_constant':
      return { value: 1 };
    case 'index':
      return { indices: 'node_placeholder' };
    case 'round':
      return { decimals: 2 };
    case 'between':
      return { low: 0, high: 100 };
    case 'nlargest':
    case 'nsmallest':
    case 'head':
    case 'tail':
      return { n: 5 };
    case 'rolling_mean':
    case 'rolling_sum':
      return { window: 7 };
    default:
      return {};
  }
}

export function enumerateTargetHandles(op: string): string[] {
  const handles: string[] = [];
  const inputCount = getInputPortCount(op);
  for (let i = 0; i < inputCount; i++) handles.push(`input-${i}`);
  for (const param of getConnectableParams(op, PARAM_SCHEMA)) {
    handles.push(`param-${param}`);
  }
  return handles;
}
