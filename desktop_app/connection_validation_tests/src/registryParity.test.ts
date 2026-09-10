import { describe, expect, it } from 'vitest';
import { INPUT_PORT_LABELS, ZERO_INPUT_OPS } from '../../frontend/src/dagGraphUtils';
import { ALL_TARGET_OPS, GRAPH_UTILS_OPS, OP_META_OPS } from './registry';

describe('registry parity between editor and graph utils', () => {
  it('reports ops in graph utils but missing from OP_META (editor library)', () => {
    const missingFromEditor = [...GRAPH_UTILS_OPS].filter((op) => !OP_META_OPS.has(op)).sort();
    // Document known drift — test fails if new drift appears without updating this list
    const knownUtilsOnly = ['count_if', 'isin_from_node', 'mean_if', 'sum_if'].sort();
    expect(missingFromEditor).toEqual(knownUtilsOnly);
  });

  it('reports ops in OP_META but missing port definitions in graph utils', () => {
    const missingPorts = [...OP_META_OPS].filter((op) => !GRAPH_UTILS_OPS.has(op)).sort();
    expect(missingPorts).toEqual([]);
  });

  it('every target op has port metadata or is a zero-input op', () => {
    for (const op of ALL_TARGET_OPS) {
      const hasPorts = op in INPUT_PORT_LABELS || ZERO_INPUT_OPS.has(op);
      expect(hasPorts, `${op} has no port metadata`).toBe(true);
    }
  });
});
