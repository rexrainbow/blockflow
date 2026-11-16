import ELK from 'elkjs/lib/elk.bundled.js';
import { createFlowchartModel } from '../model.js';
import { measureNode, sidePoint, opposite, nodeText } from '../geometry.js';
import { routeFlowEdge } from './loop-routing.js';
import { placeEdgeLabels } from './labels.js';
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
/** Pure, deterministic layout. Input JSON and normalized models remain untouched. */
export async function layoutFlowchart(input) {
  const model = createFlowchartModel(input);
  return layoutGraph(model);
}
/** Internal Flowchart geometry seam; the model is already validated. */
export async function layoutGraph(model, geometry = { measureNode, nodeText }) {
  try {
    return await place(model, geometry);
  } catch (error) {
    if (error instanceof FlowchartLayoutError) throw error;
    throw new FlowchartLayoutError(error.message, { cause: error });
  }
}
async function place(model, { measureNode, nodeText }) {
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
    if (model.layout.loopSide === 'auto') {
      for (const side of vertical ? ['left', 'right'] : ['top', 'bottom']) padding[side] += count * 40;
    } else padding[loopSide] += count * 40;
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
    routingInputs = new Map(),
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
    const routing = {
      edge,
      a,
      b,
      side,
      loopSide,
      auto: model.layout.loopSide === 'auto',
      vertical,
      forward,
      nodes,
      groups,
      localGroups: groups.filter((g) => !exempt.has(g.id)),
      obstacles,
      bounds,
      scope,
      lanes,
      clearance: model.layout.layerSpacing,
    };
    routingInputs.set(edge.id, routing);
    const route = routeFlowEdge(routing);
    edges.push({
      ...structuredClone(edge),
      fromSide: route.side.from,
      toSide: route.side.to,
      sections: [{ points: route.points }],
    });
  }
  const { warnings, labelBoxes } = placeEdgeLabels({
    edges,
    nodes,
    groups,
    reroute(edge, boxes) {
      const input = routingInputs.get(edge.id);
      try {
        const route = routeFlowEdge({
          ...input,
          side: { from: edge.fromSide, to: edge.toSide },
          auto: false,
          lanes: new Map(lanes),
          obstacles: [
            ...input.obstacles,
            ...boxes.map((box) => inflate(box, edge.style.strokeWidth / 2 + 4)),
          ],
        });
        const length = (points) =>
          points
            .slice(1)
            .reduce((sum, p, i) => sum + Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y), 0);
        const box = boxes.at(-1);
        if (
          length(route.points) >
          length(edge.sections[0].points) + 2 * (box.width + box.height + input.clearance)
        )
          return undefined;
        return {
          ...edge,
          fromSide: route.side.from,
          toSide: route.side.to,
          sections: [{ points: route.points }],
        };
      } catch {
        // An unsuccessful local trial must retain the valid original route.
        return undefined;
      }
    },
  });
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
