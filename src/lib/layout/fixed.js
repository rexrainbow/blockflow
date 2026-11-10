import { groupGeometry } from './groups.js';
import { ancestors } from '../hierarchy.js';
import { sideVector, defaultSide } from '../port-sides.js';
import { gridRegions } from '../grid.js';

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
const inside = (p, r) =>
  p.x > r.x + eps && p.x < r.x + r.width - eps && p.y > r.y + eps && p.y < r.y + r.height - eps;
const inflate = (r, n) => ({ x: r.x - n, y: r.y - n, width: r.width + 2 * n, height: r.height + 2 * n });

export async function arrangeGrids(result, model, elk) {
  const all = [...result.modules, ...result.groups],
    nodes = new Map(all.map((n) => [n.id, n])),
    refs = new Map([...model.modules, ...model.groups].map((n) => [n.id, n]));
  function shift(node, dx, dy, descendants = true) {
    node.x += dx;
    node.y += dy;
    for (const key of ['labelPosition', 'labelBounds']) {
      node[key].x += dx;
      node[key].y += dy;
    }
    for (const p of node.ports ?? []) {
      p.x += dx;
      p.y += dy;
      p.labelPosition.x += dx;
      p.labelPosition.y += dy;
      p.labelBounds.x += dx;
      p.labelBounds.y += dy;
    }
    if (descendants && node.members && !node.collapsed)
      for (const id of node.members) {
        const child = nodes.get(id);
        if (child) shift(child, dx, dy);
      }
  }
  const zero = { top: 0, left: 0, right: 0, bottom: 0 };
  async function place(children, config, origin, pad) {
    if (config?.type === 'grid') {
      const frames = (config.expandGroups ?? []).map((id) => nodes.get(id));
      children = children.flatMap((n) =>
        config.expandGroups?.includes(n.id) ? n.members.map((id) => nodes.get(id)).filter(Boolean) : [n],
      );
      const selected = new Set(config.cells.flat().filter((id) => id !== null));
      const fixed = children.filter((n) => selected.has(n.id));
      const automatic = children.filter((n) => !selected.has(n.id));
      if (fixed.length && automatic.length) {
        // A layout-only rectangle reserves the entire Grid, including empty tracks.
        // Its causal edges are projections of real signals; it never enters the model.
        const size = await place(fixed, config, { x: 0, y: 0 }, zero);
        const proxy = { id: '@grid', ...size };
        const owner = new Map();
        function register(n, id) {
          owner.set(n.id, id);
          if (!n.collapsed)
            for (const child of n.members ?? []) {
              const nested = nodes.get(child);
              if (nested) register(nested, id);
            }
        }
        for (const n of children) register(n, selected.has(n.id) ? proxy.id : n.id);
        const edges = model.connections
          .filter((e) => e.constraint !== false)
          .flatMap((e) => {
            const source = owner.get(e.source.moduleId),
              target = owner.get(e.target.moduleId);
            return source && target && source !== target
              ? [
                  {
                    id: e.id,
                    sources: [source],
                    targets: [target],
                    layoutOptions: { 'elk.layered.priority.direction': e.feedback ? '0' : '10' },
                  },
                ]
              : [];
          });
        const layout = await elk.layout({
          id: '@partial-grid',
          layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': model.layout.direction.toUpperCase(),
            'elk.padding': '[top=0,left=0,bottom=0,right=0]',
            'elk.spacing.nodeNode': String(model.layout.moduleSpacing),
            'elk.spacing.componentComponent': String(model.layout.moduleSpacing),
            'elk.layered.spacing.nodeNodeBetweenLayers': String(model.layout.layerSpacing),
            'elk.randomSeed': '1',
            ...(model.layout.placement === 'simple'
              ? { 'elk.layered.nodePlacement.strategy': 'SIMPLE' }
              : {}),
            ...(model.layout.placement === 'relaxed'
              ? { 'elk.layered.nodePlacement.favorStraightEdges': 'false' }
              : {}),
          },
          children: [proxy, ...automatic].map((n) => ({ id: n.id, width: n.width, height: n.height })),
          edges,
        });
        for (const placed of layout.children) {
          const x = origin.x + pad.left + placed.x,
            y = origin.y + pad.top + placed.y;
          if (placed.id === proxy.id) {
            for (const n of fixed) shift(n, x, y);
            for (const n of frames) shift(n, x, y, false);
          } else {
            const n = nodes.get(placed.id);
            shift(n, x - n.x, y - n.y);
          }
        }
        return { width: pad.left + layout.width + pad.right, height: pad.top + layout.height + pad.bottom };
      }
      if (!fixed.length) return place(children, undefined, origin, pad);
      const rows = config.cells,
        cols = rows[0].length,
        cw = Array(cols).fill(0),
        rh = Array(rows.length).fill(0),
        left = Array(cols).fill(0),
        right = Array(cols).fill(0),
        top = Array(rows.length).fill(0),
        bottom = Array(rows.length).fill(0),
        regions = gridRegions(rows, config.expandGroups ?? [], model.groups).map((region) => ({
          ...region,
          pad: groupGeometry(refs.get(region.id), model.layout.direction),
        }));
      rows.forEach((row, r) =>
        row.forEach((id, c) => {
          const n = nodes.get(id);
          if (n && children.includes(n)) {
            cw[c] = Math.max(cw[c], n.width);
            rh[r] = Math.max(rh[r], n.height);
          }
        }),
      );
      cw.forEach((w, c) => {
        if (!w) cw[c] = 140;
      });
      rh.forEach((h, r) => {
        if (!h) rh[r] = 84;
      });
      for (const r of regions) {
        left[r.firstColumn] = Math.max(left[r.firstColumn], r.pad.left);
        right[r.lastColumn] = Math.max(right[r.lastColumn], r.pad.right);
        top[r.firstRow] = Math.max(top[r.firstRow], r.pad.top);
        bottom[r.lastRow] = Math.max(bottom[r.lastRow], r.pad.bottom);
      }
      const sum = (values, first = 0, last = values.length - 1) =>
        values.slice(first, last + 1).reduce((a, b) => a + b, 0);
      for (const r of regions) {
        const width =
            sum(cw, r.firstColumn, r.lastColumn) +
            sum(left, r.firstColumn, r.lastColumn) -
            left[r.firstColumn] +
            sum(right, r.firstColumn, r.lastColumn) -
            right[r.lastColumn] +
            config.columnGap * (r.lastColumn - r.firstColumn) +
            r.pad.left +
            r.pad.right,
          height =
            sum(rh, r.firstRow, r.lastRow) +
            sum(top, r.firstRow, r.lastRow) -
            top[r.firstRow] +
            sum(bottom, r.firstRow, r.lastRow) -
            bottom[r.lastRow] +
            config.rowGap * (r.lastRow - r.firstRow) +
            r.pad.top +
            r.pad.bottom;
        cw[r.lastColumn] += Math.max(0, r.pad.width - width);
        rh[r.lastRow] += Math.max(0, r.pad.height - height);
      }
      const totalWidth =
          pad.left + pad.right + sum(cw) + sum(left) + sum(right) + config.columnGap * (cols - 1),
        totalHeight =
          pad.top + pad.bottom + sum(rh) + sum(top) + sum(bottom) + config.rowGap * (rows.length - 1);
      if (![totalWidth, totalHeight].every(Number.isFinite)) throw new Error('Non-finite Grid dimensions');
      const xs = [],
        ys = [];
      let y = origin.y + pad.top;
      rows.forEach((row, r) => {
        y += top[r];
        ys[r] = y;
        let x = origin.x + pad.left;
        row.forEach((id, c) => {
          x += left[c];
          xs[c] = x;
          const n = nodes.get(id);
          if (n && children.includes(n))
            shift(n, x + (cw[c] - n.width) / 2 - n.x, y + (rh[r] - n.height) / 2 - n.y);
          x += cw[c] + right[c] + config.columnGap;
        });
        y += rh[r] + bottom[r] + config.rowGap;
      });
      for (const r of regions) {
        const frame = nodes.get(r.id),
          x = xs[r.firstColumn] - r.pad.left,
          y = ys[r.firstRow] - r.pad.top;
        shift(frame, x - frame.x, y - frame.y, false);
        frame.width = xs[r.lastColumn] + cw[r.lastColumn] + r.pad.right - x;
        frame.height = ys[r.lastRow] + rh[r.lastRow] + r.pad.bottom - y;
      }
      return { width: totalWidth, height: totalHeight };
    }
    const axis = model.layout.direction === 'down' ? 'x' : 'y',
      ordered = [...children].sort((a, b) => a[axis] - b[axis]);
    for (let i = 0; i < ordered.length; i++)
      for (let j = 0; j < i; j++) {
        const a = ordered[j],
          b = ordered[i];
        if (
          b.x < a.x + a.width + 20 &&
          b.x + b.width + 20 > a.x &&
          b.y < a.y + a.height + 20 &&
          b.y + b.height + 20 > a.y
        ) {
          const delta = a[axis] + a[axis === 'x' ? 'width' : 'height'] + model.layout.moduleSpacing - b[axis];
          shift(b, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0);
        }
      }
    return {
      width: Math.max(pad.left, ...children.map((n) => n.x + n.width - origin.x)) + pad.right,
      height: Math.max(pad.top, ...children.map((n) => n.y + n.height - origin.y)) + pad.bottom,
    };
  }
  async function group(id) {
    const node = nodes.get(id);
    if (!node || node.collapsed || !node.members) return;
    const signalWrapper=refs.get(id)?._signalWrapper;
    const source=signalWrapper?nodes.get(node.members[0]):null;
    const previous=source?{width:source.width,height:source.height}:null;
    for (const child of node.members) await group(child);
    if(signalWrapper){
      const dw=source.width-previous.width,dh=source.height-previous.height;
      for(const child of node.members.slice(1)){const signal=nodes.get(child);shift(signal,model.layout.direction==='down'?dw/2:model.layout.direction==='left'?0:dw,model.layout.direction==='down'?dh:dh/2);}
      node.width=Math.max(...node.members.map(id=>nodes.get(id).x+nodes.get(id).width-node.x));
      node.height=Math.max(...node.members.map(id=>nodes.get(id).y+nodes.get(id).height-node.y));
      return;
    }
    if (externallyArranged.has(id)) return;
    const ref = refs.get(id),
      pad = groupGeometry(ref, model.layout.direction),
      children = node.members.map((id) => nodes.get(id)).filter(Boolean),
      size = await place(children, ref.layout, node, pad);
    node.width = Math.max(pad.width, size.width);
    node.height = Math.max(pad.height, size.height);
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const list = (node.ports ?? []).filter(
          (p) => (p.side ?? defaultSide(p, model.layout.direction)) === side,
        ),
        horizontal = ['top', 'bottom'].includes(side),
        leading = horizontal ? pad.left : pad.top,
        available = horizontal ? node.width - pad.left - pad.right : node.height - pad.top - pad.bottom;
      list.forEach((p, i) => {
        const old = { x: p.x, y: p.y };
        p.x = horizontal
          ? node.x + leading + (available * (i + 1)) / (list.length + 1)
          : node.x + (side === 'right' ? node.width : 0);
        p.y = horizontal
          ? node.y + (side === 'bottom' ? node.height : 0)
          : node.y + leading + (available * (i + 1)) / (list.length + 1);
        p.labelPosition.x += p.x - old.x;
        p.labelPosition.y += p.y - old.y;
        p.labelBounds.x += p.x - old.x;
        p.labelBounds.y += p.y - old.y;
      });
    }
  }
  const contained = new Set(result.groups.flatMap((g) => g.members ?? [])),
    roots = all.filter((n) => !contained.has(n.id)),
    externallyArranged = new Set();
  function prepare(children, config) {
    const expanded = config?.type === 'grid' ? (config.expandGroups ?? []) : [];
    for (const child of children)
      if (child.members && !child.collapsed) {
        if (expanded.includes(child.id)) externallyArranged.add(child.id);
        prepare(
          child.members.map((id) => nodes.get(id)).filter(Boolean),
          expanded.includes(child.id) ? undefined : refs.get(child.id).layout,
        );
      }
  }
  prepare(roots, model.rootGroupId ? undefined : model.layout);
  for (const n of roots) await group(n.id);
  await place(
    roots,
    model.rootGroupId ? undefined : model.layout,
    { x: Math.min(0, ...roots.map((n) => n.x)), y: Math.min(0, ...roots.map((n) => n.y)) },
    zero,
  );
  if (result.terminals?.length) {
    const left = Math.min(...roots.map((n) => n.x)),
      top = Math.min(...roots.map((n) => n.y)),
      right = Math.max(...roots.map((n) => n.x + n.width)),
      bottom = Math.max(...roots.map((n) => n.y + n.height));
    for (const direction of ['input', 'output']) {
      let cursor = model.layout.direction === 'down' ? left : top;
      for (const t of result.terminals.filter((t) => t.direction === direction)) {
        const down = model.layout.direction === 'down',
          x = down ? cursor : direction === 'input' ? left - 60 - t.width : right + 60,
          y = down ? (direction === 'input' ? top - 60 - t.height : bottom + 60) : cursor,
          dx = x - t.x,
          dy = y - t.y;
        t.x = x;
        t.y = y;
        for (const k of ['anchor', 'labelPosition', 'labelBounds']) {
          t[k].x += dx;
          t[k].y += dy;
        }
        cursor += (down ? t.width : t.height) + 24;
      }
    }
  }
}

