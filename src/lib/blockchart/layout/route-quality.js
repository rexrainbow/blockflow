import {
  EPS,
  sectionSegments as parts,
  samePoint,
  rectanglesOverlap as overlap,
  segmentStrokeBounds as strokeBox,
} from './routing-geometry.js';
const eps = EPS;
// Whole-path Manhattan length and direction changes; ignore near-zero segments.
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

// Proper interior crossings are deduplicated by Net and coordinate; collinear overlaps by Net pair.
export function netRouteQuality(result) {
  let length = 0,
    bends = 0;
  const crossings = new Set(),
    overlaps = new Set();
  for (const e of result.connections) {
    const m = routeMetrics(e.sections.flatMap((s) => s.points));
    length += m.length;
    bends += m.bends;
  }
  for (let i = 0; i < result.connections.length; i++)
    for (const b of result.connections.slice(i + 1)) {
      const a = result.connections[i],
        ids = [a.netId ?? a.id, b.netId ?? b.id].sort();
      if (ids[0] === ids[1]) continue;
      for (const [p, q] of parts(a.sections))
        for (const [r, s] of parts(b.sections)) {
          const h = Math.abs(p.y - q.y) < eps,
            k = Math.abs(r.y - s.y) < eps;
          if (h === k) {
            const axis = h ? 'x' : 'y',
              fixed = h ? 'y' : 'x';
            if (
              Math.abs(p[fixed] - r[fixed]) < eps &&
              Math.min(Math.max(p[axis], q[axis]), Math.max(r[axis], s[axis])) -
                Math.max(Math.min(p[axis], q[axis]), Math.min(r[axis], s[axis])) >
                eps
            )
              overlaps.add(JSON.stringify(ids));
          } else {
            const u = h ? [p, q] : [r, s],
              v = h ? [r, s] : [p, q];
            if (
              v[0].x > Math.min(u[0].x, u[1].x) + eps &&
              v[0].x < Math.max(u[0].x, u[1].x) - eps &&
              u[0].y > Math.min(v[0].y, v[1].y) + eps &&
              u[0].y < Math.max(v[0].y, v[1].y) - eps
            )
              crossings.add(JSON.stringify([...ids, Math.round(v[0].x * 1e6), Math.round(u[0].y * 1e6)]));
          }
        }
    }
  return { length, bends, crossings: crossings.size, overlaps: overlaps.size };
}

// Conservative segment-pair contacts, including T contacts but excluding a shared segment endpoint.
export function countSegmentContacts(sections, others) {
  let count = 0;
  for (const [a, b] of parts(sections))
    for (const edge of others)
      for (const [c, d] of parts(edge.sections)) {
        const h = Math.abs(a.y - b.y) < EPS,
          k = Math.abs(c.y - d.y) < EPS;
        if (h === k) {
          const axis = h ? 'x' : 'y',
            fixed = h ? 'y' : 'x';
          if (
            Math.abs(a[fixed] - c[fixed]) < EPS &&
            Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
              Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) >
              EPS
          )
            count++;
        } else {
          const p = h ? [a, b] : [c, d],
            q = h ? [c, d] : [a, b];
          if (
            q[0].x >= Math.min(p[0].x, p[1].x) - EPS &&
            q[0].x <= Math.max(p[0].x, p[1].x) + EPS &&
            p[0].y >= Math.min(q[0].y, q[1].y) - EPS &&
            p[0].y <= Math.max(q[0].y, q[1].y) + EPS
          ) {
            const hit = { x: q[0].x, y: p[0].y };
            const end = (u, v) =>
              Math.hypot(hit.x - u.x, hit.y - u.y) < EPS || Math.hypot(hit.x - v.x, hit.y - v.y) < EPS;
            if (!(end(a, b) && end(c, d))) count++;
          }
        }
      }
  return count;
}

// Stroke-envelope proximity, with same-Net and common endpoint exemptions.
// Count segment pairs (not unique intersections); used by Port adjustment.
export function countStrokeContacts(edges) {
  let crossings = 0;
  const paths = edges.map((edge) => ({
    edge,
    parts: parts(edge.sections).filter(([a, b]) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > EPS),
  }));
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++) {
      if (paths[i].edge.netId === paths[j].edge.netId) continue;
      const ends = (p) => [p.edge.sections[0].points[0], p.edge.sections.at(-1).points.at(-1)];
      const shared = ends(paths[i]).filter((a) => ends(paths[j]).some((b) => samePoint(a, b)));
      for (const [a, b] of paths[i].parts)
        for (const [c, d] of paths[j].parts) {
          // Different boundary faces may legitimately join at the same fixed anchor.
          if (
            shared.some((p) => (samePoint(p, a) || samePoint(p, b)) && (samePoint(p, c) || samePoint(p, d)))
          )
            continue;
          if (
            overlap(
              strokeBox(a, b, paths[i].edge.style.strokeWidth / 2 + 1),
              strokeBox(c, d, paths[j].edge.style.strokeWidth / 2 + 1),
            )
          )
            crossings++;
        }
    }
  return crossings;
}
