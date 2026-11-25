import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rectanglesOverlap,
  rectangleContains,
  segmentCrossesInterior,
  simplifyForwardPath,
  pointInBounds,
  collinearOverlap,
} from '../../src/lib/blockchart/layout/routing-geometry.js';
import {
  routeMetrics,
  netRouteQuality,
  countSegmentContacts,
  countStrokeContacts,
} from '../../src/lib/blockchart/layout/route-quality.js';
import { commitRoutedTrial } from '../../src/lib/blockchart/layout/routing-trial.js';

const p = (x, y) => ({ x, y });
const edge = (id, points, netId = id) => ({
  id,
  netId,
  sections: [{ points }],
  style: { strokeWidth: 1 },
});

test('geometry distinguishes interior crossing from touching a frame edge', () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(segmentCrossesInterior(p(-5, 0), p(15, 0), box), false);
  assert.equal(segmentCrossesInterior(p(-5, 5), p(15, 5), box), true);
  assert.equal(segmentCrossesInterior(p(0, -5), p(0, 15), box), false);
  assert.equal(segmentCrossesInterior(p(5, -5), p(5, 15), box), true);
  assert.equal(rectanglesOverlap(box, { ...box, x: 10 }), false);
  assert.equal(rectanglesOverlap(box, { ...box, x: 10 }, 1), true);
  assert.equal(rectangleContains(box, { ...box }), true);
  assert.equal(pointInBounds(p(10, 10), box), true);
  assert.equal(pointInBounds(p(11, 10), box), false);
  assert.equal(pointInBounds(p(11, 10), undefined), true);
  assert.equal(collinearOverlap(p(0, 0), p(10, 0), p(3, 0), p(8, 0)), true);
  assert.equal(collinearOverlap(p(0, 0), p(10, 0), p(10, 0), p(15, 0)), false);
  assert.equal(collinearOverlap(p(0, 0), p(10, 0), p(3, -3), p(3, 3)), false);
  assert.equal(collinearOverlap(p(0, 0), p(0, 10), p(0, 8), p(0, 3)), true);
});

test('forward path cleanup preserves a reversal and never changes input points', () => {
  const points = [p(0, 0), p(0, 0), p(5, 0), p(10, 0), p(5, 0), p(5, 5)];
  const saved = structuredClone(points);
  const clean = simplifyForwardPath(points);
  assert.deepEqual(clean, [p(0, 0), p(10, 0), p(5, 0), p(5, 5)]);
  assert.deepEqual(points, saved);
  assert.notEqual(clean[0], points[0]);
  assert.deepEqual(routeMetrics(clean), { length: 20, bends: 2 });
});

test('path metrics ignore zero-length steps and count direction changes', () => {
  assert.deepEqual(routeMetrics([p(0, 0), p(10, 0), p(10, 0), p(10, 5)]), {
    length: 15,
    bends: 1,
  });
  assert.deepEqual(routeMetrics([]), { length: 0, bends: 0 });
});

test('proper Net crossings, T contacts and stroke proximity keep distinct meanings', () => {
  const a = edge('a', [p(0, 0), p(10, 0)]);
  const t = edge('t', [p(5, 0), p(5, 10)]);
  assert.equal(netRouteQuality({ connections: [a, t] }).crossings, 0);
  assert.equal(countSegmentContacts(a.sections, [t]), 1);
  const commonEnd = edge('end', [p(10, 0), p(10, 10)]);
  assert.equal(countSegmentContacts(a.sections, [commonEnd]), 0);
  const nearby = edge('near', [p(0, 2), p(10, 2)]);
  assert.equal(countSegmentContacts(a.sections, [nearby]), 0);
  assert.equal(countStrokeContacts([a, nearby]), 1);
  assert.equal(countStrokeContacts([a, { ...nearby, netId: 'a' }]), 0);
});

test('Net statistics deduplicate segmented crossings and overlapping Net pairs', () => {
  const a = edge('a', [p(0, 0), p(10, 0)], 'bus');
  const b = edge('b', [p(5, -5), p(5, 5)]);
  assert.equal(netRouteQuality({ connections: [a, { ...a, id: 'a2' }, b] }).crossings, 1);
  const c = edge('c', [p(2, 0), p(5, 0), p(8, 0)]);
  assert.equal(netRouteQuality({ connections: [a, c] }).overlaps, 1);
  assert.equal(netRouteQuality({ connections: [a, { ...c, netId: 'bus' }] }).overlaps, 0);
});

test('edge bounds preserve epsilon collinearity and contacts from wide strokes', () => {
  const a = edge('a', [p(0, 0), p(10, 0)]);
  const b = edge('b', [p(2, 0.0000005), p(8, 0.0000005)]);
  assert.equal(netRouteQuality({ connections: [a, b] }).overlaps, 1);
  b.sections = [{ points: [p(2, 12), p(8, 12)] }];
  b.style.strokeWidth = 20;
  assert.equal(countStrokeContacts([a, b]), 1);
  b.sections[0].points.forEach((point) => point.y++);
  assert.equal(countStrokeContacts([a, b]), 0);
});

test('route trial rejection and search failure cannot overwrite a valid baseline', () => {
  const result = { modules: [], groups: [], connections: [], value: 'baseline' };
  const saved = structuredClone(result);
  const trial = { ...structuredClone(result), value: 'candidate' };
  const model = { connections: [] };
  assert.equal(commitRoutedTrial(result, trial, model, { accept: () => false }), false);
  assert.deepEqual(result, saved);
  const broken = { ...trial, connections: [edge('missing', [p(0, 0), p(10, 0)])] };
  assert.equal(commitRoutedTrial(result, broken, model), false);
  assert.deepEqual(result, saved);
  assert.equal(commitRoutedTrial(result, trial, model), true);
  assert.equal(result.value, 'candidate');
});

test('route trial policies propagate programming errors instead of masking them', () => {
  const result = { modules: [], groups: [], connections: [] };
  const failure = new Error('policy failed');
  assert.throws(
    () =>
      commitRoutedTrial(
        result,
        structuredClone(result),
        { connections: [] },
        {
          accept: () => {
            throw failure;
          },
        },
      ),
    (error) => error === failure,
  );
});

test('independent trial evaluation can stage normal routing before committing', async () => {
  const { evaluateRoutedTrial } = await import('../../src/lib/blockchart/layout/routing-trial.js');
  const original = { modules: [], groups: [], connections: [], value: 'original' },
    trial = structuredClone(original);
  const seen = [];
  assert.equal(
    evaluateRoutedTrial(
      trial,
      { connections: [] },
      {
        route: (draft, model, options) => {
          seen.push(options.reason);
          draft.value = 'staged';
        },
        reason: 'alignment',
        accept: (draft) => draft.value === 'staged',
      },
    ),
    true,
  );
  assert.deepEqual(seen, ['alignment']);
  assert.equal(original.value, 'original');
  assert.equal(trial.value, 'staged');
  const before = structuredClone(original);
  assert.equal(
    commitRoutedTrial(
      original,
      structuredClone(trial),
      { connections: [] },
      {
        route: () => {
          throw Error('no safe route');
        },
      },
    ),
    false,
  );
  assert.deepEqual(original, before);
});
