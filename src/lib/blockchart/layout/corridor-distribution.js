import { ancestors, parentOf } from '../hierarchy.js';
import { defaultSide, sideVector } from '../port-sides.js';
import { allocateTracks, requiredTrackSpace } from './channel-allocation.js';
import { corridorAssignments } from './channel-corridors.js';
import { connectionTrial } from './channel-batch.js';
import { parallelApproachIssues } from './approach-spacing.js';
import { netRouteQuality } from './route-quality.js';
import { containerClearance, endpointEscape, lineWidth, preferredClearance } from './routing-spacing.js';
import { EPS, segmentCrossesInterior, sectionSegments, simplifyForwardPath } from './routing-geometry.js';

const net = (e) => e.netId ?? e.id;
const ordinary = (g) => (g.type ?? 'container') === 'container' && !g.collapsed && g.portMode !== 'boundary';
const inflate = (b, gap) => ({
  x: b.x - gap,
  y: b.y - gap,
  width: b.width + 2 * gap,
  height: b.height + 2 * gap,
});
const pairKey = (a, b) => JSON.stringify([a, b].sort());
const better = (a, b) =>
  !b || a.some((v, i) => v < b[i] - EPS && a.slice(0, i).every((w, j) => Math.abs(w - b[j]) < EPS));

/** Physical sibling gaps, independent of the endpoints or placement flags of wires. */
function corridors(result, model) {
  const axis = model.layout.direction === 'down' ? 'y' : 'x';
  const cross = axis === 'x' ? 'y' : 'x';
  const extent = axis === 'x' ? 'width' : 'height';
  const crossExtent = cross === 'x' ? 'width' : 'height';
  const refs = new Map(model.groups.map((g) => [g.id, g]));
  const groups = result.groups.filter((g) => ordinary(refs.get(g.id) ?? g));
  const pairs = [];
  for (const a of groups)
    for (const b of groups) {
      const owner = parentOf(model, a.id);
      if (a === b || parentOf(model, b.id) !== owner || b[axis] <= a[axis] + a[extent] + EPS) continue;
      const lo = Math.max(a[cross], b[cross]);
      const hi = Math.min(a[cross] + a[crossExtent], b[cross] + b[crossExtent]);
      if (hi <= lo + EPS) continue;
      // An intervening sibling frame makes this an ambiguous multi-gap span.
      if (
        groups.some(
          (g) =>
            g !== a &&
            g !== b &&
            parentOf(model, g.id) === owner &&
            g[axis] < b[axis] - EPS &&
            g[axis] + g[extent] > a[axis] + a[extent] + EPS &&
            g[cross] < hi - EPS &&
            g[cross] + g[crossExtent] > lo + EPS,
        )
      )
        continue;
      pairs.push({
        id: JSON.stringify([owner ?? '', axis, 'physical', a.id, b.id]),
        owner,
        axis,
        cross,
        lo,
        hi,
        start: a[axis] + a[extent],
        end: b[axis],
        receiver: b,
        demands: [],
      });
    }
  return pairs.sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

// A forward approach may cross the receiving face one bend too early. Only
// reclaim its last rail, within one clearance of that face, for an outside
// source feeding a member. Deeper routes and intra-frame detours stay fixed.
function entersReceiverFace(c, edge, before, bend, model) {
  const { receiver, axis, cross } = c;
  const extent = cross === 'x' ? 'width' : 'height';
  return (
    bend[axis] <= c.end + containerClearance(edge) + EPS &&
    before[axis] < c.end - EPS &&
    bend[cross] >= receiver[cross] - EPS &&
    bend[cross] <= receiver[cross] + receiver[extent] + EPS &&
    ancestors(model, edge.target.moduleId).includes(receiver.id) &&
    !ancestors(model, edge.source.moduleId).includes(receiver.id)
  );
}

function endpointSafe(edge, old, nodes, model) {
  const before = simplifyForwardPath(old.sections.flatMap((s) => s.points));
  const after = simplifyForwardPath(edge.sections.flatMap((s) => s.points));
  for (const [end, first, prior, corner] of [
    [edge.source, true, before[1], after[1]],
    [edge.target, false, before.at(-2), after.at(-2)],
  ]) {
    const node = nodes.get(end?.moduleId),
      port = node?.ports?.find((p) => p.id === end.portId);
    if (!port) continue;
    const v = sideVector(port.side ?? defaultSide(port, model.layout.direction));
    const dot = (p) => (p.x - port.x) * v.x + (p.y - port.y) * v.y;
    if (!corner || Math.abs((corner.x - port.x) * v.y - (corner.y - port.y) * v.x) > EPS) return false;
    let needed = Math.min(dot(prior), endpointEscape(edge, first));
    for (const id of ancestors(model, end.moduleId)) {
      const g = nodes.get(id);
      if (!g) continue;
      const face = {
        x: v.x > 0 ? g.x + g.width : v.x < 0 ? g.x : port.x,
        y: v.y > 0 ? g.y + g.height : v.y < 0 ? g.y : port.y,
      };
      const gate = dot(face) + containerClearance(edge);
      if (dot(prior) >= gate - EPS) needed = Math.max(needed, gate);
    }
    if (dot(corner) < needed - EPS) return false;
  }
  return true;
}

function safeGeometry(trial, baseline, changed, nodes, model, labels) {
  for (const edge of trial.connections) {
    if (!changed.has(edge.id)) continue;
    const old = baseline.connections.find((e) => e.id === edge.id);
    if (!endpointSafe(edge, old, nodes, model)) return false;
    for (let s = 0; s < edge.sections.length; s++) {
      const points = edge.sections[s].points,
        prior = old.sections[s].points;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          u = prior[i - 1],
          v = prior[i];
        if (a.x === u.x && a.y === u.y && b.x === v.x && b.y === v.y) continue;
        if (
          !Number.isFinite(a.x + a.y + b.x + b.y) ||
          (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) ||
          (b.x - a.x) * (v.x - u.x) + (b.y - a.y) * (v.y - u.y) <= EPS
        )
          return false;
        for (const node of baseline.modules) {
          const attachment = node.id === edge.source?.moduleId || node.id === edge.target?.moduleId;
          const box = inflate(node, attachment ? 0 : preferredClearance(edge));
          if (segmentCrossesInterior(a, b, box) && !segmentCrossesInterior(u, v, box)) return false;
        }
        for (const group of baseline.groups) {
          // Keep existing crossings of ordinary frames, including nested scopes.
          // A changed segment cannot start traversing another frame or its margin.
          const box = inflate(group, containerClearance(edge));
          if (segmentCrossesInterior(a, b, box) && !segmentCrossesInterior(u, v, box)) return false;
        }
        if (labels.some((box) => segmentCrossesInterior(a, b, box) && !segmentCrossesInterior(u, v, box)))
          return false;
      }
    }
  }
  return true;
}

