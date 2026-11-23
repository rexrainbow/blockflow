import { ancestors } from '../hierarchy.js';
import { sideVector, defaultSide } from '../port-sides.js';
import { routeOrthogonal } from '../../shared/orthogonal.js';
import { obstacleClearance, containerClearance, endpointEscape } from './routing-spacing.js';
import { routeMetrics } from './route-quality.js';
import { simplifyReceiverAccess } from './receiver-access.js';
import {
  EPS,
  segmentCrossesInterior as crosses,
  sectionSegments as parts,
  pointInBounds as inside,
  simplifyForwardPath as clean,
} from './routing-geometry.js';
import { countSegmentContacts as contacts } from './route-quality.js';

const inflate = (b, n) => ({ x: b.x - n, y: b.y - n, width: b.width + 2 * n, height: b.height + 2 * n });
const distance = (a, b, v) => (a.x - b.x) * v.x + (a.y - b.y) * v.y;
const direction = (from, to) => {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  if (Math.abs(dx) > EPS && Math.abs(dy) > EPS) return null;
  if (Math.abs(dx) > EPS) return { x: Math.sign(dx), y: 0 };
  if (Math.abs(dy) > EPS) return { x: 0, y: Math.sign(dy) };
  return null;
};
const labelKey = (l) => l.sharedKey ?? JSON.stringify(l.bounds);

function gate(anchor, vector, frames, gap, escape) {
  const p = { x: anchor.x + vector.x * escape, y: anchor.y + vector.y * escape };
  for (const g of frames) {
    if (vector.x > 0) p.x = Math.max(p.x, g.x + g.width + gap);
    if (vector.x < 0) p.x = Math.min(p.x, g.x - gap);
    if (vector.y > 0) p.y = Math.max(p.y, g.y + g.height + gap);
    if (vector.y < 0) p.y = Math.min(p.y, g.y - gap);
  }
  return p;
}

/** Final semantic pass: group rectangles are frozen, and reserved signal labels stay pinned. */
export function routeContainerExits(result, compiled) {
  const baseline = new Map(result.connections.map((edge) => [edge.id, edge.routingInfo]));
  routeExitsWithClearance(result, compiled, containerClearance);
  const retry = new Set(
    result.connections
      .filter((edge) => edge.routingInfo?.containerExit?.status === 'blocked')
      .map((edge) => edge.id),
  );
  for (const edge of result.connections)
    if (retry.has(edge.id)) {
      if (baseline.get(edge.id) === undefined) delete edge.routingInfo;
      else edge.routingInfo = baseline.get(edge.id);
    }
  if (retry.size)
    routeExitsWithClearance(result, compiled, (edge) => Math.max(9, obstacleClearance(edge)), retry);
}

