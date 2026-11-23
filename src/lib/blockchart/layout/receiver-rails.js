import { ancestors } from '../hierarchy.js';
import { defaultSide, sideVector } from '../port-sides.js';
import { TRACK_GAP } from './channel-allocation.js';
import { obstacleClearance, containerClearance, endpointEscape, lineWidth } from './routing-spacing.js';
import { countSegmentContacts, routeMetrics } from './route-quality.js';
import {
  EPS,
  sectionSegments,
  segmentCrossesInterior,
  collinearOverlap,
  pointInBounds,
} from './routing-geometry.js';

const net = (e) => e.netId ?? e.id;
const inflate = (b, gap) => ({
  x: b.x - gap,
  y: b.y - gap,
  width: b.width + 2 * gap,
  height: b.height + 2 * gap,
});
function overlapLength(sections, others) {
  let length = 0;
  for (const [a, b] of sectionSegments(sections))
    for (const e of others)
      for (const [c, d] of sectionSegments(e.sections))
        if (collinearOverlap(a, b, c, d)) {
          const axis = Math.abs(a.x - b.x) < EPS ? 'y' : 'x';
          length +=
            Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
            Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
        }
  return length;
}

/** Final, bounded repair of conflicting incoming rails. Anchors, names and all
 * geometry stay fixed; reserved Grid/Auto/group channels are never reassigned. */
