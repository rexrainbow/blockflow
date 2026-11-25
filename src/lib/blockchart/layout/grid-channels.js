import { allocateTracks, requiredTrackSpace, TRACK_GAP } from './channel-allocation.js';
import { routeOrthogonal } from '../../shared/orthogonal.js';
import { lineWidth, endpointEscape, obstacleClearance } from './routing-spacing.js';

const eps = 1e-6;
const cross = (a, b, r) =>
  Math.abs(a.y - b.y) < eps
    ? a.y > r.y + eps &&
      a.y < r.y + r.height - eps &&
      Math.max(a.x, b.x) > r.x + eps &&
      Math.min(a.x, b.x) < r.x + r.width - eps
    : a.x > r.x + eps &&
      a.x < r.x + r.width - eps &&
      Math.max(a.y, b.y) > r.y + eps &&
      Math.min(a.y, b.y) < r.y + r.height - eps;

/** Plan before placing tracks. Keep live node references so ancestor moves are safe. */
export function planGridChannels(rows, nodes, children, connections, direction) {
  const down = direction === 'down',
    slots = new Map(),
    owners = new Map(),
    atoms = new Map();
  function register(node, slot, atom = node) {
    if (!node) return;
    slots.set(node.id, slot);
    atoms.set(node.id, atom);
    for (const id of node.members ?? []) register(nodes.get(id), slot, atom);
  }
  const allowed = new Set(children.map((n) => n.id));
  rows.forEach((row, r) =>
    row.forEach((id, c) => {
      const node = nodes.get(id);
      if (node && allowed.has(id)) {
        register(node, { flow: down ? r : c, cross: down ? c : r });
        owners.set(id, node);
      }
    }),
  );
  const channels = new Map();
  for (const edge of connections) {
    if (edge.feedback || edge.direction === 'both' || edge._signalTrunk || edge._signalTail) continue;
    const a = slots.get(edge.source.moduleId),
      b = slots.get(edge.target.moduleId);
    if (!a || !b || a.flow >= b.flow || a.cross === b.cross) continue;
    const index = a.flow;
    if (!channels.has(index))
      channels.set(index, { index, axis: down ? 'y' : 'x', nodes: [], branches: [], margin: 0 });
    const channel = channels.get(index);
    channel.branches.push({
      id: edge.id,
      net: edge.netId ?? edge.id,
      lo: Math.min(a.cross, b.cross),
      hi: Math.max(a.cross, b.cross),
      width: lineWidth(edge),
      sourceNode: atoms.get(edge.source.moduleId),
      targetNode: atoms.get(edge.target.moduleId),
    });
    channel.margin = Math.max(
      channel.margin,
      endpointEscape(edge, true) + obstacleClearance(edge) + 2,
      endpointEscape(edge, false) + obstacleClearance(edge) + 2,
    );
  }
  for (const channel of channels.values()) {
    channel.targets = [];
    for (const [id, node] of owners) if (slots.get(id).flow === channel.index) channel.nodes.push(node);
    for (const [id, node] of owners) if (slots.get(id).flow === channel.index + 1) channel.targets.push(node);
    channel.tracks = allocateTracks(channel.branches);
    channel.required = requiredTrackSpace(channel.tracks, channel.margin);
  }
  return [...channels.values()];
}

export function channelAssignments(channels) {
  const result = new Map();
  for (const channel of channels ?? []) {
    const extent = channel.axis === 'y' ? 'height' : 'width';
    const gap =
      channel.kind === 'auto'
        ? Math.min(...channel.targets.map((n) => n[channel.axis])) -
          Math.max(...channel.nodes.map((n) => n[channel.axis] + n[extent]))
        : channel.gap;
    if (gap < channel.required - 1e-6) continue;
    const start =
      Math.max(...channel.nodes.map((n) => n[channel.axis] + n[extent])) +
      channel.inset +
      (gap - channel.required) / 2 +
      channel.margin;
    let offset = 0;
    channel.tracks.forEach((track, index) => {
      const coordinate = start + offset + track.width / 2;
      for (const net of track.nets)
        for (const id of net.branches)
          result.set(id, {
            axis: channel.axis,
            coordinate,
            track: index,
            count: channel.tracks.length,
            ...(channel.kind === 'auto' ? { owner: channel.owner } : {}),
          });
      offset += track.width + TRACK_GAP;
    });
  }
  return result;
}

/** Perpendicular crossings remain legal; foreign parallel ink must stay separated. */
export function parallelOverlap(a, b, c, d, gap = 0) {
  if (Math.abs(a.y - b.y) < eps && Math.abs(c.y - d.y) < eps)
    return (
      Math.abs(a.y - c.y) < gap + eps &&
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) >
        eps
    );
  if (Math.abs(a.x - b.x) < eps && Math.abs(c.x - d.x) < eps)
    return (
      Math.abs(a.x - c.x) < gap + eps &&
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) >
        eps
    );
  return false;
}

export function routeGridChannel({
  search = routeOrthogonal,
  start,
  finish,
  source,
  target,
  av,
  bv,
  channel,
  obstacles,
  bounds,
  clearance,
  avoid,
  gap,
}) {
  const axis = channel.axis,
    other = axis === 'y' ? 'x' : 'y';
  if (Math.abs(start[other] - finish[other]) < eps) return null;
  for (const fromOffset of [0, -8, 8])
    for (const toOffset of [0, -8, 8]) {
      const a = { ...start, [axis]: channel.coordinate, [other]: start[other] + fromOffset };
      const b = { ...finish, [axis]: channel.coordinate, [other]: finish[other] + toOffset };
      if (
        bounds &&
        [a, b].some(
          (p) =>
            p.x < bounds.x - eps ||
            p.y < bounds.y - eps ||
            p.x > bounds.x + bounds.width + eps ||
            p.y > bounds.y + bounds.height + eps,
        )
      )
        continue;
      if (obstacles.some((r) => cross(a, b, r))) continue;
      const travel = { x: 0, y: 0 };
      travel[other] = Math.sign(b[other] - a[other]);
      if (!travel[other]) continue;
      let head, tail;
      try {
        head = search(start, a, obstacles, bounds, clearance, avoid, {
          startDirection: av,
          endDirection: travel,
        });
        tail = search(b, finish, obstacles, bounds, clearance, avoid, {
          startDirection: travel,
          endDirection: { x: -bv.x, y: -bv.y },
        });
      } catch {
        continue;
      }
      const points = [source, ...head, ...tail, target];
      if (
        points
          .slice(1)
          .some((p, i) =>
            avoid.some(([c, d, required = gap]) => parallelOverlap(points[i], p, c, d, required)),
          )
      )
        continue;
      return { points, waypoints: [a, b] };
    }
  return null;
}
