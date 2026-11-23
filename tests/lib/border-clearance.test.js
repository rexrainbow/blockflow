import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoutingStrategy } from '../../src/lib/blockchart/layout/routing-strategies.js';
import { connectionStyle } from '../../src/lib/blockchart/styles.js';
const p = (x, y) => ({ x, y });
function context(scope) {
  const ref = { id: 'Wire', style: connectionStyle(null) };
  return {
    edge: { id: 'Wire' },
    ref,
    a: { p: p(-20, 0), node: { id: 'Source' } },
    b: { p: p(20, 0), node: { id: 'Target' } },
    av: p(1, 0),
    bv: p(-1, 0),
    start: p(-20, 0),
    finish: p(20, 0),
    obstacles: [{ x: -8, y: -8, width: 16, height: 16, _owner: 'Obstacle' }],
    avoid: [],
    straight: false,
    scope,
  };
}
test('ordinary route leaves eight units of clear space around a physical Block', () => {
  const c = context(),
    saved = structuredClone(c);
  const result = createRoutingStrategy('ordinary', { model: { layout: { layerSpacing: 30 } } }).route(c);
  assert.deepEqual(c, saved);
  // The physical obstacle is [-5,5] in Y; baseline inflation adds three units.
  assert.ok(Math.max(...result.points.map((p) => Math.abs(p.y))) >= 13 - 1e-6);
  assert.deepEqual(result.points[0], c.start);
  assert.deepEqual(result.points.at(-1), c.finish);
});
test('a narrow corridor falls back to safe minimum without widening or failing', () => {
  const c = context({ x: -25, y: -10, width: 50, height: 20 }),
    saved = structuredClone(c);
  const result = createRoutingStrategy('ordinary', { model: { layout: { layerSpacing: 30 } } }).route(c);
  assert.deepEqual(c, saved);
  const detour = Math.max(...result.points.map((p) => Math.abs(p.y)));
  assert.ok(detour >= 8 - 1e-6 && detour <= 10 + 1e-6);
  assert.deepEqual(result.points[0], c.start);
  assert.deepEqual(result.points.at(-1), c.finish);
});
