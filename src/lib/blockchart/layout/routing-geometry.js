// Shared geometry primitives. Keep boundary/tolerance semantics explicit at call sites.
export const EPS = 1e-6;
export const rectanglesOverlap = (a, b, gap = 0) =>
  a.x < b.x + b.width + gap - EPS &&
  a.x + a.width + gap > b.x + EPS &&
  a.y < b.y + b.height + gap - EPS &&
  a.y + a.height + gap > b.y + EPS;
export const rectangleContains = (a, b) =>
  b.x >= a.x - EPS &&
  b.y >= a.y - EPS &&
  b.x + b.width <= a.x + a.width + EPS &&
  b.y + b.height <= a.y + a.height + EPS;
export const sectionSegments = (sections) =>
  sections.flatMap((s) => s.points.slice(1).map((b, i) => [s.points[i], b]));
export const samePoint = (a, b) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
export function collinearOverlap(a, b, c, d) {
  const horizontal = Math.abs(a.y - b.y) < EPS;
  if (horizontal !== Math.abs(c.y - d.y) < EPS) return false;
  const axis = horizontal ? 'x' : 'y',
    fixed = horizontal ? 'y' : 'x';
  return (
    Math.abs(a[fixed] - c[fixed]) < EPS &&
    Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
      Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) >
      EPS
  );
}
export const segmentCrossesInterior = (a, b, r) =>
  Math.abs(a.y - b.y) < EPS
    ? a.y > r.y + EPS &&
      a.y < r.y + r.height - EPS &&
      Math.max(a.x, b.x) > r.x + EPS &&
      Math.min(a.x, b.x) < r.x + r.width - EPS
    : a.x > r.x + EPS &&
      a.x < r.x + r.width - EPS &&
      Math.max(a.y, b.y) > r.y + EPS &&
      Math.min(a.y, b.y) < r.y + r.height - EPS;
export const pointInBounds = (p, b) =>
  !b || (p.x >= b.x - EPS && p.x <= b.x + b.width + EPS && p.y >= b.y - EPS && p.y <= b.y + b.height + EPS);
export const simplifyForwardPath = (points) => {
  const out = [];
  for (const p of points) {
    if (out.length && Math.hypot(p.x - out.at(-1).x, p.y - out.at(-1).y) < EPS) continue;
    out.push({ x: p.x, y: p.y });
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      if (
        ((Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS) ||
          (Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS)) &&
        (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0
      )
        out.splice(-2, 1);
      else break;
    }
  }
  return out;
};
export const segmentStrokeBounds = (a, b, half) => ({
  x: Math.min(a.x, b.x) - half,
  y: Math.min(a.y, b.y) - half,
  width: Math.abs(a.x - b.x) + 2 * half,
  height: Math.abs(a.y - b.y) + 2 * half,
});
