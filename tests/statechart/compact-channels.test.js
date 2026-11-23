import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStatechartModel, graphDocument } from '../../src/lib/statechart/model.js';
import { layoutStatechart, parseMermaid } from '../../src/lib/statechart/index.js';
import { createFlowchartModel } from '../../src/lib/flowchart/model.js';
import { checkedPlacement } from '../../src/lib/statechart/layout.js';
import { placeStatechart, labelConflicts } from '../../src/lib/statechart/label-layout.js';
import { compactStatechartChannels } from '../../src/lib/statechart/compact-channels.js';
import { routeQuality, topologyPlans } from '../../src/lib/statechart/topology.js';

const source = JSON.parse(
  await readFile(new URL('../../examples/statechart/task-controller.json', import.meta.url), 'utf8'),
);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
async function baseline(raw) {
  const model = createStatechartModel(raw),
    graph = createFlowchartModel(graphDocument(model));
  return checkedPlacement(model, graph, placeStatechart, topologyPlans(model, graph), (layout) => layout);
}

function safety(before, after) {
  assert.deepEqual(labelConflicts(after), []);
  const old = routeQuality(before),
    next = routeQuality(after);
  for (const key of ['overlaps', 'crossings', 'overlapLength', 'bends', 'length', 'area'])
    assert.ok(next[key] <= old[key] + 1e-5, `${key} worsened`);
  assert.ok(after.width <= before.width + 1e-5);
  assert.ok(after.height <= before.height + 1e-5);
  assert.deepEqual(
    after.states.map((s) => s.id),
    before.states.map((s) => s.id),
  );
  for (let i = 0; i < before.states.length; i++) {
    const a = before.states[i],
      b = after.states[i];
    assert.equal(a.width, b.width);
    assert.equal(a.height, b.height);
    for (const other of before.states) {
      const moved = after.states.find((s) => s.id === other.id);
      assert.equal(Math.sign(a.x - other.x), Math.sign(b.x - moved.x));
      assert.equal(Math.sign(a.y - other.y), Math.sign(b.y - moved.y));
    }
  }
  for (let i = 0; i < before.transitions.length; i++) {
    const a = before.transitions[i],
      b = after.transitions[i];
    for (const key of ['id', 'from', 'to', 'fromSide', 'toSide', 'label', 'displayLabel'])
      assert.equal(b[key], a[key]);
    if (a.labelBounds) {
      near(a.labelBounds.width, b.labelBounds.width);
      near(a.labelBounds.height, b.labelBounds.height);
    }
    const ends = (edge) => [edge.sections[0].points[0], edge.sections.at(-1).points.at(-1)];
    for (const [j, id] of [a.from, a.to].entries()) {
      const oldState = before.states.find((s) => s.id === id),
        nextState = after.states.find((s) => s.id === id);
      near(ends(a)[j].x - oldState.x, ends(b)[j].x - nextState.x);
      near(ends(a)[j].y - oldState.y, ends(b)[j].y - nextState.y);
    }
  }
}

test('Batch task controller staggers labels, narrows channels and retains routing quality', async () => {
  const input = structuredClone(source),
    saved = structuredClone(input);
  const old = await baseline(input),
    snapshot = structuredClone(old);
  const result = await layoutStatechart(input);
  safety(old, result);
  assert.ok(result.width < old.width * 0.9, 'material width reduction');
  assert.equal(result.height, old.height);
  assert.equal(routeQuality(result).crossings, 0);
  const a = result.transitions.find((e) => e.id === 'transition_2').labelBounds;
  const b = result.transitions.find((e) => e.id === 'transition_6').labelBounds;
  assert.ok(a.x < b.x + b.width && b.x < a.x + a.width, 'X projections should overlap');
  assert.ok(a.y + a.height <= b.y || b.y + b.height <= a.y, 'Y bands must be separate');
  assert.deepEqual(input, saved);
  assert.deepEqual(old, snapshot);
  assert.deepEqual(compactStatechartChannels(old), result);
  assert.deepEqual(await layoutStatechart(input), result);
});

for (const direction of ['up', 'left', 'right']) {
  test(`channel compaction preserves ownership and endpoint sides (${direction})`, async () => {
    const input = structuredClone(source);
    input.layout.direction = direction;
    input.transitions[0].fromSide = 'left';
    const saved = structuredClone(input),
      old = await baseline(input),
      next = await layoutStatechart(input);
    safety(old, next);
    assert.equal(next.transitions[0].fromSide, 'left');
    assert.deepEqual(input, saved);
  });
}

test('caption bounds and small graphs remain valid without forced compression', async () => {
  for (const direction of ['down', 'right']) {
    const raw = parseMermaid('stateDiagram-v2\nA --> B: ready\nB --> A: retry');
    raw.layout = { direction };
    raw.diagram.caption = 'A deliberately wide caption that must remain inside the exported chart.';
    const old = await baseline(raw),
      next = await layoutStatechart(raw);
    safety(old, next);
    assert.ok(next.caption.position.x >= 0 && next.caption.position.y < next.height);
  }
  const empty = { states: [], transitions: [], width: 20, height: 20 };
  assert.equal(compactStatechartChannels(empty), empty);
});

test('no removable channel gap returns the original layout unchanged', async () => {
  const old = await baseline(parseMermaid('stateDiagram-v2\nA --> B: ready'));
  const saved = structuredClone(old);
  assert.equal(compactStatechartChannels(old), old);
  assert.deepEqual(old, saved);
});

test('unequal multiline labels and thick strokes retain ownership during compaction', async () => {
  const raw = structuredClone(source);
  raw.diagram.style.transition.fontSize = 15;
  raw.diagram.style.transition.strokeWidth = 5;
  raw.layout.labelMaxWidth = 190;
  raw.transitions[1].label = 'Ready && resources available\ncontinue the batch';
  const old = await baseline(raw),
    next = await layoutStatechart(raw);
  safety(old, next);
  assert.equal(next.transitions[1].label, raw.transitions[1].label);
});

test('configured spacing between states in the same row is retained', async () => {
  const raw = structuredClone(source);
  raw.layout.nodeSpacing = 180;
  const old = await baseline(raw),
    next = await layoutStatechart(raw);
  safety(old, next);
  for (let i = 0; i < next.states.length; i++)
    for (const b of next.states.slice(i + 1)) {
      const a = next.states[i];
      if (a.y >= b.y + b.height || b.y >= a.y + a.height) continue;
      const gap = a.x < b.x ? b.x - a.x - a.width : a.x - b.x - b.width;
      assert.ok(gap >= 180 - 1e-5);
    }
});
