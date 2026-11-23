import { routeOrthogonal } from '../../shared/orthogonal.js';
import { EPS as eps, segmentCrossesInterior as crosses } from './routing-geometry.js';
import { routeMetrics } from './route-quality.js';

/** Compare whole attachments, including synthetic-label entry/exit stubs. */
export function containerEntryRoute({
  baseline,
  start,
  finish,
  source,
  target,
  av,
  bv,
  containers,
  obstacles,
  bounds,
  clearance,
  avoid,
  entryGap = 9,
  prefix = [],
  suffix = [],
}) {
  const original = routeMetrics([...prefix, ...baseline, ...suffix]);
  if (original.bends < 2 || !original.length) return null;
  // Exterior access may trade length for clarity, but never grow without a bound.
  const budget = original.length * 1.5;
  let best = null,
    score = original;
  const travel = { x: -bv.x, y: -bv.y };
  for (const group of containers) {
    const gap = entryGap;
    const gate = {
      x: bv.x > 0 ? group.x + group.width + gap : bv.x < 0 ? group.x - gap : finish.x,
      y: bv.y > 0 ? group.y + group.height + gap : bv.y < 0 ? group.y - gap : finish.y,
    };
    // Gate must be outward from the receiver, with a clear straight access lane.
    if ((gate.x - finish.x) * bv.x + (gate.y - finish.y) * bv.y < -eps) continue;
    if (
      bounds &&
      (gate.x < bounds.x ||
        gate.x > bounds.x + bounds.width ||
        gate.y < bounds.y ||
        gate.y > bounds.y + bounds.height)
    )
      continue;
    if (obstacles.some((box) => crosses(gate, finish, box))) continue;
    let head;
    try {
      head = routeOrthogonal(start, gate, obstacles, bounds, clearance, avoid, {
        startDirection: av,
        endDirection: travel,
      });
    } catch {
      // An optional candidate must not replace a valid route with a routing failure.
      continue;
    }
    const points = [source, ...head, finish, target];
    const next = routeMetrics([...prefix, ...points, ...suffix]);
    if (next.length > budget + eps || next.bends >= original.bends) continue;
    if (next.bends < score.bends || (next.bends === score.bends && next.length < score.length)) {
      best = points.map(({ x, y }) => ({ x, y }));
      score = next;
    }
  }
  return best;
}