function proximitySafe(trial, baselineIssues) {
  const after = parallelApproachIssues(trial.connections);
  const allowed = new Set(baselineIssues.map((i) => pairKey(i.a, i.b)));
  return (
    after.length <= baselineIssues.length &&
    after.every((i) => allowed.has(pairKey(i.a, i.b))) &&
    after.reduce((sum, i) => sum + i.missing, 0) <=
      baselineIssues.reduce((sum, i) => sum + i.missing, 0) + EPS
  );
}

function patchesTrial(baseline, patches) {
  const changed = new Set(patches.map((p) => p.edgeId));
  const trial = connectionTrial(baseline, changed);
  const edges = new Map(trial.connections.map((e) => [e.id, e]));
  const keys = new Map();
  for (const p of patches) {
    const key = JSON.stringify([p.edgeId, p.section, p.index, p.axis]);
    if (keys.has(key) && Math.abs(keys.get(key) - p.coordinate) > EPS) return null;
    keys.set(key, p.coordinate);
    const points = edges.get(p.edgeId).sections[p.section].points;
    points[p.index][p.axis] = p.coordinate;
    points[p.index + 1][p.axis] = p.coordinate;
  }
  return { trial, changed };
}

/** Final route-only redistribution. One frozen baseline, at most four offers per
 * corridor; shared edges merge by segment patches, with whole-batch rollback. */