function routeExitsWithClearance(result, compiled, clearanceFor, selected = null) {
  const model = compiled._signalOriginal ?? compiled;
  const nodes = [...result.modules, ...result.groups],
    owners = new Map(nodes.map((n) => [n.id, n]));
  const refs = new Map(model.connections.map((e) => [e.id, e]));
  const labels = [
    ...new Map(
      result.connections
        .flatMap((e) => [e.signalLabel, e.signalEndLabel].filter(Boolean))
        .map((l) => [labelKey(l), l]),
    ).values(),
  ];
  for (const edge of result.connections) {
    if (selected && !selected.has(edge.id)) continue;
    const ref = refs.get(edge.id);
    if (!ref?.source.moduleId) continue;
    const sourceNode = owners.get(ref.source.moduleId),
      port = sourceNode?.ports?.find((p) => p.id === ref.source.portId);
    if (!port) continue;
    const sourceParents = ancestors(model, ref.source.moduleId);
    const targetParents = ref.target.moduleId ? ancestors(model, ref.target.moduleId) : [];
    if (owners.get(ref.target.moduleId)?.members) targetParents.push(ref.target.moduleId);
    const targetSet = new Set(targetParents),
      sourceSet = new Set(sourceParents);
    const leaving = sourceParents
      .filter((id) => !targetSet.has(id))
      .map((id) => owners.get(id))
      .filter(Boolean);
    if (!leaving.length) continue;
    const v = sideVector(port.side ?? defaultSide(port, model.layout.direction));
    const originalPoints = clean(edge.sections.flatMap((s) => s.points)),
      source = originalPoints[0];
    if (originalPoints.length < 3) continue;
    const gap = clearanceFor(ref);
    const required = gate(source, v, leaving, gap, 0);
    if (
      distance(originalPoints[1], required, v) >= -EPS &&
      Math.abs((originalPoints[1].x - source.x) * v.y - (originalPoints[1].y - source.y) * v.x) < EPS
    )
      continue;
    const record = (status, reason) => {
      edge.routingInfo = {
        ...edge.routingInfo,
        containerExit: { status, groups: leaving.map((g) => g.id), ...(reason ? { reason } : {}) },
      };
    };
    const protectedGroup = (g) => g.collapsed || g.portMode === 'boundary';
    if (
      leaving.some(protectedGroup) ||
      targetParents.some((id) => !sourceSet.has(id) && protectedGroup(owners.get(id) ?? {}))
    ) {
      record('blocked', 'protected-boundary');
      continue;
    }
    if (edge.routingInfo?.channelStatus === 'routed' || edge.routingInfo?.method === 'outer-aabb') {
      record('blocked', 'reserved-channel');
      continue;
    }
    const prefixCount = edge.netTrunkSections ?? 0;
    const prefix = edge.sections.slice(0, prefixCount);
    const anchor = prefix.length ? prefix.at(-1).points.at(-1) : source;
    if (
      prefix
        .flatMap((s) => s.points)
        .some(
          (p) =>
            Math.abs((p.x - source.x) * v.y - (p.y - source.y) * v.x) > EPS || distance(p, source, v) < -EPS,
        )
    ) {
      record('blocked', 'reserved-source-label');
      continue;
    }
    let suffix = [],
      target = originalPoints.at(-1),
      w;
    if (edge.signalEndLabel) {
      const index = edge.sections.findLastIndex((s) =>
        parts([s]).some(([a, b]) => crosses(a, b, edge.signalEndLabel.bounds)),
      );
      if (index < prefixCount) {
        record('blocked', 'reserved-receiver-label');
        continue;
      }
      suffix = edge.sections.slice(index);
      target = suffix[0].points[0];
      const bridge = clean(suffix[0].points);
      if (bridge.length < 2) {
        record('blocked', 'reserved-receiver-label');
        continue;
      }
      w = direction(bridge[1], target);
    } else if (ref.target.moduleId) {
      const p = owners.get(ref.target.moduleId)?.ports?.find((p) => p.id === ref.target.portId);
      if (p) w = sideVector(p.side ?? defaultSide(p, model.layout.direction));
    } else {
      const before = originalPoints.at(-2);
      w = direction(target, before);
    }
    if (!w) {
      record('blocked', 'missing-receiver');
      continue;
    }
    const commonId = sourceParents.findLast((id) => targetSet.has(id)),
      common = owners.get(commonId);
    const entering = targetParents
      .filter((id) => !sourceSet.has(id))
      .map((id) => owners.get(id))
      .filter(Boolean);
    const clearance = obstacleClearance(ref);
    const bounds = common
      ? {
          x: common.x + clearance,
          y: common.y + clearance,
          width: common.width - 2 * clearance,
          height: common.height - 2 * clearance,
        }
      : undefined;
    const out = gate(anchor, v, leaving, gap, endpointEscape(ref, true));
    const into = gate(target, w, entering, gap, endpointEscape(ref, false));
    const exempt = new Set([...sourceParents, ...targetParents]);
    const bodies = nodes
      .filter((n) => !exempt.has(n.id))
      .map((n) => ({ ...inflate(n, clearance), owner: n.id }));
    for (const terminal of result.terminals ?? [])
      if (terminal.id !== ref.target.terminal && !terminal.style?.hidden && terminal.labelBounds)
        bodies.push({ ...inflate(terminal.labelBounds, 4), owner: terminal.id });
    const labelBoxes = labels.map((l) => ({ ...inflate(l.bounds, clearance), key: labelKey(l) }));
    if (
      ![anchor, out, into, target].every((p) => inside(p, bounds)) ||
      bodies.some(
        (b) =>
          (b.owner !== sourceNode.id && crosses(anchor, out, b)) ||
          (b.owner !== ref.target.moduleId && crosses(into, target, b)),
      ) ||
      labelBoxes.some(
        (b) =>
          (b.key !== (edge.signalLabel && labelKey(edge.signalLabel)) && crosses(anchor, out, b)) ||
          (b.key !== (edge.signalEndLabel && labelKey(edge.signalEndLabel)) && crosses(into, target, b)),
      )
    ) {
      record('blocked', 'obstructed-access');
      continue;
    }
    const others = result.connections.filter(
      (other) =>
        other !== edge &&
        (other.netId ?? other.id) !== (edge.netId ?? edge.id) &&
        !(
          refs.get(other.id)?.source.moduleId === ref.source.moduleId &&
          refs.get(other.id)?.source.portId === ref.source.portId
        ),
    );
    const obstacles = [
      ...bodies,
      ...labelBoxes,
      ...[...leaving, ...entering].map((g) => inflate(g, clearance)),
    ];
    let middle;
    try {
      middle = routeOrthogonal(
        out,
        into,
        obstacles,
        bounds,
        model.layout.layerSpacing,
        others.flatMap((e) => parts(e.sections)),
        { startDirection: v, endDirection: { x: -w.x, y: -w.y } },
      );
    } catch {
      record('blocked', 'no-exterior-route');
      continue;
    }
    let points = clean([anchor, ...middle, target]);
    const existingContacts = contacts([...prefix, { points }, ...suffix], others);
    points = simplifyReceiverAccess(points, {
      sourceVector: v,
      sourceGate: out,
      targetVector: w,
      targetGroups: entering,
      clearance,
      minAccess: endpointEscape(ref, false),
      obstacles,
      bounds,
      arrivalObstacles: [
        ...bodies.filter((b) => b.owner !== ref.target.moduleId),
        ...leaving.map((g) => inflate(g, clearance)),
        ...labelBoxes.filter((b) => b.key !== (edge.signalEndLabel && labelKey(edge.signalEndLabel))),
      ],
      accept: (candidate) =>
        contacts([...prefix, { points: candidate }, ...suffix], others) <= existingContacts,
    });
    if (
      points.some((p) => !Number.isFinite(p.x + p.y)) ||
      parts([{ points }]).some(([a, b]) => Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS)
    ) {
      record('blocked', 'no-exterior-route');
      continue;
    }
    const sections = [...structuredClone(prefix), { points }, ...structuredClone(suffix)];
    const before = routeMetrics(originalPoints),
      after = routeMetrics(clean(sections.flatMap((s) => s.points)));
    if (
      after.length > before.length * 2 + 32 ||
      after.bends > before.bends + 4 ||
      contacts(sections, others) > contacts(edge.sections, others)
    ) {
      record('blocked', 'detour-or-crossing-budget');
      continue;
    }
    edge.sections = sections;
    edge.routingInfo = { ...edge.routingInfo, method: 'fixed-orthogonal', reason: 'container-exit' };
    record('routed');
  }
}
