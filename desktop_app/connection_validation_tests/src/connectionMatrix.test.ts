import { describe, expect, it } from 'vitest';
import { getInputPortCount, getConnectableParams } from '../../frontend/src/dagGraphUtils';
import {
  defaultParamsForOp,
  makeNode,
  tryConnect,
} from './fixtures';
import { PARAM_SCHEMA } from './paramSchema';
import { ALL_TARGET_OPS } from './registry';
import {
  ALL_SCOPE_CLASSES,
  buildProducerBank,
  expectedInputAllowed,
  expectedParamAllowed,
  expectsInputScopeCheck,
  type ScopeClass,
} from './scopeProducers';
import { makeEdge } from './fixtures';
import { BINARY_ELEMENTWISE_OPS } from '../../frontend/src/dagGraphUtils';

const bank = buildProducerBank();

interface MatrixCase {
  id: string;
  targetOp: string;
  targetHandle: string;
  sourceId: string;
  sourceScope: ScopeClass;
  peerScopes: string[];
  peerId?: string;
  valuesScope?: string;
  kind: 'input' | 'param';
  expectAllowed: boolean;
}

const PEER_FOR_PORT1 = 'condition_a' as ScopeClass;

function buildInputMatrixCases(): MatrixCase[] {
  const cases: MatrixCase[] = [];

  for (const targetOp of ALL_TARGET_OPS) {
    const portCount = getInputPortCount(targetOp);
    for (let portIdx = 0; portIdx < portCount; portIdx++) {
      const peerVariants: Array<{
        label: string;
        peerScopes: string[];
        peerEdges: ReturnType<typeof makeEdge>[];
        peerId?: string;
      }> = [
        { label: 'no-peer', peerScopes: [], peerEdges: [] },
      ];
      if (portIdx >= 1 && BINARY_ELEMENTWISE_OPS.has(targetOp)) {
        const peer = bank.producers[PEER_FOR_PORT1];
        const peerDup = (bank.producers as { condition_a_2: { id: string; inferredScope: string } }).condition_a_2;
        peerVariants.push({
          label: `peer-${PEER_FOR_PORT1}`,
          peerScopes: [peer.inferredScope],
          peerEdges: [],
          peerId: peerDup.id,
        });
      }

      for (const variant of peerVariants) {
        for (const scopeClass of ALL_SCOPE_CLASSES) {
          const producer = bank.producers[scopeClass];
          cases.push({
            id: `${targetOp}:input-${portIdx}<-${scopeClass}:${variant.label}`,
            targetOp,
            targetHandle: `input-${portIdx}`,
            sourceId: producer.id,
            sourceScope: scopeClass,
            peerScopes: variant.peerScopes,
            peerId: variant.peerId,
            kind: 'input',
            expectAllowed: expectedInputAllowed(
              targetOp,
              portIdx,
              producer.inferredScope,
              variant.peerScopes,
            ),
          });
        }
      }
    }
  }

  return cases;
}

function buildParamMatrixCases(): MatrixCase[] {
  const cases: MatrixCase[] = [];

  for (const targetOp of ALL_TARGET_OPS) {
    const params = getConnectableParams(targetOp, PARAM_SCHEMA);
    for (const paramKey of params) {
      for (const scopeClass of ALL_SCOPE_CLASSES) {
        const producer = bank.producers[scopeClass];
        cases.push({
          id: `${targetOp}:param-${paramKey}<-${scopeClass}`,
          targetOp,
          targetHandle: `param-${paramKey}`,
          sourceId: producer.id,
          sourceScope: scopeClass,
          peerScopes: [],
          kind: 'param',
          expectAllowed: expectedParamAllowed(
            targetOp,
            paramKey,
            producer.inferredScope,
            targetOp === 'index' && paramKey === 'indices' ? 'Global' : undefined,
          ),
        });
      }
    }
  }

  return cases;
}

const inputCases = buildInputMatrixCases();
const paramCases = buildParamMatrixCases();

