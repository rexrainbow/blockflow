import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ELK from 'elkjs/lib/elk.bundled.js';
import { createDiagramModel, layoutDiagram } from '../../src/lib/blockchart/index.js';
import { signalModel } from '../../src/lib/blockchart/layout/signals.js';
import { gridInternalEdges } from '../../src/lib/blockchart/layout/grid-placement.js';
import { buildElkGraph } from '../../src/lib/blockchart/layout/elk-graph.js';
import { readElkResult } from '../../src/lib/blockchart/layout/elk-result.js';
const module = (id) => ({
  id,
  ports: [
    { id: 'in', direction: 'input' },
    { id: 'out', direction: 'output' },
  ],
});
const edges = (g) => [...(g.edges ?? []), ...(g.children ?? []).flatMap(edges)];

for (const direction of ['right', 'down'])
  for (const view of [undefined, 'Device'])
    test(`Grid-internal Placement cannot push an unrelated output Container (${direction}, ${view ?? 'Top'})`, async () => {
      const original = JSON.parse(
        readFileSync(new URL('../fixtures/blockchart/scoped-peripheral-input.json', import.meta.url), 'utf8'),
      );
      const variants = [];
      for (const enabled of [false, true]) {
        const raw = structuredClone(original);
        raw.layout.direction = direction;
        raw.connections
          .find((e) => e.from === 'ReceiveDelay.tout')
          .to.find((e) => e.endpoint === 'CaptureQueue.sample').constraint = enabled;
        const saved = structuredClone(raw),
          model = createDiagramModel(raw),
          snapshot = structuredClone(model);
        const result = await layoutDiagram(model, { rootGroupId: view });
        assert.deepEqual(raw, saved);
        assert.deepEqual(model, snapshot);
        assert.equal(
          model.connections.find((e) => e.source.moduleId === 'ReceiveDelay' && e.target.portId === 'sample')
            .constraint !== false,
          enabled,
        );
        assert.deepEqual(result.warnings ?? [], []);
        variants.push(result);
      }
      for (const key of ['modules', 'groups', 'terminals', 'width', 'height'])
        assert.deepEqual(variants[1][key], variants[0][key], key);
      const routes = (r) => r.connections.map((e) => ({ id: e.id, sections: e.sections }));
      assert.deepEqual(routes(variants[1]), routes(variants[0]));
    });

test('only cross-cell branches are deferred; same-cell label trunks and partial Grid Auto peers retain placement', () => {
  const raw = {
    version: 1,
    diagram: { name: 'Partial Grid' },
    modules: ['A', 'B', 'Free', 'Outside'].map(module),
    groups: [{ id: 'Core', members: ['A', 'B', 'Free'], layout: { type: 'grid', cells: [['A'], ['B']] } }],
    connections: [{ id: 'Payload', from: 'A.out', to: ['B.in', 'Free.in', 'Outside.in'], label: 'Payload' }],
  };
  const model = signalModel(createDiagramModel(raw)),
    snapshot = structuredClone(model),
    deferred = gridInternalEdges(model);
  const fixed = model.connections.find((e) => e.target.moduleId === 'B');
  assert.deepEqual([...deferred], [fixed.id]);
  const trunk = model.connections.find((e) => e._signalTrunk);
  assert.ok(trunk);
  assert.ok(!deferred.has(trunk.id));
  const graphEdges = edges(buildElkGraph(model)).map((e) => e.id);
  assert.ok(!graphEdges.includes('@' + fixed.id));
  assert.ok(graphEdges.includes('@' + trunk.id));
  for (const target of ['Free', 'Outside'])
    assert.ok(graphEdges.includes('@' + model.connections.find((e) => e.target.moduleId === target).id));
  assert.deepEqual(model, snapshot);
});

test('Auto descendants of a pinned compound cell retain their placement connections', () => {
  const model = createDiagramModel({
    version: 1,
    diagram: { name: 'Compound cell' },
    layout: { type: 'grid', cells: [['Cell', 'B']] },
    modules: ['A', 'Inner', 'B'].map(module),
    groups: [{ id: 'Cell', members: ['A', 'Inner'] }],
    connections: [{ id: 'Fanout', from: 'A.out', to: ['Inner.in', 'B.in'] }],
  });
  assert.equal(gridInternalEdges(model).size, 0);
  assert.equal(edges(buildElkGraph(model)).length, 2);
});

test('expanded cross-Container Grid cells also defer their fixed internal relationship', () => {
  const model = createDiagramModel({
    version: 1,
    diagram: { name: 'Expanded' },
    layout: { type: 'grid', cells: [['A'], ['B']] },
    modules: ['A', 'B'].map(module),
    groups: [
      { id: 'Left', members: ['A'] },
      { id: 'Right', members: ['B'] },
    ],
    connections: [{ id: 'Wire', from: 'A.out', to: ['B.in'] }],
  });
  assert.deepEqual([...gridInternalEdges(model)], [model.connections[0].id]);
  assert.equal(edges(buildElkGraph(model)).length, 0);
});

test('missing required Auto routes still fail rather than taking the deferred Grid fallback', async () => {
  const model = createDiagramModel({
    version: 1,
    diagram: { name: 'Auto' },
    modules: ['A', 'B'].map(module),
    connections: [{ id: 'Wire', from: 'A.out', to: ['B.in'] }],
  });
  const elk = new ELK(),
    graph = await elk.layout(buildElkGraph(model));
  assert.equal(graph.edges.length, 1);
  graph.edges = [];
  assert.throws(
    () => readElkResult(graph, model),
    (error) => error.message === 'Missing route: ' + model.connections[0].id,
  );
});
