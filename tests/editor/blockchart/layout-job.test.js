import test from 'node:test';
import assert from 'node:assert/strict';
import { runLayoutJob } from '../../../src/editor/blockchart/layout-job.js';
import { LayoutService } from '../../../src/editor/blockchart/services/layout.js';
import * as commands from '../../../src/editor/blockchart/commands.js';
import { renderSvg } from '../../../src/lib/blockchart/index.js';
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
  s.dispose();
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
