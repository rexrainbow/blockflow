import { routeMetrics } from './route-quality.js';
import {
  EPS as eps,
  segmentCrossesInterior as crosses,
  pointInBounds as inside,
  simplifyForwardPath as clean,
} from './routing-geometry.js';

const dot = (a, b, v) => (a.x - b.x) * v.x + (a.y - b.y) * v.y;

/** Remove optional receiver-gate spurs without relaxing the source departure. */
export function simplifyReceiverAccess(
  points,
  {
    sourceVector,
    sourceGate,
    targetVector,
    targetGroups,
    clearance,
    minAccess,
    obstacles,
    arrivalObstacles,
    bounds,
    accept = () => true,
  },
) {
  const target = points.at(-1),
    source = points[0];
  let best = points,
    score = routeMetrics(points);
  // Only repair the local tail, leaving reserved labels/other route stages intact.
  for (let i = Math.max(0, points.length - 7); i < points.length - 2; i++) {
    const p = points[i];
    const corner = targetVector.x ? { x: p.x, y: target.y } : { x: target.x, y: p.y };
    if (!inside(corner, bounds) || dot(corner, target, targetVector) < minAccess - eps) continue;
    if (
      targetGroups.some((g) => {
        const face = {
          x: targetVector.x > 0 ? g.x + g.width : targetVector.x < 0 ? g.x : corner.x,
          y: targetVector.y > 0 ? g.y + g.height : targetVector.y < 0 ? g.y : corner.y,
        };
        return dot(corner, face, targetVector) < clearance - eps;
      })
    )
      continue;
    if (
      obstacles.some((r) => crosses(p, corner, r)) ||
      arrivalObstacles.some((r) => crosses(corner, target, r))
    )
      continue;
    const candidate = clean([...points.slice(0, i + 1), corner, target]);
    if (candidate.length < 2) continue;
    // Shortcuts must still travel straight through every source exit gate first.
    if (
      Math.abs((candidate[1].x - source.x) * sourceVector.y - (candidate[1].y - source.y) * sourceVector.x) >
        eps ||
      dot(candidate[1], sourceGate, sourceVector) < -eps
    )
      continue;
    const next = routeMetrics(candidate);
    if (next.bends >= score.bends || next.length > score.length + eps || !accept(candidate)) continue;
    best = candidate;
    score = next;
  }
  return best;
}