export function separateReceiverRails(result, compiled) {
  const model = compiled._signalOriginal ?? compiled;
  const refs = new Map(model.connections.map((e) => [e.id, e]));
  const nodes = [...result.modules, ...result.groups],
    owners = new Map(nodes.map((n) => [n.id, n]));
  const labels = result.connections.flatMap((e) => [
    ...[e.signalLabel, e.signalEndLabel].filter(Boolean).map((l) => l.bounds),
    ...(e.labelInstances ?? []).map((l) => l.bounds),
  ]);
  const requests = [];
  for (const edge of result.connections) {
    const ref = refs.get(edge.id),
      sections = edge.sections,
      points = sections.at(-1)?.points;
    if (!ref?.target.moduleId || !points || points.length < 4) continue;
    const node = owners.get(ref.target.moduleId),
      port = node?.ports.find((p) => p.id === ref.target.portId);
    if (!port || node.type === 'concat' || node.members) continue;
    if (
      ancestors(model, node.id).some((id) => {
        const g = owners.get(id);
        return g && (g.collapsed || g.portMode === 'boundary' || g.type !== 'container');
      })
    )
      continue;
    const side = port.side ?? defaultSide(port, model.layout.direction),
      v = sideVector(side);
    const axis = v.x ? 'x' : 'y',
      cross = v.x ? 'y' : 'x',
      sign = v[axis];
    const [before, a, b, target] = points.slice(-4);
    if (
      Math.abs(target.x - port.x) > EPS ||
      Math.abs(target.y - port.y) > EPS ||
      Math.abs(a[axis] - b[axis]) > EPS ||
      Math.abs(b[cross] - target[cross]) > EPS ||
      Math.abs(before[cross] - a[cross]) > EPS ||
      Math.abs(a[cross] - b[cross]) < EPS ||
      (b[axis] - target[axis]) * sign < endpointEscape(ref, false) - EPS
    )
      continue;
    requests.push({ edge, ref, node, points, axis, cross, sign, side });
  }
  // Longer rails are usually the through route crossing several Port approaches.
  // Repair them first, but only when this does not add segment contacts elsewhere.
  requests.sort(
    (a, b) =>
      Math.abs(b.points.at(-3)[b.cross] - b.points.at(-2)[b.cross]) -
      Math.abs(a.points.at(-3)[a.cross] - a.points.at(-2)[a.cross]),
  );
  for (const request of requests) {
    const { edge, ref, node, points, axis, sign, side } = request;
    if (edge.routingInfo?.channelStatus === 'routed' || edge.routingInfo?.method === 'outer-aabb') continue;
    const rail = points.slice(-3, -1);
    // Shared same-Net approaches must be moved jointly, outside this local repair.
    if (
      requests.some(
        (r) =>
          r !== request &&
          net(r.edge) === net(edge) &&
          collinearOverlap(...rail, ...r.edge.sections.at(-1).points.slice(-3, -1)),
      )
    )
      continue;
    const siblings = requests.filter(
      (r) => r !== request && r.node === node && r.side === side && net(r.edge) !== net(edge),
    );
    const group = ancestors(model, node.id)
      .reverse()
      .map((id) => owners.get(id))
      .find((g) => g && !g.collapsed && g.portMode !== 'boundary' && g.type === 'container');
    const boundary = group
      ? sign > 0
        ? group[axis] + group[axis === 'x' ? 'width' : 'height']
        : group[axis]
      : null;
    const nearFrame = group && Math.abs(rail[0][axis] - boundary) < containerClearance(ref) - EPS;
    const conflicting = siblings.some((r) =>
      collinearOverlap(...rail, ...r.edge.sections.at(-1).points.slice(-3, -1)),
    );
    if (!conflicting && !nearFrame) continue;
    const others = result.connections.filter((e) => e !== edge && net(e) !== net(edge));
    const originalOverlap = overlapLength(edge.sections, others),
      originalContacts = countSegmentContacts(edge.sections, others);
    if (!nearFrame && originalOverlap < EPS) continue;
    const exempt = new Set([
      ...ancestors(model, ref.source.moduleId),
      ...ancestors(model, ref.target.moduleId),
    ]);
    const boxes = nodes
      .filter((n) => !exempt.has(n.id))
      .map((n) =>
        inflate(n, n.id === ref.source.moduleId || n.id === ref.target.moduleId ? 0 : obstacleClearance(ref)),
      );
    boxes.push(
      ...labels,
      ...(result.terminals ?? []).filter((t) => !t.style.hidden).map((t) => inflate(t.labelBounds, 3)),
    );
    let scope = ref.scope ? owners.get(ref.scope) : null;
    const scopeRef = model.groups.find((g) => g.id === ref.scope);
    if (scopeRef?.type === 'container' && scopeRef.portMode !== 'boundary') {
      const parent = owners.get(ancestors(model, scopeRef.id).at(-1));
      if (parent?.type === 'container' && parent.portMode !== 'boundary' && !parent.collapsed) scope = parent;
    }
    const sourceFrames = ancestors(model, ref.source.moduleId)
      .map((id) => owners.get(id))
      .filter(Boolean);
    const gap = Math.max(TRACK_GAP, lineWidth(ref) + 6, ...siblings.map((r) => lineWidth(r.ref) + 6));
    let best = null,
      bestScore = null;
    for (let track = 1; track <= 4; track++) {
      let position = rail[0][axis] + sign * gap * track;
      if (group) {
        position =
          sign > 0
            ? Math.max(position, boundary + containerClearance(ref))
            : Math.min(position, boundary - containerClearance(ref));
      }
      const candidate = points.map((p) => ({ ...p }));
      candidate.at(-3)[axis] = candidate.at(-2)[axis] = position;
      const [before, a, b, target] = candidate.slice(-4);
      if (
        (a[axis] - before[axis]) * (points.at(-3)[axis] - before[axis]) <= EPS ||
        (b[axis] - target[axis]) * sign < endpointEscape(ref, false) - EPS
      )
        continue;
      if (scope && !candidate.slice(-3).every((p) => pointInBounds(p, scope))) continue;
      // A receiver repair must not pull an existing source departure bend back
      // inside its source frame. The upstream path is otherwise left untouched.
      if (sourceFrames.some((g) => !pointInBounds(points.at(-3), g) && pointInBounds(a, g))) continue;
      const changed = [before, a, b, target];
      if (
        sectionSegments([{ points: changed }]).some(([a, b]) =>
          boxes.some((box) => segmentCrossesInterior(a, b, box)),
        )
      )
        continue;
      const sections = [...edge.sections.slice(0, -1), { ...edge.sections.at(-1), points: candidate }];
      const overlap = overlapLength(sections, others),
        contacts = countSegmentContacts(sections, others);
      if (
        (nearFrame ? overlap > originalOverlap + EPS : overlap >= originalOverlap - EPS) ||
        contacts > originalContacts
      )
        continue;
      const length = routeMetrics(candidate).length,
        originalLength = routeMetrics(points).length;
      if (length > originalLength + gap * 8 + EPS) continue;
      const score = [overlap, contacts, length];
      if (
        !bestScore ||
        score.some(
          (n, i) =>
            n < bestScore[i] - EPS && score.slice(0, i).every((v, j) => Math.abs(v - bestScore[j]) < EPS),
        )
      ) {
        best = sections;
        bestScore = score;
      }
    }
    if (best) {
      edge.sections = best;
      edge.routingInfo = { ...edge.routingInfo, receiverRail: 'separated' };
    }
  }
}
