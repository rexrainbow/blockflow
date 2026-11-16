import test from 'node:test';
import assert from 'node:assert/strict';
import { runLayoutJob } from '../../../src/editor/flowchart/layout-job.js';
import { LayoutService } from '../../../src/editor/flowchart/services/layout.js';
import { parseMermaid } from '../../../src/lib/flowchart/index.js';
import { convertFlowchart } from '../../../src/agent-kit/flowchart-converter.js';
import { readFile } from 'node:fs/promises';

test('job SVG equals converter bytes and hit identity follows authoring IDs without mutation', async () => {
  const document = parseMermaid('flowchart TD\n subgraph G [Work]\n A --> B\n end\n B --> A');
  const before = structuredClone(document);
  const reply = await runLayoutJob({ document, revision: 9 });
  assert.equal(reply.error, undefined);
  assert.equal(reply.revision, 9);
  assert.equal(reply.svg, (await convertFlowchart(document, { format: 'svg' })).text);
  assert.deepEqual(document, before);
  assert.deepEqual(
    reply.layout.edges.map((e) => e.editorKey),
    document.edges.map((e, i) => e.id ?? `edge_${i + 1}`),
  );
  assert.deepEqual(new Set(reply.layout.nodes.map((n) => n.id)), new Set(['A', 'B']));
  assert.equal(reply.layout.groups[0].id, 'G');
});
test('job ignores malformed envelopes and reports domain validation errors with revision/path', async () => {
  for (const data of [null, {}, { document: {}, revision: 1.5 }])
    assert.equal(await runLayoutJob(data), null);
  const bad = await runLayoutJob({
    document: { version: 1, diagram: { name: 'Bad' }, nodes: [], edges: [] },
    revision: 2,
  });
  assert.equal(bad.revision, 2);
  assert.equal(bad.path, 'nodes');
  assert.ok(bad.error);
  const wrong = await runLayoutJob({
    document: { version: 1, diagram: { name: 'Block' }, modules: [], connections: [] },
    revision: 3,
  });
  assert.equal(wrong.path, 'document.modules');
});
test('example with notes/groups/loops matches converter for all four directions', async () => {
  const source = JSON.parse(
    await readFile(new URL('../../../examples/flowchart/batch-update.json', import.meta.url), 'utf8'),
  );
  for (const direction of ['down', 'right', 'up', 'left']) {
    const document = structuredClone(source);
    document.layout = { ...document.layout, direction, loopSide: 'auto' };
    const reply = await runLayoutJob({ document, revision: 1 });
    assert.equal(reply.error, undefined);
    assert.equal(reply.svg, (await convertFlowchart(document, { format: 'svg' })).text);
  }
});
test('Flowchart service injects only its domain payload and supports session disposal', () => {
  const s = new LayoutService(() => {});
  assert.deepEqual(s.createRequest({ nodes: [] }, { rootGroupId: 'Ignored' }, 5), {
    document: { nodes: [] },
    revision: 5,
  });
  assert.equal(s.debounceMs, 180);
  s.dispose();
  assert.throws(() => s.request({}), /disposed/);
});
test('Worker listener handles repeated jobs and ignores malformed messages', async (t) => {
  const previous = globalThis.self,
    replies = [];
  let listener;
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
    if (previous === undefined) delete globalThis.self;
    else globalThis.self = previous;
  });
  await import('../../../src/editor/flowchart/workers/layout.js');
  await listener({ data: null });
  for (const revision of [1, 2])
    await listener({ data: { document: parseMermaid('flowchart LR\n A --> B'), revision } });
  assert.deepEqual(
    replies.map((r) => r.revision),
    [1, 2],
  );
  assert.ok(replies.every((r) => r.svg.startsWith('<svg')));
});
