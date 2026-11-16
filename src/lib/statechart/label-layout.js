import ELK from 'elkjs/lib/elk.bundled.js';
import { measureNode, nodeText, opposite } from '../flowchart/geometry.js';
import { textSize } from '../shared/text.js';
import { STATECHART_LAYOUT_DEFAULTS } from './model.js';

export class StatechartLayoutError extends Error {
  constructor(message, path = '') {
    super(message);
    this.name = 'StatechartLayoutError';
    this.path = path;
  }
}
export function wrapCondition(value, style, maxWidth) {
  const out = [];
  for (const row of value.replace(/\r\n?/g, '\n').split('\n')) {
    const firstLine = out.length;
    let line = '';
    for (const token of row.split(/(\s+)/).filter(Boolean)) {
      if (textSize(line + token, style).width <= maxWidth) {
        line += token;
        continue;
      }
      if (line.trim()) {
        out.push(line.trimEnd());
        line = '';
      }
      if (!token.trim()) continue;
      for (const char of token) {
        if (line && textSize(line + char, style).width > maxWidth) {
          out.push(line);
          line = '';
        }
        line += char;
      }
    }
    if (line || out.length === firstLine) out.push(line.trimEnd());
  }
  return out.join('\n');
}
export const segments = (edge) =>
  edge.sections.flatMap((s) => s.points.slice(1).map((p, i) => [s.points[i], p]));
