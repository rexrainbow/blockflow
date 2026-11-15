import test from 'node:test';
import assert from 'node:assert/strict';
import { routeOrthogonal } from '../../src/lib/shared/orthogonal.js';
import { routeFixed } from '../../src/lib/blockchart/layout/fixed.js';
import { connectionStyle } from '../../src/lib/blockchart/styles.js';
import { applyConnectionArrows } from '../../src/lib/blockchart/layout/arrows.js';
const vector = (a, b) => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });
function metrics(points) {
  let length = 0,
    bends = 0,
    previous;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      distance = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (distance < 1e-6) continue;
    assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6, 'orthogonal segment');
    const next = vector(a, b);
    if (previous) {
      assert.notEqual(previous.x * next.x + previous.y * next.y, -1, 'no immediate reversal over a stub');
      if (previous.x !== next.x || previous.y !== next.y) bends++;
    }
    previous = next;
    length += distance;
  }
  return { length, bends };
}
const crosses = (a, b, r) =>
  a.y === b.y
    ? a.y > r.y && a.y < r.y + r.height && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width
    : a.x > r.x && a.x < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height;
for (const departure of [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
])
  for (const turn of [-1, 1]) {
    const arrival = { x: -departure.y * turn, y: departure.x * turn };
    test(`complete-route turns include endpoint directions ${JSON.stringify(departure)} -> ${JSON.stringify(arrival)}`, () => {
      const source = { x: 0, y: 0 },
        target = { x: 100 * departure.x + 70 * arrival.x, y: 100 * departure.y + 70 * arrival.y };
      const start = { x: 6 * departure.x, y: 6 * departure.y },
        end = { x: target.x - 9 * arrival.x, y: target.y - 9 * arrival.y };
      const route = routeOrthogonal(start, end, [], undefined, 20, [], {
        startDirection: departure,
        endDirection: arrival,
      });
      assert.deepEqual(route[0], start);
      assert.deepEqual(route.at(-1), end);
      assert.deepEqual(metrics([source, ...route, target]), { length: 170, bends: 1 });
    });
  }
test('endpoint scoring retains obstacle clearance while choosing a necessary detour', () => {
  const obstacle = { x: -5, y: 30, width: 10, height: 40 };
  const path = [
    { x: 0, y: 0 },
    ...routeOrthogonal({ x: 0, y: 6 }, { x: 100, y: 91 }, [obstacle], undefined, 20, [], {
      startDirection: { x: 0, y: 1 },
      endDirection: { x: 0, y: 1 },
    }),
    { x: 100, y: 100 },
  ];
  assert.deepEqual(metrics(path), { length: 200, bends: 2 });
  for (let i = 1; i < path.length; i++) assert.ok(!crosses(path[i - 1], path[i], obstacle));
});
test('endpoint directions do not permit escaping a blocked routing scope', () => {
  assert.throws(
    () =>
      routeOrthogonal(
        { x: 0, y: 6 },
        { x: 100, y: 91 },
        [{ x: 30, y: -1, width: 40, height: 102 }],
        { x: 0, y: 0, width: 100, height: 100 },
        20,
        [],
        { startDirection: { x: 0, y: 1 }, endDirection: { x: 0, y: 1 } },
      ),
    /No clear orthogonal route/,
  );
});
test('coincident escape points with opposite endpoint directions require a loop', () => {
  const route = routeOrthogonal({ x: 0, y: 0 }, { x: 0, y: 0 }, [], undefined, 20, [], {
    startDirection: { x: 1, y: 0 },
    endDirection: { x: -1, y: 0 },
  });
  assert.ok(metrics([{ x: -6, y: 0 }, ...route, { x: -9, y: 0 }]).bends >= 4);
  assert.ok(route.length > 1);
});
for (const direction of ['down', 'right'])
  test(`fixed routing counts both stubs instead of hugging a decorative frame (${direction})`, () => {
    const swap = direction === 'right',
      point = (p) => (swap ? { x: p.y, y: p.x } : { ...p }),
      box = (b) => (swap ? { ...b, x: b.y, y: b.x, width: b.height, height: b.width } : { ...b });
    const target = {
      ...box({ id: 'FSM', x: 80, y: 80, width: 60, height: 40 }),
      ports: [{ id: 'control', ...point({ x: 140, y: 100 }), side: swap ? 'bottom' : 'right' }],
    };
    const frame = {
      ...box({ id: 'Frame', x: 70, y: 20, width: 90, height: 140 }),
      members: ['FSM'],
      ports: [],
      portMode: 'direct',
    };
    const terminal = {
      id: 'Control',
      direction: 'input',
      ...box({ x: 180, y: -30, width: 40, height: 30 }),
      anchor: point({ x: 200, y: 0 }),
      labelBounds: box({ x: 180, y: -30, width: 40, height: 30 }),
      style: { hidden: false },
    };
    const model = {
      layout: { direction, layerSpacing: 45 },
      modules: [{ id: 'FSM' }],
      groups: [{ id: 'Frame', members: ['FSM'] }],
      connections: [
        {
          id: 'Run',
          source: { terminal: 'Control' },
          target: { moduleId: 'FSM', portId: 'control' },
          constraint: false,
          style: { ...connectionStyle(null), endArrow: 'triangle' },
        },
      ],
    };
    const result = {
      modules: [target],
      groups: [frame],
      terminals: [terminal],
      connections: [
        { id: 'Run', width: null, style: { ...connectionStyle(null), endArrow: 'triangle' }, sections: [] },
      ],
    };
    const stable = structuredClone({
      modules: result.modules,
      groups: result.groups,
      terminals: result.terminals,
    });
    routeFixed(result, model);
    applyConnectionArrows(result.connections);
    const route = result.connections[0];
    assert.deepEqual(route.sections[0].points, [
      point({ x: 200, y: 0 }),
      point({ x: 200, y: 100 }),
      point({ x: 140, y: 100 }),
    ]);
    assert.deepEqual(metrics(route.sections[0].points), { length: 160, bends: 1 });
    assert.deepEqual(route.arrow.points[0], point({ x: 140, y: 100 }));
    assert.deepEqual({ modules: result.modules, groups: result.groups, terminals: result.terminals }, stable);
  });
