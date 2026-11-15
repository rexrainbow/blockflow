import { routeOrthogonal as route } from '../../shared/orthogonal.js';
import { ancestors } from '../hierarchy.js';
import { sideVector, defaultSide } from '../port-sides.js';
import { endpointEscape, obstacleClearance, fitEndpointEscape } from './routing-spacing.js';
import { containerEntryRoute } from './container-entry.js';
import { channelAssignments, routeGridChannel, reconcileChannelRoutes } from './grid-channels.js';

const eps = 1e-6;
const inflate = (r, n) => ({ x: r.x - n, y: r.y - n, width: r.width + 2 * n, height: r.height + 2 * n });
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
  const channelPass = reason === 'grid-channels' || reason === 'auto-channels';
  const channels = channelPass
    ? channelAssignments(reason === 'auto-channels' ? result._autoChannels : result._gridChannels)
    : new Map();
  const completed = new Set();
  const originalChannels = new Map();
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
    const channel = channels.get(edge.id);
    if (channelPass && !channel) continue;
    const entryOnly = reason === 'container-entry';
    const sourceAncestors = new Set(ref.source.moduleId ? ancestors(model, ref.source.moduleId) : []);
    if (
      entryOnly &&
      ref.target.moduleId &&
      ancestors(model, ref.target.moduleId).some((id) => {
        const group = owners.get(id);
        return !sourceAncestors.has(id) && (group?.collapsed || group?.portMode === 'boundary');
      })
    )
      continue;
    const entryContainers = entryOnly
      ? (ref.target.moduleId ? ancestors(model, ref.target.moduleId) : [])
          .filter((id) => !sourceAncestors.has(id))
          .map((id) => owners.get(id))
          .filter(
            (g) =>
              g &&
              !g.collapsed &&
              g.portMode !== 'boundary' &&
              !model.groups.find((item) => item.id === g.id)?._signalWrapper,
          )
      : [];
    if (entryOnly && !entryContainers.length) continue;
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
    if (channel) {
      avoid = result.connections
        .filter(
          (other) =>
            other !== edge &&
            (refs.get(other.id).netId ?? other.id) !== (ref.netId ?? ref.id) &&
            (!channels.has(other.id) || completed.has(other.id)),
        )
        .flatMap((other) =>
          other.sections.flatMap((s) =>
            s.points
              .slice(1)
              .map((p, i) => [
                s.points[i],
                p,
                Math.max(3, (ref.style.strokeWidth + other.style.strokeWidth) / 2 + 2),
              ]),
          ),
        );
      completed.add(edge.id);
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
    let middle;
    let channelRoute;
    if (channel) {
      channelRoute = routeGridChannel({
        start,
        finish,
        source: a.p,
        target: b.p,
        av,
        bv,
        channel,
        obstacles,
        bounds: scope ? { x: scope.x, y: scope.y, width: scope.width, height: scope.height } : undefined,
        clearance: model.layout.layerSpacing,
        avoid,
        gap: 3,
      });
      if (!channelRoute) {
        edge.routingInfo = { ...edge.routingInfo, channelStatus: 'blocked' };
        continue;
      }
      middle = channelRoute.points.map(({ x, y }) => ({ x, y }));
    } else if (entryOnly) {
      const signal = model._signals?.find((item) => item.branches.includes(edge.id));
      const receiver = signal?.receivers.find((item) => item.branchId === edge.id);
      const edgePoints = (id) =>
        result.connections.find((item) => item.id === id)?.sections.flatMap((s) => s.points) ?? [];
      const labelPoints = (id) =>
        ['in', 'out'].map((portId) => ports.get(id + '.' + portId)?.p).filter(Boolean);
      middle = containerEntryRoute({
        baseline: edge.sections.flatMap((section) => section.points),
        prefix: signal ? [...edgePoints(signal.trunkId), ...labelPoints(signal.signalId)] : [],
        suffix: receiver ? [...labelPoints(receiver.signalId), ...edgePoints(receiver.tailId)] : [],
        start,
        finish,
        source: a.p,
        target: b.p,
        av,
        bv,
        containers: entryContainers,
        obstacles,
        bounds: scope ? { x: scope.x, y: scope.y, width: scope.width, height: scope.height } : undefined,
        clearance: model.layout.layerSpacing,
        entryGap: Math.max(9, obstacleClearance(ref)),
        avoid,
      });
      if (!middle) continue;
    } else {
      try {
        middle = straight
          ? [
              { x: a.p.x, y: a.p.y },
              { x: b.p.x, y: b.p.y },
            ]
          : route(
              start,
              finish,
              obstacles,
              scope ? { x: scope.x, y: scope.y, width: scope.width, height: scope.height } : undefined,
              model.layout.layerSpacing,
              avoid,
              { startDirection: av, endDirection: { x: -bv.x, y: -bv.y } },
            );
      } catch (cause) {
        throw new Error(`Cannot route ${edge.id}: ${cause.message}`, { cause });
      }
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
    if (channel) originalChannels.set(edge.id, { sections: edge.sections, routingInfo: edge.routingInfo });
    edge.sections = [{ points }];
    edge.routingInfo = {
      method: channel ? (reason === 'auto-channels' ? 'auto-channel' : 'grid-channel') : 'fixed-orthogonal',
      reason:
        reason ?? (selected ? 'port-adjustment' : ref.constraint === false ? 'non-constraining' : 'grid'),
      ...(channel
        ? {
            channelAxis: channel.axis,
            channelTrack: channel.track,
            channelTrackCount: channel.count,
            channelStatus: 'routed',
            ...(channel.owner ? { channelOwner: channel.owner } : {}),
            waypoints: channelRoute.waypoints,
          }
        : {}),
    };
  }
  if (channels.size) reconcileChannelRoutes(result.connections, refs, originalChannels);
}
