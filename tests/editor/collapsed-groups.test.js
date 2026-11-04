import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setGroupCollapsed, setGroupPortMode, renamePort } from '../../src/editor/state/commands.js';
import { History } from '../../src/editor/state/history.js';
const fixture = JSON.parse(
  await readFile(new URL('../../examples/boundary-groups.json', import.meta.url), 'utf8'),
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
  assert.ok(history.present.connections.some((e) => e.to === 'Inner.request'));
});
test('cannot switch a collapsed boundary to Direct or hide a Direct group', () => {
  const doc = structuredClone(fixture);
  doc.connections = [];
  setGroupCollapsed(doc, 'Inner', true);
  const before = structuredClone(doc);
  assert.throws(() => setGroupPortMode(doc, 'Inner', false), /Show contents/);
  assert.deepEqual(doc, before);
  setGroupCollapsed(doc, 'Inner', false);
  setGroupPortMode(doc, 'Inner', false);
  assert.throws(() => setGroupCollapsed(doc, 'Inner', true), /Boundary or Collection/);
  assert.throws(() => setGroupCollapsed(doc, 'Inner', 'true'), /boolean/);
});
