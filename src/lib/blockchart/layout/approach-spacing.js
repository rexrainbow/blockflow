import { ancestors } from '../hierarchy.js';
import { defaultSide, sideVector } from '../port-sides.js';
import {
  wireClearance,
  lineWidth,
  preferredClearance,
  containerClearance,
  endpointEscape,
} from './routing-spacing.js';
import { segmentsContact, routeMetrics } from './route-quality.js';
import {
  EPS,
  sectionSegments,
  collinearOverlap,
  segmentCrossesInterior,
  samePoint,
  pointInBounds,
  simplifyForwardPath,
} from './routing-geometry.js';

const net = (e) => e.netId ?? e.id;
const inflate = (r, gap) => ({
  x: r.x - gap,
  y: r.y - gap,
  width: r.width + 2 * gap,
  height: r.height + 2 * gap,
});
function issue(a, b, p, q, u, v) {
  const horizontal = Math.abs(p.y - q.y) < EPS;
  if (horizontal !== Math.abs(u.y - v.y) < EPS) return null;
  const axis = horizontal ? 'x' : 'y',
    cross = horizontal ? 'y' : 'x';
  const span =
    Math.min(Math.max(p[axis], q[axis]), Math.max(u[axis], v[axis])) -
    Math.max(Math.min(p[axis], q[axis]), Math.min(u[axis], v[axis]));
  const distance = Math.abs(p[cross] - u[cross]),
    required = wireClearance(a, b);
  if (span <= EPS || distance >= required - EPS) return null;
  const ends = (e) => [e.sections[0].points[0], e.sections.at(-1).points.at(-1)];
  if (
    ends(a).some(
      (x) =>
        ends(b).some((y) => samePoint(x, y)) &&
        [p, q].some((y) => samePoint(x, y)) &&
        [u, v].some((y) => samePoint(x, y)),
    )
  )
    return null;
  return { distance, required, span, missing: required - distance };
}
/** Parallel stroke proximity includes short projected overlap at a corner. Proper
 * perpendicular crossings and a shared fixed endpoint are different cases. */
export function parallelApproachIssues(edges) {
  const found = [];
  const segments = edges.map((edge) => sectionSegments(edge.sections));
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i],
        b = edges[j];
      if (net(a) === net(b)) continue;
      for (const [p, q] of segments[i])
        for (const [u, v] of segments[j]) {
          const hit = issue(a, b, p, q, u, v);
          if (hit) found.push({ ...hit, a: a.id, b: b.id });
        }
    }
  return found;
}
function localQuality(edge, sections, others) {
  const candidate = { ...edge, sections };
  const segments = sectionSegments(sections);
  let near = 0,
    nearSpan = 0,
    missing = 0,
    overlap = 0,
    contacts = 0;
  const nearNets = new Set(),
    contactNets = new Set();
  for (const { edge: other, segments: foreign } of others)
    for (const segment of segments)
      for (const peer of foreign) {
        const [a, b] = segment,
          [c, d] = peer;
        if (segmentsContact(segment, peer)) {
          contacts++;
          contactNets.add(net(other));
        }
        const hit = issue(candidate, other, a, b, c, d);
        if (hit) {
          near++;
          nearSpan += hit.span;
          nearNets.add(net(other));
          missing += hit.missing;
        }
        if (collinearOverlap(a, b, c, d)) {
          const axis = Math.abs(a.x - b.x) < EPS ? 'y' : 'x';
          overlap +=
            Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
            Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
        }
      }
  return { near, nearSpan, missing, overlap, nearNets, contactNets, contacts };
}
const better = (a, b) =>
  !b || a.some((v, i) => v < b[i] - EPS && a.slice(0, i).every((w, j) => Math.abs(w - b[j]) < EPS));

/** Bounded route-only cleanup after semantic restoration. Reuse an existing
 * same-Net fork when possible; frozen channel/outer routes and all anchors stay. */
export function separateApproachSpacing(result, compiled) {
  repairSpacing(result, compiled, true);
}

