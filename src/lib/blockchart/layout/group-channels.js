import { ancestors, parentOf } from '../hierarchy.js';
import { defaultSide } from '../port-sides.js';
import { routeChannelProposals } from './channel-batch.js';
import { parallelOverlap } from './grid-channels.js';
import { lineWidth, obstacleClearance, containerClearance, endpointEscape } from './routing-spacing.js';
import { netRouteQuality, countSegmentContacts, countStrokeContacts } from './route-quality.js';
import {
  EPS,
  sectionSegments,
  segmentCrossesInterior,
  pointInBounds,
  simplifyForwardPath,
} from './routing-geometry.js';

const inflate = (n, gap) => ({
  x: n.x - gap,
  y: n.y - gap,
  width: n.width + gap * 2,
  height: n.height + gap * 2,
});
const protectedGroup = (g) => g && (g.collapsed || g.portMode === 'boundary' || g.type !== 'container');
const net = (e) => e.netId ?? e.id;
function contacts(edges, changed) {
  let total = 0;
  for (let i = 0; i < edges.length; i++)
    for (const other of edges.slice(i + 1)) {
      const edge = edges[i];
      if (net(edge) !== net(other) && (changed.has(edge.id) || changed.has(other.id)))
        total += countSegmentContacts(edge.sections, [other]);
    }
  return total;
}

/** Geometry is frozen. Batch channels only between facing, sibling ordinary Containers. */
export function groupProposals(result, compiled, { includeReserved = false, accepts = () => true } = {}) {
  const semantic = compiled._signalOriginal ?? compiled,
    down = compiled.layout.direction === 'down';
  const axis = down ? 'y' : 'x',
    cross = down ? 'x' : 'y',
    extent = down ? 'height' : 'width';
  const sourceSide = down ? 'bottom' : 'right',
    targetSide = down ? 'top' : 'left';
  const nodes = new Map([...result.modules, ...result.groups].map((n) => [n.id, n]));
  const groups = new Map(semantic.groups.map((g) => [g.id, g]));
  const modules = new Map(semantic.modules.map((m) => [m.id, m]));
  const working = new Map(compiled.connections.map((e) => [e.id, e]));
  const refs = new Map(semantic.connections.map((e) => [e.id, e]));
  const port = (e) => nodes.get(e.moduleId)?.ports.find((p) => p.id === e.portId);
  const batches = new Map();
  // Geometry and reservations select route demands. Constraint/feedback flags
  // govern layout, not access to a free corridor; aligned fanout also participates.
  // This strategy may reassign its own tracks jointly, never Grid/Auto/outer plans.
  for (const edge of result.connections) {
    const ref = refs.get(edge.id),
      wire = working.get(edge.id);
    if (
      !ref ||
      !wire ||
      !accepts(edge) ||
      ref.direction === 'both' ||
      (ref.netStyle ?? ref.style).startArrow !== 'none' ||
      (!includeReserved &&
        edge.routingInfo?.channelStatus === 'routed' &&
        edge.routingInfo?.method !== 'group-channel') ||
      edge.routingInfo?.method === 'outer-aabb'
    )
      continue;
    const source = port(ref.source),
      target = port(ref.target),
      a = port(wire.source),
      b = port(wire.target);
    if (!source || !target || !a || !b) continue;
    if (
      (source.side ?? defaultSide(source, compiled.layout.direction)) !== sourceSide ||
      (target.side ?? defaultSide(target, compiled.layout.direction)) !== targetSide ||
      (a.side ?? defaultSide(a, compiled.layout.direction)) !== sourceSide ||
      (b.side ?? defaultSide(b, compiled.layout.direction)) !== targetSide
    )
      continue;
    const sourceModule = modules.get(ref.source.moduleId),
      targetModule = modules.get(ref.target.moduleId);
    if (!sourceModule || !targetModule || sourceModule.type === 'concat' || targetModule.type === 'concat')
      continue;
    const sa = ancestors(semantic, ref.source.moduleId),
      ta = ancestors(semantic, ref.target.moduleId);
    const from = sa.at(-1),
      to = ta.at(-1);
    if (
      !from ||
      !to ||
      from === to ||
      parentOf(semantic, from) !== parentOf(semantic, to) ||
      [...sa, ...ta].some((id) => protectedGroup(groups.get(id)))
    )
      continue;
    const sg = nodes.get(from),
      tg = nodes.get(to),
      parent = parentOf(semantic, from);
    if (!sg || !tg || tg[axis] < sg[axis] + sg[extent] - EPS) continue;
    // Pinned names may be inside wrappers. Only replace a branch when the
    // physical source/name trunk and receiver tail already share its access line.
    const signal = compiled._signals?.find((s) => s.branches.includes(edge.id));
    const receiver = signal?.receivers.find((r) => r.branchId === edge.id);
    const attachment = (id) =>
      result.connections.find((e) => e.id === id)?.sections.flatMap((s) => s.points) ?? [];
    if (
      Math.abs(source[cross] - a[cross]) > EPS ||
      Math.abs(target[cross] - b[cross]) > EPS ||
      attachment(signal?.trunkId).some(
        (p) => Math.abs(p[cross] - a[cross]) > EPS || p[axis] < source[axis] - EPS,
      ) ||
      attachment(receiver?.tailId).some(
        (p) => Math.abs(p[cross] - b[cross]) > EPS || p[axis] > target[axis] + EPS,
      )
    )
      continue;
    const gap = containerClearance(ref);
    const lo = Math.max(sg[axis] + sg[extent] + gap, a[axis] + endpointEscape(wire, true));
    const hi = Math.min(tg[axis] - gap, b[axis] - endpointEscape(wire, false));
    if (lo > hi) continue;
    const key = JSON.stringify([from, to]);
    if (!batches.has(key)) batches.set(key, { from, to, parent, branches: [] });
    batches.get(key).branches.push({
      id: edge.id,
      net: net(ref),
      lo: Math.min(a[cross], b[cross]),
      hi: Math.max(a[cross], b[cross]),
      width: lineWidth(ref),
      a,
      b,
      ref,
      wire,
      min: lo,
      max: hi,
    });
  }

  return [...batches.values()].map((batch) => ({
    key: JSON.stringify(['group', batch.parent, batch.from, batch.to]),
    kind: 'group',
    owner: batch.parent,
    axis,
    before: [nodes.get(batch.from)],
    after: [nodes.get(batch.to)],
    min: Math.max(...batch.branches.map((e) => e.min)),
    max: Math.min(...batch.branches.map((e) => e.max)),
    margin: Math.max(...batch.branches.map((b) => containerClearance(b.ref))),
    accessMin: Math.max(...batch.branches.map((b) => b.a[axis] + endpointEscape(b.wire, true))),
    accessMax: Math.min(...batch.branches.map((b) => b.b[axis] - endpointEscape(b.wire, false))),
    branches: batch.branches,
    route: ({ trial, branch, assignment }) => groupRoute(trial, compiled, batch, branch, assignment),
    accept: (trial, baseline, changed) => {
      const q = netRouteQuality(trial),
        old = netRouteQuality(baseline);
      return (
        q.overlaps <= old.overlaps &&
        q.crossings <= old.crossings &&
        q.bends <= old.bends &&
        q.length <= old.length + EPS &&
        contacts(trial.connections, changed) <= contacts(baseline.connections, changed) &&
        countStrokeContacts(trial.connections) <= countStrokeContacts(baseline.connections)
      );
    },
    satisfied: () => {
      const paths = batch.branches.map(({ id, min, max }) => {
        const points = simplifyForwardPath(
          result.connections.find((e) => e.id === id).sections.flatMap((s) => s.points),
        );
        const straight = points.length === 2 && Math.abs(points[0][cross] - points.at(-1)[cross]) < EPS;
        return {
          points,
          valid:
            straight ||
            (points.length === 4 &&
              points[1][axis] >= min - EPS &&
              points[1][axis] <= max + EPS &&
              Math.abs(points[1][axis] - points[2][axis]) < EPS),
        };
      });
      return (
        paths.every((p) => p.valid) &&
        batch.branches.every((a, i) =>
          batch.branches.slice(i + 1).every((b, j) => {
            if (a.net === b.net || a.hi - a.lo < EPS || b.hi - b.lo < EPS) return true;
            const p = paths[i].points,
              q = paths[i + j + 1].points;
            return (
              p.length === 4 &&
              q.length === 4 &&
              !parallelOverlap(p[1], p[2], q[1], q[2], (a.width + b.width) / 2 + 2)
            );
          }),
        )
      );
    },
  }));
}

