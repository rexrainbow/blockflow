import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { measureLayout } from '../../examples/metrics.js';
import { checkLayout, freeze } from './helpers.js';

const names = ['placement-branch', 'placement-feedback', 'placement-stress'];
const load = async name => JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));

for (const name of names) test(`${name}: all three placements preserve geometry and route correctly`, async () => {
  const input = await load(name);
  let baselineGeometry;
  for (const placement of ['default', 'relaxed', 'simple']) {
    const model = createDiagramModel({ ...input, layout: { ...input.layout, placement } });
    const before = structuredClone(model);
    const layout = await layoutDiagram(freeze(model));
    assert.deepEqual(model, before);
    checkLayout(model, layout);
    const geometry = layout.modules.map(module => ({
      id: module.id, width: module.width, height: module.height,
      ports: module.ports.map(port => ({ id: port.id, x: port.x - module.x, y: port.y - module.y })),
    }));
    if (baselineGeometry) assert.deepEqual(geometry, baselineGeometry);
    else baselineGeometry = geometry;
    const metrics = measureLayout(layout);
    assert.ok(metrics.bends >= 0 && metrics.wireLength > 0);
    assert.ok(metrics.topYSpread >= 0 && metrics.centerYSpread >= 0);
    assert.equal(metrics.edges.length, model.connections.length);
    assert.ok(renderSvg(layout).startsWith('<svg'));
  }
});

test('comparison fixtures isolate return edge and port geometry changes', async () => {
  const branch = await load(names[0]), feedback = await load(names[1]), stress = await load(names[2]);
  assert.deepEqual(branch.modules, feedback.modules);
  assert.deepEqual(feedback.connections.slice(0, -1), branch.connections);
  assert.deepEqual(feedback.connections.at(-1), { from: 'D.feedback', to: 'A.feedback' });
  assert.deepEqual(stress.connections, feedback.connections);
  assert.deepEqual(branch.modules.map(m => m.id), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.equal(branch.connections.length, 6);
  assert.equal(feedback.connections.length, 7);
  assert.notDeepEqual(stress.modules, feedback.modules);
});

test('metrics distinguish top/center alignment and count actual bends and lengths', () => {
  const layout = {
    width: 100, height: 90,
    modules: [
      { id: 'A', y: 0, height: 40 }, { id: 'B', y: 10, height: 20 },
      { id: 'C', y: 5, height: 30 }, { id: 'D', y: 0, height: 40 },
    ],
    connections: [{ id: 'edge', sections: [{ points: [
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 20, y: 0 }, { x: 20, y: 30 }, { x: 50, y: 30 },
    ] }] }],
  };
  const metrics = measureLayout(layout);
  assert.equal(metrics.topYSpread, 10);
  assert.equal(metrics.centerYSpread, 0);
  assert.equal(metrics.bends, 2);
  assert.equal(metrics.wireLength, 80);
  assert.deepEqual(metrics.edges, [{ id: 'edge', bends: 2, wireLength: 80 }]);
});