function repairSpacing(result, compiled, allowBatch) {
  if (result.connections.length < 2) return;
  const model = compiled._signalOriginal ?? compiled,
    refs = new Map(model.connections.map((e) => [e.id, e]));
  const nodes = [...result.modules, ...result.groups],
    owners = new Map(nodes.map((n) => [n.id, n]));
  const groupRefs = new Map(model.groups.map((g) => [g.id, g]));
  const labels = result.connections.flatMap((e) => [
    ...[e.signalLabel, e.signalEndLabel].filter(Boolean).map((l) => l.bounds),
    ...(e.labelInstances ?? []).map((l) => l.bounds),
  ]);
  const points = [
    ...nodes.flatMap((n) => [
      { x: n.x, y: n.y },
      { x: n.x + n.width, y: n.y + n.height },
    ]),
    ...result.connections.flatMap((e) =>
      e.sections.flatMap((s) =>
        s.points.flatMap((p) => [
          { x: p.x - lineWidth(e) / 2, y: p.y - lineWidth(e) / 2 },
          { x: p.x + lineWidth(e) / 2, y: p.y + lineWidth(e) / 2 },
        ]),
      ),
    ),
  ];
  const scene = { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)) };
  scene.width = Math.max(...points.map((p) => p.x)) - scene.x;
  scene.height = Math.max(...points.map((p) => p.y)) - scene.y;
  const port = (end) => owners.get(end.moduleId)?.ports.find((p) => p.id === end.portId);
  const protectedGroup = (id) => {
    const g = groupRefs.get(id);
    return g && (g.collapsed || g.portMode === 'boundary' || g.type !== 'container');
  };
  function attachmentSafe(old, next, ref) {
    const a = port(ref.source),
      b = port(ref.target);
    if (!a || !b) return false;
    const before = simplifyForwardPath(old.flatMap((s) => s.points)),
      after = simplifyForwardPath(next.flatMap((s) => s.points));
    if (!samePoint(before[0], after[0]) || !samePoint(before.at(-1), after.at(-1))) return false;
    for (const [p, first, oldCorner, corner, end] of [
      [a, true, before[1], after[1], ref.source],
      [b, false, before.at(-2), after.at(-2), ref.target],
    ]) {
      const vector = sideVector(p.side ?? defaultSide(p, model.layout.direction)),
        dot = (q) => (q.x - p.x) * vector.x + (q.y - p.y) * vector.y;
      if (Math.abs((corner.x - p.x) * vector.y - (corner.y - p.y) * vector.x) > EPS) return false;
      let needed = Math.min(dot(oldCorner), endpointEscape(ref, first));
      for (const id of ancestors(model, end.moduleId)) {
        const g = owners.get(id);
        if (!g) continue;
        const face = {
          x: vector.x > 0 ? g.x + g.width : vector.x < 0 ? g.x : p.x,
          y: vector.y > 0 ? g.y + g.height : vector.y < 0 ? g.y : p.y,
        };
        const gate = dot(face) + containerClearance(ref);
        // Preserve gates that this route actually reached. An already-unmet
        // outer ancestor gate must not freeze the entire old endpoint stub.
        if (dot(oldCorner) >= gate - EPS) needed = Math.max(needed, gate);
      }
      if (dot(corner) < needed - EPS) return false;
    }
    return true;
  }
  for (let iteration = 0; iteration < 12; iteration++) {
    const issues = parallelApproachIssues(result.connections);
    if (!issues.length) break;
    const affected = new Set(issues.flatMap((i) => [i.a, i.b]));
    let best = null,
      bestScore = null;
    const deferred = [];
    for (const edge of [...result.connections].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
      if (
        !affected.has(edge.id) ||
        edge.routingInfo?.channelStatus === 'routed' ||
        edge.routingInfo?.method === 'outer-aabb'
      )
        continue;
      const ref = refs.get(edge.id);
      if (!ref?.source.moduleId || !ref.target.moduleId || ref.source.moduleId === ref.target.moduleId)
        continue;
      if (
        [ref.source, ref.target].some(
          (e) =>
            owners.get(e.moduleId)?.type === 'concat' || ancestors(model, e.moduleId).some(protectedGroup),
        )
      )
        continue;
      const others = result.connections.filter((e) => e !== edge && net(e) !== net(edge)),
        own = result.connections.filter((e) => e !== edge && net(e) === net(edge));
      const peers = others.map((edge) => ({ edge, segments: sectionSegments(edge.sections) }));
      const old = localQuality(edge, edge.sections, peers),
        length = routeMetrics(edge.sections.flatMap((s) => s.points)).length;
      const gap = Math.max(
        ...others.filter((e) => old.nearNets.has(net(e))).map((e) => wireClearance(edge, e)),
      );
      const exempt = new Set([
        ...ancestors(model, ref.source.moduleId),
        ...ancestors(model, ref.target.moduleId),
      ]);
      let scope = ref.scope ? owners.get(ref.scope) : null;
      if (
        groupRefs.get(ref.scope)?.type === 'container' &&
        groupRefs.get(ref.scope)?.portMode !== 'boundary'
      ) {
        const parent = owners.get(ancestors(model, ref.scope).at(-1));
        if (parent?.type === 'container' && parent.portMode !== 'boundary' && !parent.collapsed)
          scope = parent;
      }
      for (let s = 0; s < edge.sections.length; s++)
        for (let k = 1; k < edge.sections[s].points.length - 2; k++) {
          const path = edge.sections[s].points,
            [before, a, b, after] = path.slice(k - 1, k + 3);
          const axis = Math.abs(a.x - b.x) < EPS ? 'x' : 'y',
            cross = axis === 'x' ? 'y' : 'x';
          if (
            Math.abs(a[axis] - b[axis]) > EPS ||
            Math.abs(a[cross] - b[cross]) < EPS ||
            Math.abs(before[cross] - a[cross]) > EPS ||
            Math.abs(after[cross] - b[cross]) > EPS
          )
            continue;
          const shared = new Set(
            own.flatMap((e) =>
              sectionSegments(e.sections)
                .filter(([p, q]) => Math.abs(p[axis] - q[axis]) < EPS)
                .map(([p]) => p[axis]),
            ),
          );
          const coordinates = [
            ...shared,
            ...[-4, -3, -2, -1, 1, 2, 3, 4].map((n) => a[axis] + gap * n),
          ].filter((v) => Math.abs(v - a[axis]) > EPS && Math.abs(v - a[axis]) <= gap * 4 + EPS);
          for (const coordinate of [...new Set(coordinates)].sort((a, b) => a - b)) {
            if (
              (coordinate - before[axis]) * (a[axis] - before[axis]) <= EPS ||
              (after[axis] - coordinate) * (after[axis] - b[axis]) <= EPS
            )
              continue;
            const replacement = path.map((p) => ({ ...p }));
            replacement[k][axis] = replacement[k + 1][axis] = coordinate;
            const changed = replacement.slice(k - 1, k + 3),
              inkBounds = inflate(scene, -lineWidth(edge) / 2);
            if (!changed.every((p) => pointInBounds(p, inkBounds) && pointInBounds(p, scope))) continue;
            const segments = sectionSegments([{ points: changed }]);
            if (
              segments.some(
                ([p, q]) =>
                  nodes.some((n) => {
                    if (exempt.has(n.id)) return false;
                    const attachment =
                      (n.id === ref.source.moduleId && [p, q].some((x) => samePoint(x, port(ref.source)))) ||
                      (n.id === ref.target.moduleId && [p, q].some((x) => samePoint(x, port(ref.target))));
                    return segmentCrossesInterior(p, q, inflate(n, attachment ? 0 : preferredClearance(ref)));
                  }) ||
                  labels.some((box) => segmentCrossesInterior(p, q, box)) ||
                  (result.terminals ?? []).some(
                    (t) => !t.style.hidden && segmentCrossesInterior(p, q, inflate(t.labelBounds, 3)),
                  ),
              )
            )
              continue;
            const sections = edge.sections.map((section, i) =>
              i === s ? { ...section, points: replacement } : section,
            );
            if (!attachmentSafe(edge.sections, sections, ref)) continue;
            const quality = localQuality(edge, sections, peers);
            // Moving a long rail past a peer can briefly align their returns.
            // Try separating the shorter overlap on a draft before publishing.
            const shorterOverlap =
              allowBatch && quality.overlap > old.overlap + EPS && quality.nearSpan < old.nearSpan - EPS;
            if (
              quality.near > old.near ||
              (quality.near === old.near && quality.missing >= old.missing - EPS && !shorterOverlap) ||
              quality.contactNets.size > old.contactNets.size + Math.max(0, old.near - quality.near)
            )
              continue;
            const nextLength = routeMetrics(sections.flatMap((s) => s.points)).length;
            if (nextLength > length + gap * 8 + EPS) continue;
            const score = [
              quality.near - old.near,
              quality.missing - old.missing,
              quality.contacts - old.contacts,
              shared.has(coordinate) ? 0 : 1,
              nextLength - length,
              Math.abs(coordinate - a[axis]),
            ];
            if (
              quality.overlap > old.overlap + EPS ||
              [...quality.nearNets].some((key) => !old.nearNets.has(key))
            ) {
              if (allowBatch) deferred.push({ edge, sections, score });
              continue;
            }
            if (better(score, bestScore)) {
              best = { edge, sections };
              bestScore = score;
            }
          }
        }
    }
    if (!best) {
      if (allowBatch && deferred.length && commitSpacingBatch(result, compiled, issues, deferred)) continue;
      break;
    }
    best.edge.sections = best.sections;
    best.edge.routingInfo = { ...best.edge.routingInfo, approachSpacing: 'separated' };
  }
}

