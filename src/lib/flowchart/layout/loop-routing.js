import { sidePoint, vectors, opposite } from '../geometry.js';
import { routeOrthogonal } from '../../shared/orthogonal.js';

const simplify = (points) => {
  const out = [];
  for (const p of points) {
    if (out.length && Math.hypot(p.x - out.at(-1).x, p.y - out.at(-1).y) < 1e-6) continue;
    out.push({ ...p });
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      if (
        ((Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6) ||
          (Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6)) &&
        (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0
      )
        out.splice(-2, 1);
      else break;
    }
  }
  return out;
};
export function routeFlowEdge({
  edge,
  a,
  b,
  side,
  loopSide,
  auto,
  vertical,
  forward,
  nodes,
  groups,
  localGroups,
  obstacles,
  bounds,
  scope,
  lanes,
  clearance,
}) {
  function candidate(laneSide, local) {
    const ends =
      edge.kind === 'loop' && auto
        ? {
            from: edge.fromSide ?? laneSide,
            to: edge.toSide ?? (edge.from === edge.to ? opposite[forward] : laneSide),
          }
        : side;
    const start = sidePoint(a, ends.from),
      end = sidePoint(b, ends.to),
      av = vectors[ends.from],
      bv = vectors[ends.to];
    const distance = Math.max(14, edge.style.strokeWidth * 2 + 8);
    const access = { x: start.x + av.x * distance, y: start.y + av.y * distance },
      finish = { x: end.x + bv.x * distance, y: end.y + bv.y * distance };
    const waypoints = [access];
    const key = JSON.stringify([scope?.id ?? null, laneSide]),
      index = lanes.get(key) ?? 0;
    if (edge.kind === 'loop') {
      const axis = ['left', 'right'].includes(laneSide) ? 'x' : 'y',
        extent = axis === 'x' ? 'width' : 'height',
        tangent = axis === 'x' ? 'y' : 'x',
        size = tangent === 'x' ? 'width' : 'height';
      const all = [...nodes, ...(local ? localGroups : groups)],
        lo = Math.min(access[tangent], finish[tangent]) - distance,
        hi = Math.max(access[tangent], finish[tangent]) + distance;
      const nearby = all.filter((n) => n[tangent] <= hi && n[tangent] + n[size] >= lo);
      const relevant = local ? nearby : all;
      const outer = laneSide === 'right' || laneSide === 'bottom';
      const lane =
        local || !scope
          ? outer
            ? Math.max(...relevant.map((n) => n[axis] + n[extent])) + 36 + index * 28
            : Math.min(...relevant.map((n) => n[axis])) - 36 - index * 28
          : laneSide === 'right'
            ? scope.x + scope.width - 18 - index * 28
            : laneSide === 'left'
              ? scope.x + 18 + index * 28
              : laneSide === 'bottom'
                ? scope.y + scope.height - 18 - index * 28
                : bounds.y + 12 + index * 28;
      if (bounds && (lane < bounds[axis] || lane > bounds[axis] + bounds[extent]))
        throw new Error('Loop lane is outside its group.');
      const turn = { ...finish, [axis]: lane };
      const note = nodes.find(
        (n) => n.type === 'note' && n.attachTo === b.id && n.side === laneSide && ends.to === laneSide,
      );
      if (note)
        turn[tangent] =
          access[tangent] >= finish[tangent]
            ? Math.max(finish[tangent], note[tangent] + note[size] + 10)
            : Math.min(finish[tangent], note[tangent] - 10);
      waypoints.push({ ...access, [axis]: lane }, turn);
    }
    waypoints.push(finish);
    const parts = [];
    for (let i = 1; i < waypoints.length; i++)
      parts.push(...routeOrthogonal(waypoints[i - 1], waypoints[i], obstacles, bounds, clearance));
    const points = simplify([start, ...parts, end]);
    const length = points
      .slice(1)
      .reduce((total, p, i) => total + Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y), 0);
    return { points, side: ends, key, index, score: length + 20 * Math.max(0, points.length - 2) };
  }
  let best;
  if (edge.kind === 'loop' && auto) {
    // Stable ties prefer the historical side; failed candidates cannot hide a
    // valid opposite-side route. Retain the full outer route as a safe fallback.
    for (const choice of vertical ? ['right', 'left'] : ['bottom', 'top'])
      for (const local of [true, false]) {
        try {
          const route = candidate(choice, local);
          if (!best || route.score < best.score - 1e-6) best = route;
        } catch {
          /* Try the other candidate. */
        }
      }
  }
  best ??= candidate(loopSide, false);
  if (edge.kind === 'loop') lanes.set(best.key, best.index + 1);
  return best;
}
