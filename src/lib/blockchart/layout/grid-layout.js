import { translateNode } from './translate.js';
import { groupGeometry } from './groups.js';
import { defaultSide } from '../port-sides.js';
import { gridRegions } from '../grid.js';

/** Arrange existing node envelopes; callers must reroute connections afterwards. */
export async function arrangeGrids(result, model, elk) {
  const all = [...result.modules, ...result.groups],
    nodes = new Map(all.map((n) => [n.id, n])),
    refs = new Map([...model.modules, ...model.groups].map((n) => [n.id, n]));
  for (const t of result.terminals ?? []) nodes.set('@terminal:' + t.id, t);
  function shift(node, dx, dy, descendants = true) {
    translateNode(node, dx, dy);
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
    const signalWrapper = refs.get(id)?._signalWrapper;
    const source = signalWrapper ? nodes.get(node.members[0]) : null;
    const previous = source ? { width: source.width, height: source.height } : null;
    for (const child of node.members) await group(child);
    if (signalWrapper) {
      const dw = source.width - previous.width,
        dh = source.height - previous.height;
      for (const child of node.members.slice(1)) {
        const signal = nodes.get(child);
        shift(
          signal,
          model.layout.direction === 'down' ? dw / 2 : model.layout.direction === 'left' ? 0 : dw,
          model.layout.direction === 'down' ? dh : dh / 2,
        );
      }
      node.width = Math.max(...node.members.map((id) => nodes.get(id).x + nodes.get(id).width - node.x));
      node.height = Math.max(...node.members.map((id) => nodes.get(id).y + nodes.get(id).height - node.y));
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
    roots = all.filter((n) => !contained.has(n.id) && !n._signalTerminal),
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
        const wrapper = result.groups.find((g) => g._signalTerminal === t.id),
          packed = wrapper ?? t;
        const down = model.layout.direction === 'down',
          x = down ? cursor : direction === 'input' ? left - 60 - packed.width : right + 60,
          y = down ? (direction === 'input' ? top - 60 - packed.height : bottom + 60) : cursor,
          dx = x - packed.x,
          dy = y - packed.y;
        if (wrapper) {
          shift(wrapper, dx, dy);
          cursor += (down ? packed.width : packed.height) + 24;
          continue;
        }
        translateNode(t, dx, dy);
        cursor += (down ? t.width : t.height) + 24;
      }
    }
  }
}
