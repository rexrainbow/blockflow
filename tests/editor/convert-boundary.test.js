import test from 'node:test';
import assert from 'node:assert/strict';
import { convertToBoundaryGroup, addModule, addPort, placeBlock } from '../../src/editor/state/commands.js';
import { History } from '../../src/editor/state/history.js';
import { createDiagramModel, layoutDiagram } from '../../src/lib/index.js';
import { moduleGeometry } from '../../src/lib/geometry.js';
import { fixture } from '../lib/helpers.js';

test('conversion preserves keys, ports, labels, dimensions, connections and effective inherited appearance', () => {
  const raw = fixture();
  raw.diagram.style = {
    module: {
      fillColor: '#abcdef',
      borderWidth: 3,
      label: { fontSize: 22, padding: 5, color: '#123456' },
      inputPortLabel: { fontSize: 16, color: '#321654' },
    },
  };
  Object.assign(raw.modules[0], {
    label: 'Source\nblock',
    width: 2.3,
    height: 3.5,
    style: { label: { color: '#112233' }, portLabel: { backgroundColor: '#fedcba' } },
  });
  raw.modules[0].ports[0].label = 'Data\nin';
  raw.modules[0].ports[1].width = 8;
  const old = createDiagramModel(raw).modules[0],
    block = structuredClone(raw.modules[0]),
    connections = structuredClone(raw.connections);
  assert.equal(convertToBoundaryGroup(raw, 'a'), 'a');
  const g = raw.groups[0],
    normalized = createDiagramModel(raw).groups[0];
  assert.equal(
    raw.modules.some((n) => n.id === 'a'),
    false,
  );
  assert.equal(g.id, 'a');
  assert.equal(g.label, block.label);
  assert.deepEqual(g.ports, block.ports);
  assert.deepEqual(g.members, []);
  assert.equal(g.type, 'boundary');
  assert.equal(g.collapsed, true);
  assert.equal(g.width, 2.3);
  assert.equal(g.height, 3.5);
  assert.deepEqual(raw.connections, connections);
  assert.deepEqual(normalized.style, old.style);
  assert.deepEqual(normalized.ports, old.ports);
  assert.deepEqual(moduleGeometry(normalized), moduleGeometry(old));
});

test('nested conversion preserves parent membership and sibling order in one undoable edit', () => {
  const raw = fixture();
  raw.groups = [{ id: 'Parent', members: ['b', 'a'] }];
  const history = new History(raw);
  history.update((doc) => convertToBoundaryGroup(doc, 'a'));
  const converted = structuredClone(history.present);
  assert.deepEqual(converted.groups[0].members, ['b', 'a']);
  history.undo();
  assert.deepEqual(history.present, raw);
  history.redo();
  assert.deepEqual(history.present, converted);
});

test('conversion permits unrelated empty drafts and keeps layout settings', () => {
  const raw = fixture();
  raw.modules.push({ id: 'Draft', ports: [] });
  raw.layout = { direction: 'left', placement: 'relaxed' };
  convertToBoundaryGroup(raw, 'a');
  assert.deepEqual(raw.layout, { direction: 'left', placement: 'relaxed' });
  assert.deepEqual(raw.modules.at(-1), { id: 'Draft', ports: [] });
});

for (const [name, change, id] of [
  ['missing block', () => {}, 'missing'],
  [
    'empty draft',
    (d) => {
      d.modules[0].ports = [];
    },
    'a',
  ],
  [
    'invalid dimensions',
    (d) => {
      d.modules[0].width = 0;
    },
    'a',
  ],
  [
    'duplicate group key',
    (d) => {
      d.groups = [{ id: 'a', members: [] }];
    },
    'a',
  ],
  [
    'invalid connection',
    (d) => {
      d.connections[0].to = 'Missing.in';
    },
    'a',
  ],
])
  test('failed conversion is atomic: ' + name, () => {
    const raw = fixture();
    change(raw);
    const before = structuredClone(raw);
    assert.throws(() => convertToBoundaryGroup(raw, id));
    assert.deepEqual(raw, before);
  });

test('same-block self-loop becomes an external group feedback route with unchanged endpoints', async () => {
  const raw = fixture();
  raw.connections.push({ from: 'a.o', to: 'a.i', feedback: true, label: 'Feedback' });
  const before = structuredClone(raw.connections);
  convertToBoundaryGroup(raw, 'a');
  assert.deepEqual(raw.connections, before);
  const model = createDiagramModel(raw);
  assert.equal(model.connections[1].scope, '');
  assert.equal(model.connections[1].insideSelfLoop, false);
  const layout = await layoutDiagram(model);
  assert.equal(layout.connections.length, 2);
  assert.equal(layout.groups[0].collapsed, true);
});

test('converted group can expand, accept a child and connect through its original boundary ports', () => {
  const raw = fixture();
  convertToBoundaryGroup(raw, 'a');
  raw.groups[0].collapsed = false;
  const id = addModule(raw);
  placeBlock(raw, id, 'a');
  const child = raw.modules.find((n) => n.id === id);
  const input = addPort(child, 'input'),
    output = addPort(child, 'output');
  raw.connections.push({ from: 'a.i', to: id + '.' + input }, { from: id + '.' + output, to: 'a.o' });
  createDiagramModel(raw);
  assert.deepEqual(raw.groups[0].members, [id]);
});
