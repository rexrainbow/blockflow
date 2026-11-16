import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMermaid, layoutFlowchart } from '../../src/lib/flowchart/index.js';
import { routeFlowEdge } from '../../src/lib/flowchart/layout/loop-routing.js';
const fixture = () =>
  parseMermaid(
    'flowchart TD\nA["Write"] --> B{"More?"}\nB -->|Yes| A\nB -->|No| C["Commit"]\nN@{shape:doc,label:"A wide attached explanation with several details"}\nA -.- N',
  );
const length = (e) => {
  const p = e.sections[0].points;
  return p.slice(1).reduce((s, v, i) => s + Math.abs(v.x - p[i].x) + Math.abs(v.y - p[i].y), 0);
};
const crosses = (a, b, r) =>
  a.x === b.x
    ? a.x > r.x + 1e-6 &&
      a.x < r.x + r.width - 1e-6 &&
      Math.max(a.y, b.y) > r.y + 1e-6 &&
      Math.min(a.y, b.y) < r.y + r.height - 1e-6
    : a.y > r.y + 1e-6 &&
      a.y < r.y + r.height - 1e-6 &&
      Math.max(a.x, b.x) > r.x + 1e-6 &&
      Math.min(a.x, b.x) < r.x + r.width - 1e-6;
function clear(layout) {
  for (const e of layout.edges) {
    const p = e.sections[0].points;
    for (let i = 1; i < p.length; i++)
      for (const n of layout.nodes) {
        if (n.id === e.from || n.id === e.to) continue;
        assert.ok(!crosses(p[i - 1], p[i], n), `${e.id} crosses ${n.id}`);
      }
  }
}
test('auto avoids endpoint notes on either side, shortens the loop and preserves the input', async () => {
  for (const noteSide of ['right', 'left']) {
    const d = fixture();
    d.nodes.find((n) => n.id === 'N').side = noteSide;
    const before = structuredClone(d);
    const auto = await layoutFlowchart(d),
      edge = auto.edges.find((e) => e.label === 'Yes');
    const fixed = await layoutFlowchart({ ...d, layout: { ...d.layout, loopSide: noteSide } });
    assert.equal(edge.fromSide, noteSide === 'right' ? 'left' : 'right');
    assert.equal(edge.toSide, edge.fromSide);
    assert.ok(length(edge) < length(fixed.edges.find((e) => e.label === 'Yes')) * 0.6);
    assert.equal(edge.sections[0].points.length, 4);
    assert.deepEqual(d, before);
    clear(auto);
    assert.deepEqual(await layoutFlowchart(d), auto);
  }
});
test('auto keeps grouped loops inside their scope in all directions; explicit hints survive', async () => {
  for (const direction of ['down', 'up', 'right', 'left']) {
    const d = fixture();
    d.layout.direction = direction;
    d.groups = [{ id: 'G', members: d.nodes.map((n) => n.id) }];
    const auto = await layoutFlowchart(d),
      g = auto.groups[0],
      loop = auto.edges.find((e) => e.label === 'Yes');
    clear(auto);
    for (const p of loop.sections[0].points)
      assert.ok(p.x >= g.x && p.x <= g.x + g.width && p.y >= g.y && p.y <= g.y + g.height);
    const side = ['down', 'up'].includes(direction) ? 'left' : 'top';
    const edge = d.edges.find((e) => e.label === 'Yes');
    edge.fromSide = side;
    edge.toSide = side;
    const pinned = await layoutFlowchart(d),
      pin = pinned.edges.find((e) => e.label === 'Yes');
    assert.equal(pin.fromSide, side);
    assert.equal(pin.toSide, side);
    clear(pinned);
  }
});
test('local automatic corridors ignore distant extents while retaining real obstacles', () => {
  const a = { id: 'A', x: 0, y: 100, width: 80, height: 40 },
    b = { id: 'B', x: 0, y: 0, width: 80, height: 40 };
  const far = [
    { id: 'FarRight', x: 2000, y: 1000, width: 200, height: 40 },
    { id: 'FarLeft', x: -2000, y: 1000, width: 200, height: 40 },
  ];
  function route(nodes) {
    return routeFlowEdge({
      edge: { id: 'loop', kind: 'loop', from: 'A', to: 'B', style: { strokeWidth: 1 } },
      a,
      b,
      side: { from: 'right', to: 'right' },
      loopSide: 'right',
      auto: true,
      vertical: true,
      forward: 'bottom',
      nodes,
      groups: [],
      localGroups: [],
      obstacles: nodes.map((n) => ({
        ...n,
        x: n.x - 5,
        y: n.y - 5,
        width: n.width + 10,
        height: n.height + 10,
      })),
      lanes: new Map(),
      clearance: 60,
    });
  }
  const base = route([a, b]);
  assert.deepEqual(route([a, b, ...far]).points, base.points);
  const obstacle = { id: 'Nearby', x: 90, y: 45, width: 100, height: 25 };
  const changed = route([a, b, ...far, obstacle]);
  assert.equal(changed.side.from, 'left');
  for (let i = 1; i < changed.points.length; i++)
    assert.ok(!crosses(changed.points[i - 1], changed.points[i], obstacle));
  const blockedRight = { id: 'BlockedRight', x: 85, y: 90, width: 40, height: 60 };
  assert.equal(route([a, b, blockedRight]).side.from, 'left');
  const blockedLeft = { id: 'BlockedLeft', x: -45, y: 90, width: 40, height: 60 };
  assert.throws(() => route([a, b, blockedRight, blockedLeft]), /obstructed/);
});
