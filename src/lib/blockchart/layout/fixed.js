import { ancestors } from '../hierarchy.js';
import { sideVector, defaultSide } from '../port-sides.js';
import { endpointEscape, obstacleClearance, fitEndpointEscape } from './routing-spacing.js';
import { createRoutingStrategy } from './routing-strategies.js';
import {
  EPS as eps,
  segmentCrossesInterior as crosses,
  sectionSegments,
  collinearOverlap,
} from './routing-geometry.js';

const inflate = (r, n) => ({ x: r.x - n, y: r.y - n, width: r.width + 2 * n, height: r.height + 2 * n });

// Sparse rectilinear visibility graph. Only adjacent coordinates are connected;
// heap search includes a bend penalty and never crosses an obstacle interior.

export function routeFixed(
  result,
  model,
  {
    strategy: strategyName = 'ordinary',
    onlyExcluded = false,
    selected = null,
    reason = null,
    avoidForeignOverlaps = false,
    channelPlans = null,
    channelAvoid = null,
  } = {},
) {
  const nodes = [...result.modules, ...result.groups],
    owners = new Map(nodes.map((n) => [n.id, n])),
    refs = new Map(model.connections.map((e) => [e.id, e]));
  const ports = new Map(
    nodes.flatMap((n) => (n.ports ?? []).map((p) => [n.id + '.' + p.id, { p, node: n }])),
  );
  const terminals = new Map((result.terminals ?? []).map((t) => [t.id, t]));
  const strategy = createRoutingStrategy(strategyName, {
    result,
    model,
    owners,
    ports,
    refs,
    channelPlans,
    channelAvoid,
    selected,
    onlyExcluded,
    reason,
    reroute: (trial, options) => routeFixed(trial, model, options),
  });
  if (strategy.execute) return strategy.execute();
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
    const plan = strategy.select(ref, edge);
    if (!plan) continue;
    const a = end(ref.source, ref.target, ref),
      b = end(ref.target, ref.source, ref),
      av = a.vector ?? sideVector(a.side),
      bv = b.vector ?? sideVector(b.side);
    const startDistance = endpointEscape(ref, true);
    const endDistance = endpointEscape(ref, false);
    const start = { x: a.p.x + av.x * startDistance, y: a.p.y + av.y * startDistance },
      finish = { x: b.p.x + bv.x * endDistance, y: b.p.y + bv.y * endDistance };
    // Concat text is reserved outside its thin body. Its physical Port can be
    // inside the layout envelope: escape the envelope along the access line.
    for (const [endpoint, point, vector] of [
      [a, start, av],
      [b, finish, bv],
    ]) {
      const node = endpoint.node;
      if (node?.type !== 'concat') continue;
      const extra =
        vector.x > 0
          ? node.x + node.width - endpoint.p.x
          : vector.x < 0
            ? endpoint.p.x - node.x
            : vector.y > 0
              ? node.y + node.height - endpoint.p.y
              : endpoint.p.y - node.y;
      point.x += vector.x * Math.max(0, extra);
      point.y += vector.y * Math.max(0, extra);
    }
    const scope = ref.scope ? owners.get(ref.scope) : undefined;
    const exempt = new Set([
      ...(ref.source.moduleId ? ancestors(model, ref.source.moduleId) : []),
      ...(ref.target.moduleId ? ancestors(model, ref.target.moduleId) : []),
    ]);
    if (scope) exempt.add(scope.id);
    const obstacles = nodes
      .filter((n) => !exempt.has(n.id))
      .map((n) => ({
        ...inflate(n, obstacleClearance(ref)),
        _owner: n.id,
      }));
    for (const g of result.groups)
      if (exempt.has(g.id) && (g.collapsed || g.portMode === 'boundary') && !g.style.label.hidden)
        obstacles.push(inflate(g.labelBounds, Math.max(3, obstacleClearance(ref))));
    for (const t of result.terminals ?? [])
      if (t !== a.terminal && t !== b.terminal && !t.style.hidden) obstacles.push(inflate(t.labelBounds, 4));
    fitEndpointEscape(a, start, av, obstacles);
    fitEndpointEscape(b, finish, bv, obstacles);
    const self = ref.source.moduleId === ref.target.moduleId ? owners.get(ref.source.moduleId) : undefined;
    const nearby = self ? inflate(self, 120) : undefined;
    let avoid =
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
    if (strategy.avoid) {
      avoid = strategy.avoid({ edge, ref, plan });
    } else if (avoidForeignOverlaps) {
      // Repair only actual collinear conflicts from the rejected ordinary trial.
      // Adding every foreign rail to the visibility graph creates a quadratic
      // coordinate grid on large charts, even for unrelated edges.
      const ownSegments = sectionSegments(edge.sections);
      avoid = result.connections
        .filter((other) => other !== edge && (refs.get(other.id).netId ?? other.id) !== (ref.netId ?? ref.id))
        .flatMap((other) => sectionSegments(other.sections))
        .filter(([c, d]) => ownSegments.some(([a, b]) => collinearOverlap(a, b, c, d)));
    }
    const aligned =
      av.x === -bv.x &&
      av.y === -bv.y &&
      (b.p.x - a.p.x) * av.x + (b.p.y - a.p.y) * av.y > eps &&
      Math.abs((b.p.x - a.p.x) * av.y - (b.p.y - a.p.y) * av.x) < eps;
    const inScope = (p) =>
      !scope ||
      (p.x >= scope.x - eps &&
        p.y >= scope.y - eps &&
        p.x <= scope.x + scope.width + eps &&
        p.y <= scope.y + scope.height + eps);
    // Preferred escape segments may overlap on a short attachment. A clear,
    // correctly facing complete span needs no artificial loop around those stubs.
    const straight =
      aligned &&
      !avoid.length &&
      inScope(a.p) &&
      inScope(b.p) &&
      !obstacles.some(
        (box) =>
          (!a.node || box._owner !== a.node.id) &&
          (!b.node || box._owner !== b.node.id) &&
          crosses(a.p, b.p, box),
      );
    const context = { edge, ref, plan, a, b, av, bv, start, finish, obstacles, scope, avoid, straight };
    const routed = strategy.route(context);
    if (!routed) continue;
    const middle = routed.points;
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
    strategy.beforeCommit?.(edge);
    edge.sections = [{ points }];
    edge.routingInfo = {
      method: strategy.method,
      reason:
        reason ??
        strategy.reason ??
        (selected ? 'port-adjustment' : ref.constraint === false ? 'non-constraining' : 'grid'),
      ...strategy.details?.(context, routed),
    };
  }
  strategy.finish?.();
}
