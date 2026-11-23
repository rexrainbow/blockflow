import test from 'node:test';
import assert from 'node:assert/strict';
import { simplifyReceiverAccess } from '../../src/lib/blockchart/layout/receiver-access.js';

function fixture(offset = 1) {
  return {
    points: [
      { x: 200, y: 0 },
      { x: 220, y: 0 },
      { x: 220, y: -40 },
      { x: 30, y: -40 },
      { x: 30, y: 100 },
      { x: 24, y: 100 },
      { x: 24, y: 100 + offset },
      { x: 54, y: 100 + offset },
    ],
    options: {
      sourceVector: { x: 1, y: 0 },
      sourceGate: { x: 220, y: 0 },
      targetVector: { x: -1, y: 0 },
      targetGroups: [{ x: 33, y: 50, width: 100, height: 100 }],
      clearance: 3,
      minAccess: 9,
      obstacles: [
        { x: 147, y: -23, width: 66, height: 46 },
        { x: 30, y: 47, width: 106, height: 106 },
      ],
      arrivalObstacles: [{ x: 147, y: -23, width: 66, height: 46 }],
      bounds: { x: 0, y: -80, width: 300, height: 300 },
    },
  };
}
for (const offset of [1, 4.75])
  for (let rotation = 0; rotation < 4; rotation++)
    test(`receiver spur simplifies at rotation ${rotation}, offset ${offset}`, () => {
      const f = fixture(offset),
        point = (p) => {
          let { x, y } = p;
          for (let i = 0; i < rotation; i++) [x, y] = [-y, x];
          return { x, y };
        };
      const box = (b) => {
        const a = point(b),
          c = point({ x: b.x + b.width, y: b.y + b.height });
        return {
          x: Math.min(a.x, c.x),
          y: Math.min(a.y, c.y),
          width: Math.abs(a.x - c.x),
          height: Math.abs(a.y - c.y),
        };
      };
      f.points = f.points.map(point);
      for (const key of ['sourceVector', 'sourceGate', 'targetVector'])
        f.options[key] = point(f.options[key]);
      for (const key of ['obstacles', 'arrivalObstacles', 'targetGroups'])
        f.options[key] = f.options[key].map(box);
      f.options.bounds = box(f.options.bounds);
      const saved = structuredClone(f);
      const next = simplifyReceiverAccess(f.points, f.options);
      assert.deepEqual(
        next,
        [
          { x: 200, y: 0 },
          { x: 220, y: 0 },
          { x: 220, y: -40 },
          { x: 30, y: -40 },
          { x: 30, y: 100 + offset },
          { x: 54, y: 100 + offset },
        ].map(point),
      );
      assert.deepEqual(f, saved);
    });

test('a genuine obstacle keeps a necessary receiver detour', () => {
  const f = fixture();
  f.options.obstacles.push({ x: 29.5, y: 100.25, width: 1, height: 0.5 });
  assert.deepEqual(simplifyReceiverAccess(f.points, f.options), f.points);
});

test('a failed foreign-contact check retains the original receiver path', () => {
  const f = fixture();
  f.options.accept = () => false;
  assert.equal(simplifyReceiverAccess(f.points, f.options), f.points);
});

test('receiver simplification cannot move the first turn inside the source gate', () => {
  const f = fixture();
  f.options.sourceGate = { x: 230, y: 0 };
  assert.equal(simplifyReceiverAccess(f.points, f.options), f.points);
});

test('target clearance and common-ancestor scope are mandatory', () => {
  const f = fixture();
  f.options.clearance = 9;
  assert.deepEqual(simplifyReceiverAccess(f.points, f.options), f.points);
  const g = fixture();
  g.options.bounds = { x: 0, y: -80, width: 300, height: 180.5 };
  assert.equal(simplifyReceiverAccess(g.points, g.options), g.points);
});
