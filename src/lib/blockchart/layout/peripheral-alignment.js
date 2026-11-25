import { ancestors, descendants, parentOf } from '../hierarchy.js';
import { groupGeometry } from './groups.js';
import { resolveLayoutSpacing } from '../layout-spacing.js';
import { translateNode } from './translate.js';
import { createCandidateRouter, evaluateRoutedTrial } from './routing-trial.js';
import { routeFixed } from './fixed.js';
import { routeWorkingConnections } from './routing-policy.js';
import { netRouteQuality as quality } from './route-quality.js';
import {
  EPS as eps,
  rectanglesOverlap as overlaps,
  rectangleContains as contains,
} from './routing-geometry.js';

const nodesOf = (r) => new Map([...r.modules, ...r.groups].map((n) => [n.id, n]));
const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  return (v[Math.floor((v.length - 1) / 2)] + v[Math.ceil((v.length - 1) / 2)]) / 2;
};

function anchors(result, semantic, axis) {
  const nodes = nodesOf(result),
    terminals = new Map((result.terminals ?? []).map((t) => [t.id, t]));
  const port = (e) =>
    e.moduleId
      ? nodes.get(e.moduleId)?.ports.find((p) => p.id === e.portId)
      : terminals.get(e.terminal)?.anchor;
  let main = 0,
    weak = 0;
  for (const e of semantic.connections) {
    const a = port(e.source),
      b = port(e.target);
    if (!a || !b) continue;
    const delta = Math.abs(a[axis] - b[axis]);
    if (e.constraint === false) weak += delta * 0.15;
    else main += delta;
  }
  return { main, weak, port };
}

function shiftTree(node, delta, axis, nodes) {
  translateNode(node, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0);
  for (const id of node.members ?? []) {
    const child = nodes.get(id);
    if (child) shiftTree(child, delta, axis, nodes);
  }
}

function candidate(result, model, groupId, units, positions, axis, rigid) {
  const trial = structuredClone(result),
    nodes = nodesOf(trial),
    group = nodes.get(groupId);
  const size = axis === 'x' ? 'width' : 'height';
  let extent = group[size],
    start = group[axis] + (positions[0] - units[0].position);
  if (!rigid) {
    const ref = model.groups.find((g) => g.id === groupId),
      pad = groupGeometry(ref, model.layout.direction, model),
      before = axis === 'x' ? pad.left : pad.top,
      after = axis === 'x' ? pad.right : pad.bottom;
    const gap = resolveLayoutSpacing(model, groupId).moduleSpacing;
    let end = -Infinity;
    for (let i = 0; i < units.length; i++) {
      const n = nodes.get(units[i].id),
        target = Math.max(positions[i], end + gap);
      shiftTree(n, target - n[axis], axis, nodes);
      end = target + n[size];
    }
    const lo = Math.min(...units.map((u) => nodes.get(u.id)[axis]));
    extent = Math.max(group[size], pad[size], end - lo + before + after);
    start = lo - before;
  }
  const parentId = parentOf(model, groupId),
    parent = nodes.get(parentId);
  let limit;
  if (parent) {
    const p = groupGeometry(
      model.groups.find((g) => g.id === parentId),
      model.layout.direction,
      model,
    );
    limit = {
      ...parent,
      [axis]: parent[axis] + (axis === 'x' ? p.left : p.top),
      [size]: parent[size] - (axis === 'x' ? p.left + p.right : p.top + p.bottom),
    };
  } else {
    const all = [...result.modules, ...result.groups];
    const min = Math.min(...all.map((n) => n[axis])),
      max = Math.max(...all.map((n) => n[axis] + n[size]));
    limit = { [axis]: min, [size]: max - min };
  }
  if (extent > limit[size] + eps) return null;
  const clamped = Math.max(limit[axis], Math.min(start, limit[axis] + limit[size] - extent)),
    adjust = clamped - start;
  if (rigid) shiftTree(group, clamped - group[axis], axis, nodes);
  else {
    if (Math.abs(adjust) > eps) for (const u of units) shiftTree(nodes.get(u.id), adjust, axis, nodes);
    translateNode(group, axis === 'x' ? clamped - group[axis] : 0, axis === 'y' ? clamped - group[axis] : 0);
    group[size] = extent;
  }
  const owned = new Set([groupId, ...descendants(model, groupId)]),
    parents = new Set(ancestors(model, groupId));
  if (parent && !contains(parent, group)) return null;
  if (
    [...trial.modules, ...trial.groups].some(
      (n) => !owned.has(n.id) && !parents.has(n.id) && overlaps(group, n),
    )
  )
    return null;
  if ((trial.terminals ?? []).some((t) => !t.style.hidden && overlaps(group, t.labelBounds))) return null;
  const flow = axis === 'x' ? 'y' : 'x',
    flowSize = axis === 'x' ? 'height' : 'width';
  const oldGroup = nodesOf(result).get(groupId),
    spacing = resolveLayoutSpacing(model, parentId).moduleSpacing;
  for (const n of [...result.modules, ...result.groups]) {
    if (
      owned.has(n.id) ||
      parentOf(model, n.id) !== parentId ||
      group[flow] >= n[flow] + n[flowSize] ||
      n[flow] >= group[flow] + group[flowSize]
    )
      continue;
    const oldGap = Math.max(n[axis] - oldGroup[axis] - oldGroup[size], oldGroup[axis] - n[axis] - n[size]);
    const nextGap = Math.max(n[axis] - group[axis] - group[size], group[axis] - n[axis] - n[size]);
    if (nextGap < Math.min(spacing, Math.max(0, oldGap)) - eps) return null;
  }
  return trial;
}