export function segmentCrossesBox(a, b, r, margin = 0) {
  const x = r.x - margin,
    y = r.y - margin,
    w = r.width + 2 * margin,
    h = r.height + 2 * margin,
    eps = 1e-6;
  return Math.abs(a.y - b.y) < eps
    ? a.y > y + eps && a.y < y + h - eps && Math.max(a.x, b.x) > x + eps && Math.min(a.x, b.x) < x + w - eps
    : a.x > x + eps && a.x < x + w - eps && Math.max(a.y, b.y) > y + eps && Math.min(a.y, b.y) < y + h - eps;
}
const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
export function labelConflicts(layout) {
  const issues = [];
  for (const edge of layout.transitions) {
    const path = segments(edge);
    if (
      !path.length ||
      path.some(
        ([a, b]) =>
          !Number.isFinite(a.x + a.y + b.x + b.y) ||
          (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6),
      )
    )
      issues.push({ edgeId: edge.id, reason: 'Invalid orthogonal route' });
    for (const state of layout.states)
      if (path.some(([a, b]) => segmentCrossesBox(a, b, state)))
        issues.push({ edgeId: edge.id, stateId: state.id });
  }
  for (const edge of layout.transitions.filter((e) => e.labelBounds)) {
    const box = edge.labelBounds;
    for (const other of layout.transitions) {
      const hits = segments(other).filter(([a, b]) =>
        segmentCrossesBox(a, b, box, other.id === edge.id ? 0 : 3 + other.style.strokeWidth / 2),
      );
      if (other.id === edge.id ? hits.length !== 1 : hits.length > 0)
        issues.push({ labelId: edge.id, edgeId: other.id });
    }
    for (const state of layout.states)
      if (overlaps(box, state)) issues.push({ labelId: edge.id, stateId: state.id });
    for (const other of layout.transitions)
      if (other.labelBounds && other.id !== edge.id && overlaps(box, other.labelBounds))
        issues.push({ labelId: edge.id, labelId2: other.id });
  }
  return issues;
}
const compact = (points) => {
  const out = [];
  for (const p of points) {
    if (out.length && Math.hypot(p.x - out.at(-1).x, p.y - out.at(-1).y) < 1e-6) continue;
    out.push({ ...p });
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      if (
        ((Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6) ||
          (Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6)) &&
        (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0
      )
        out.splice(-2, 1);
      else break;
    }
  }
  return out;
};
const sideName = { left: 'WEST', right: 'EAST', top: 'NORTH', bottom: 'SOUTH' };
const portPoint = (side, w, h) => ({
  x: side === 'left' ? 0 : side === 'right' ? w : w / 2,
  y: side === 'top' ? 0 : side === 'bottom' ? h : h / 2,
});
function stateSide(port, node) {
  return ['left', 'right', 'top', 'bottom'].sort((a, b) => {
    const distance = (side) =>
      side === 'left'
        ? Math.abs(port.x)
        : side === 'right'
          ? Math.abs(port.x - node.width)
          : side === 'top'
            ? Math.abs(port.y)
            : Math.abs(port.y - node.height);
    return distance(a) - distance(b);
  })[0];
}
export async function placeStatechart(model, graph, scale = 1, plan = null) {
  const vertical = ['down', 'up'].includes(graph.layout.direction),
    forward = { down: 'bottom', up: 'top', right: 'right', left: 'left' }[graph.layout.direction];
  const statesById = new Map(model.states.map((s) => [s.id, s]));
  const pairs = new Set(),
    transitions = graph.edges.map((edge) => {
      const e = structuredClone(edge),
        pair = JSON.stringify([e.from, e.to]);
      if (pairs.has(pair)) e.kind = 'loop';
      pairs.add(pair);
      return e;
    });
  const nodes = new Map(
    graph.nodes.map((n) => {
      const state = statesById.get(n.id),
        diameter = Math.max(20, 2 * n.style.borderWidth + 10);
      return [
        n.id,
        {
          id: n.id,
          ...(state.kind === 'state' ? measureNode(n) : { width: diameter, height: diameter }),
          ports: [],
          layoutOptions: { 'elk.portConstraints': state.kind === 'state' ? 'FIXED_SIDE' : 'FIXED_POS' },
        },
      ];
    }),
  );
  const labels = new Map(),
    edges = [],
    connections = new Map();
  function priorities(edge) {
    if (!plan || plan.baseline) return {};
    const owner = plan.topology.satellites;
    const branch = owner.get(edge.to) === edge.from,
      resume = owner.get(edge.from) === edge.to;
    const backbone = plan.backbone.has(JSON.stringify([edge.from, edge.to]));
    return {
      'elk.layered.priority.direction': String(
        backbone ? 100 : branch ? 30 : resume || edge.kind === 'loop' ? 1 : 10,
      ),
      'elk.layered.priority.straightness': String(backbone ? 100 : branch || resume ? 20 : 1),
      'elk.layered.priority.shortness': String(branch || resume ? 20 : backbone ? 10 : 1),
    };
  }
  transitions.forEach((edge, index) => {
    const loop = edge.kind === 'loop',
      self = edge.from === edge.to;
    const fromSide =
      edge.fromSide ?? (self ? (vertical ? 'right' : 'bottom') : loop ? opposite[forward] : forward);
    const toSide = edge.toSide ?? (self ? opposite[forward] : loop ? forward : opposite[forward]);
    const fromId = `@statechart:port:${index}:from`,
      toId = `@statechart:port:${index}:to`;
    for (const [id, owner, side] of [
      [fromId, edge.from, fromSide],
      [toId, edge.to, toSide],
    ]) {
      const n = nodes.get(owner);
      n.ports.push({
        id,
        width: 0,
        height: 0,
        ...(statesById.get(owner).kind !== 'state' ? portPoint(side, n.width, n.height) : {}),
        layoutOptions: { 'elk.port.side': sideName[side] },
      });
    }
    const parts = [];
    if (edge.label !== undefined) {
      const displayLabel = wrapCondition(
          edge.label,
          edge.style,
          model.layout?.labelMaxWidth ?? STATECHART_LAYOUT_DEFAULTS.labelMaxWidth,
        ),
        size = textSize(displayLabel, edge.style),
        guard = Math.max(8, edge.style.strokeWidth * 2 + 4);
      const width = size.width + 8,
        height = size.height + 6,
        id = `@statechart:label:${index}`,
        w = width + 2 * guard,
        h = height + 2 * guard;
      const inSide = loop && !self ? forward : opposite[forward],
        outSide = opposite[inSide];
      const input = id + ':in',
        output = id + ':out';
      nodes.set(id, {
        id,
        width: w,
        height: h,
        ports: [
          [input, inSide],
          [output, outSide],
        ].map(([pid, side]) => ({
          id: pid,
          width: 0,
          height: 0,
          ...portPoint(side, w, h),
          layoutOptions: { 'elk.port.side': sideName[side] },
        })),
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      });
      labels.set(edge.id, { nodeId: id, displayLabel, width, height, guard });
      for (const [suffix, source, target] of [
        ['in', fromId, input],
        ['out', output, toId],
      ]) {
        const eid = `@statechart:edge:${index}:${suffix}`;
        edges.push({ id: eid, sources: [source], targets: [target], layoutOptions: priorities(edge) });
        parts.push(eid);
      }
    } else {
      const id = `@statechart:edge:${index}`;
      edges.push({ id, sources: [fromId], targets: [toId], layoutOptions: priorities(edge) });
      parts.push(id);
    }
    connections.set(edge.id, { parts, fromId, toId });
  });
  for (const [id, n] of nodes)
    if (statesById.get(id)?.kind === 'state') {
      const count = (side) =>
        n.ports.filter((p) => p.layoutOptions['elk.port.side'] === sideName[side]).length;
      n.width = Math.max(n.width, (Math.max(count('top'), count('bottom')) + 1) * 14 + 12);
      n.height = Math.max(n.height, (Math.max(count('left'), count('right')) + 1) * 14 + 12);
    }
  let children = [...nodes.values()];
  if (plan && !plan.baseline) {
    const order = new Map(plan.order.map((id, i) => [id, i]));
    const edgeOrder = [...transitions].sort((a, b) => {
      const key = (e) =>
        plan.labelOrder === 'target'
          ? [order.get(e.to), order.get(e.from)]
          : [order.get(e.from), order.get(e.to)];
      const left = key(a),
        right = key(b);
      return left[0] - right[0] || left[1] - right[1];
    });
    const labelOrder = new Map(
      edgeOrder.filter((e) => labels.has(e.id)).map((e, i) => [labels.get(e.id).nodeId, i]),
    );
    children.sort(
      (a, b) =>
        (order.get(a.id) ?? plan.order.length + labelOrder.get(a.id)) -
        (order.get(b.id) ?? plan.order.length + labelOrder.get(b.id)),
    );
    const partOrder = new Map(
      edgeOrder.flatMap((e, i) => connections.get(e.id).parts.map((id, j) => [id, i * 2 + j])),
    );
    edges.sort((a, b) => partOrder.get(a.id) - partOrder.get(b.id));
  }
  const laid = await new ELK().layout({
    id: '@statechart:root',
    children,
    edges,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': graph.layout.direction.toUpperCase(),
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.randomSeed': '1',
      ...(plan && !plan.baseline ? { 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES' } : {}),
      'elk.layered.mergeEdges': 'false',
      'elk.spacing.nodeNode': String(graph.layout.nodeSpacing * scale),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(graph.layout.layerSpacing * scale),
      'elk.spacing.edgeNode': '12',
      'elk.spacing.edgeEdge': '12',
      'elk.spacing.portPort': '12',
      'elk.layered.spacing.edgeNodeBetweenLayers': '16',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
    },
  });
  const positions = new Map(laid.children.map((n) => [n.id, n])),
    laidEdges = new Map(laid.edges.map((e) => [e.id, e]));
  const states = graph.nodes.map((n) => {
    const state = statesById.get(n.id),
      p = positions.get(n.id),
      descriptionAlign = state.style?.descriptionAlign ?? model.diagram.style?.state?.descriptionAlign;
    const node = {
      ...structuredClone(n),
      ...state,
      label: state.label ?? state.id,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      style: { ...n.style, ...(descriptionAlign !== undefined ? { descriptionAlign } : {}) },
    };
    const text = nodeText({ ...node, label: n.label });
    return { ...node, labelPosition: text.position, labelBounds: text.bounds };
  });
  const result = {
    version: 1,
    diagram: graph.diagram,
    width: laid.width,
    height: laid.height,
    states,
    transitions: transitions.map((edge) => {
      const info = connections.get(edge.id),
        parts = info.parts.map((id) => laidEdges.get(id)),
        points = [];
      for (const part of parts) {
        for (const section of part.sections ?? [])
          points.push(section.startPoint, ...(section.bendPoints ?? []), section.endPoint);
      }
      const a = positions.get(edge.from),
        b = positions.get(edge.to),
        from = a.ports.find((p) => p.id === info.fromId),
        to = b.ports.find((p) => p.id === info.toId);
      const result = {
        ...edge,
        fromSide: stateSide(from, a),
        toSide: stateSide(to, b),
        sections: [{ points: compact(points) }],
      };
      const label = labels.get(edge.id);
      if (label) {
        const p = positions.get(label.nodeId);
        result.displayLabel = label.displayLabel;
        result.labelBounds = {
          x: p.x + label.guard,
          y: p.y + label.guard,
          width: label.width,
          height: label.height,
        };
        result.labelPosition = { x: p.x + p.width / 2, y: p.y + p.height / 2, anchor: 'middle' };
      }
      return result;
    }),
  };
  if (graph.diagram.caption) {
    const size = textSize(graph.diagram.caption, { fontSize: 11 });
    result.caption = {
      text: graph.diagram.caption,
      position: { x: 24, y: result.height + size.height / 2, anchor: 'start' },
    };
    result.height += size.height + 24;
    result.width = Math.max(result.width, size.width + 48);
  }
  return result;
}
