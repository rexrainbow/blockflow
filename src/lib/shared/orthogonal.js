const eps = 1e-6;
const heading = (v) => (!v ? 0 : v.x < 0 ? 1 : v.x > 0 ? 2 : v.y < 0 ? 3 : v.y > 0 ? 4 : 0);
const axis = (dir) => (dir <= 2 ? 1 : 2);
const opposite = (a, b) => a && b && a !== b && axis(a) === axis(b);
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
const inside = (p, r) =>
  p.x > r.x + eps && p.x < r.x + r.width - eps && p.y > r.y + eps && p.y < r.y + r.height - eps;

/** Endpoint directions describe travel before start and after end, not outward target normals. */
export function routeOrthogonal(
  start,
  end,
  obstacles,
  bounds,
  clearance,
  avoid = [],
  { startDirection, endDirection } = {},
) {
  const startHeading = heading(startDirection),
    endHeading = heading(endDirection);
  // Calls without endpoint headings retain the original axis-state search.
  const oriented = Boolean(startHeading || endHeading),
    stride = oriented ? 5 : 3;
  const xs = new Set([start.x, end.x]),
    ys = new Set([start.y, end.y]);
  for (const r of obstacles) {
    xs.add(r.x);
    xs.add(r.x + r.width);
    ys.add(r.y);
    ys.add(r.y + r.height);
  }
  for (const [a, b] of avoid) {
    if (a.x === b.x) {
      xs.add(a.x - 16);
      xs.add(a.x + 16);
    }
    if (a.y === b.y) {
      ys.add(a.y - 16);
      ys.add(a.y + 16);
    }
  }
  const all = [start, end, ...obstacles.flatMap((r) => [r, { x: r.x + r.width, y: r.y + r.height }])];
  xs.add(Math.min(...all.map((p) => p.x)) - clearance);
  xs.add(Math.max(...all.map((p) => p.x)) + clearance);
  ys.add(Math.min(...all.map((p) => p.y)) - clearance);
  ys.add(Math.max(...all.map((p) => p.y)) + clearance);
  const X = [...xs]
      .filter((x) => !bounds || (x >= bounds.x - eps && x <= bounds.x + bounds.width + eps))
      .sort((a, b) => a - b),
    Y = [...ys]
      .filter((y) => !bounds || (y >= bounds.y - eps && y <= bounds.y + bounds.height + eps))
      .sort((a, b) => a - b);
  if (X.length * Y.length > 250000)
    throw new Error('Orthogonal routing graph is too large; reduce diagram complexity.');
  const width = X.length,
    from = Y.indexOf(start.y) * width + X.indexOf(start.x),
    to = Y.indexOf(end.y) * width + X.indexOf(end.x),
    valid = new Map();
  const point = (id) => ({ x: X[id % width], y: Y[Math.floor(id / width)] });
  const allowed = (id) => {
    if (!valid.has(id)) valid.set(id, !obstacles.some((r) => inside(point(id), r)));
    return valid.get(id);
  };
  if (from < 0 || to < 0 || !allowed(from) || !allowed(to))
    throw new Error('Endpoint access is obstructed. Increase spacing or change attachment sides.');
  const heap = [],
    dist = new Map(),
    previous = new Map();
  const push = (key, cost) => {
    let i = heap.length;
    heap.push({ key, cost });
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p].cost <= cost) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = { key, cost };
  };
  const pop = () => {
    const first = heap[0],
      last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1].cost < heap[c].cost) c++;
        if (heap[c].cost >= last.cost) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = last;
    }
    return first;
  };
  const initial = from * stride + startHeading;
  const initialCost =
    from === to && startHeading && endHeading && axis(startHeading) !== axis(endHeading) ? 20 : 0;
  dist.set(initial, initialCost);
  push(initial, initialCost);
  let finish;
  while (heap.length) {
    const current = pop();
    if (current.cost !== dist.get(current.key)) continue;
    const id = Math.floor(current.key / stride),
      dir = current.key % stride;
    if (id === to && !opposite(dir, endHeading)) {
      finish = current.key;
      break;
    }
    const x = id % width,
      y = Math.floor(id / width),
      a = point(id);
    for (const [nx, ny, nextHeading] of [
      [x - 1, y, 1],
      [x + 1, y, 2],
      [x, y - 1, 3],
      [x, y + 1, 4],
    ]) {
      if (nx < 0 || ny < 0 || nx >= X.length || ny >= Y.length) continue;
      const next = ny * width + nx;
      const nextDir = oriented ? nextHeading : axis(nextHeading);
      // Do not reverse back over an endpoint stub (or immediately retrace a segment).
      if (oriented && opposite(dir, nextHeading)) continue;
      if (next === to && opposite(nextHeading, endHeading)) continue;
      if (!allowed(next)) continue;
      const b = point(next);
      if (obstacles.some((r) => crosses(a, b, r))) continue;
      let parallelCost = 0;
      for (const [u, v] of avoid) {
        if (a.x === b.x && u.x === v.x && Math.abs(a.x - u.x) < 12)
          parallelCost +=
            10 *
            Math.max(
              0,
              Math.min(Math.max(a.y, b.y), Math.max(u.y, v.y)) -
                Math.max(Math.min(a.y, b.y), Math.min(u.y, v.y)),
            );
        if (a.y === b.y && u.y === v.y && Math.abs(a.y - u.y) < 12)
          parallelCost +=
            10 *
            Math.max(
              0,
              Math.min(Math.max(a.x, b.x), Math.max(u.x, v.x)) -
                Math.max(Math.min(a.x, b.x), Math.min(u.x, v.x)),
            );
      }
      const cost =
          current.cost +
          Math.abs(a.x - b.x) +
          Math.abs(a.y - b.y) +
          parallelCost +
          (dir && dir !== nextDir ? 20 : 0) +
          (next === to && endHeading && nextDir !== endHeading ? 20 : 0),
        key = next * stride + nextDir;
      if (cost < (dist.get(key) ?? Infinity)) {
        dist.set(key, cost);
        previous.set(key, current.key);
        push(key, cost);
      }
    }
  }
  if (finish === undefined)
    throw new Error('No clear orthogonal route exists. Increase spacing or change attachment sides.');
  const points = [];
  for (let k = finish; k !== undefined; k = previous.get(k)) points.push(point(Math.floor(k / stride)));
  return points.reverse();
}
