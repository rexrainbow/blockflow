import test from 'node:test';
import assert from 'node:assert/strict';
import { containerEntryRoute } from '../../src/lib/blockchart/layout/container-entry.js';
import { routeMetrics } from '../../src/lib/blockchart/layout/route-quality.js';
import { routeFixed } from '../../src/lib/blockchart/layout/fixed.js';
import { connectionStyle } from '../../src/lib/blockchart/styles.js';

const fixture = () => ({
  baseline: [
    { x: 0, y: 0 },
    { x: 0, y: 80 },
    { x: 60, y: 80 },
    { x: 60, y: 90 },
    { x: 100, y: 90 },
    { x: 100, y: 100 },
    { x: 85, y: 100 },
  ],
  source: { x: 0, y: 0 },
  start: { x: 0, y: 6 },
  finish: { x: 91, y: 100 },
  target: { x: 85, y: 100 },
  av: { x: 0, y: 1 },
  bv: { x: 1, y: 0 },
  containers: [{ x: 40, y: 30, width: 80, height: 90 }],
  obstacles: [{ x: 20, y: 30, width: 30, height: 40 }],
  clearance: 30,
  avoid: [],
});
for (let turns = 0; turns < 4; turns++) {
  const point = (p) => {
    let { x, y } = p;
    for (let i = 0; i < turns; i++) [x, y] = [-y, x];
    return { x, y };
  };
  const box = (r) => {
    const a = point(r),
      b = point({ x: r.x + r.width, y: r.y + r.height });
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  };
  test(`Container entry reduces complete-path bends and respects obstacles (rotation ${turns})`, () => {
    const input = fixture();
    for (const key of ['source', 'target', 'start', 'finish', 'av', 'bv']) input[key] = point(input[key]);
    input.baseline = input.baseline.map(point);
    input.containers = input.containers.map(box);
    input.obstacles = input.obstacles.map(box);
    const frozen = structuredClone(input),
      path = containerEntryRoute(input);
    assert.ok(path);
    assert.equal(routeMetrics(path).bends, 3);
    assert.ok(routeMetrics(path).length <= routeMetrics(input.baseline).length * 1.5);
    assert.deepEqual(path[0], input.source);
    assert.deepEqual(path.at(-1), input.target);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i];
      assert.ok(a.x === b.x || a.y === b.y);
      for (const r of input.obstacles) {
        const hit =
          a.y === b.y
            ? a.y > r.y &&
              a.y < r.y + r.height &&
              Math.max(a.x, b.x) > r.x &&
              Math.min(a.x, b.x) < r.x + r.width
            : a.x > r.x &&
              a.x < r.x + r.width &&
              Math.max(a.y, b.y) > r.y &&
              Math.min(a.y, b.y) < r.y + r.height;
        assert.equal(hit, false);
      }
    }
    assert.deepEqual(input, frozen);
  });
}
test('excessively long outer detours retain the original route', () => {
  const input = fixture();
  input.containers[0].width = 1000;
  assert.equal(containerEntryRoute(input), null);
});
test('a foreign label blocking the horizontal entry lane retains the original route', () => {
  const input = fixture();
  input.obstacles.push({ x: 110, y: 90, width: 10, height: 20 });
  assert.equal(containerEntryRoute(input), null);
});
test('entry candidates cannot leave the routing scope', () => {
  const input = fixture();
  input.bounds = { x: -10, y: -10, width: 130, height: 150 };
  assert.equal(containerEntryRoute(input), null);
});
test('straight attachments are left unchanged', () => {
  const input = fixture();
  input.baseline = [
    { x: 0, y: 0 },
    { x: 85, y: 0 },
  ];
  assert.equal(containerEntryRoute(input), null);
});

test('the detour budget includes both reserved labels and their hardware attachments', () => {
  const input = fixture();
  input.containers[0].width = 130;
  assert.equal(containerEntryRoute(input), null, 'branch-only budget rejects this detour');
  input.prefix = [
    { x: 0, y: -150 },
    { x: 0, y: 0 },
  ];
  input.suffix = [
    { x: 85, y: 100 },
    { x: 35, y: 100 },
  ];
  const route = containerEntryRoute(input);
  assert.ok(route);
  assert.equal(routeMetrics([...input.prefix, ...route, ...input.suffix]).bends, 3);
  assert.ok(
    route.every((p) => Object.keys(p).length === 2),
    'route points expose coordinates only',
  );
});

for (const protectedFrame of [false, true])
  test(`fixed routing ${protectedFrame ? 'preserves Boundary protection' : 'improves ordinary Container entry without moving nodes'}`, () => {
    const input = fixture();
    const modules = [
      {
        id: 'Source',
        x: -10,
        y: -20,
        width: 20,
        height: 20,
        ports: [{ id: 'out', x: 0, y: 0, side: 'bottom' }],
      },
      {
        id: 'Target',
        x: 65,
        y: 90,
        width: 20,
        height: 20,
        ports: [{ id: 'in', x: 85, y: 100, side: 'right' }],
      },
      { id: 'Obstacle', ...input.obstacles[0], ports: [] },
    ];
    const group = {
      id: 'Frame',
      ...input.containers[0],
      members: ['Target'],
      portMode: protectedFrame ? 'boundary' : 'direct',
      ports: [],
      style: { label: { hidden: true } },
    };
    const ref = {
      id: 'Route',
      source: { moduleId: 'Source', portId: 'out' },
      target: { moduleId: 'Target', portId: 'in' },
      style: connectionStyle(null),
    };
    const result = {
      modules,
      groups: [group],
      terminals: [],
      connections: [{ id: 'Route', style: ref.style, sections: [{ points: input.baseline }] }],
    };
    const stable = structuredClone({ modules, groups: result.groups });
    routeFixed(
      result,
      { modules, groups: [group], connections: [ref], layout: { direction: 'down', layerSpacing: 30 } },
      { strategy: 'container-entry' },
    );
    assert.equal(
      routeMetrics(result.connections[0].sections.flatMap((s) => s.points)).bends,
      protectedFrame ? 5 : 3,
    );
    assert.deepEqual({ modules: result.modules, groups: result.groups }, stable);
    if (!protectedFrame) assert.equal(result.connections[0].routingInfo.reason, 'container-entry');
  });
