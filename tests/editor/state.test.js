import test from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../../src/editor/state/history.js';
import {
  emptyDocument,
  validateDocument,
  addModule,
  addPort,
  removeModule,
  removePort,
  renamePort,
  renameModule,
  endpoints,
  movePort,
  targetReason,
} from '../../src/editor/state/commands.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';

function fixture() {
  return {
    version: 1,
    diagram: { name: 'Editor' },
    modules: [
      {
        id: 'a',
        ports: [
          { id: 'out', direction: 'output' },
          { id: 'aux', direction: 'output' },
          { id: 'in', direction: 'input' },
        ],
      },
      {
        id: 'b',
        ports: [
          { id: 'in', direction: 'input' },
          { id: 'out', direction: 'output' },
        ],
      },
    ],
    connections: [{ from: 'a.out', to: 'b.in' }],
  };
}

test('block key rename updates fanout, incoming edges and self-loops atomically', () => {
  const doc = fixture();
  doc.modules.push({ id: 'aa', ports: [{ id: 'in', direction: 'input' }] });
  doc.connections.push({ from: 'a.out', to: 'a.in' }, { from: 'a.aux', to: 'aa.in' });
  const history = new History(doc);
  history.update((draft) => renameModule(draft, 'a', 'Source'));
  assert.deepEqual(history.present.connections, [
    { from: 'Source.out', to: 'b.in' },
    { from: 'Source.out', to: 'Source.in' },
    { from: 'Source.aux', to: 'aa.in' },
  ]);
  assert.equal(history.present.modules[0].label, undefined);
  assert.equal(endpoints(history.present, 'output')[0].label, 'Source.out');
  validateDocument(history.present);
  history.undo();
  assert.deepEqual(history.present, doc);
  history.redo();
  assert.equal(history.present.modules[0].id, 'Source');
});

test('duplicate block keys receive the first available suffix and invalid keys leave data intact', () => {
  const doc = fixture();
  doc.modules.push({ id: 'b_2', ports: [{ id: 'in', direction: 'input' }] });
  assert.deepEqual(renameModule(doc, 'a', 'b'), { id: 'b_3', requested: 'b', adjusted: true });
  assert.equal(doc.connections[0].from, 'b_3.out');
  const before = structuredClone(doc);
  assert.throws(() => renameModule(doc, 'b_3', 'bad.key'), /letters/);
  assert.deepEqual(doc, before);
  assert.deepEqual(renameModule(doc, 'b_3', 'b_3'), { id: 'b_3', requested: 'b_3', adjusted: false });
  assert.deepEqual(doc, before);
});

test('new blocks default to their ID; key renames preserve only explicit display names', () => {
  const doc = emptyDocument();
  const id = addModule(doc);
  addPort(doc.modules[0], 'input');
  assert.equal(doc.modules[0].label, undefined);
  assert.equal(createDiagramModel(doc).modules[0].label, id);
  renameModule(doc, id, 'Source');
  assert.equal(createDiagramModel(doc).modules[0].label, 'Source');
  doc.modules[0].label = 'Custom name';
  renameModule(doc, 'Source', 'Capture');
  assert.equal(createDiagramModel(doc).modules[0].label, 'Custom name');
});

test('history clones raw JSON, omits unspecified width and branches after undo', () => {
  const input = fixture();
  const history = new History(input);
  history.update((doc) => {
    renamePort(doc, 'a', 'out', 'data');
  });
  assert.equal(history.present.connections[0].from, 'a.data');
  assert.equal(input.connections[0].from, 'a.out');
  history.undo();
  assert.equal(history.present.modules[0].ports[0].id, 'out');
  assert.equal(Object.hasOwn(history.present.modules[0].ports[0], 'width'), false);
  history.redo();
  assert.equal(history.present.connections[0].from, 'a.data');
  history.undo();
  history.update((doc) => {
    doc.diagram.name = 'Branch';
  });
  assert.equal(history.future.length, 0);
});

test('block and port deletion remove dependent connections in one undo step', () => {
  for (const remove of [(doc) => removeModule(doc, 'a'), (doc) => removePort(doc, 'a', 'out')]) {
    const input = fixture();
    const history = new History(input);
    history.update(remove);
    assert.equal(history.present.connections.length, 0);
    assert.equal(history.past.length, 1);
    history.undo();
    assert.deepEqual(history.present, input);
  }
});

test('history is bounded, no-op and rejected commands do not add snapshots', () => {
  const history = new History(fixture(), 3);
  for (let n = 0; n < 5; n++)
    history.update((doc) => {
      doc.diagram.name = `${n}`;
    });
  assert.equal(history.past.length, 3);
  history.update(() => {});
  assert.equal(history.past.length, 3);
  assert.throws(() => history.update((doc) => renamePort(doc, 'a', 'out', 'bad.key')));
  assert.equal(history.present.modules[0].ports[0].id, 'out');
});

test('empty document and draft creation; port ordering only moves the chosen side', () => {
  const doc = emptyDocument();
  validateDocument(doc);
  const id = addModule(doc);
  assert.throws(() => createDiagramModel(doc));
  const module = doc.modules.find((m) => m.id === id);
  addPort(module, 'input');
  addPort(module, 'output');
  addPort(module, 'input');
  movePort(module, 'input', 0, 1);
  assert.deepEqual(
    module.ports.map((p) => p.id),
    ['in_2', 'out_1', 'in_1'],
  );
  createDiagramModel(doc);
});

test('unknown/known endpoint combinations; mismatch only when both widths are explicit', async () => {
  for (const [source, target, expected] of [
    [undefined, undefined, null],
    [8, undefined, 8],
    [undefined, 16, 16],
    [1, 1, 1],
    [8, 8, 8],
  ]) {
    const doc = fixture();
    if (source !== undefined) doc.modules[0].ports[0].width = source;
    if (target !== undefined) doc.modules[1].ports[0].width = target;
    const model = createDiagramModel(doc);
    assert.equal(model.connections[0].width, expected);
    assert.equal(model.modules[0].ports[0].width, source ?? null);
    assert.equal(targetReason(doc, 'a.out', 'b.in', 0), '');
    const svg = renderSvg(await layoutDiagram(model));
    assert.ok(svg.includes(`stroke-width="${expected > 1 ? 2.5 : 1.5}"`));
  }
  const doc = fixture();
  doc.modules[0].ports[0].width = 8;
  doc.modules[1].ports[0].width = 16;
  assert.throws(
    () => createDiagramModel(doc),
    (error) => error.path === 'connections[0].to',
  );
  assert.equal(targetReason(doc, 'a.out', 'b.in', 0), 'Width mismatch');
});

test('unknown fanout stays unknown across independent connections', () => {
  const doc = fixture();
  doc.modules[0].ports.push({ id: 'other', direction: 'input', width: 16 });
  doc.modules[1].ports[0].width = 8;
  doc.connections.push({ from: 'a.out', to: 'a.other' });
  const model = createDiagramModel(doc);
  assert.deepEqual(
    model.connections.map((c) => c.width),
    [8, 16],
  );
  assert.equal(model.modules[0].ports[0].width, null);
  assert.equal(targetReason(doc, 'b.out', 'b.in'), 'Input already connected');
});
