import { routeOrthogonal } from '../../shared/orthogonal.js';

const eps = 1e-6;
const crosses = (a, b, r) =>
  Math.abs(a.y - b.y) < eps
    ? a.y > r.y + eps &&
      a.y < r.y + r.height - eps &&
      Math.max(a.x, b.x) > r.x + eps &&
      Math.min(a.x, b.x) < r.x + r.width - eps
    : a.x > r.x + eps &&
      a.x < r.x + r.width - eps &&
      Math.max(a.y, b.y) > r.y + eps &&
      Math.min(a.y, b.y) < r.y + r.height - eps;

export function routeMetrics(points) {
  let length = 0,
    bends = 0,
    previous;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const distance = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (distance < eps) continue;
    const direction = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
    if (previous && (direction.x !== previous.x || direction.y !== previous.y)) bends++;
    previous = direction;
    length += distance;
  }
  return { length, bends };
}

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
