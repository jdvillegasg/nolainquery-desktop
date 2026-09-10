import type { Edge } from '@xyflow/react';
import {
  BINARY_ELEMENTWISE_OPS,
  computeAllScopes,
  getInputPortLabel,
  graphStateFromFlow,
} from '../../frontend/src/dagGraphUtils';
import { FlowNode, makeEdge, makeNode } from './fixtures';

export type ScopeClass =
  | 'global'
  | 'condition_a'
  | 'condition_b'
  | 'grouped_month'
  | 'grouped_year'
  | 'scalar'
  | 'derived'
  | 'mask_global'
  | 'mask_condition_a';

export interface ScopeProducer {
  id: string;
  scope: ScopeClass;
  label: string;
  inferredScope: string;
}

export interface ProducerBank {
  nodes: FlowNode[];
  edges: Edge[];
  producers: Record<ScopeClass, ScopeProducer>;
}

const CONDITION_A = "Country == 'UK'";
const CONDITION_B = 'Year == 2024';

/**
 * Minimal graph fixtures — one canonical node per scope class.
 * Scopes are verified via computeAllScopes at build time.
 */
export function buildProducerBank(): ProducerBank {
  const nodes: FlowNode[] = [
    makeNode('prod_global', 'filter_extract', { column: 'Revenue' }),
    makeNode('prod_cond_a', 'filter_extract', { column: 'Revenue', condition: CONDITION_A }),
    makeNode('prod_cond_b', 'filter_extract', { column: 'Revenue', condition: CONDITION_B }),
    makeNode('prod_grouped_m', 'groupby_agg', {
      groupby_column: 'Month',
      agg_column: 'Revenue',
      agg_function: 'sum',
    }),
    makeNode('prod_grouped_y', 'groupby_agg', {
      groupby_column: 'Year',
      agg_column: 'Revenue',
      agg_function: 'sum',
    }),
    makeNode('prod_scalar', 'load_constant', { value: 0 }),
    makeNode('prod_unique', 'unique', {}),
    makeNode('prod_mask_global', 'gt', {}),
    makeNode('prod_mask_cond_a', 'gt', {}),
    // Duplicates for peer-context tests (same scope, different node id — avoids false cycle detection)
    makeNode('prod_cond_a_2', 'filter_extract', { column: 'Tax', condition: CONDITION_A }),
    makeNode('prod_mask_global_2', 'gt', {}),
  ];

  const edges: Edge[] = [
    makeEdge('prod_global', 'prod_unique', 'input-0'),
    makeEdge('prod_global', 'prod_mask_global', 'input-0'),
    makeEdge('prod_scalar', 'prod_mask_global', 'input-1'),
    makeEdge('prod_cond_a', 'prod_mask_cond_a', 'input-0'),
    makeEdge('prod_scalar', 'prod_mask_cond_a', 'input-1'),
    makeEdge('prod_global', 'prod_mask_global_2', 'input-0'),
    makeEdge('prod_scalar', 'prod_mask_global_2', 'input-1'),
  ];

  const graphNodes = graphStateFromFlow(nodes, edges);
  const scopes = computeAllScopes(graphNodes);

  const producers: Record<ScopeClass, ScopeProducer> = {
    global: {
      id: 'prod_global',
      scope: 'global',
      label: 'Global (unfiltered column)',
      inferredScope: scopes['prod_global'],
    },
    condition_a: {
      id: 'prod_cond_a',
      scope: 'condition_a',
      label: `Condition (${CONDITION_A})`,
      inferredScope: scopes['prod_cond_a'],
    },
    condition_b: {
      id: 'prod_cond_b',
      scope: 'condition_b',
      label: `Condition (${CONDITION_B})`,
      inferredScope: scopes['prod_cond_b'],
    },
    grouped_month: {
      id: 'prod_grouped_m',
      scope: 'grouped_month',
      label: 'Grouped (Month)',
      inferredScope: scopes['prod_grouped_m'],
    },
    grouped_year: {
      id: 'prod_grouped_y',
      scope: 'grouped_year',
      label: 'Grouped (Year)',
      inferredScope: scopes['prod_grouped_y'],
    },
    scalar: {
      id: 'prod_scalar',
      scope: 'scalar',
      label: 'Scalar (constant)',
      inferredScope: scopes['prod_scalar'],
    },
    derived: {
      id: 'prod_unique',
      scope: 'derived',
      label: 'Derived (unique)',
      inferredScope: scopes['prod_unique'],
    },
    mask_global: {
      id: 'prod_mask_global',
      scope: 'mask_global',
      label: 'Mask in global scope',
      inferredScope: scopes['prod_mask_global'],
    },
    mask_condition_a: {
      id: 'prod_mask_cond_a',
      scope: 'mask_condition_a',
      label: `Mask in condition scope (${CONDITION_A})`,
      inferredScope: scopes['prod_mask_cond_a'],
    },
  };

  // Attach duplicate ids for peer wiring (not in ALL_SCOPE_CLASSES matrix)
  (producers as ProducerBank['producers'] & {
    condition_a_2: ScopeProducer;
    mask_global_2: ScopeProducer;
  }).condition_a_2 = {
    id: 'prod_cond_a_2',
    scope: 'condition_a',
    label: `Condition duplicate (${CONDITION_A})`,
    inferredScope: scopes['prod_cond_a_2'],
  };
  (producers as ProducerBank['producers'] & { mask_global_2: ScopeProducer }).mask_global_2 = {
    id: 'prod_mask_global_2',
    scope: 'mask_global',
    label: 'Mask global duplicate',
    inferredScope: scopes['prod_mask_global_2'],
  };

  return { nodes, edges, producers };
}