// A single rail can be trapped between a reserved channel and a clear ordinary
// rail. Permit a temporary conflict only inside a disposable two-stage batch;
// publish it only after ordinary repairs remove every newly introduced pair.
function commitSpacingBatch(result, compiled, before, offers) {
  const ids = new Map(result.connections.map((e) => [e.id, net(e)]));
  const pair = (i) => JSON.stringify([ids.get(i.a), ids.get(i.b)].sort());
  const oldPairs = new Set(before.map(pair));
  const oldMissing = before.reduce((sum, i) => sum + i.missing, 0);
  const overlaps = (edges) => {
    const totals = new Map();
    const segments = edges.map((edge) => sectionSegments(edge.sections));
    for (let i = 0; i < edges.length; i++)
      for (let j = i + 1; j < edges.length; j++) {
        if (net(edges[i]) === net(edges[j])) continue;
        let length = 0;
        for (const [a, b] of segments[i])
          for (const [c, d] of segments[j]) {
            if (!collinearOverlap(a, b, c, d)) continue;
            const axis = Math.abs(a.x - b.x) < EPS ? 'y' : 'x';
            length +=
              Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
              Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
          }
        if (length) {
          const key = JSON.stringify([net(edges[i]), net(edges[j])].sort());
          totals.set(key, (totals.get(key) ?? 0) + length);
        }
      }
    return totals;
  };
  const oldOverlap = overlaps(result.connections);
  offers.sort((a, b) =>
    better(a.score, b.score) ? -1 : better(b.score, a.score) ? 1 : a.edge.id.localeCompare(b.edge.id, 'en'),
  );
  for (const offer of offers.slice(0, 2)) {
    const draft = structuredClone(result);
    const edge = draft.connections.find((e) => e.id === offer.edge.id);
    edge.sections = structuredClone(offer.sections);
    edge.routingInfo = { ...edge.routingInfo, approachSpacing: 'separated' };
    repairSpacing(draft, compiled, false);
    const after = parallelApproachIssues(draft.connections);
    if (
      after.some((i) => !oldPairs.has(pair(i))) ||
      after.length > before.length ||
      (after.length === before.length && after.reduce((sum, i) => sum + i.missing, 0) >= oldMissing - EPS)
    )
      continue;
    if ([...overlaps(draft.connections)].some(([key, length]) => length > (oldOverlap.get(key) ?? 0) + EPS))
      continue;
    for (const candidate of draft.connections) {
      const original = result.connections.find((e) => e.id === candidate.id);
      original.sections = candidate.sections;
      if (candidate.routingInfo) original.routingInfo = candidate.routingInfo;
    }
    return true;
  }
  return false;
}
