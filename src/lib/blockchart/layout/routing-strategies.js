import { routeOrthogonal } from '../../shared/orthogonal.js';
import { ancestors } from '../hierarchy.js';
import { obstacleClearance, containerClearance, preferredClearance } from './routing-spacing.js';
import { containerEntryRoute } from './container-entry.js';
import { routeGridChannel } from './grid-channels.js';
import { trackProposals } from './channel-corridors.js';
import { routeChannelProposals } from './channel-batch.js';
import { groupProposals } from './group-channels.js';

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
    case 'shared-channels':
      return { execute: () => routePlannedChannels(name, context) };
    case 'channel-access':
      return channelAccessStrategy(context);
    default:
      throw new Error('Unknown routing strategy: ' + name);
  }
}

function ordinaryStrategy({ model, search = routeOrthogonal }) {
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
            points: search(
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

function containerEntryStrategy({ result, model, owners, ports, search }) {
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
        search,
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

function routePlannedChannels(name, { result, model, reroute, selected, onlyExcluded, reason }) {
  const kinds = name === 'shared-channels' ? ['grid', 'auto'] : [name === 'auto-channels' ? 'auto' : 'grid'];
  const proposals = kinds
    .flatMap((kind) => trackProposals(result, kind))
    .map((proposal) => ({
      ...proposal,
      route: ({ trial, demand, assignment, avoid }) => {
        const plan = { ...assignment, kind: proposal.kind };
        reroute(trial, {
          strategy: 'channel-access',
          reason,
          selected: new Set([demand.id]),
          channelPlans: new Map([[demand.id, plan]]),
          channelAvoid: avoid,
        });
        const edge = trial.connections.find((e) => e.id === demand.id);
        return plan.unchanged || edge.routingInfo?.channelStatus === 'routed'
          ? { sections: edge.sections, routingInfo: edge.routingInfo }
          : null;
      },
    }));
  if (name === 'shared-channels') {
    const registered = new Set(proposals.flatMap((p) => p.branches.map((b) => b.id)));
    const edges = new Map(result.connections.map((e) => [e.id, e]));
    const groups = groupProposals(result, model, {
      includeReserved: true,
      accepts: (edge) =>
        edge.routingInfo?.channelStatus !== 'routed' ||
        edge.routingInfo.method === 'group-channel' ||
        registered.has(edge.id),
    });
    proposals.push(...groups);
  }
  const refs = new Map(model.connections.map((e) => [e.id, e]));
  const filtered = proposals
    .map((p) => ({
      ...p,
      branches: p.branches.filter(
        (b) => (!selected || selected.has(b.id)) && (!onlyExcluded || refs.get(b.id)?.constraint === false),
      ),
    }))
    .filter((p) => p.branches.length);
  return routeChannelProposals(result, model, filtered);
}

/** One planner's endpoint/obstacle adapter. Allocation, peer reservations and
 * transactional acceptance belong to the shared corridor batch. */
function channelAccessStrategy({ model, channelPlans, channelAvoid, reason, search }) {
  return {
    method: 'grid-channel',
    select: (_ref, edge) => (channelPlans?.has(edge.id) ? { channel: channelPlans.get(edge.id) } : null),
    avoid: () => channelAvoid ?? [],
    route: ({ edge, a, b, av, bv, start, finish, obstacles, scope, avoid, straight, plan: { channel } }) => {
      const points = edge.sections.flatMap((s) => s.points);
      const aligned =
        av.x === -bv.x &&
        av.y === -bv.y &&
        Math.abs((b.p.x - a.p.x) * av.y - (b.p.y - a.p.y) * av.x) < 1e-6 &&
        (b.p.x - a.p.x) * av.x + (b.p.y - a.p.y) * av.y > 0 &&
        points.every((p) => Math.abs((p.x - a.p.x) * av.y - (p.y - a.p.y) * av.x) < 1e-6);
      if (straight || aligned) {
        channel.unchanged = true;
        return null;
      }
      const routed = routeGridChannel({
        search,
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
      return routed ? { ...routed, points: routed.points.map(({ x, y }) => ({ x, y })) } : null;
    },
    details: ({ plan: { channel } }, routed) => ({
      method: channel.kind === 'auto' ? 'auto-channel' : 'grid-channel',
      reason: reason ?? (channel.kind === 'auto' ? 'auto-channels' : 'grid-channels'),
      channelAxis: channel.axis,
      channelTrack: channel.track,
      channelTrackCount: channel.count,
      channelStatus: 'routed',
      ...(channel.owner ? { channelOwner: channel.owner } : {}),
      waypoints: routed.waypoints,
    }),
  };
}