for (const direction of ['down', 'right'])
  test(`short aligned receiver attachment stays straight when preferred escapes overlap (${direction})`, () => {
    const swap = direction === 'right',
      point = (p) => (swap ? { x: p.y, y: p.x } : { ...p }),
      box = (b) => (swap ? { ...b, x: b.y, y: b.x, width: b.height, height: b.width } : { ...b });
    const label = {
      ...box({ id: 'Name', x: 0, y: 0, width: 20, height: 20 }),
      ports: [{ id: 'out', ...point({ x: 10, y: 20 }), side: swap ? 'right' : 'bottom' }],
    };
    const concat = {
      ...box({ id: 'Join', type: 'concat', x: 0, y: 25.5, width: 100, height: 18 }),
      ports: [{ id: 'in', ...point({ x: 10, y: 28 }), side: swap ? 'left' : 'top' }],
    };
    const ref = {
      id: 'Tail',
      source: { moduleId: 'Name', portId: 'out' },
      target: { moduleId: 'Join', portId: 'in' },
      _signalTail: true,
      style: { ...connectionStyle(null), endArrow: 'triangle' },
    };
    const result = {
      modules: [label, concat],
      groups: [],
      terminals: [],
      connections: [{ id: 'Tail', width: null, style: ref.style, sections: [] }],
    };
    routeFixed(result, {
      layout: { direction, layerSpacing: 30 },
      modules: [{ id: 'Name' }, { id: 'Join' }],
      groups: [],
      connections: [ref],
    });
    applyConnectionArrows(result.connections);
    assert.deepEqual(result.connections[0].sections[0].points, [
      point({ x: 10, y: 20 }),
      point({ x: 10, y: 28 }),
    ]);
    assert.deepEqual(result.connections[0].arrow.points[0], point({ x: 10, y: 28 }));
  });
test('a clear-facing Terminal connection still detours around a foreign Terminal label', () => {
  const target = {
    id: 'Target',
    x: 100,
    y: -10,
    width: 40,
    height: 20,
    ports: [{ id: 'in', x: 100, y: 0, side: 'left' }],
  };
  const terminal = {
    id: 'Start',
    direction: 'input',
    anchor: { x: 0, y: 0 },
    labelBounds: { x: -30, y: -5, width: 30, height: 10 },
    style: { hidden: false },
  };
  const annotation = {
    id: 'Other',
    direction: 'output',
    anchor: { x: 40, y: 0 },
    labelBounds: { x: 40, y: -5, width: 20, height: 10 },
    style: { hidden: false },
  };
  const ref = {
    id: 'Route',
    source: { terminal: 'Start' },
    target: { moduleId: 'Target', portId: 'in' },
    style: connectionStyle(null),
  };
  const result = {
    modules: [target],
    groups: [],
    terminals: [terminal, annotation],
    connections: [{ id: 'Route', width: null, style: ref.style, sections: [] }],
  };
  routeFixed(result, {
    layout: { direction: 'right', layerSpacing: 30 },
    modules: [{ id: 'Target' }],
    groups: [],
    connections: [ref],
  });
  const path = result.connections[0].sections[0].points;
  assert.ok(metrics(path).bends >= 2, 'the foreign label blocks the direct span');
  for (let i = 1; i < path.length; i++) assert.ok(!crosses(path[i - 1], path[i], annotation.labelBounds));
});
