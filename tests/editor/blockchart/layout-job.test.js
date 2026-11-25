import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutJobRunner, runLayoutJob } from '../../../src/editor/blockchart/layout-job.js';
import { LayoutService } from '../../../src/editor/blockchart/services/layout.js';
import { geometryKey } from '../../../src/editor/blockchart/paint-layout.js';
import * as commands from '../../../src/editor/blockchart/commands.js';
import { layoutDiagram, renderSvg } from '../../../src/lib/blockchart/index.js';
const fixture = () => ({
  version: 1,
  diagram: { name: 'Worker document' },
  modules: [
    { id: 'Source', ports: [{ id: 'out', direction: 'output' }] },
    { id: 'SinkA', ports: [{ id: 'in', direction: 'input' }] },
    { id: 'SinkB', ports: [{ id: 'in', direction: 'input' }] },
  ],
  groups: [{ id: 'Group', members: ['Source', 'SinkA', 'SinkB'] }],
  connections: [{ from: 'Source.out', to: ['SinkA.in', 'SinkB.in'], label: 'Data' }],
});

test('Blockchart jobs preserve revision, authoring identity and fan-out hit targets', async () => {
  const document = fixture(),
    before = structuredClone(document),
    reply = await runLayoutJob({ document, revision: 7, rootGroupId: null });
  assert.equal(reply.revision, 7);
  assert.equal(reply.error, undefined);
  assert.deepEqual(document, before);
  assert.equal(reply.layout.connections.length, 2);
  assert.equal(reply.svg, renderSvg(reply.layout));
  for (const edge of reply.layout.connections) {
    assert.equal(edge.editorKey, commands.connectionKey(document.connections[0]));
    assert.equal(edge.editorLabel, 'Source.out to SinkA.in, SinkB.in');
  }
  const scoped = await runLayoutJob({ document, revision: 8, rootGroupId: 'Group' });
  assert.equal(scoped.layout.rootGroupId, 'Group');
  assert.equal(scoped.revision, 8);
});
test('malformed messages are ignored and validation/view failures keep the worker reply shape', async () => {
  for (const data of [null, {}, { document: fixture(), revision: 1.5 }, { document: fixture() }])
    assert.equal(await runLayoutJob(data), null);
  const document = fixture();
  document.modules[0].ports[0].direction = 'invalid';
  const reply = await runLayoutJob({ document, revision: 2 });
  assert.equal(reply.revision, 2);
  assert.ok(reply.error);
  assert.equal(reply.path, 'modules[0].ports[0].direction');
  const unknown = await runLayoutJob({ document: fixture(), revision: 3, rootGroupId: 'Missing' });
  assert.match(unknown.error, /Unknown view group/);
  const wrongDomain = await runLayoutJob({
    document: { version: 1, diagram: { name: 'Flowchart' }, nodes: [], edges: [] },
    revision: 4,
  });
  assert.ok(wrongDomain.error);
  assert.equal(wrongDomain.path, 'nodes');
});
test('domain service preserves the Blockchart request contract', () => {
  const s = new LayoutService(() => {});
  assert.equal(s.debounceMs, 180);
  assert.deepEqual(s.createRequest({ modules: [] }, { rootGroupId: 'Group' }, 4), {
    document: { modules: [] },
    revision: 4,
    rootGroupId: 'Group',
  });
  assert.deepEqual(s.createRequest({}, {}, 5), { document: {}, revision: 5, rootGroupId: null });
  assert.equal(s.requestDelay({}), 180);
  assert.equal(s.requestDelay({ paintOnly: true }), 0);
  assert.deepEqual(s.createRequest({}, { paintOnly: true }, 6), {
    document: {},
    revision: 6,
    rootGroupId: null,
    paintOnly: true,
  });
  s.dispose();
});

function countingRunner() {
  let calls = 0;
  const run = createLayoutJobRunner((...args) => {
    calls++;
    return layoutDiagram(...args);
  });
  return { run, calls: () => calls };
}

test('paint jobs resolve defaults, overrides and removals and own their returned geometry', async () => {
  const h = countingRunner();
  const document = fixture();
  const first = await h.run({ document, revision: 1, rootGroupId: 'Group' });
  first.layout.modules[0].x = -999;
  document.diagram.style = { module: { fillColor: '#abc' }, connection: { strokeColor: '#def' } };
  document.modules[0].style = { borderColor: '#123' };
  document.connections[0].to[1] = { endpoint: 'SinkB.in', style: { strokeColor: '#456' } };
  for (const revision of [2, 3, 4]) {
    const data = { document, revision, rootGroupId: 'Group', paintOnly: true };
    const before = structuredClone(document);
    const reply = await h.run(data);
    assert.ok(reply.layout, reply.error);
    assert.deepEqual(reply, await runLayoutJob(data));
    assert.deepEqual(document, before);
    assert.ok(reply.layout.connections.some((e) => e.netTrunkSections > 0 && e.arrow));
    reply.layout.modules[0].ports.length = 0;
    if (revision === 2) document.connections[0].style = { strokeColor: '#abc' };
    else {
      delete document.diagram.style;
      delete document.connections[0].style;
      delete document.modules[0].style;
      document.connections[0].to[1] = 'SinkB.in';
    }
  }
  assert.equal(h.calls(), 1);
});

