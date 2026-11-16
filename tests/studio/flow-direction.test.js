import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDiagramModel } from '../../src/lib/index.js';
import { concatSide, setFlowDirection } from '../../src/studio/blockchart/state/actions.js';

const load = async () =>
  JSON.parse(await readFile(new URL('../../examples/blockchart/concat-feedback.json', import.meta.url), 'utf8'));

test('Flow change clears explicit Concat sides so the document stays valid', async () => {
  const doc = await load();
  for (const p of doc.modules[1].ports) p.side = p.direction === 'input' ? 'top' : 'bottom';
  createDiagramModel(structuredClone(doc));
  setFlowDirection(doc, 'right');
  assert.equal(doc.layout, undefined, 'an emptied layout object is removed');
  assert.ok(doc.modules[1].ports.every((p) => !('side' in p)));
  createDiagramModel(structuredClone(doc));
  setFlowDirection(doc, 'down');
  assert.deepEqual(doc.layout, { direction: 'down' });
  createDiagramModel(structuredClone(doc));
});

test('Flow change keeps ordinary Block sides and resets a Flow-specific feedback side', async () => {
  const doc = await load();
  doc.modules[0].ports[0].side = 'right';
  doc.layout = { direction: 'down', feedbackRouting: 'outer', feedbackSide: 'left' };
  setFlowDirection(doc, 'right');
  assert.equal(doc.modules[0].ports[0].side, 'right');
  assert.deepEqual(doc.layout, { feedbackRouting: 'outer' });
});

test('concatSide names the side the runtime requires', () => {
  assert.equal(concatSide({ layout: { direction: 'down' } }, 'input'), 'top');
  assert.equal(concatSide({ layout: { direction: 'down' } }, 'output'), 'bottom');
  assert.equal(concatSide({}, 'input'), 'left');
  assert.equal(concatSide({}, 'output'), 'right');
});
