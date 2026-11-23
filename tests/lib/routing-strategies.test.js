import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ELK from 'elkjs/lib/elk.bundled.js';
import { routeFixed } from '../../src/lib/blockchart/layout/fixed.js';
import { connectionStyle } from '../../src/lib/blockchart/styles.js';
import { routeMetrics } from '../../src/lib/blockchart/layout/route-quality.js';
import { createDiagramModel } from '../../src/lib/blockchart/index.js';
import { signalModel } from '../../src/lib/blockchart/layout/signals.js';
import { buildElkGraph } from '../../src/lib/blockchart/layout/elk-graph.js';
import { readElkResult } from '../../src/lib/blockchart/layout/elk-result.js';
import { arrangeGrids } from '../../src/lib/blockchart/layout/grid-layout.js';
import { planAutoChannels } from '../../src/lib/blockchart/layout/auto-channels.js';

function fixture() {
  const style = connectionStyle(null);
  const modules = [
    {
      id: 'Source',
      x: -10,
      y: -20,
      width: 20,
      height: 20,
      ports: [{ id: 'out', x: 0, y: 0, side: 'bottom' }],
    },
    {
      id: 'Target',
      x: 65,
      y: 90,
      width: 20,
      height: 20,
      ports: [{ id: 'in', x: 85, y: 100, side: 'right' }],
    },
    { id: 'Obstacle', x: 20, y: 30, width: 30, height: 40, ports: [] },
  ];
  const groups = [
    {
      id: 'Frame',
      x: 40,
      y: 30,
      width: 80,
      height: 90,
      members: ['Target'],
      portMode: 'direct',
      ports: [],
      style: { label: { hidden: true } },
    },
  ];
  const ref = {
    id: 'Route',
    source: { moduleId: 'Source', portId: 'out' },
    target: { moduleId: 'Target', portId: 'in' },
    style,
  };
  const points = [
    [0, 0],
    [0, 80],
    [60, 80],
    [60, 90],
    [100, 90],
    [100, 100],
    [85, 100],
  ].map(([x, y]) => ({ x, y }));
  return {
    model: { modules, groups, connections: [ref], layout: { direction: 'down', layerSpacing: 30 } },
    result: { modules, groups, terminals: [], connections: [{ id: 'Route', style, sections: [{ points }] }] },
  };
}

test('diagnostic reasons cannot activate Container entry or channel strategies', () => {
  const f = fixture(),
    ordinary = structuredClone(f.result);
  routeFixed(ordinary, f.model);
  for (const reason of ['container-entry', 'grid-channels', 'auto-channels', 'explanation']) {
    const r = structuredClone(f.result);
    routeFixed(r, f.model, { reason });
    assert.deepEqual(r.connections[0].sections, ordinary.connections[0].sections);
    assert.equal(r.connections[0].routingInfo.method, 'fixed-orthogonal');
    assert.equal(r.connections[0].routingInfo.reason, reason);
  }
});

test('explicit Container entry uses its bounded policy with any diagnostic reason', () => {
  const { result, model } = fixture(),
    nodes = structuredClone({ modules: result.modules, groups: result.groups });
  routeFixed(result, model, { strategy: 'container-entry', reason: 'entry explanation' });
  assert.equal(routeMetrics(result.connections[0].sections.flatMap((s) => s.points)).bends, 3);
  assert.equal(result.connections[0].routingInfo.reason, 'entry explanation');
  assert.deepEqual({ modules: result.modules, groups: result.groups }, nodes);
});

for (const kind of ['grid', 'auto'])
  test(`${kind} channel routing and reconciliation do not depend on diagnostic text`, async () => {
    const raw = JSON.parse(
      readFileSync(
        new URL(`../../examples/blockchart/${kind}-routing-channels.json`, import.meta.url),
        'utf8',
      ),
    );
    const model = signalModel(createDiagramModel(raw)),
      elk = new ELK();
    const result = readElkResult(await elk.layout(buildElkGraph(model)), model);
    if (kind === 'grid') await arrangeGrids(result, model, elk);
    else planAutoChannels(result, model);
    routeFixed(result, model);
    const baseline = structuredClone(result),
      custom = structuredClone(result);
    routeFixed(baseline, model, { strategy: kind + '-channels' });
    routeFixed(custom, model, { strategy: kind + '-channels', reason: 'channel explanation' });
    const routed = baseline.connections.filter((e) => e.routingInfo?.method === kind + '-channel');
    assert.ok(routed.length > 0);
    for (const edge of custom.connections) {
      const old = baseline.connections.find((e) => e.id === edge.id);
      if (old.routingInfo?.method === kind + '-channel') {
        assert.equal(edge.routingInfo.reason, 'channel explanation');
        edge.routingInfo.reason = old.routingInfo.reason;
      }
    }
    assert.deepEqual(custom, baseline);
  });

test('edge selection and excluded-only routing stay independent of diagnostics', () => {
  const { result, model } = fixture();
  model.connections.push({ ...structuredClone(model.connections[0]), id: 'Weak', constraint: false });
  result.connections.push({ ...structuredClone(result.connections[0]), id: 'Weak' });
  const saved = structuredClone(result.connections[0]);
  routeFixed(result, model, { onlyExcluded: true, selected: new Set(['Route']), reason: 'auto-channels' });
  assert.deepEqual(result.connections[0], saved);
  assert.equal(result.connections[1].routingInfo, undefined);
  routeFixed(result, model, { onlyExcluded: true });
  assert.deepEqual(result.connections[0], saved);
  assert.equal(result.connections[1].routingInfo.reason, 'non-constraining');
});

test('an unknown routing strategy fails without changing the working layout', () => {
  const { result, model } = fixture(),
    saved = structuredClone(result);
  assert.throws(() => routeFixed(result, model, { strategy: 'typo' }), /Unknown routing strategy/);
  assert.deepEqual(result, saved);
});