// Sparse rectilinear visibility graph. Only adjacent coordinates are connected;
// heap search includes a bend penalty and never crosses an obstacle interior.
function route(start, end, obstacles, bounds, clearance, avoid = []) {
  const xs = new Set([start.x, end.x]),
    ys = new Set([start.y, end.y]);
  for (const r of obstacles) {
    xs.add(r.x);
    xs.add(r.x + r.width);
    ys.add(r.y);
    ys.add(r.y + r.height);
  }
  for(const [a,b] of avoid) {
    if(a.x===b.x) {xs.add(a.x-16);xs.add(a.x+16);}
    if(a.y===b.y) {ys.add(a.y-16);ys.add(a.y+16);}
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
    throw new Error('Fixed routing graph is too large; split the diagram into smaller groups.');
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
    throw new Error('Port access is obstructed in fixed layout. Increase Grid gaps or change port sides.');
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
  const initial = from * 3;
  dist.set(initial, 0);
  push(initial, 0);
  let finish;
  while (heap.length) {
    const current = pop();
    if (current.cost !== dist.get(current.key)) continue;
    const id = Math.floor(current.key / 3),
      dir = current.key % 3;
    if (id === to) {
      finish = current.key;
      break;
    }
    const x = id % width,
      y = Math.floor(id / width),
      a = point(id);
    for (const [nx, ny, nextDir] of [
      [x - 1, y, 1],
      [x + 1, y, 1],
      [x, y - 1, 2],
      [x, y + 1, 2],
    ]) {
      if (nx < 0 || ny < 0 || nx >= X.length || ny >= Y.length) continue;
      const next = ny * width + nx;
      if (!allowed(next)) continue;
      const b = point(next);
      if (obstacles.some((r) => crosses(a, b, r))) continue;
      let parallelCost=0;
      for(const [u,v] of avoid) {
        if(a.x===b.x&&u.x===v.x&&Math.abs(a.x-u.x)<12) parallelCost+=10*Math.max(0,Math.min(Math.max(a.y,b.y),Math.max(u.y,v.y))-Math.max(Math.min(a.y,b.y),Math.min(u.y,v.y)));
        if(a.y===b.y&&u.y===v.y&&Math.abs(a.y-u.y)<12) parallelCost+=10*Math.max(0,Math.min(Math.max(a.x,b.x),Math.max(u.x,v.x))-Math.max(Math.min(a.x,b.x),Math.min(u.x,v.x)));
      }
      const cost =
          current.cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + parallelCost + (dir && dir !== nextDir ? 20 : 0),
        key = next * 3 + nextDir;
      if (cost < (dist.get(key) ?? Infinity)) {
        dist.set(key, cost);
        previous.set(key, current.key);
        push(key, cost);
      }
    }
  }
  if (finish === undefined)
    throw new Error('No clear orthogonal route in fixed layout. Increase Grid gaps or change port sides.');
  const points = [];
  for (let k = finish; k !== undefined; k = previous.get(k)) points.push(point(Math.floor(k / 3)));
  return points.reverse();
}

export function routeFixed(result, model, onlyExcluded = false, selected = null) {
  const nodes = [...result.modules, ...result.groups],
    owners = new Map(nodes.map((n) => [n.id, n])),
    refs = new Map(model.connections.map((e) => [e.id, e]));
  const ports = new Map(
    nodes.flatMap((n) => (n.ports ?? []).map((p) => [n.id + '.' + p.id, { p, node: n }])),
  );
  const terminals = new Map((result.terminals ?? []).map((t) => [t.id, t]));
  const end = (ref, peer, edge) => {
    if (ref.terminal !== undefined) {
      const t = terminals.get(ref.terminal);
      return {
        p: t.anchor,
        side:
          model.layout.direction === 'down'
            ? t.direction === 'input'
              ? 'bottom'
              : 'top'
            : t.direction === 'input'
              ? 'right'
              : 'left',
        terminal: t,
      };
    }
    const found = ports.get(ref.moduleId + '.' + ref.portId),
      isInside =
        found.node.members && (edge.insideSelfLoop || ancestors(model, peer.moduleId).includes(ref.moduleId));
    const side = found.p.side ?? defaultSide(found.p, model.layout.direction),
      vector = sideVector(side);
    return { ...found, side, vector: isInside ? { x: -vector.x, y: -vector.y } : vector };
  };
  for (const edge of result.connections) {
    if (selected && !selected.has(edge.id)) continue;
    const ref = refs.get(edge.id);
    if (onlyExcluded && ref.constraint !== false) continue;
    const a = end(ref.source, ref.target, ref),
      b = end(ref.target, ref.source, ref),
      distance = ref._signalTrunk?3:Math.max(14, edge.style.strokeWidth * 2 + 6),
      av = a.vector ?? sideVector(a.side),
      bv = b.vector ?? sideVector(b.side);
    const start = { x: a.p.x + av.x * distance, y: a.p.y + av.y * distance },
      finish = { x: b.p.x + bv.x * distance, y: b.p.y + bv.y * distance };
    const scope = ref.scope ? owners.get(ref.scope) : undefined;
    const exempt = new Set([
      ...(ref.source.moduleId ? ancestors(model, ref.source.moduleId) : []),
      ...(ref.target.moduleId ? ancestors(model, ref.target.moduleId) : []),
    ]);
    if (scope) exempt.add(scope.id);
    const obstacles = nodes
      .filter((n) => !exempt.has(n.id))
      .map((n) => inflate(n, ref._signalTrunk?1:Math.max(5, edge.style.strokeWidth / 2 + 2)));
    for (const g of result.groups)
      if (exempt.has(g.id) && !g.style.label.hidden) obstacles.push(inflate(g.labelBounds, 3));
    for (const t of result.terminals ?? [])
      if (t !== a.terminal && t !== b.terminal && !t.style.hidden) obstacles.push(inflate(t.labelBounds, 4));
    const self=ref.source.moduleId===ref.target.moduleId?owners.get(ref.source.moduleId):undefined;
    const nearby=self?inflate(self,120):undefined;
    const avoid=ref.label!==undefined&&!ref.style.label.hidden&&nearby
      ? result.connections.filter(other=>other!==edge).flatMap(other=>other.sections.flatMap(section=>section.points.slice(1).map((p,i)=>[section.points[i],p])))
        .filter(([a,b])=>Math.max(a.x,b.x)>=nearby.x&&Math.min(a.x,b.x)<=nearby.x+nearby.width&&Math.max(a.y,b.y)>=nearby.y&&Math.min(a.y,b.y)<=nearby.y+nearby.height) : [];
    const middle = route(
      start,
      finish,
      obstacles,
      scope ? { x: scope.x, y: scope.y, width: scope.width, height: scope.height } : undefined,
      model.layout.layerSpacing,
      avoid,
    );
    const full = [{ x: a.p.x, y: a.p.y }, ...middle, { x: b.p.x, y: b.p.y }],
      points = [];
    for (const p of full) {
      if (points.length && Math.abs(points.at(-1).x - p.x) < eps && Math.abs(points.at(-1).y - p.y) < eps)
        continue;
      points.push(p);
      while (points.length >= 3) {
        const [u, v, w] = points.slice(-3);
        if (
          (Math.abs(u.x - v.x) < eps && Math.abs(v.x - w.x) < eps) ||
          (Math.abs(u.y - v.y) < eps && Math.abs(v.y - w.y) < eps)
        )
          points.splice(points.length - 2, 1);
        else break;
      }
    }
    edge.sections = [{ points }];
    edge.routingInfo = {
      method: 'fixed-orthogonal',
      reason: selected ? 'port-adjustment' : ref.constraint === false ? 'non-constraining' : 'grid',
    };
  }
}