function groupRoute(result, compiled, batch, branch, assignment) {
  const { a, b, ref, wire, id } = branch,
    axis = assignment.axis,
    coordinate = assignment.coordinate;
  const nodes = new Map([...result.modules, ...result.groups].map((n) => [n.id, n]));
  const points = simplifyForwardPath(
    [
      { x: a.x, y: a.y },
      { ...a, [axis]: coordinate },
      { ...b, [axis]: coordinate },
      { x: b.x, y: b.y },
    ].map(({ x, y }) => ({ x, y })),
  );
  const exempt = new Set([
    ...ancestors(compiled, wire.source.moduleId),
    ...ancestors(compiled, wire.target.moduleId),
    wire.source.moduleId,
    wire.target.moduleId,
    ref.source.moduleId,
    ref.target.moduleId,
  ]);
  const clearance = obstacleClearance(ref),
    owner = nodes.get(batch.parent),
    bounds = owner ? inflate(owner, -clearance) : undefined;
  const obstacles = [...nodes.values()].filter((n) => !exempt.has(n.id)).map((n) => inflate(n, clearance));
  for (const t of result.terminals ?? []) if (!t.style.hidden) obstacles.push(inflate(t.labelBounds, 4));
  if (
    !points.every((p) => pointInBounds(p, bounds)) ||
    obstacles.some((box) => sectionSegments([{ points }]).some(([a, b]) => segmentCrossesInterior(a, b, box)))
  )
    return null;
  const edge = result.connections.find((e) => e.id === id);
  if (points.length === 2 && simplifyForwardPath(edge.sections.flatMap((s) => s.points)).length === 2)
    return { sections: edge.sections, routingInfo: edge.routingInfo };
  return {
    sections: [{ points }],
    routingInfo: {
      method: 'group-channel',
      reason: 'inter-container',
      channelAxis: axis,
      channelTrack: assignment.track,
      channelTrackCount: assignment.count,
      channelStatus: 'routed',
      ...(batch.parent ? { channelOwner: batch.parent } : {}),
      sourceGroup: batch.from,
      targetGroup: batch.to,
    },
  };
}

/** Standalone entry keeps pre-existing foreign reservations protected. The shared
 * runtime collects all planner offers before allocating any of their tracks. */
export function routeGroupChannels(result, compiled) {
  return routeChannelProposals(result, compiled, groupProposals(result, compiled));
}
