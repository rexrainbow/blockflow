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

const boxOf = (segments) => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [a, b] of segments) {
    x0 = Math.min(x0, a.x, b.x);
    x1 = Math.max(x1, a.x, b.x);
    y0 = Math.min(y0, a.y, b.y);
    y1 = Math.max(y1, a.y, b.y);
  }
  return { x0, y0, x1, y1 };
};
const mayTouch = (a, b, pad) =>
  a.x0 <= b.x1 + pad && b.x0 <= a.x1 + pad && a.y0 <= b.y1 + pad && b.y0 <= a.y1 + pad;
// Deduplicate proper crossings by Net and coordinate, collinear overlaps by Net pair.
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
  const edges = result.connections,
    segments = edges.map((e) => parts(e.sections)),
    boxes = segments.map(boxOf);
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i],
        b = edges[j],
        ids = [a.netId ?? a.id, b.netId ?? b.id].sort();
      if (ids[0] === ids[1]) continue;
      if (!mayTouch(boxes[i], boxes[j], eps)) continue;
      for (const [p, q] of segments[i])
        for (const [r, s] of segments[j]) {
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
  const segments = parts(sections);
  let count = 0;
  for (const edge of others)
    for (const other of parts(edge.sections))
      for (const segment of segments) if (segmentsContact(segment, other)) count++;
  return count;
}

export function segmentsContact([a, b], [c, d]) {
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
      return true;
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
      return !(end(a, b) && end(c, d));
    }
  }
  return false;
}

// Stroke-envelope proximity, with same-Net and common endpoint exemptions.
// Count segment pairs (not unique intersections); used by Port adjustment.
export function countStrokeContacts(edges) {
  let crossings = 0;
  const paths = edges.map((edge) => {
    const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const segments = [];
    for (const [a, b] of parts(edge.sections)) {
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= EPS) continue;
      const box = strokeBox(a, b, edge.style.strokeWidth / 2 + 1);
      segments.push({ a, b, box });
      bounds.x0 = Math.min(bounds.x0, box.x);
      bounds.y0 = Math.min(bounds.y0, box.y);
      bounds.x1 = Math.max(bounds.x1, box.x + box.width);
      bounds.y1 = Math.max(bounds.y1, box.y + box.height);
    }
    return {
      netId: edge.netId,
      segments,
      bounds,
      ends: [edge.sections[0]?.points[0], edge.sections.at(-1)?.points.at(-1)],
    };
  });
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++) {
      const a = paths[i],
        b = paths[j];
      if (a.netId === b.netId || !mayTouch(a.bounds, b.bounds, EPS)) continue;
      const shared = a.ends.filter((p) => b.ends.some((q) => samePoint(p, q)));
      for (const first of a.segments)
        for (const second of b.segments) {
          if (!overlap(first.box, second.box)) continue;
          // Different boundary faces may legitimately join at the same fixed anchor.
          if (
            shared.some(
              (p) =>
                (samePoint(p, first.a) || samePoint(p, first.b)) &&
                (samePoint(p, second.a) || samePoint(p, second.b)),
            )
          )
            continue;
          crossings++;
        }
    }
  return crossings;
}
