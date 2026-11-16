import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import {
  parseMermaid,
  createStatechartModel,
  layoutStatechart,
  renderStatechartSvg,
  STATECHART_LAYOUT_DEFAULTS,
} from '../../src/lib/statechart/index.js';
import { wrapCondition, labelConflicts } from '../../src/lib/statechart/label-layout.js';
import { textSize } from '../../src/lib/shared/text.js';
import { checkedPlacement } from '../../src/lib/statechart/layout.js';
import { createFlowchartModel, layoutFlowchart } from '../../src/lib/flowchart/index.js';

const source = await readFile(new URL('../fixtures/statechart/timer-fsm.mmd', import.meta.url), 'utf8');
const schema = JSON.parse(
  await readFile(new URL('../../schema/statechart.schema.json', import.meta.url), 'utf8'),
);
const validate = new Ajv({ strict: true }).compile(schema);
const parts = (e) => e.sections.flatMap((s) => s.points.slice(1).map((b, i) => [s.points[i], b]));
// Independent check against actual returned rectangles and paths, not rendering masks.
function enters([a, b], r) {
  return Math.abs(a.y - b.y) < 1e-6
    ? a.y > r.y + 1e-6 &&
        a.y < r.y + r.height - 1e-6 &&
        Math.max(a.x, b.x) > r.x + 1e-6 &&
        Math.min(a.x, b.x) < r.x + r.width - 1e-6
    : a.x > r.x + 1e-6 &&
        a.x < r.x + r.width - 1e-6 &&
        Math.max(a.y, b.y) > r.y + 1e-6 &&
        Math.min(a.y, b.y) < r.y + r.height - 1e-6;
}
function ownership(layout) {
  for (const label of layout.transitions.filter((t) => t.labelBounds)) {
    for (const edge of layout.transitions)
      assert.equal(
        parts(edge).filter((p) => enters(p, label.labelBounds)).length,
        edge.id === label.id ? 1 : 0,
        `${edge.id} versus ${label.id}`,
      );
    for (const state of layout.states)
      assert.ok(
        !(
          label.labelBounds.x < state.x + state.width &&
          label.labelBounds.x + label.labelBounds.width > state.x &&
          label.labelBounds.y < state.y + state.height &&
          label.labelBounds.y + label.labelBounds.height > state.y
        ),
      );
  }
  for (const edge of layout.transitions)
    for (const [a, b] of parts(edge))
      assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6, 'orthogonal wire');
  assert.deepEqual(labelConflicts(layout), []);
}
test('condition wrapping respects explicit lines and Unicode without changing visible tokens', () => {
  const text = 'Is last-cycle && continue-mode && Has Initial-delay\n輸出完成 && ready',
    style = { fontSize: 11 };
  const wrapped = wrapCondition(text, style, 160);
  assert.equal(wrapped.replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.ok(wrapped.split('\n').every((row) => textSize(row, style).width <= 160));
  assert.equal(wrapCondition('Ready   ', style, 36), 'Read\ny');
  assert.equal(wrapCondition('A\n\nB', style, 160), 'A\n\nB');
});
test('Timer labels reserve their own routes, wrap display text and stagger real states without virtual-node leakage', async () => {
  const raw = parseMermaid(source),
    before = structuredClone(raw),
    layout = await layoutStatechart(raw);
  assert.deepEqual(raw, before);
  ownership(layout);
  assert.deepEqual(layout.states.map((n) => n.id).sort(), raw.states.map((n) => n.id).sort());
  assert.equal(layout.transitions.length, raw.transitions.length);
  assert.ok(new Set(layout.states.filter((s) => s.kind === 'state').map((s) => s.x)).size > 1);
  assert.ok(layout.transitions.some((t) => t.displayLabel?.includes('\n')));
  for (let i = 0; i < raw.transitions.length; i++) {
    assert.equal(layout.transitions[i].label, raw.transitions[i].label);
    assert.equal(layout.transitions[i].id, raw.transitions[i].id ?? `transition_${i + 1}`);
  }
  assert.deepEqual(await layoutStatechart(raw), layout);
  assert.doesNotMatch(renderStatechartSvg(layout), /@statechart:label:|@statechart:edge:/);
});
test('all flow directions and label widths retain ownership, fixed sides and independent parallel/self transitions', async () => {
  for (const direction of ['down', 'up', 'right', 'left']) {
    const raw = parseMermaid(source);
    raw.layout = { direction, labelMaxWidth: 150 };
    const endpointSide = ['down', 'up'].includes(direction) ? 'left' : 'top';
    raw.transitions.push({
      from: 'HI',
      to: 'HI',
      label: 'repeat while enabled && waiting',
      fromSide: endpointSide,
      toSide: ['down', 'right'].includes(direction) ? 'top' : 'bottom',
    });
    const layout = await layoutStatechart(raw);
    ownership(layout);
    const self = layout.transitions.at(-1);
    assert.equal(self.fromSide, raw.transitions.at(-1).fromSide);
    assert.equal(self.toSide, raw.transitions.at(-1).toSide);
    const parallel = layout.transitions.filter((t) => t.from === 'LO' && t.to === 'HI');
    assert.equal(parallel.length, 2);
    assert.notDeepEqual(parallel[0].sections, parallel[1].sections);
    const wider = await layoutStatechart({ ...raw, layout: { ...raw.layout, labelMaxWidth: 360 } });
    ownership(wider);
    assert.equal(wider.transitions[0].label, layout.transitions[0].label);
  }
});
test('labelMaxWidth is a validated state-only option and graph lowering does not leak it into Flowchart', async () => {
  assert.equal(
    schema.properties.layout.properties.labelMaxWidth.default,
    STATECHART_LAYOUT_DEFAULTS.labelMaxWidth,
  );
  const raw = parseMermaid(source);
  for (const value of [0, -1, null, '240', false]) {
    raw.layout.labelMaxWidth = value;
    assert.equal(validate(raw), false);
    assert.throws(
      () => createStatechartModel(raw),
      (e) => e.path === 'layout.labelMaxWidth',
    );
  }
  raw.layout.labelMaxWidth = 200;
  assert.equal(validate(raw), true);
  assert.doesNotThrow(() => createStatechartModel(raw));
  ownership(await layoutStatechart(raw));
});

test('Statechart rejects every authored global loopSide while Flowchart retains its fixed-side contract', async () => {
  for (const loopSide of ['auto', 'left', 'right', 'top', 'bottom', null]) {
    const raw = parseMermaid(source);
    raw.layout.loopSide = loopSide;
    const before = structuredClone(raw);
    assert.equal(validate(raw), false);
    assert.throws(
      () => createStatechartModel(raw),
      (e) => e.path === 'layout.loopSide',
    );
    await assert.rejects(layoutStatechart(raw), (e) => e.path === 'layout.loopSide');
    assert.deepEqual(raw, before);
  }
  const flow = {
    version: 1,
    diagram: { name: 'Fixed Flowchart return' },
    layout: { direction: 'down', loopSide: 'left' },
    nodes: [{ id: 'A' }, { id: 'B' }],
    edges: [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'A' },
    ],
  };
  createFlowchartModel(flow);
  const layout = await layoutFlowchart(flow),
    loop = layout.edges.find((e) => e.kind === 'loop');
  assert.equal(loop.fromSide, 'left');
  assert.equal(loop.toSide, 'left');
});
test('ownership detection rejects foreign wires even when an opaque background would hide them', async () => {
  const layout = await layoutStatechart(parseMermaid('stateDiagram-v2\nA --> B: guarded transition'));
  const label = layout.transitions[0],
    box = label.labelBounds;
  layout.transitions.push({
    id: 'foreign',
    from: 'A',
    to: 'B',
    style: { strokeWidth: 1 },
    sections: [
      {
        points: [
          { x: box.x - 10, y: box.y + box.height / 2 },
          { x: box.x + box.width + 10, y: box.y + box.height / 2 },
        ],
      },
    ],
  });
  assert.ok(labelConflicts(layout).some((c) => c.labelId === label.id && c.edgeId === 'foreign'));
});

