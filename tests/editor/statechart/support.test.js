import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import * as c from '../../../src/editor/statechart/commands.js';
import { runLayoutJob } from '../../../src/editor/statechart/layout-job.js';
import { LayoutService } from '../../../src/editor/statechart/services/layout.js';
import { convertStatechart } from '../../../src/agent-kit/statechart-converter.js';
test('immutable state/transition edits retain identity and validate failures atomically', () => {
  const raw = c.addState(c.emptyDocument(), { label: 'Work' }),
    before = structuredClone(raw);
  let next = c.addTransition(raw, 'Idle', 'State1', { label: 'go' });
  next = c.addTransition(next, 'State1', 'Idle');
  next = c.renameState(next, 'State1', 'Work');
  assert.equal(next.transitions[0].to, 'Work');
  next = c.reconnectTransition(next, 'transition_2', 'to', 'Work');
  assert.equal(next.transitions[1].to, 'Work');
  next = c.removeTransition(next, 'transition_1');
  assert.equal(next.transitions[0].id, 'transition_2');
  next = c.removeState(next, 'Work');
  assert.equal(next.transitions.length, 0);
  assert.equal(next.states.length, 1);
  assert.deepEqual(raw, before);
  for (const fn of [
    () => c.removeState(c.emptyDocument(), 'Idle'),
    () => c.renameState(raw, 'Idle', 'State1'),
    () => c.addTransition(raw, 'Unknown', 'Idle'),
    () => c.reconnectTransition(raw, 'missing', 'wrong', 'Idle'),
    () => c.removeTransition(raw, 'missing'),
  ])
    assert.throws(fn, (e) => typeof e.path === 'string');
});
test('job bytes equal converter and service preserves generic lifecycle', async () => {
  const document = c.addTransition(c.addState(c.emptyDocument()), 'Idle', 'State1'),
    before = structuredClone(document);
  const reply = await runLayoutJob({ document, revision: 7 });
  assert.equal(reply.svg, (await convertStatechart(document)).text);
  assert.equal(reply.revision, 7);
  assert.equal(reply.layout.transitions[0].editorKey, 'transition_1');
  assert.deepEqual(document, before);
  assert.equal(await runLayoutJob(null), null);
  const bad = await runLayoutJob({ document: { ...document, states: [] }, revision: 8 });
  assert.equal(bad.path, 'states');
  const legacy = { ...document, layout: { loopSide: 'auto' } };
  const rejected = await runLayoutJob({ document: legacy, revision: 9 });
  assert.equal(rejected.revision, 9);
  assert.equal(rejected.path, 'layout.loopSide');
  assert.equal(rejected.layout, undefined);
  const s = new LayoutService(() => {});
  assert.equal(s.debounceMs, 180);
  s.dispose();
  assert.throws(() => s.request(document), /disposed/);
});
test('Statechart Worker accepts successive messages independently of ELK onmessage', async (t) => {
  const old = globalThis.self;
  let listener;
  const replies = [];
  globalThis.self = {
    addEventListener(type, fn) {
      assert.equal(type, 'message');
      listener = fn;
    },
    postMessage(reply) {
      replies.push(reply);
    },
  };
  t.after(() => {
    if (old === undefined) delete globalThis.self;
    else globalThis.self = old;
  });
  await import('../../../src/editor/statechart/workers/layout.js');
  for (const revision of [1, 2]) await listener({ data: { document: c.emptyDocument(), revision } });
  assert.deepEqual(
    replies.map((r) => r.revision),
    [1, 2],
  );
  assert.ok(replies.every((r) => r.svg.startsWith('<svg')));
});
for (const offline of [false, true])
  test(`Statechart ${offline ? 'inline' : 'module'} Worker bundles without GUI imports`, async () => {
    const result = await build({
      configFile: false,
      logLevel: 'error',
      build: {
        write: false,
        minify: false,
        lib: {
          entry: fileURLToPath(
            new URL(
              `../../../src/editor/statechart/services/worker-factory${offline ? '.offline' : ''}.js`,
              import.meta.url,
            ),
          ),
          formats: ['es'],
        },
      },
    });
    const output = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output),
      assets = output.filter((o) => o.type === 'asset');
    if (offline) {
      assert.equal(assets.length, 0);
      assert.match(output.find((o) => o.type === 'chunk').code, /createObjectURL/);
    } else {
      assert.equal(assets.length, 1);
      assert.match(String(assets[0].source), /editorKey/);
    }
  });