export const ALL_SCOPE_CLASSES: ScopeClass[] = [
  'global',
  'condition_a',
  'condition_b',
  'grouped_month',
  'grouped_year',
  'scalar',
  'derived',
  'mask_global',
  'mask_condition_a',
];

export function isScopeAligned(
  sourceScope: string,
  peerScopes: string[],
): boolean {
  const nonScalar = [sourceScope, ...peerScopes].filter((s) => s && s !== 'Scalar');
  if (nonScalar.length <= 1) return true;
  const first = nonScalar[0];
  return nonScalar.every((s) => s === first);
}

export function expectsInputScopeCheck(targetOp: string): boolean {
  return (
    BINARY_ELEMENTWISE_OPS.has(targetOp)
    || targetOp === 'sum_if'
    || targetOp === 'mean_if'
    || targetOp === 'logical_and'
    || targetOp === 'logical_or'
  );
}

export function expectedInputAllowed(
  targetOp: string,
  portIndex: number,
  sourceScope: string,
  peerScopes: string[],
): boolean {
  const label = getInputPortLabel(targetOp, portIndex);

  if (BINARY_ELEMENTWISE_OPS.has(targetOp)) {
    return isScopeAligned(sourceScope, peerScopes);
  }

  if (targetOp === 'sum_if' || targetOp === 'mean_if') {
    if (label === 'mask') {
      if (sourceScope === 'Scalar') return true;
      const valuesScope = peerScopes[0];
      if (!valuesScope || valuesScope === 'Scalar') return true;
      return sourceScope === valuesScope;
    }
    if (label === 'values') {
      const maskScope = peerScopes[0];
      if (sourceScope === 'Scalar') return true;
      if (!maskScope || maskScope === 'Scalar') return true;
      return sourceScope === maskScope;
    }
  }

  if (targetOp === 'logical_and' || targetOp === 'logical_or') {
    return isScopeAligned(sourceScope, peerScopes);
  }

  // Unary and other ops: validateConnection does not enforce scope on inputs.
  return true;
}

export function expectedParamAllowed(
  targetOp: string,
  paramKey: string,
  sourceScope: string,
  valuesScope?: string,
): boolean {
  if (targetOp === 'groupby_agg' && paramKey === 'agg_column') {
    return !sourceScope.startsWith('Grouped:');
  }
  if (targetOp === 'index' && paramKey === 'indices') {
    if (sourceScope === 'Scalar') return true;
    if (!valuesScope) return true;
    return sourceScope === valuesScope;
  }
  return true;
}
