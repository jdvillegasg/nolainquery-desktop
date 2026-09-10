import { describe, expect, it } from 'vitest';
import {
  defaultParamsForOp,
  makeEdge,
  makeNode,
  tryConnect,
} from './fixtures';
import { buildProducerBank } from './scopeProducers';

describe('structural connection rules', () => {
  const bank = buildProducerBank();

  it('rejects incomplete connection (missing targetHandle)', () => {
    const nodes = [makeNode('a', 'load_constant', { value: 1 }), makeNode('b', 'mean')];
    const err = tryConnect(nodes, [], 'a', 'b', '');
    expect(err).toBe('Incomplete connection');
  });

  it('rejects self-connection', () => {
    const nodes = [makeNode('a', 'mean')];
    const err = tryConnect(nodes, [], 'a', 'a', 'input-0');
    expect(err).toBe('A node cannot connect to itself');
  });

  it('rejects unknown source node', () => {
    const nodes = [makeNode('b', 'mean')];
    const err = tryConnect(nodes, [], 'missing', 'b', 'input-0');
    expect(err).toBe('Unknown node');
  });

  it('rejects connection not starting from output port', () => {
    const nodes = [
      makeNode('a', 'load_constant', { value: 1 }),
      makeNode('b', 'add'),
    ];
    const err = tryConnect(nodes, [], 'a', 'b', 'input-0', 'input-0');
    expect(err).toBe('Connections must start from the Output port');
  });

  it('rejects cycles', () => {
    const nodes = [
      makeNode('n1', 'load_constant', { value: 1 }),
      makeNode('n2', 'add'),
      makeNode('n3', 'abs'),
    ];
    const edges = [
      makeEdge('n1', 'n2', 'input-0'),
      makeEdge('n2', 'n3', 'input-0'),
    ];
    // n1 → n2 → n3 already; wiring n1 directly into n3 shortcuts the chain → cycle
    const cycleErr = tryConnect(nodes, edges, 'n1', 'n3', 'input-0');
    expect(cycleErr).toBe('This connection would create a cycle in the graph');
  });

  it('rejects invalid input port index', () => {
    const nodes = [...bank.nodes, makeNode('tgt', 'abs')];
    const err = tryConnect(nodes, bank.edges, 'prod_scalar', 'tgt', 'input-3');
    expect(err).toBe('"abs" does not have this input port');
  });

  it('rejects zero-input op input port', () => {
    const nodes = [...bank.nodes, makeNode('tgt', 'filter_extract', { column: 'Revenue' })];
    const err = tryConnect(nodes, bank.edges, 'prod_scalar', 'tgt', 'input-0');
    expect(err).toBe('"filter_extract" does not have this input port');
  });

  it('rejects double-connect on same port with different source', () => {
    const nodes = [
      makeNode('s1', 'load_constant', { value: 1 }),
      makeNode('s2', 'load_constant', { value: 2 }),
      makeNode('tgt', 'add'),
    ];
    const edges = [makeEdge('s1', 'tgt', 'input-0')];
    const err = tryConnect(nodes, edges, 's2', 'tgt', 'input-0');
    expect(err).toBe('Port "left" is already connected — disconnect it first');
  });

  it('rejects non-connectable param port', () => {
    const nodes = [...bank.nodes, makeNode('tgt', 'round', { decimals: 2 })];
    const err = tryConnect(nodes, bank.edges, 'prod_scalar', 'tgt', 'param-decimals');
    expect(err).toBe('Parameter "decimals" cannot be wired from another node');
  });

  it('rejects double-connect on param port', () => {
    const nodes = [
      makeNode('s1', 'load_constant', { value: 1 }),
      makeNode('s2', 'load_constant', { value: 2 }),
      makeNode('tgt', 'groupby_agg', defaultParamsForOp('groupby_agg')),
    ];
    const edges = [makeEdge('s1', 'tgt', 'param-agg_column')];
    const err = tryConnect(nodes, edges, 's2', 'tgt', 'param-agg_column');
    expect(err).toBe('Parameter "agg_column" is already connected');
  });

  it('rejects invalid connection target handle', () => {
    const nodes = [...bank.nodes, makeNode('tgt', 'mean')];
    const err = tryConnect(nodes, bank.edges, 'prod_scalar', 'tgt', 'output');
    expect(err).toBe('Invalid connection target');
  });
});
