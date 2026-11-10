import { routeOrthogonal as route } from '../../shared/orthogonal.js';
import { ancestors } from '../hierarchy.js';
import { sideVector, defaultSide } from '../port-sides.js';

const eps = 1e-6;
const inflate = (r, n) => ({ x: r.x - n, y: r.y - n, width: r.width + 2 * n, height: r.height + 2 * n });

// Sparse rectilinear visibility graph. Only adjacent coordinates are connected;
// heap search includes a bend penalty and never crosses an obstacle interior.

export function routeFixed(result, model, onlyExcluded = false, selected = null, reason = null) {
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
      distance = ref._signalTrunk || ref._signalTail ? 3 : Math.max(14, edge.style.strokeWidth * 2 + 6),
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
      .map((n) =>
        inflate(n, ref._signalTrunk || ref._signalTail ? 1 : Math.max(5, edge.style.strokeWidth / 2 + 2)),
      );
    for (const g of result.groups)
      if (exempt.has(g.id) && !g.style.label.hidden) obstacles.push(inflate(g.labelBounds, 3));
    for (const t of result.terminals ?? [])
      if (t !== a.terminal && t !== b.terminal && !t.style.hidden) obstacles.push(inflate(t.labelBounds, 4));
    const self = ref.source.moduleId === ref.target.moduleId ? owners.get(ref.source.moduleId) : undefined;
    const nearby = self ? inflate(self, 120) : undefined;
    const avoid =
      ref.label !== undefined && !ref.style.label.hidden && nearby
        ? result.connections
            .filter((other) => other !== edge)
            .flatMap((other) =>
              other.sections.flatMap((section) =>
                section.points.slice(1).map((p, i) => [section.points[i], p]),
              ),
            )
            .filter(
              ([a, b]) =>
                Math.max(a.x, b.x) >= nearby.x &&
                Math.min(a.x, b.x) <= nearby.x + nearby.width &&
                Math.max(a.y, b.y) >= nearby.y &&
                Math.min(a.y, b.y) <= nearby.y + nearby.height,
            )
        : [];
    let middle;
    try {
      middle = route(
        start,
        finish,
        obstacles,
        scope ? { x: scope.x, y: scope.y, width: scope.width, height: scope.height } : undefined,
        model.layout.layerSpacing,
        avoid,
      );
    } catch (cause) {
      throw new Error(`Cannot route ${edge.id}: ${cause.message}`, { cause });
    }
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
      reason:
        reason ?? (selected ? 'port-adjustment' : ref.constraint === false ? 'non-constraining' : 'grid'),
    };
  }
}
