import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  setGroupPortMode,
  renamePort,
  removePort,
  addPort,
  movePort,
  endpoints,
  targetReason,
  placeBlock,
  removeGroup,
  validateDocument,
} from '../../src/editor/state/commands.js';
import { History } from '../../src/editor/state/history.js';
const fixture = JSON.parse(
  await readFile(new URL('../fixtures/boundary-minimal.json', import.meta.url), 'utf8'),
);

test('group mode changes are atomic, reversible and preserve inactive port definitions', () => {
  const doc = structuredClone(fixture),
    before = structuredClone(doc);
  assert.throws(
    () => setGroupPortMode(doc, 'Outer', false),
    (error) => error.problems.length === 4,
  );
  assert.deepEqual(doc, before);
  doc.connections = [];
  const history = new History(doc);
  history.update((d) => setGroupPortMode(d, 'Outer', false));
  assert.equal(history.present.groups[0].portMode, 'direct');
  assert.deepEqual(history.present.groups[0].ports, doc.groups[0].ports);
  assert.ok(!endpoints(history.present, 'output').some((p) => p.ref === 'Outer.in'));
  history.undo();
  assert.equal(history.present.groups[0].portMode, 'boundary');
  history.redo();
  assert.equal(history.present.groups[0].portMode, 'direct');
});

test('enabling a boundary reports bypass connections without changing the document', () => {
  const doc = structuredClone(fixture);
  doc.groups.forEach((g) => (g.portMode = 'direct'));
  doc.connections = [{ from: 'Source.out', to: 'Decode.in' }];
  const before = structuredClone(doc);
  assert.throws(
    () => setGroupPortMode(doc, 'Outer', true),
    (error) => error.problems[0].includes('Source.out') && error.problems[0].includes('Outer'),
  );
  assert.deepEqual(doc, before);
});

test('group ports share block key, display, style, reordering and connection rename behavior', () => {
  const doc = structuredClone(fixture),
    g = doc.groups[0];
  const result = renamePort(doc, 'Outer', 'in', 'out');
  assert.equal(result.id, 'out_2');
  assert.equal(doc.connections[0].to, 'Outer.out_2');
  assert.equal(doc.connections[1].from, 'Outer.out_2');
  assert.equal(g.ports[0].label, 'Data\nin');
  const id = addPort(g, 'input');
  movePort(g, 'input', 2, 0);
  assert.equal(g.ports[0].id, id);
  removePort(doc, 'Outer', 'out_2');
  assert.equal(doc.connections.length, 4);
  validateDocument(doc);
});

test('endpoint choices expose both faces and reject invalid directions and boundary bypass', () => {
  const doc = structuredClone(fixture);
  for (const direction of ['input', 'output'])
    assert.ok(endpoints(doc, direction).some((p) => p.ref === 'Outer.in'));
  assert.equal(targetReason(doc, 'Outer.in', 'Inner.in', 1), '');
  assert.match(targetReason(doc, 'Source.out', 'Decode.in'), /boundary of group Outer/);
  assert.match(targetReason(doc, 'Inner.out', 'Decode.in'), /Expected input port/);
  assert.match(targetReason(doc, 'Source.out', 'Outer.in'), /already connected/);
});

test('moving connected blocks across boundaries and ungrouping referenced ports are blocked atomically', () => {
  const doc = structuredClone(fixture),
    before = structuredClone(doc);
  assert.throws(() => placeBlock(doc, 'Decode', ''), /outside of group/);
  assert.deepEqual(doc, before);
  assert.throws(() => removeGroup(doc, 'Inner'), /Disconnect group Inner ports/);
  assert.deepEqual(doc, before);
  doc.connections = [];
  placeBlock(doc, 'Decode', '');
  removeGroup(doc, 'Inner');
  validateDocument(doc);
});
