const eps = 1e-6;
const heading = (v) => (!v ? 0 : v.x < 0 ? 1 : v.x > 0 ? 2 : v.y < 0 ? 3 : v.y > 0 ? 4 : 0);
const axis = (dir) => (dir <= 2 ? 1 : 2);
const opposite = (a, b) => a && b && a !== b && axis(a) === axis(b);

const stepX = [-1, 1, 0, 0];
const stepY = [0, 0, -1, 1];

// Filter lazily and in input order so parallel penalties sum in the same order.
// Limit retained references on long, narrow grids spanned by many obstacles.
function candidatesByCoordinate(coordinates, items, matches, budget) {
  const lists = new Array(coordinates.length);
  return (index) => {
    if (lists[index]) return lists[index];
    const candidates = items.filter((item) => matches(item, coordinates[index]));
    if (candidates.length <= budget) {
      lists[index] = candidates;
      budget -= candidates.length;
    }
    return candidates;
  };
}

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
  let minX = Math.min(start.x, end.x),
    maxX = Math.max(start.x, end.x),
    minY = Math.min(start.y, end.y),
    maxY = Math.max(start.y, end.y);
  for (const r of obstacles) {
    minX = Math.min(minX, r.x, r.x + r.width);
    maxX = Math.max(maxX, r.x, r.x + r.width);
    minY = Math.min(minY, r.y, r.y + r.height);
    maxY = Math.max(maxY, r.y, r.y + r.height);
  }
  xs.add(minX - clearance);
  xs.add(maxX + clearance);
  ys.add(minY - clearance);
  ys.add(maxY + clearance);
  const X = [...xs]
      .filter((x) => !bounds || (x >= bounds.x - eps && x <= bounds.x + bounds.width + eps))
      .sort((a, b) => a - b),
    Y = [...ys]
      .filter((y) => !bounds || (y >= bounds.y - eps && y <= bounds.y + bounds.height + eps))
      .sort((a, b) => a - b);
  if (X.length * Y.length > 250000)
    throw new Error('Orthogonal routing graph is too large; reduce diagram complexity.');
  const width = X.length,
    height = Y.length,
    nodes = width * height,
    from = Y.indexOf(start.y) * width + X.indexOf(start.x),
    to = Y.indexOf(end.y) * width + X.indexOf(end.x);

  const obstaclesInColumn = candidatesByCoordinate(
    X,
    obstacles,
    (r, x) => x > r.x + eps && x < r.x + r.width - eps,
    nodes,
  );
  const obstaclesInRow = candidatesByCoordinate(
    Y,
    obstacles,
    (r, y) => y > r.y + eps && y < r.y + r.height - eps,
    nodes,
  );
  const avoidInColumn = candidatesByCoordinate(
    X,
    avoid,
    ([u, v], x) => u.x === v.x && Math.abs(x - u.x) < 12,
    nodes,
  );
  const avoidInRow = candidatesByCoordinate(
    Y,
    avoid,
    ([u, v], y) => u.y === v.y && Math.abs(y - u.y) < 12,
    nodes,
  );

  const valid = new Uint8Array(nodes);
  const allowed = (id) => {
    if (!valid[id]) {
      const xi = id % width,
        yi = Math.floor(id / width),
        y = Y[yi];
      valid[id] = obstaclesInColumn(xi).some((r) => y > r.y + eps && y < r.y + r.height - eps) ? 1 : 2;
    }
    return valid[id] === 2;
  };
  const links = new Float64Array(nodes * 2).fill(NaN);
  const linkCost = (id, next, ax, ay, bx, by) => {
    const key = Math.min(id, next) * 2 + (ay === by ? 0 : 1);
    const cached = links[key];
    if (!Number.isNaN(cached)) return cached;
    // Obstacle interiors use the geometry epsilon; parallel ink requires an exact axis.
    if (Math.abs(ay - by) < eps) {
      const lo = Math.min(ax, bx),
        hi = Math.max(ax, bx);
      for (const r of obstaclesInRow(Math.floor(id / width)))
        if (hi > r.x + eps && lo < r.x + r.width - eps) return (links[key] = Infinity);
    } else {
      const lo = Math.min(ay, by),
        hi = Math.max(ay, by);
      for (const r of obstaclesInColumn(id % width))
        if (hi > r.y + eps && lo < r.y + r.height - eps) return (links[key] = Infinity);
    }
    let penalty = 0;
    if (ax === bx)
      for (const [u, v] of avoidInColumn(id % width))
        penalty +=
          10 *
          Math.max(
            0,
            Math.min(Math.max(ay, by), Math.max(u.y, v.y)) - Math.max(Math.min(ay, by), Math.min(u.y, v.y)),
          );
    if (ay === by)
      for (const [u, v] of avoidInRow(Math.floor(id / width)))
        penalty +=
          10 *
          Math.max(
            0,
            Math.min(Math.max(ax, bx), Math.max(u.x, v.x)) - Math.max(Math.min(ax, bx), Math.min(u.x, v.x)),
          );
    return (links[key] = penalty);
  };
  if (from < 0 || to < 0 || !allowed(from) || !allowed(to))
    throw new Error('Endpoint access is obstructed. Increase spacing or change attachment sides.');

  // Equal costs keep their heap position. Prefer the left child on a tie.
  let heapKeys = new Int32Array(Math.min(1024, nodes * stride)),
    heapCosts = new Float64Array(heapKeys.length),
    size = 0;
  const push = (key, cost) => {
    if (size === heapKeys.length) {
      const keys = new Int32Array(size * 2),
        costs = new Float64Array(size * 2);
      keys.set(heapKeys);
      costs.set(heapCosts);
      heapKeys = keys;
      heapCosts = costs;
    }
    let i = size++;
    while (i) {
      const p = (i - 1) >> 1;
      if (heapCosts[p] <= cost) break;
      heapKeys[i] = heapKeys[p];
      heapCosts[i] = heapCosts[p];
      i = p;
    }
    heapKeys[i] = key;
    heapCosts[i] = cost;
  };
  let poppedKey = 0,
    poppedCost = 0;
  const pop = () => {
    poppedKey = heapKeys[0];
    poppedCost = heapCosts[0];
    const lastKey = heapKeys[size - 1],
      lastCost = heapCosts[size - 1];
    size--;
    if (size) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= size) break;
        if (c + 1 < size && heapCosts[c + 1] < heapCosts[c]) c++;
        if (heapCosts[c] >= lastCost) break;
        heapKeys[i] = heapKeys[c];
        heapCosts[i] = heapCosts[c];
        i = c;
      }
      heapKeys[i] = lastKey;
      heapCosts[i] = lastCost;
    }
  };
  const dist = new Float64Array(nodes * stride).fill(Infinity),
    previous = new Int32Array(nodes * stride).fill(-1);
  const initial = from * stride + startHeading;
  const initialCost =
    from === to && startHeading && endHeading && axis(startHeading) !== axis(endHeading) ? 20 : 0;
  dist[initial] = initialCost;
  push(initial, initialCost);
  let finish = -1;
  while (size) {
    pop();
    const currentKey = poppedKey,
      currentCost = poppedCost;
    if (currentCost !== dist[currentKey]) continue;
    const id = Math.floor(currentKey / stride),
      dir = currentKey % stride;
    if (id === to && !opposite(dir, endHeading)) {
      finish = currentKey;
      break;
    }
    const x = id % width,
      y = Math.floor(id / width),
      ax = X[x],
      ay = Y[y];
    for (let n = 0; n < 4; n++) {
      const nx = x + stepX[n],
        ny = y + stepY[n],
        nextHeading = n + 1;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      const nextDir = oriented ? nextHeading : axis(nextHeading);
      if (oriented && opposite(dir, nextHeading)) continue;
      if (next === to && opposite(nextHeading, endHeading)) continue;
      if (!allowed(next)) continue;
      const bx = X[nx],
        by = Y[ny];
      const parallelCost = linkCost(id, next, ax, ay, bx, by);
      if (!Number.isFinite(parallelCost)) continue;
      const cost =
          currentCost +
          Math.abs(ax - bx) +
          Math.abs(ay - by) +
          parallelCost +
          (dir && dir !== nextDir ? 20 : 0) +
          (next === to && endHeading && nextDir !== endHeading ? 20 : 0),
        key = next * stride + nextDir;
      if (cost < dist[key]) {
        dist[key] = cost;
        previous[key] = currentKey;
        push(key, cost);
      }
    }
  }
  if (finish < 0)
    throw new Error('No clear orthogonal route exists. Increase spacing or change attachment sides.');
  // Create path points only during reconstruction. A loop revisits the same point object.
  const shared = new Map(),
    point = (id) => {
      let p = shared.get(id);
      if (!p) shared.set(id, (p = { x: X[id % width], y: Y[Math.floor(id / width)] }));
      return p;
    };
  const points = [];
  for (let k = finish; k !== -1; k = previous[k]) points.push(point(Math.floor(k / stride)));
  return points.reverse();
}