test('junction paint follows the Net even when its first branch overrides its stroke', async () => {
  const h = countingRunner(),
    document = fixture();
  delete document.groups;
  delete document.connections[0].label;
  document.modules.push({ id: 'SinkC', ports: [{ id: 'in', direction: 'input' }] });
  document.connections[0].to.push('SinkC.in');
  document.diagram.style = { module: { portLabel: { hidden: true } } };
  document.layout = {
    type: 'grid',
    cells: [
      ['Source', 'SinkA'],
      [null, 'SinkB'],
      [null, 'SinkC'],
    ],
  };
  await h.run({ document, revision: 1 });
  document.connections[0].style = { strokeColor: '#789' };
  document.connections[0].to[0] = { endpoint: 'SinkA.in', style: { strokeColor: '#abc' } };
  const data = { document, revision: 2, paintOnly: true };
  const reply = await h.run(data);
  assert.deepEqual(reply, await runLayoutJob(data));
  assert.equal(reply.layout.junctions.length, 2);
  assert.ok(reply.layout.junctions.every((j) => j.style.strokeColor === '#778899'));
  assert.equal(h.calls(), 1);
});

test('paint hints validate input and fall back for new workers, views and geometry', async () => {
  const h = countingRunner(),
    document = fixture();
  let revision = 0;
  async function check(expectedCalls, rootGroupId = null) {
    const data = { document, rootGroupId, revision: ++revision, paintOnly: true };
    const reply = await h.run(data);
    assert.deepEqual(reply, await runLayoutJob(data));
    assert.equal(h.calls(), expectedCalls);
    return reply;
  }
  await check(1);
  await check(2, 'Group');
  document.modules[0].label = 'Wider source';
  document.modules[0].style = { fillColor: '#abc' };
  await check(3, 'Group');
  document.connections[0].style = { strokeWidth: 6 };
  await check(4, 'Group');
  document.connections[0].to.reverse();
  await check(5, 'Group');
  document.modules[0].style.fillColor = 'invalid';
  assert.equal((await check(5, 'Group')).path, 'modules[0].style.fillColor');
  delete document.modules[0].style;
  await check(6, 'Group');
});

test('repaint and labelled renames update collapsed ports, repeated labels, hit targets and overrides', async () => {
  const h = countingRunner();
  const doc = fixture();
  doc.diagram.caption = 'Caption';
  doc.terminals = [{ id: 'Clock', direction: 'input' }];
  doc.groups[0] = {
    id: 'Group',
    label: 'Group',
    type: 'collection',
    collapsed: true,
    members: ['SinkA', 'SinkB'],
  };
  doc.modules[0].label = 'Source';
  doc.modules[0].ports[0].label = 'Output';
  doc.connections[0].style = { label: { repeatAtEnd: 'always' } };
  doc.layout = { type: 'grid', cells: [['Source', 'Group']] };
  const original = structuredClone(doc);
  const initial = await h.run({ document: doc, revision: 1 });
  assert.ok(initial.layout, initial.error);
  commands.renameModule(doc, 'Source', 'Renamed');
  commands.renamePort(doc, 'Renamed', 'out', 'send');
  doc.groups[0].id = 'Bank';
  doc.layout.cells[0][1] = 'Bank';
  const text = {
    color: '#123',
    opacity: 0.35,
    backgroundColor: '#abc',
    backgroundOpacity: 0.2,
    textAlign: 'right',
  };
  doc.diagram.style = { text, caption: { opacity: 0.8 }, terminal: { color: '#789' } };
  doc.groups[0].style = { fillColor: '#abc', borderColor: '#456', borderOpacity: 0.1, inputPortLabel: text };
  doc.modules[0].style = {
    borderStyle: 'dotted',
    fillOpacity: 0.2,
    label: text,
    portLabel: { opacity: 0.1 },
  };
  doc.modules[0].ports[0].style = { color: '#fed' };
  Object.assign(doc.connections[0].style, { opacity: 0.4, lineStyle: 'dashed' });
  doc.connections[0].to[0] = { endpoint: 'SinkA.in', style: { opacity: 0.7, lineStyle: 'dotted' } };
  assert.equal(geometryKey(doc), geometryKey(original));
  for (const [revision, document] of [
    [2, doc],
    [3, original],
    [4, doc],
  ]) {
    const data = { document, revision, paintOnly: true };
    const actual = await h.run(data);
    assert.ok(actual.layout, actual.error);
    assert.deepEqual(actual, await runLayoutJob(data));
    const group = actual.layout.groups[0];
    assert.equal(group.ports.length, 2);
    assert.ok(actual.layout.connections.every((e) => e.routingTarget.moduleId === group.id));
    assert.ok(actual.layout.connections[0].labelInstances.some((l) => l.role === 'end' && l.sharedKey));
    assert.equal(h.calls(), 1);
  }
});

