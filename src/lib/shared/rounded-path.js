const EPS = 1e-6;
const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Render orthogonal geometry without changing endpoints or the supplied points. */
export function roundedPath(points, { radius = 8, endClearance = 0, obstacles = [] } = {}) {
  const p = points.filter((v, i) => !i || Math.hypot(v.x - points[i - 1].x, v.y - points[i - 1].y) > EPS);
  if (!p.length) return '';
  const out = [`M ${p[0].x} ${p[0].y}`];
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1],
      b = p[i],
      c = p[i + 1];
    const incoming = Math.hypot(b.x - a.x, b.y - a.y),
      outgoing = Math.hypot(c.x - b.x, c.y - b.y);
    const u = { x: (b.x - a.x) / incoming, y: (b.y - a.y) / incoming };
    const v = { x: (c.x - b.x) / outgoing, y: (c.y - b.y) / outgoing };
    let r = Math.min(
      radius,
      incoming / 2,
      outgoing / 2,
      i === p.length - 2 ? Math.max(0, outgoing - endClearance) : Infinity,
    );
    if (Math.abs(u.x * v.y - u.y * v.x) < EPS) r = 0;
    let start, end;
    while (r >= 0.25) {
      start = { x: b.x - u.x * r, y: b.y - u.y * r };
      end = { x: b.x + v.x * r, y: b.y + v.y * r };
      // The complete quadratic is inside this box. Keep its swept area clear.
      const box = {
        x: Math.min(start.x, b.x, end.x),
        y: Math.min(start.y, b.y, end.y),
        width: Math.max(start.x, b.x, end.x) - Math.min(start.x, b.x, end.x),
        height: Math.max(start.y, b.y, end.y) - Math.min(start.y, b.y, end.y),
      };
      if (!obstacles.some((obstacle) => overlaps(box, obstacle))) break;
      r /= 2;
    }
    if (r < 0.25) out.push(`L ${b.x} ${b.y}`);
    else out.push(`L ${start.x} ${start.y} Q ${b.x} ${b.y} ${end.x} ${end.y}`);
  }
  if (p.length > 1) out.push(`L ${p.at(-1).x} ${p.at(-1).y}`);
  return out.join(' ');
}
