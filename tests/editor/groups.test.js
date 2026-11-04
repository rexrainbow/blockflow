import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  addGroup,
  removeGroup,
  groupOf,
  placeBlock,
  moveBlock,
  renameModule,
  removeModule,
  addModule,
  validateDocument,
} from '../../src/editor/state/commands.js';
import { History } from '../../src/editor/state/history.js';
const fixture = JSON.parse(
  await readFile(new URL('../../examples/feedback-priority.json', import.meta.url), 'utf8'),
);

test('group membership and ungrouping are atomic history operations preserving connections', () => {
  const history = new History(fixture);
  let id;
  history.update((doc) => {
    id = addGroup(doc, 'InputA');
    placeBlock(doc, 'InputB', id);
  });
  assert.deepEqual(history.present.groups[0].members, ['InputA', 'InputB']);
  assert.equal(groupOf(history.present, 'Mux'), '');
  assert.equal(
    history.update((doc) => placeBlock(doc, 'InputA', id)),
    false,
  );
  assert.deepEqual(history.present.groups[0].members, ['InputA', 'InputB']);
  assert.deepEqual(history.present.connections, fixture.connections);
  history.undo();
  assert.equal(history.present.groups, undefined);
  history.redo();
  history.update((doc) => {
    moveBlock(doc, 'InputB', -1);
  });
  assert.deepEqual(history.present.groups[0].members, ['InputB', 'InputA']);
  history.update((doc) => {
    placeBlock(doc, 'InputA');
  });
  assert.equal(groupOf(history.present, 'InputA'), '');
  history.update((doc) => removeGroup(doc, id));
  assert.equal(history.present.groups, undefined);
  assert.deepEqual(history.present.connections, fixture.connections);
  assert.equal(history.present.modules.length, 3);
});

test('key rename/deletion update group references; IDs share a namespace; empty groups validate', () => {
  const doc = structuredClone(fixture);
  const id = addGroup(doc, 'InputA');
  const renamed = renameModule(doc, 'InputA', id);
  assert.equal(renamed.id, id + '_2');
  assert.deepEqual(doc.groups[0].members, [renamed.id]);
  removeModule(doc, renamed.id);
  assert.deepEqual(doc.groups[0].members, []);
  assert.throws(() => placeBlock(doc, 'Mux', 'missing'));
  validateDocument(doc);
  const empty = {
    version: 1,
    diagram: { name: 'Empty' },
    modules: [],
    groups: [{ id: 'block_1', members: [] }],
  };
  validateDocument(empty);
  assert.equal(addModule(empty), 'block_2');
});

test('nested moves reject cycles atomically; ungroup promotes contents to the original parent', async () => {
  const doc = JSON.parse(
    await readFile(new URL('../../examples/nested-groups.json', import.meta.url), 'utf8'),
  );
  const history = new History(doc);
  const before = structuredClone(history.present);
  assert.throws(() => history.update((d) => placeBlock(d, 'system', 'pipeline')), /descendant/);
  assert.deepEqual(history.present, before);
  assert.equal(history.past.length, 0);
  history.update((d) => placeBlock(d, 'auxiliary', 'system'));
  assert.deepEqual(history.present.groups.find((g) => g.id === 'core').members, ['pipeline']);
  history.update((d) => removeGroup(d, 'core'));
  assert.deepEqual(history.present.groups.find((g) => g.id === 'system').members, ['pipeline', 'auxiliary']);
  assert.deepEqual(history.present.connections, doc.connections);
  validateDocument(history.present);
  history.undo();
  assert.equal(groupOf(history.present, 'pipeline'), 'core');
  history.update((d) => placeBlock(d, 'core'));
  assert.equal(groupOf(history.present, 'core'), '');
  validateDocument(history.present);
});