function evaluateCase(c: MatrixCase): { error: string | null; allowed: boolean } {
  const targetId = `tgt_${c.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const nodes = [...bank.nodes, makeNode(targetId, c.targetOp, defaultParamsForOp(c.targetOp))];
  const edges = [...bank.edges];
  if (c.peerId && c.targetHandle.startsWith('input-')) {
    edges.push(makeEdge(c.peerId, targetId, 'input-0'));
  }
  const error = tryConnect(nodes, edges, c.sourceId, targetId, c.targetHandle);
  return { error, allowed: error === null };
}

describe('scope producer bank sanity', () => {
  it('assigns distinct scope labels to fixture producers', () => {
    expect(bank.producers.global.inferredScope).toBe('Global');
    expect(bank.producers.condition_a.inferredScope).toBe("Condition:Country == 'UK'");
    expect(bank.producers.condition_b.inferredScope).toBe('Condition:Year == 2024');
    expect(bank.producers.grouped_month.inferredScope).toBe('Grouped:Month');
    expect(bank.producers.grouped_year.inferredScope).toBe('Grouped:Year');
    expect(bank.producers.scalar.inferredScope).toBe('Scalar');
    expect(bank.producers.derived.inferredScope).toBe('Derived');
    expect(bank.producers.mask_global.inferredScope).toBe('Global');
    expect(bank.producers.mask_condition_a.inferredScope).toBe("Condition:Country == 'UK'");
  });
});

describe('input port × scope-class matrix', () => {
  it(`covers ${inputCases.length} input-port combinations`, () => {
    const failures: string[] = [];
    let allowedCount = 0;
    let deniedCount = 0;

    for (const c of inputCases) {
      const { allowed, error } = evaluateCase(c);
      if (c.expectAllowed) {
        allowedCount++;
        if (!allowed) {
          failures.push(
            `EXPECTED ALLOW: ${c.id} — got "${error}"`,
          );
        }
      } else {
        deniedCount++;
        if (allowed) {
          failures.push(
            `EXPECTED DENY: ${c.id} — connection was accepted (scope ${bank.producers[c.sourceScope].inferredScope})`,
          );
        } else if (!error?.includes('Scope mismatch')) {
          failures.push(
            `EXPECTED SCOPE DENY: ${c.id} — got "${error}" (want Scope mismatch)`,
          );
        }
      }
    }

    if (failures.length > 0) {
      expect.fail(
        `${failures.length} matrix failures (${allowedCount} allow / ${deniedCount} deny cases):\n`
        + failures.slice(0, 20).join('\n')
        + (failures.length > 20 ? `\n… and ${failures.length - 20} more` : ''),
      );
    }
  });

  it('every scope-checked op has at least one allowed and one denied input case', () => {
    const byOp = new Map<string, { allowed: number; denied: number }>();

    for (const c of inputCases) {
      if (!expectsInputScopeCheck(c.targetOp)) continue;
      const stats = byOp.get(c.targetOp) ?? { allowed: 0, denied: 0 };
      if (c.expectAllowed) stats.allowed++;
      else stats.denied++;
      byOp.set(c.targetOp, stats);
    }

    const vacuous: string[] = [];
    for (const [op, stats] of byOp) {
      if (stats.allowed === 0 || stats.denied === 0) {
        vacuous.push(`${op} (allowed=${stats.allowed}, denied=${stats.denied})`);
      }
    }

    expect(vacuous, `Scope-checked ops need both allow and deny cases: ${vacuous.join(', ')}`).toEqual([]);
  });
});

describe('connectable param × scope-class matrix', () => {
  it(`covers ${paramCases.length} param-port combinations`, () => {
    const failures: string[] = [];

    for (const c of paramCases) {
      const { allowed, error } = evaluateCase(c);
      if (c.expectAllowed && !allowed) {
        failures.push(`EXPECTED ALLOW: ${c.id} — got "${error}"`);
      }
      if (!c.expectAllowed && allowed) {
        failures.push(`EXPECTED DENY: ${c.id} — connection was accepted`);
      }
      if (!c.expectAllowed && !allowed && c.targetOp === 'groupby_agg' && c.targetHandle === 'param-agg_column') {
        if (!error?.includes('already grouped')) {
          failures.push(`EXPECTED grouped deny: ${c.id} — got "${error}"`);
        }
      }
    }

    if (failures.length > 0) {
      expect.fail(failures.slice(0, 25).join('\n') + (failures.length > 25 ? `\n… +${failures.length - 25}` : ''));
    }
  });
});

describe('peer-context scope alignment (binary inputs)', () => {
  type PeerProducerKey = ScopeClass | 'condition_a_2' | 'mask_global_2';

  const peerCases: Array<{
    op: string;
    peerKey: PeerProducerKey;
    incomingKey: PeerProducerKey;
    portIdx: number;
    expectAllowed: boolean;
  }> = [
    { op: 'add', peerKey: 'condition_a', incomingKey: 'condition_a_2', portIdx: 1, expectAllowed: true },
    { op: 'add', peerKey: 'condition_a', incomingKey: 'condition_b', portIdx: 1, expectAllowed: false },
    { op: 'add', peerKey: 'condition_a', incomingKey: 'scalar', portIdx: 1, expectAllowed: true },
    { op: 'add', peerKey: 'global', incomingKey: 'condition_a', portIdx: 1, expectAllowed: false },
    { op: 'logical_and', peerKey: 'mask_global', incomingKey: 'mask_condition_a', portIdx: 1, expectAllowed: false },
    { op: 'logical_and', peerKey: 'mask_global', incomingKey: 'mask_global_2', portIdx: 1, expectAllowed: true },
    { op: 'sum_if', peerKey: 'global', incomingKey: 'mask_global', portIdx: 1, expectAllowed: true },
    { op: 'sum_if', peerKey: 'global', incomingKey: 'mask_condition_a', portIdx: 1, expectAllowed: false },
    { op: 'sum_if', peerKey: 'global', incomingKey: 'scalar', portIdx: 1, expectAllowed: true },
    { op: 'mean_if', peerKey: 'condition_a', incomingKey: 'mask_condition_a', portIdx: 1, expectAllowed: true },
    { op: 'mean_if', peerKey: 'condition_a', incomingKey: 'mask_global', portIdx: 1, expectAllowed: false },
  ];

  const extraProducers = bank.producers as typeof bank.producers & {
    condition_a_2: { id: string };
    mask_global_2: { id: string };
  };

  function producerId(key: PeerProducerKey): string {
    if (key === 'condition_a_2') return extraProducers.condition_a_2.id;
    if (key === 'mask_global_2') return extraProducers.mask_global_2.id;
    return bank.producers[key].id;
  }

  for (const c of peerCases) {
    it(`${c.op} input-${c.portIdx}: peer=${c.peerKey} + incoming=${c.incomingKey}`, () => {
      const targetId = 'tgt_peer';
      const peerId = producerId(c.peerKey);
      const incomingId = producerId(c.incomingKey);
      const peerPort = 0;
      const nodes = [...bank.nodes, makeNode(targetId, c.op, defaultParamsForOp(c.op))];
      const edges = [...bank.edges, {
        id: 'peer-edge',
        source: peerId,
        target: targetId,
        targetHandle: `input-${peerPort}`,
        sourceHandle: 'output',
      }];
      const error = tryConnect(nodes, edges, incomingId, targetId, `input-${c.portIdx}`);
      if (c.expectAllowed) {
        expect(error).toBeNull();
      } else {
        expect(error).not.toBeNull();
        expect(error).toMatch(/Scope mismatch/);
      }
    });
  }
});

describe('index.indices param requires matching values scope', () => {
  it('allows mask with same scope as wired values input', () => {
    const targetId = 'tgt_index_ok';
    const nodes = [...bank.nodes, makeNode(targetId, 'index', { indices: 'node_x' })];
    const edges = [
      ...bank.edges,
      {
        id: 'values-edge',
        source: 'prod_cond_a',
        target: targetId,
        targetHandle: 'input-0',
        sourceHandle: 'output',
      },
    ];
    const error = tryConnect(nodes, edges, 'prod_mask_cond_a', targetId, 'param-indices');
    expect(error).toBeNull();
  });

  it('rejects mask with different scope than wired values input', () => {
    const targetId = 'tgt_index_bad';
    const nodes = [...bank.nodes, makeNode(targetId, 'index', { indices: 'node_x' })];
    const edges = [
      ...bank.edges,
      {
        id: 'values-edge',
        source: 'prod_global',
        target: targetId,
        targetHandle: 'input-0',
        sourceHandle: 'output',
      },
    ];
    const error = tryConnect(nodes, edges, 'prod_mask_cond_a', targetId, 'param-indices');
    expect(error).toMatch(/Scope mismatch/);
  });

  it('allows scalar indices regardless of values scope', () => {
    const targetId = 'tgt_index_scalar';
    const nodes = [...bank.nodes, makeNode(targetId, 'index', { indices: 'node_x' })];
    const edges = [
      ...bank.edges,
      {
        id: 'values-edge',
        source: 'prod_global',
        target: targetId,
        targetHandle: 'input-0',
        sourceHandle: 'output',
      },
    ];
    const error = tryConnect(nodes, edges, 'prod_scalar', targetId, 'param-indices');
    expect(error).toBeNull();
  });
});
