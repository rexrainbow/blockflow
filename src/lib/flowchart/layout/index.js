import ELK from 'elkjs/lib/elk.bundled.js';
import { createFlowchartModel } from '../model.js';
import { measureNode, sidePoint, vectors, opposite, nodeText } from '../geometry.js';
import { routeOrthogonal } from '../../shared/orthogonal.js';
import { textSize } from '../../shared/text.js';

export class FlowchartLayoutError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'FlowchartLayoutError';
  }
}
const inflate = (r, gap) => ({
  x: r.x - gap,
  y: r.y - gap,
  width: r.width + 2 * gap,
  height: r.height + 2 * gap,
});
const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const simplify = (points) => {
  const result = [];
  for (const p of points) {
    if (result.length && Math.hypot(p.x - result.at(-1).x, p.y - result.at(-1).y) < 1e-6) continue;
    result.push({ ...p });
    while (result.length >= 3) {
      const [a, b, c] = result.slice(-3);
      if (
        ((Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6) ||
          (Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6)) &&
        (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0
      )
        result.splice(-2, 1);
      else break;
    }
  }
  return result;
};
/** Pure, deterministic layout. Input JSON and normalized models remain untouched. */
export async function layoutFlowchart(input) {
  const model = createFlowchartModel(input);
  try {
    return await place(model);
  } catch (error) {
    if (error instanceof FlowchartLayoutError) throw error;
    throw new FlowchartLayoutError(error.message, { cause: error });
  }
}
async function place(model) {
  const forward = { down: 'bottom', up: 'top', right: 'right', left: 'left' }[model.layout.direction];
  const vertical = ['down', 'up'].includes(model.layout.direction);
  const loopSide = model.layout.loopSide === 'auto' ? (vertical ? 'right' : 'bottom') : model.layout.loopSide;
  const refs = new Map(model.nodes.map((n) => [n.id, n]));
  const parents = new Map(model.groups.flatMap((g) => g.members.map((id) => [id, g.id])));
  const ancestors = (id) => {
    const out = [];
    for (let p = parents.get(id); p; p = parents.get(p)) out.push(p);
    return out;
  };
  const common = (a, b) => ancestors(a).find((id) => ancestors(b).includes(id));
  const sizes = new Map(model.nodes.map((n) => [n.id, measureNode(n)])),
    packs = new Map();
  const notes = new Map(model.nodes.filter((n) => n.type === 'note').map((n) => [n.attachTo, n]));
  for (const n of model.nodes.filter((n) => n.type !== 'note')) {
    const size = sizes.get(n.id),
      note = notes.get(n.id),
      gap = model.layout.noteGap;
    let x = 0,
      y = 0,
      nx = 0,
      ny = 0;
    if (note) {
      const ns = sizes.get(note.id);
      nx =
        note.side === 'right'
          ? size.width + gap
          : note.side === 'left'
            ? -gap - ns.width
            : (size.width - ns.width) / 2;
      ny =
        note.side === 'bottom'
          ? size.height + gap
          : note.side === 'top'
            ? -gap - ns.height
            : (size.height - ns.height) / 2;
      x = -Math.min(0, nx);
      y = -Math.min(0, ny);
    }
    const ns = note ? sizes.get(note.id) : { width: 0, height: 0 };
    packs.set(n.id, {
      x,
      y,
      nx: nx + x,
      ny: ny + y,
      width: Math.max(size.width, note ? nx + ns.width : 0) + x,
      height: Math.max(size.height, note ? ny + ns.height : 0) + y,
    });
  }
  const sides = new Map();
  for (const e of model.edges) {
    const loop = e.kind === 'loop';
    sides.set(e.id, {
      from: e.fromSide ?? (loop ? loopSide : forward),
      to: e.toSide ?? (loop && e.from !== e.to ? loopSide : opposite[forward]),
    });
  }
  const compiled = new Map();
  for (const n of model.nodes.filter((n) => n.type !== 'note')) {
    const pack = packs.get(n.id),
      size = sizes.get(n.id),
      ports = [];
    for (const e of model.edges.filter((e) => e.kind !== 'association'))
      for (const end of ['from', 'to'])
        if (e[end] === n.id) {
          const side = sides.get(e.id)[end],
            point = sidePoint({ x: pack.x, y: pack.y, ...size }, side);
          ports.push({
            id: '@flowchart:port:' + e.id + ':' + end,
            width: 0,
            height: 0,
            ...point,
            layoutOptions: {
              'elk.port.side': { left: 'WEST', right: 'EAST', top: 'NORTH', bottom: 'SOUTH' }[side],
            },
          });
        }
    compiled.set(n.id, {
      id: n.id,
      width: pack.width,
      height: pack.height,
      ports,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
    });
  }
  for (const g of model.groups) {
    const header = Math.max(36, g.style.fontSize * 1.5 + 16),
      padding = { left: 24, right: 24, top: header + 12, bottom: 24 };
    const count = model.edges.filter((e) => e.kind === 'loop' && common(e.from, e.to) === g.id).length;
    padding[loopSide] += count * 40;
    compiled.set(g.id, {
      id: g.id,
      labels: [{ text: g.label, ...textSize(g.label, g.style) }],
      layoutOptions: {
        'elk.padding': `[top=${padding.top},left=${padding.left},bottom=${padding.bottom},right=${padding.right}]`,
      },
      children: [],
    });
  }
  for (const g of model.groups)
    compiled.get(g.id).children = g.members.filter((id) => compiled.has(id)).map((id) => compiled.get(id));
  const graph = {
    id: '@flowchart:root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': model.layout.direction.toUpperCase(),
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': String(model.layout.nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(model.layout.layerSpacing),
      'elk.randomSeed': '1',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
    },
    children: [...compiled.values()].filter((n) => !parents.has(n.id)),
    edges: model.edges
      .filter((e) => e.kind === 'flow')
      .map((e) => ({
        id: '@flowchart:edge:' + e.id,
        sources: ['@flowchart:port:' + e.id + ':from'],
        targets: ['@flowchart:port:' + e.id + ':to'],
        ...(e.label ? { labels: [{ text: e.label, ...textSize(e.label, e.style) }] } : {}),
      })),
  };
  const laid = await new ELK().layout(graph),
    absolute = new Map();
  function collect(n, x = 0, y = 0) {
    const point = { x: x + (n.x ?? 0), y: y + (n.y ?? 0) };
    absolute.set(n.id, { ...n, ...point });
    for (const child of n.children ?? []) collect(child, point.x, point.y);
  }
  collect(laid);
  const nodes = [];
  for (const n of model.nodes.filter((n) => n.type !== 'note')) {
    const placed = absolute.get(n.id),
      pack = packs.get(n.id);
    nodes.push({ ...structuredClone(n), x: placed.x + pack.x, y: placed.y + pack.y, ...sizes.get(n.id) });
    const note = notes.get(n.id);
    if (note)
      nodes.push({
        ...structuredClone(note),
        x: placed.x + pack.nx,
        y: placed.y + pack.ny,
        ...sizes.get(note.id),
      });
  }
  nodes.sort(
    (a, b) => model.nodes.findIndex((n) => n.id === a.id) - model.nodes.findIndex((n) => n.id === b.id),
  );
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const text = nodeText(n);
    n.labelPosition = text.position;
    n.labelBounds = text.bounds;
  }
  const groups = model.groups.map((g) => {
    const p = absolute.get(g.id);
    return {
      ...structuredClone(g),
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      labelPosition: { x: p.x + 16, y: p.y + 20, anchor: 'start' },
      labelBounds: { x: p.x + 12, y: p.y + 8, ...textSize(g.label, g.style) },
    };
  });
  groups.sort((a, b) => ancestors(a.id).length - ancestors(b.id).length);
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const edges = [],
    lanes = new Map();
  for (const edge of model.edges) {
    const a = nodeMap.get(edge.from),
      b = nodeMap.get(edge.to),
      side = sides.get(edge.id);
    if (edge.kind === 'association') {
      const note = a.type === 'note' ? a : b,
        owner = a.type === 'note' ? b : a;
      const outward = note.side ?? (vertical ? 'right' : 'bottom');
      side.from = a === owner ? outward : opposite[outward];
      side.to = b === note ? opposite[outward] : outward;
    }
    const start = sidePoint(a, side.from),
      end = sidePoint(b, side.to),
      av = vectors[side.from],
      bv = vectors[side.to],
      distance = Math.max(14, edge.style.strokeWidth * 2 + 8);
    const access = { x: start.x + av.x * distance, y: start.y + av.y * distance },
      finish = { x: end.x + bv.x * distance, y: end.y + bv.y * distance };
    const exempt = new Set([...ancestors(a.id), ...ancestors(b.id)]),
      scope = groupMap.get(common(a.id, b.id));
    const obstacles = [...nodes, ...groups.filter((g) => !exempt.has(g.id))].map((n) => inflate(n, 5));
    for (const g of groups.filter((g) => exempt.has(g.id))) obstacles.push(inflate(g.labelBounds, 4));
    const bounds = scope
      ? {
          x: scope.x + 8,
          y: scope.y + scope.style.fontSize * 1.5 + 20,
          width: scope.width - 16,
          height: scope.height - scope.style.fontSize * 1.5 - 28,
        }
      : undefined;
    const waypoints = [access];
    if (edge.kind === 'loop') {
      const laneKey = (scope?.id ?? 'root') + loopSide,
        index = lanes.get(laneKey) ?? 0;
      lanes.set(laneKey, index + 1);
      const all = [...nodes, ...groups],
        axis = ['left', 'right'].includes(loopSide) ? 'x' : 'y',
        extent = axis === 'x' ? 'width' : 'height';
      const lane = scope
        ? loopSide === 'right'
          ? scope.x + scope.width - 18 - index * 28
          : loopSide === 'left'
            ? scope.x + 18 + index * 28
            : loopSide === 'bottom'
              ? scope.y + scope.height - 18 - index * 28
              : bounds.y + 12 + index * 28
        : loopSide === 'right' || loopSide === 'bottom'
          ? Math.max(...all.map((n) => n[axis] + n[extent])) + 36 + index * 28
          : Math.min(...all.map((n) => n[axis])) - 36 - index * 28;
      const turn = { ...finish, [axis]: lane };
      const targetNote = nodes.find((n) => n.type === 'note' && n.attachTo === b.id && n.side === loopSide);
      if (targetNote) {
        const tangent = axis === 'x' ? 'y' : 'x',
          size = axis === 'x' ? 'height' : 'width';
        turn[tangent] =
          access[tangent] >= finish[tangent]
            ? Math.max(finish[tangent], targetNote[tangent] + targetNote[size] + 10)
            : Math.min(finish[tangent], targetNote[tangent] - 10);
      }
      waypoints.push({ ...access, [axis]: lane }, turn);
    }
    waypoints.push(finish);
    const parts = [];
    for (let i = 1; i < waypoints.length; i++)
      parts.push(
        ...routeOrthogonal(waypoints[i - 1], waypoints[i], obstacles, bounds, model.layout.layerSpacing),
      );
    const points = simplify([start, ...parts, end]);
    edges.push({ ...structuredClone(edge), fromSide: side.from, toSide: side.to, sections: [{ points }] });
  }
  const warnings = [],
    labelBoxes = [];
  for (const edge of edges.filter((e) => e.label !== undefined)) {
    const size = textSize(edge.label, edge.style),
      width = size.width + 8,
      height = size.height + 6,
      candidates = [];
    const pts = edge.sections[0].points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        h = Math.abs(dy) < 1e-6,
        length = Math.abs(dx) + Math.abs(dy);
      if (length < 12) continue;
      for (const fraction of [Math.min((h ? width : height) / 2 + 12, length / 2) / length, 0.25, 0.5, 0.75])
        for (const sign of [1, -1]) {
          const x = a.x + dx * fraction + (h ? 0 : sign * (width / 2 + 5)),
            y = a.y + dy * fraction + (h ? sign * (height / 2 + 5) : 0);
          candidates.push({ x: x - width / 2, y: y - height / 2, width, height });
        }
    }
    const blockers = [...nodes, ...groups.map((g) => g.labelBounds), ...labelBoxes];
    let box = candidates.find((c) => !blockers.some((b) => overlaps(inflate(c, 3), b)));
    if (!box) {
      box = candidates[0] ?? { x: pts[0].x + 10, y: pts[0].y + 10, width, height };
      warnings.push({
        code: 'FLOW_LABEL_OVERLAP',
        edgeId: edge.id,
        message: 'Could not place the condition label with full clearance.',
      });
    }
    labelBoxes.push(box);
    edge.labelBounds = box;
    edge.labelPosition = { x: box.x + width / 2, y: box.y + height / 2, anchor: 'middle' };
  }
  const all = [
    ...nodes,
    ...groups,
    ...labelBoxes,
    ...edges.flatMap((e) =>
      e.sections.flatMap((s) =>
        s.points.map((p) => {
          const half = Math.max(8, e.style.strokeWidth * 1.5);
          return { x: p.x - half, y: p.y - half, width: 2 * half, height: 2 * half };
        }),
      ),
    ),
  ];
  const minX = Math.min(...all.map((n) => n.x)) - 24,
    minY = Math.min(...all.map((n) => n.y)) - 24;
  const width = Math.max(...all.map((n) => n.x + n.width)) - minX + 24,
    height = Math.max(...all.map((n) => n.y + n.height)) - minY + 24;
  const shift = (p) => {
    p.x -= minX;
    p.y -= minY;
  };
  for (const n of [...nodes, ...groups]) {
    shift(n);
    shift(n.labelPosition);
    shift(n.labelBounds);
  }
  for (const e of edges) {
    for (const s of e.sections) s.points.forEach(shift);
    if (e.labelBounds) {
      shift(e.labelBounds);
      shift(e.labelPosition);
    }
  }
  const result = {
    version: 1,
    diagram: structuredClone(model.diagram),
    width,
    height,
    nodes,
    groups,
    edges,
    ...(warnings.length ? { warnings } : {}),
  };
  if (model.diagram.caption) {
    const size = textSize(model.diagram.caption, { fontSize: 11 });
    result.caption = {
      text: model.diagram.caption,
      position: { x: 24, y: height + size.height / 2, anchor: 'start' },
    };
    result.height += size.height + 24;
    result.width = Math.max(width, size.width + 48);
  }
  return result;
}
