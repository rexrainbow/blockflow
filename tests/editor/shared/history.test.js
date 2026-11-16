import test from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../../../src/editor/shared/history.js';

test('shared History snapshots arbitrary documents and preserves no-op/branch semantics', () => {
  const source = { nodes: [{ id: 'start', text: 'Start' }], edges: [] },
    history = new History(source);
  source.nodes[0].text = 'Outside';
  assert.equal(history.present.nodes[0].text, 'Start');
  assert.equal(
    history.update(() => {}),
    false,
  );
  assert.equal(
    history.update((d) => {
      d.nodes[0].text = 'Edited';
    }),
    true,
  );
  assert.equal(history.undo(), true);
  assert.equal(history.present.nodes[0].text, 'Start');
  assert.equal(history.redo(), true);
  assert.equal(history.present.nodes[0].text, 'Edited');
  history.undo();
  history.update((d) => d.nodes.push({ id: 'next' }));
  assert.equal(history.redo(), false);
});
test('failed changes are atomic, committed input is cloned, and history stays bounded', () => {
  const h = new History({ value: 0 }, 2);
  assert.throws(() =>
    h.update((d) => {
      d.value = 9;
      throw new Error('Rejected');
    }),
  );
  assert.deepEqual(h.present, { value: 0 });
  assert.equal(h.past.length, 0);
  const next = { value: 1 };
  h.commit(next);
  next.value = 99;
  assert.equal(h.present.value, 1);
  h.commit({ value: 2 });
  h.commit({ value: 3 });
  assert.equal(h.past.length, 2);
  h.undo();
  h.undo();
  assert.equal(h.present.value, 1);
  assert.equal(h.undo(), false);
});
