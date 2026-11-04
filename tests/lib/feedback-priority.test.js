import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDiagramModel, layoutDiagram } from '../../src/lib/index.js';
import { checkLayout, freeze } from './helpers.js';

const example = JSON.parse(await readFile(new URL('../../examples/feedback-priority.json', import.meta.url), 'utf8'));

test('feedback is optional, boolean, defaults false in once layout', () => {
  const raw = structuredClone(example);
  const before = structuredClone(raw);
  const model = createDiagramModel(freeze(raw));
  assert.deepEqual(model.connections.map(edge => edge.feedback), [false, false, true]);
  assert.deepEqual(raw, before);
  for (const value of [false, true]) {
    const input = structuredClone(example);
    input.connections[0].feedback = value;
    assert.equal(createDiagramModel(input).connections[0].feedback, value);
  }
});

for (const feedback of [null, 0, 10, 'true', [], {}]) test('reject invalid feedback ' + JSON.stringify(feedback), () => {
  const raw = structuredClone(example);
  raw.connections[2].feedback = feedback;
  assert.throws(() => createDiagramModel(raw), error => error.path === 'connections[2].feedback');
});

test('marked Mux feedback preserves both inputs before Mux with fixed ports', async () => {
  const raw = structuredClone(example);
  const model = createDiagramModel(raw);
  const before = structuredClone(model);
  const layout = await layoutDiagram(freeze(model));
  checkLayout(model, layout);
  assert.deepEqual(model, before);
  const [a, b, mux] = ['InputA', 'InputB', 'Mux'].map(id => layout.modules.find(node => node.id === id));
  assert.equal(a.x, b.x);
  assert.ok(a.x + a.width < mux.x);
  assert.ok(b.x + b.width < mux.x);
  assert.deepEqual(layout.connections.map(edge => edge.feedback), [false, false, true]);
  const normal = structuredClone(raw);
  delete normal.connections[2].feedback;
  const unmarked = await layoutDiagram(createDiagramModel(normal));
  assert.ok(unmarked.modules.find(node => node.id === 'InputA').x > unmarked.modules.find(node => node.id === 'Mux').x);
});

test('feedback preference coexists with once layout and outer routing', async () => {
  const raw = structuredClone(example);
  raw.layout = { ...raw.layout, feedbackRouting: 'outer' };
  const model = createDiagramModel(raw);
  const result = await layoutDiagram(model);
  checkLayout(model, result);
  assert.equal(result.connections[2].feedback, true);
});
