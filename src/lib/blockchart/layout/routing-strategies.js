import { routeOrthogonal as route } from '../../shared/orthogonal.js';
import { ancestors } from '../hierarchy.js';
import { obstacleClearance, containerClearance, preferredClearance } from './routing-spacing.js';
import { containerEntryRoute } from './container-entry.js';
import { channelAssignments, routeGridChannel, reconcileChannelRoutes } from './grid-channels.js';

// Fixed routing adapters share prepared endpoint/obstacle geometry, not policies.
// select returns null to leave an edge untouched; route returns null on an optional
// search failure. Diagnostic reasons never choose a strategy.
export function createRoutingStrategy(name, context) {
  switch (name) {
    case 'ordinary':
      return ordinaryStrategy(context);
    case 'container-entry':
      return containerEntryStrategy(context);
    case 'grid-channels':
    case 'auto-channels':
      return channelStrategy(name, context);
    default:
      throw new Error('Unknown routing strategy: ' + name);
  }
}

function ordinaryStrategy({ model }) {
  return {
    method: 'fixed-orthogonal',
    select: () => ({}),
    route: ({ edge, ref, a, b, av, bv, start, finish, obstacles, scope, avoid, straight }) => {
      if (straight)
        return {
          points: [
            { x: a.p.x, y: a.p.y },
            { x: b.p.x, y: b.p.y },
          ],
        };
      const extra = preferredClearance(ref) - obstacleClearance(ref);
      const preferred =
        extra > 0
          ? obstacles.map((box) =>
              box._owner === a.node?.id
                ? box
                : {
                    ...box,
                    x: box.x - extra,
                    y: box.y - extra,
                    width: box.width + extra * 2,
                    height: box.height + extra * 2,
                  },
            )
          : obstacles;
      let failure;
      for (const boxes of preferred === obstacles ? [obstacles] : [preferred, obstacles]) {
        try {
          return {
            points: route(
              start,
              finish,
              boxes,
              scope ? { x: scope.x, y: scope.y, width: scope.width, height: scope.height } : undefined,
              model.layout.layerSpacing,
              avoid,
              { startDirection: av, endDirection: { x: -bv.x, y: -bv.y } },
            ),
          };
        } catch (cause) {
          failure = cause;
        }
      }
      throw new Error(`Cannot route ${edge.id}: ${failure.message}`, { cause: failure });
    },
  };
}

function containerEntryStrategy({ result, model, owners, ports }) {
  return {
    method: 'fixed-orthogonal',
    reason: 'container-entry',
    select: (ref) => {
      const sourceAncestors = new Set(ref.source.moduleId ? ancestors(model, ref.source.moduleId) : []);
      if (
        ref.target.moduleId &&
        ancestors(model, ref.target.moduleId).some((id) => {
          const group = owners.get(id);
          return !sourceAncestors.has(id) && (group?.collapsed || group?.portMode === 'boundary');
        })
      )
        return null;
      const entryContainers = (ref.target.moduleId ? ancestors(model, ref.target.moduleId) : [])
        .filter((id) => !sourceAncestors.has(id))
        .map((id) => owners.get(id))
        .filter(
          (g) =>
            g &&
            !g.collapsed &&
            g.portMode !== 'boundary' &&
            !model.groups.find((item) => item.id === g.id)?._signalWrapper,
        );
      return entryContainers.length ? { entryContainers } : null;
    },
    route: ({
      edge,
      ref,
      a,
      b,
      av,
      bv,
      start,
      finish,
      obstacles,
      scope,
      avoid,
      plan: { entryContainers },
    }) => {
      const signal = model._signals?.find((item) => item.branches.includes(edge.id));
      const receiver = signal?.receivers.find((item) => item.branchId === edge.id);
      const edgePoints = (id) =>
        result.connections.find((item) => item.id === id)?.sections.flatMap((s) => s.points) ?? [];
      const labelPoints = (id) =>
        ['in', 'out'].map((portId) => ports.get(id + '.' + portId)?.p).filter(Boolean);
      const points = containerEntryRoute({
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
        entryGap: containerClearance(ref),
        avoid,
      });
      return points ? { points } : null;
    },
  };
}

function channelStrategy(name, { result, model, refs }) {
  const channels = channelAssignments(name === 'auto-channels' ? result._autoChannels : result._gridChannels);
  const completed = new Set(),
    originalChannels = new Map();
  return {
    method: name === 'auto-channels' ? 'auto-channel' : 'grid-channel',
    reason: name,
    select: (_ref, edge) => {
      const channel = channels.get(edge.id);
      return channel ? { channel } : null;
    },
    avoid: ({ edge, ref }) => {
      const avoid = result.connections
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
      return avoid;
    },
    route: ({ edge, a, b, av, bv, start, finish, obstacles, scope, avoid, plan: { channel } }) => {
      const channelRoute = routeGridChannel({
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
        return null;
      }
      return { ...channelRoute, points: channelRoute.points.map(({ x, y }) => ({ x, y })) };
    },
    beforeCommit: (edge) =>
      originalChannels.set(edge.id, { sections: edge.sections, routingInfo: edge.routingInfo }),
    details: ({ plan: { channel } }, routed) => ({
      channelAxis: channel.axis,
      channelTrack: channel.track,
      channelTrackCount: channel.count,
      channelStatus: 'routed',
      ...(channel.owner ? { channelOwner: channel.owner } : {}),
      waypoints: routed.waypoints,
    }),
    finish: () => {
      if (channels.size) reconcileChannelRoutes(result.connections, refs, originalChannels);
    },
  };
}
