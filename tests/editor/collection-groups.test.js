import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setGroupType, setGroupCollapsed } from '../../src/editor/state/commands.js';
import { History } from '../../src/editor/state/history.js';
const raw = JSON.parse(
  await readFile(new URL('../../examples/collection-instances.json', import.meta.url), 'utf8'),
);

test('group type and visibility changes are atomic undoable edits preserving definitions', () => {
  const history = new History(raw);
  history.update((doc) => setGroupType(doc, 'PEs', 'container'));
  assert.equal(history.present.groups[0].collapsed, false);
  assert.deepEqual(history.present.modules, raw.modules);
  assert.deepEqual(history.present.connections, raw.connections);
  history.undo();
  assert.deepEqual(history.present, raw);
  history.redo();
  history.update((doc) => setGroupType(doc, 'PEs', 'collection'));
  history.update((doc) => setGroupCollapsed(doc, 'PEs', true));
  assert.equal(history.present.groups[0].collapsed, true);
  assert.deepEqual(history.present.groups[0].members, raw.groups[0].members);
});

test('Boundary conversion reports bypass edges and leaves the document intact', () => {
  const doc = structuredClone(raw),
    before = structuredClone(doc);
  assert.throws(
    () => setGroupType(doc, 'PEs', 'boundary'),
    (error) => error.problems.some((p) => p.includes('Source.out') && p.includes('PE_0.in')),
  );
  assert.deepEqual(doc, before);
});

test('leaving Boundary refuses referenced ports but retains inactive definitions after disconnecting', () => {
  const doc = {
    version: 1,
    diagram: { name: 'Boundary' },
    modules: [{ id: 'A', ports: [{ id: 'out', direction: 'output' }] }],
    groups: [
      {
        id: 'G',
        portMode: 'boundary',
        collapsed: true,
        members: [],
        ports: [{ id: 'in', direction: 'input' }],
      },
    ],
    connections: [{ from: 'A.out', to: 'G.in' }],
  };
  const before = structuredClone(doc);
  assert.throws(
    () => setGroupType(doc, 'G', 'collection'),
    (error) => error.problems[0].includes('G.in'),
  );
  assert.deepEqual(doc, before);
  doc.connections = [];
  setGroupType(doc, 'G', 'collection');
  assert.deepEqual(doc.groups[0].ports, before.groups[0].ports);
  assert.equal(doc.groups[0].portMode, undefined);
  setGroupType(doc, 'G', 'boundary');
  assert.deepEqual(doc.groups[0].ports, before.groups[0].ports);
  assert.throws(() => setGroupType(doc, 'G', 'stack'), /Choose Container/);
});