test('conflicting reservations trigger bounded local spacing attempts and a path-bearing failure', async () => {
  const raw = parseMermaid('stateDiagram-v2\nA --> B: guarded transition'),
    model = createStatechartModel(raw);
  const good = await layoutStatechart(raw),
    bad = structuredClone(good),
    label = bad.transitions[0],
    box = label.labelBounds;
  bad.transitions.push({
    id: 'foreign',
    style: { strokeWidth: 1 },
    sections: [
      {
        points: [
          { x: box.x - 10, y: box.y + box.height / 2 },
          { x: box.x + box.width + 10, y: box.y + box.height / 2 },
        ],
      },
    ],
  });
  const attempts = [];
  const recovered = await checkedPlacement(model, {}, async (_model, _graph, scale) => {
    attempts.push(scale);
    return scale === 1 ? bad : good;
  });
  assert.equal(recovered, good);
  assert.deepEqual(attempts, [1, 1.5]);
  attempts.length = 0;
  await assert.rejects(
    checkedPlacement(model, {}, async (_model, _graph, scale) => {
      attempts.push(scale);
      return bad;
    }),
    (e) => e.name === 'StatechartLayoutError' && e.path === 'transitions[0].label',
  );
  assert.deepEqual(attempts, [1, 1.5, 2.25]);
});
