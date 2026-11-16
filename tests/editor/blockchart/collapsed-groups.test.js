import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setGroupCollapsed, setGroupType, renamePort } from '../../../src/editor/blockchart/commands.js';
import { History } from '../../../src/editor/shared/history.js';
const fixture = JSON.parse(
  await readFile(new URL('../../../examples/blockchart/boundary-groups.json', import.meta.url), 'utf8'),
);
test('Hide contents is one persisted, undoable edit preserving all children and links', () => {
  const history = new History(fixture);
  history.update((doc) => setGroupCollapsed(doc, 'Inner', true));
  assert.deepEqual(history.present.modules, fixture.modules);
  assert.deepEqual(history.present.connections, fixture.connections);
  assert.deepEqual(history.present.groups[1].members, fixture.groups[1].members);
  assert.equal(history.present.groups[1].collapsed, true);
  history.undo();
  assert.deepEqual(history.present, fixture);
  history.redo();
  history.update((doc) => renamePort(doc, 'Inner', 'in', 'request'));
  assert.equal(history.present.groups[1].collapsed, true);
  assert.ok(history.present.connections.some((e) => e.to.includes('Inner.request')));
});
test('cannot switch a collapsed boundary to Direct or hide a Direct group', () => {
  const doc = structuredClone(fixture);
  doc.connections = [];
  setGroupCollapsed(doc, 'Inner', true);
  const before = structuredClone(doc);
  setGroupType(doc, 'Inner', 'container');
  assert.equal(doc.groups[1].collapsed, false);
  assert.equal(doc.groups[1].type, 'container');
  setGroupType(doc, 'Inner', 'container');
  assert.throws(() => setGroupCollapsed(doc, 'Inner', true), /Boundary or Collection/);
  assert.throws(() => setGroupCollapsed(doc, 'Inner', 'true'), /boolean/);
});
