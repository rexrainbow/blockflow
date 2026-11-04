import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacyLayout } from '../../src/editor/state/legacy-layout.js';
import { createDiagramModel } from '../../src/lib/index.js';
import { fixture, freeze } from '../lib/helpers.js';
test('legacy editor migration removes only retired settings and does not mutate input', () => {
  const original = fixture();
  original.layout = { direction: 'left', moduleSpacing: 80, orderMode: 'staged' };
  Object.assign(original.connections[0], {
    order: 3,
    alignment: true,
    label: 'Keep this label',
    feedback: true,
    style: { strokeColor: '#123456' },
  });
  original.modules[0].width = 2;
  original.groups = [{ id: 'G', members: ['a'], portMode: 'direct', collapsed: false }];
  const before = structuredClone(original),
    expected = structuredClone(original);
  delete expected.layout.orderMode;
  delete expected.connections[0].order;
  delete expected.connections[0].alignment;
  const converted = migrateLegacyLayout(freeze(original));
  assert.deepEqual(converted, expected);
  assert.deepEqual(original, before);
  createDiagramModel(converted);
  assert.deepEqual(migrateLegacyLayout(converted), converted);
});
test('migration never masks malformed or unrelated document fields', () => {
  for (const value of [null, [], 1, 'bad', { layout: null, connections: [null] }])
    assert.deepEqual(migrateLegacyLayout(value), value);
  const d = fixture();
  d.layout = { unknown: true, orderMode: 'all' };
  d.connections[0].order = 1;
  const result = migrateLegacyLayout(d);
  assert.equal(result.layout.unknown, true);
  assert.throws(() => createDiagramModel(result));
});