export function distributeCorridorRails(result, compiled) {
  const model = compiled._signalOriginal ?? compiled;
  const physical = corridors(result, model);
  if (!physical.length) return;
  const nodes = new Map([...result.modules, ...result.groups].map((n) => [n.id, n]));
  const refs = new Map(model.groups.map((g) => [g.id, g]));
  const labels = result.connections.flatMap((e) =>
    [e.signalLabel, e.signalEndLabel, ...(e.labelInstances ?? [])].filter(Boolean).map((l) => l.bounds),
  );
  labels.push(...(result.terminals ?? []).filter((t) => !t.style.hidden).map((t) => t.labelBounds));
  for (const edge of result.connections) {
    if (
      edge.routingInfo?.method === 'outer-aabb' ||
      (edge.routingInfo?.channelStatus === 'routed' && edge.routingInfo?.method !== 'group-channel') ||
      [edge.source, edge.target].some(
        (e) =>
          e?.moduleId &&
          (nodes.get(e.moduleId)?.type === 'concat' ||
            ancestors(model, e.moduleId).some((id) => !ordinary(refs.get(id) ?? {}))),
      )
    )
      continue;
    for (let section = edge.netTrunkSections ?? 0; section < edge.sections.length; section++) {
      const points = edge.sections[section].points;
      for (let i = 1; i < points.length - 2; i++) {
        const [before, a, b, after] = points.slice(i - 1, i + 3);
        for (const c of physical) {
          if (
            Math.abs(a[c.axis] - b[c.axis]) > EPS ||
            Math.abs(a[c.cross] - b[c.cross]) < EPS ||
            Math.abs(before[c.cross] - a[c.cross]) > EPS ||
            Math.abs(after[c.cross] - b[c.cross]) > EPS ||
            a[c.axis] < c.start - EPS ||
            Math.max(a[c.cross], b[c.cross]) <= c.lo + EPS ||
            Math.min(a[c.cross], b[c.cross]) >= c.hi - EPS
          )
            continue;
          // A return/U-shaped rail consumes a different routing budget. Keep
          // it as a frozen obstacle rather than lengthening an outer detour.
          if (a[c.axis] <= before[c.axis] + EPS || after[c.axis] <= b[c.axis] + EPS) continue;
          if (a[c.axis] > c.end + EPS) {
            const atTarget = section === edge.sections.length - 1 && i === points.length - 3;
            if (!atTarget || !entersReceiverFace(c, edge, before, a, model)) continue;
          }
          // Source/name trunks and receiver labels are pinned, not layout rails.
          if (
            sectionSegments([{ points: [before, a, b, after] }]).some(([p, q]) =>
              labels.some((box) => segmentCrossesInterior(p, q, box)),
            )
          )
            continue;
          c.demands.push({
            id: JSON.stringify([edge.id, section, i]),
            edgeId: edge.id,
            section,
            index: i,
            net: net(edge),
            lo: Math.min(a[c.cross], b[c.cross]),
            hi: Math.max(a[c.cross], b[c.cross]),
            width: lineWidth(edge),
            coordinate: a[c.axis],
            margin: containerClearance(edge),
          });
        }
      }
    }
  }
  const eligible = physical.filter((c) => new Set(c.demands.map((d) => d.net)).size >= 2);
  if (!eligible.length) return;
  const oldQuality = netRouteQuality(result),
    oldIssues = parallelApproachIssues(result.connections);
  const safe = (draft, changed) => {
    if (!safeGeometry(draft, result, changed, nodes, model, labels) || !proximitySafe(draft, oldIssues))
      return false;
    const q = netRouteQuality(draft);
    return q.overlaps <= oldQuality.overlaps &&
      q.crossings <= oldQuality.crossings &&
      q.bends <= oldQuality.bends &&
      q.length <= oldQuality.length + EPS
      ? q
      : false;
  };
  const candidates = [];
  for (const c of eligible) {
    const compact = allocateTracks(c.demands);
    const margin = Math.max(...c.demands.map((d) => d.margin));
    c.min = c.start + margin;
    c.max = c.end - margin;
    c.available = c.max - c.min;
    // Interval coloring can put non-overlapping Nets on one rail even when
    // their approach topology needs opposite ordering around a third Net.
    // A bounded alternative keeps one track per Net in baseline spatial order.
    const separate = allocateTracks(c.demands).flatMap((t) =>
      t.nets.map((n) => ({ width: n.width, nets: [n] })),
    );
    const position = (t) => {
      const values = c.demands
        .filter((d) => d.net === t.nets[0].key)
        .map((d) => d.coordinate)
        .sort((a, b) => a - b);
      return (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2;
    };
    separate.sort((a, b) => position(a) - position(b) || a.nets[0].key.localeCompare(b.nets[0].key, 'en'));
    let best = null,
      bestScore = null;
    for (const tracks of [compact, separate])
      for (const reverse of [false, true]) {
        c.tracks = tracks;
        c.required = requiredTrackSpace(tracks);
        c.fits = c.available >= c.required - EPS;
        if (!c.fits) continue;
        const assignments = corridorAssignments(c, reverse, { spread: true });
        const patches = c.demands.map((d) => ({ ...d, ...assignments.get(d.id) }));
        const draft = patchesTrial(result, patches);
        const q = draft && safe(draft.trial, draft.changed);
        if (!q) continue;
        const movement = patches.reduce(
          (sum, p, i) => sum + Math.abs(p.coordinate - c.demands[i].coordinate),
          0,
        );
        const score = [q.overlaps, q.crossings, q.bends, q.length, movement];
        if (better(score, bestScore)) {
          best = { corridor: c, patches };
          bestScore = score;
        }
      }
    if (best) candidates.push(best);
  }
  if (!candidates.length) return;
  const combined = patchesTrial(
    result,
    candidates.flatMap((c) => c.patches),
  );
  // Independent corridors may share a wire. Validate their merged point edits
  // together; no corridor gets priority simply because it was visited first.
  if (!combined || !safe(combined.trial, combined.changed)) return;
  for (const old of result.connections) {
    if (!combined.changed.has(old.id)) continue;
    const edge = combined.trial.connections.find((e) => e.id === old.id);
    const records = candidates.flatMap((c) =>
      c.patches
        .filter((p) => p.edgeId === old.id)
        .map((p) => ({
          id: c.corridor.id,
          axis: p.axis,
          section: p.section,
          index: p.index,
          track: p.track,
          count: p.count,
        })),
    );
    old.sections = edge.sections;
    old.routingInfo = { ...old.routingInfo, distributedCorridors: records };
  }
}