/** Post-Grid, tangent-only alignment of small unpinned Auto leaf Containers. */
export function alignPeripheralGroups(result, model) {
  const semantic = model._signalOriginal ?? model,
    axis = model.layout.direction === 'down' ? 'x' : 'y';
  const groups = semantic.groups,
    byId = new Map(groups.map((g) => [g.id, g]));
  const pinned = new Set(
    (semantic.layout.type === 'grid' ? semantic.layout.cells.flat() : []).filter(Boolean),
  );
  for (const g of groups)
    if (g.layout?.type === 'grid') for (const id of g.layout.cells.flat()) if (id) pinned.add(id);
  let changed = false;
  for (const ref of groups) {
    if (
      ref.collapsed ||
      (ref.type ?? 'container') !== 'container' ||
      ref.portMode === 'boundary' ||
      ref.layout?.type === 'grid' ||
      pinned.has(ref.id) ||
      (ref.ports ?? []).length ||
      !ref.members.length ||
      ref.members.length > 4 ||
      ref.members.some(
        (id) =>
          pinned.has(id) || byId.has(id) || semantic.modules.find((m) => m.id === id)?.type === 'concat',
      )
    )
      continue;
    if (
      ancestors(semantic, ref.id).some(
        (id) =>
          (byId.get(id)?.type ?? 'container') !== 'container' ||
          byId.get(id)?.portMode === 'boundary' ||
          byId.get(id)?.collapsed,
      )
    )
      continue;
    const parent = parentOf(semantic, ref.id),
      fixed = groups.filter((g) => g.layout?.type === 'grid' && parentOf(semantic, g.id) === parent);
    if (!fixed.length) continue;
    const core = new Set(fixed.flatMap((g) => [g.id, ...descendants(semantic, g.id)])),
      nodes = nodesOf(result);
    const current = anchors(result, semantic, axis),
      units = [];
    for (const id of ref.members) {
      const wrapper = model.groups.find((g) => g._signalWrapper && g.members.includes(id));
      const unit = nodes.get(wrapper?.id ?? id);
      if (!unit) break;
      const goals = [];
      for (const edge of semantic.connections) {
        if (edge.constraint === false) continue;
        const own =
          edge.source.moduleId === id ? edge.source : edge.target.moduleId === id ? edge.target : null;
        const peer = own === edge.source ? edge.target : edge.source;
        if (!own || !core.has(peer.moduleId)) continue;
        const a = current.port(own),
          b = current.port(peer);
        if (a && b) goals.push(unit[axis] + b[axis] - a[axis]);
      }
      units.push({ id: unit.id, position: unit[axis], goals });
    }
    if (units.length !== ref.members.length) continue;
    units.sort((a, b) => a.position - b.position);
    const allDeltas = units.flatMap((u) => u.goals.map((p) => p - u.position));
    if (!allDeltas.length) continue;
    const rigid = units.some((u) => !u.goals.length);
    const delta = median(allDeltas);
    const translation = units.map((u) => u.position + delta);
    const plans = rigid
      ? [translation]
      : [
          units.map((u) => Math.min(...u.goals)),
          units.map((u) => Math.max(...u.goals)),
          units.map((u) => u.goals.reduce((a, b) => a + b, 0) / u.goals.length),
          translation,
        ];
    const candidates = [],
      seen = new Set();
    for (const positions of plans) {
      const trial = candidate(result, model, ref.id, units, positions, axis, rigid);
      if (!trial) continue;
      const trialNodes = nodesOf(trial),
        key = units.map((u) => trialNodes.get(u.id)[axis].toFixed(3)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const score = anchors(trial, semantic, axis),
        worst = Math.max(
          ...units.flatMap((u) => u.goals.map((p) => Math.abs(p - trialNodes.get(u.id)[axis]))),
        );
      if (score.main >= current.main - 1) continue;
      candidates.push({ trial, score, worst });
    }
    candidates.sort(
      (a, b) => a.score.main - b.score.main || a.worst - b.worst || a.score.weak - b.score.weak,
    );
    if (!candidates.length) continue;
    const baseline = rigid ? quality(result) : null;
    // Placement is selected from actual peer anchors, not from a transient
    // all-Net route score. Compare routing alternatives only at that position.
    candidateSearch: for (const c of candidates.slice(0, 2)) {
      const search = createCandidateRouter();
      let best = null,
        bestScore = null;
      for (const avoidForeignOverlaps of [false, true]) {
        const trial = structuredClone(c.trial);
        if (
          !evaluateRoutedTrial(trial, model, {
            reason: 'peripheral-alignment',
            routeOptions: { avoidForeignOverlaps, search },
            route: (draft, routingModel, options) => {
              routeFixed(draft, routingModel, options);
              routeWorkingConnections(draft, routingModel, search);
            },
          })
        )
          continue;
        const q = quality(trial),
          score = [q.overlaps, q.crossings, q.bends, q.length];
        // These are working routes: semantic cleanup still follows. Preserve a
        // clear drawing and reject a longer detour for the whole-frame move.
        if (
          baseline &&
          (q.length > baseline.length + eps ||
            (!baseline.overlaps && q.overlaps) ||
            (!baseline.crossings && q.crossings))
        )
          continue;
        if (
          !bestScore ||
          score.some(
            (n, i) =>
              n < bestScore[i] - eps && score.slice(0, i).every((v, j) => Math.abs(v - bestScore[j]) < eps),
          )
        ) {
          best = trial;
          bestScore = score;
        }
      }
      if (best) {
        Object.assign(result, best);
        changed = true;
        break candidateSearch;
      }
    }
  }
  return changed;
}