test('a labelled group rename reuses its scoped layout while a real view change computes again', async () => {
  const h = countingRunner(),
    document = fixture();
  document.groups[0].label = 'Processing';
  await h.run({ document, revision: 1, rootGroupId: 'Group' });
  document.groups[0].id = 'Bank';
  for (const [revision, rootGroupId] of [
    [2, 'Bank'],
    [3, null],
  ]) {
    const data = { document, revision, rootGroupId, paintOnly: true };
    assert.deepEqual(await h.run(data), await runLayoutJob(data));
    assert.equal(h.calls(), revision - 1);
  }
});

test('geometry keys retain measured text, endpoint rewires and routing fields', () => {
  const original = fixture();
  for (const change of [
    (d) => commands.renameModule(d, 'Source', 'LongerSource'),
    (d) => commands.renamePort(d, 'Source', 'out', 'newPort'),
    (d) => {
      d.groups[0].id = 'Different';
    },
    (d) => {
      d.connections[0].to.reverse();
    },
    (d) => {
      d.modules[0].style = { borderWidth: 3 };
    },
    (d) => {
      d.connections[0].style = { endArrow: 'none' };
    },
    (d) => {
      d.connections[0].style = { label: { repeatAtEnd: 'always' } };
    },
    ...[{ fontSize: 18 }, { hidden: true }, { padding: 8 }].map((label) => (d) => {
      d.diagram.style = { module: { label } };
    }),
  ]) {
    const copy = structuredClone(original);
    change(copy);
    assert.notEqual(geometryKey(copy), geometryKey(original));
  }
});

test('reordering identical labelled slots is not treated as a rename', async () => {
  const h = countingRunner();
  const document = {
    version: 1,
    diagram: { name: 'Slots' },
    modules: ['A', 'B'].map((id) => ({ id, label: 'Item' })),
  };
  await h.run({ document, revision: 1 });
  document.modules.reverse();
  const data = { document, revision: 2, paintOnly: true };
  assert.deepEqual(await h.run(data), await runLayoutJob(data));
  assert.equal(h.calls(), 2);
});

test('outer routing reuses a labelled rename only while its endpoint sort order is stable', async () => {
  const h = countingRunner(),
    document = fixture();
  document.layout = { feedbackRouting: 'outer' };
  delete document.groups;
  delete document.connections[0].label;
  for (const n of document.modules) n.label = n.id;
  await h.run({ document, revision: 1 });
  commands.renameModule(document, 'SinkA', 'SinkA2');
  for (const revision of [2, 3]) {
    if (revision === 3) commands.renameModule(document, 'SinkA2', 'Z');
    const data = { document, revision, paintOnly: true };
    assert.deepEqual(await h.run(data), await runLayoutJob(data));
    assert.equal(h.calls(), revision - 1);
  }
});

test('an older full job finishing late cannot replace a newer geometry baseline', async () => {
  let release,
    calls = 0;
  const run = createLayoutJobRunner(async (...args) => {
    if (++calls === 1)
      await new Promise((resolve) => {
        release = resolve;
      });
    return layoutDiagram(...args);
  });
  const previousDocument = fixture();
  const older = run({ document: previousDocument, revision: 1 });
  previousDocument.connections[0].to.pop();
  const document = fixture();
  document.modules[0].label = 'Updated geometry';
  const fresh = await run({ document, revision: 2, paintOnly: true });
  release();
  const oldReply = await older;
  assert.equal(oldReply.layout.connections[0].editorLabel, 'Source.out to SinkA.in, SinkB.in');
  document.modules[0].style = { fillColor: '#abc' };
  const data = { document, revision: 3, paintOnly: true };
  assert.ok(fresh.layout);
  assert.deepEqual(await run(data), await runLayoutJob(data));
  assert.equal(calls, 2);
});
test('worker entry uses an event listener and can process sequential messages', async (t) => {
  const previous = globalThis.self,
    listeners = [],
    messages = [];
  globalThis.self = {
    addEventListener(type, listener) {
      assert.equal(type, 'message');
      listeners.push(listener);
    },
    postMessage(data) {
      messages.push(data);
    },
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.self;
    else globalThis.self = previous;
  });
  await import('../../../src/editor/blockchart/workers/layout.js');
  assert.equal(listeners.length, 1);
  await listeners[0]({ data: {} });
  assert.equal(messages.length, 0);
  for (const revision of [1, 2]) await listeners[0]({ data: { document: fixture(), revision } });
  assert.deepEqual(
    messages.map((m) => m.revision),
    [1, 2],
  );
  assert.ok(messages.every((m) => m.svg));
});
