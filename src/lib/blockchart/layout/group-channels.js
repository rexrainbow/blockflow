import { ancestors, parentOf } from '../hierarchy.js';
import { defaultSide } from '../port-sides.js';
import { allocateTracks, requiredTrackSpace, TRACK_GAP } from './channel-allocation.js';
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
export function routeGroupChannels(result, compiled) {
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
      ref.direction === 'both' ||
      (ref.netStyle ?? ref.style).startArrow !== 'none' ||
      (edge.routingInfo?.channelStatus === 'routed' && edge.routingInfo?.method !== 'group-channel') ||
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
  for (const batch of batches.values()) {
    const tracks = allocateTracks(batch.branches),
      minimum = Math.max(...batch.branches.map((e) => e.min)),
      maximum = Math.min(...batch.branches.map((e) => e.max));
    const width = requiredTrackSpace(tracks);
    if (width > maximum - minimum + EPS) continue;
    const changed = new Set(batch.branches.map((e) => e.id));
    const baseline = netRouteQuality(result),
      baselineContacts = contacts(result.connections, changed);
    const compliant = batch.branches.every(({ id, min, max }) => {
      const points = simplifyForwardPath(
        result.connections.find((e) => e.id === id).sections.flatMap((s) => s.points),
      );
      if (Math.abs(points[0][cross] - points.at(-1)[cross]) < EPS && points.length === 2) return true;
      return (
        points.length === 4 &&
        points[1][axis] >= min - EPS &&
        points[1][axis] <= max + EPS &&
        Math.abs(points[1][axis] - points[2][axis]) < EPS
      );
    });
    const independent = batch.branches.every((a, i) =>
      batch.branches.slice(i + 1).every((b) => {
        if (a.net === b.net || a.hi - a.lo < EPS || b.hi - b.lo < EPS) return true;
        const path = (id) =>
          simplifyForwardPath(result.connections.find((e) => e.id === id).sections.flatMap((s) => s.points));
        const p = path(a.id),
          q = path(b.id);
        return (
          p.length === 4 &&
          q.length === 4 &&
          !parallelOverlap(p[1], p[2], q[1], q[2], (a.width + b.width) / 2 + 2)
        );
      }),
    );
    if (compliant && independent) continue;
    const baselineInk = countStrokeContacts(result.connections);
    let best = null,
      bestQuality = null;
    for (const ordered of tracks.length > 1 ? [tracks, [...tracks].reverse()] : [tracks]) {
      const coordinates = new Map();
      let offset = minimum + (maximum - minimum - width) / 2;
      for (const track of ordered) {
        const coordinate = offset + track.width / 2;
        for (const n of track.nets)
          for (const id of n.branches) coordinates.set(id, { coordinate, index: tracks.indexOf(track) });
        offset += track.width + TRACK_GAP;
      }
      const trial = { ...result, connections: structuredClone(result.connections) };
      let safe = true;
      for (const branch of batch.branches) {
        const { a, b, ref, wire, id } = branch,
          { coordinate, index } = coordinates.get(id);
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
        const obstacles = [...nodes.values()]
          .filter((n) => !exempt.has(n.id))
          .map((n) => inflate(n, clearance));
        for (const t of result.terminals ?? [])
          if (!t.style.hidden) obstacles.push(inflate(t.labelBounds, 4));
        const segments = sectionSegments([{ points }]);
        if (
          !points.every((p) => pointInBounds(p, bounds)) ||
          obstacles.some((box) => segments.some(([p, q]) => segmentCrossesInterior(p, q, box)))
        ) {
          safe = false;
          break;
        }
        const edge = trial.connections.find((e) => e.id === id);
        // Straight fanout branches reserve their Net's span, but keep their
        // existing clean access line and diagnostics instead of adding a detour.
        if (points.length === 2 && simplifyForwardPath(edge.sections.flatMap((s) => s.points)).length === 2)
          continue;
        edge.sections = [{ points }];
        edge.routingInfo = {
          method: 'group-channel',
          reason: 'inter-container',
          channelAxis: axis,
          channelTrack: index,
          channelTrackCount: tracks.length,
          channelStatus: 'routed',
          ...(batch.parent ? { channelOwner: batch.parent } : {}),
          sourceGroup: batch.from,
          targetGroup: batch.to,
        };
      }
      if (!safe) continue;
      const q = netRouteQuality(trial);
      if (
        q.overlaps > baseline.overlaps ||
        q.crossings > baseline.crossings ||
        q.bends > baseline.bends ||
        q.length > baseline.length + EPS ||
        contacts(trial.connections, changed) > baselineContacts ||
        countStrokeContacts(trial.connections) > baselineInk
      )
        continue;
      if (
        !best ||
        q.crossings < bestQuality.crossings ||
        (q.crossings === bestQuality.crossings && q.bends < bestQuality.bends)
      ) {
        best = trial;
        bestQuality = q;
      }
    }
    if (best) result.connections = best.connections;
  }
}
