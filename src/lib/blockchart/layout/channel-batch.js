import { collectCorridors, corridorAssignments } from './channel-corridors.js';
import { netRouteQuality } from './route-quality.js';
import { EPS, sectionSegments } from './routing-geometry.js';
import { parallelOverlap } from './grid-channels.js';

const net = (e) => e.netId ?? e.id;
const score = (result) => {
  const q = netRouteQuality(result);
  return [q.overlaps, q.crossings, q.bends, q.length];
};
const better = (a, b) =>
  !b || a.some((v, i) => v < b[i] - EPS && a.slice(0, i).every((w, j) => Math.abs(w - b[j]) < EPS));
/** Route-only draft. Geometry and private plans keep their original identities. */
export function connectionTrial(result, ids) {
  return { ...result, connections: result.connections.map((e) => (ids.has(e.id) ? structuredClone(e) : e)) };
}

function validRoutes(trial, baseline, ids) {
  const near = (a, b) => a && b && Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
  return trial.connections
    .filter((e) => ids.has(e.id))
    .every((e) => {
      const old = baseline.connections.find((b) => b.id === e.id),
        points = e.sections.flatMap((s) => s.points);
      const before = old.sections.flatMap((s) => s.points);
      return (
        near(points[0], before[0]) &&
        near(points.at(-1), before.at(-1)) &&
        points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) &&
        sectionSegments(e.sections).every(([a, b]) => Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS)
      );
    });
}

function collisions(connections, changed) {
  const pairs = [];
  for (let i = 0; i < connections.length; i++)
    for (const b of connections.slice(i + 1)) {
      const a = connections[i];
      if (net(a) === net(b) || (!changed.has(a.id) && !changed.has(b.id))) continue;
      const gap = Math.max(3, ((a.style?.strokeWidth ?? 1) + (b.style?.strokeWidth ?? 1)) / 2 + 2);
      if (
        sectionSegments(a.sections).some(([p, q]) =>
          sectionSegments(b.sections).some(([r, s]) => parallelOverlap(p, q, r, s, gap)),
        )
      )
        pairs.push([a.id, b.id]);
    }
  return pairs;
}

/** Every proposal is evaluated against the same frozen baseline. No candidate
 * becomes an obstacle simply because another planner happened to run first. */
export function routeChannelProposals(result, model, proposals) {
  const corridors = collectCorridors(result, model, proposals),
    candidates = [],
    attempts = [];
  const byBranch = new Map();
  for (const c of corridors)
    for (const d of c.demands) {
      if (!byBranch.has(d.id)) byBranch.set(d.id, []);
      byBranch.get(d.id).push(c.id);
    }
  const ambiguous = new Set([...byBranch.values()].filter((ids) => ids.length > 1).flat());
  for (const corridor of corridors) {
    const ids = new Set(corridor.demands.map((d) => d.id));
    if (ambiguous.has(corridor.id) || !corridor.fits) {
      candidates.push({ corridor, ids, trial: null });
      continue;
    }
    if (corridor.offers.every((p) => p.satisfied?.())) continue;
    let best = null,
      bestScore = null;
    const modes = corridor.demands.some(
      (d) =>
        d.offers.some((o) => o.proposal.kind === 'group') &&
        d.offers.some((o) => o.proposal.kind !== 'group'),
    )
      ? ['direct', 'fixed']
      : ['direct'];
    for (const reverse of corridor.tracks.length > 1 ? [false, true] : [false])
      for (const mode of modes) {
        const assignments = corridorAssignments(corridor, reverse),
          trial = connectionTrial(result, ids),
          used = new Set();
        let safe = true,
          failure = null;
        for (const demand of corridor.demands) {
          const offers = [...demand.offers].sort((a, b) => {
            const priority = (o) =>
              mode === 'direct' ? (o.proposal.kind === 'group' ? 0 : 1) : o.proposal.kind === 'group' ? 1 : 0;
            return priority(a) - priority(b) || a.proposal.key.localeCompare(b.proposal.key, 'en');
          });
          const offer = offers[0],
            assignment = assignments.get(demand.id);
          const avoid = result.connections
            .filter((e) => !ids.has(e.id) && net(e) !== demand.net)
            .flatMap((e) =>
              sectionSegments(e.sections).map(([a, b]) => [
                a,
                b,
                Math.max(3, (demand.width + (e.style?.strokeWidth ?? 1)) / 2 + 2),
              ]),
            );
          for (const peer of corridor.demands)
            if (peer.net !== demand.net) {
              const a = assignments.get(peer.id),
                cross = a.axis === 'x' ? 'y' : 'x';
              avoid.push([
                { [a.axis]: a.coordinate, [cross]: peer.lo },
                { [a.axis]: a.coordinate, [cross]: peer.hi },
                Math.max(3, (demand.width + peer.width) / 2 + 2),
              ]);
            }
          let patch;
          try {
            patch = offer.proposal.route({ trial, demand, branch: offer.branch, assignment, avoid, ids });
          } catch {
            safe = false;
            failure = 'access:' + demand.id;
            break;
          }
          if (!patch) {
            safe = false;
            failure = 'access:' + demand.id;
            break;
          }
          const edge = trial.connections.find((e) => e.id === demand.id);
          Object.assign(edge, patch);
          used.add(offer.proposal);
        }
        if (!safe) {
          attempts.push({ corridor: corridor.id, reason: failure });
          continue;
        }
        if (!validRoutes(trial, result, ids)) {
          attempts.push({ corridor: corridor.id, reason: 'invalid-route' });
          continue;
        }
        const conflicts = collisions(trial.connections, ids);
        if (conflicts.length) {
          attempts.push({ corridor: corridor.id, reason: 'parallel', conflicts });
          continue;
        }
        if ([...used].some((p) => p.accept && !p.accept(trial, result, ids))) {
          attempts.push({ corridor: corridor.id, reason: 'policy' });
          continue;
        }
        const q = score(trial);
        if (better(q, bestScore)) {
          best = trial;
          bestScore = q;
        }
      }
    candidates.push({ corridor, ids, trial: best });
  }
  // Conflicting corridor candidates roll back symmetrically. Restoration may
  // expose another conflict with a baseline route; each batch is removed once.
  const active = new Set(candidates.filter((c) => c.trial));
  function combined() {
    const routes = new Map();
    for (const c of active) for (const e of c.trial.connections) if (c.ids.has(e.id)) routes.set(e.id, e);
    return result.connections.map((e) => routes.get(e.id) ?? e);
  }
  while (active.size) {
    const changed = new Set([...active].flatMap((c) => [...c.ids]));
    const conflicts = collisions(combined(), changed);
    if (!conflicts.length) break;
    const rejected = new Set(conflicts.flat());
    let removed = false;
    for (const c of [...active])
      if ([...c.ids].some((id) => rejected.has(id))) {
        active.delete(c);
        removed = true;
      }
    if (!removed) break;
  }
  for (const c of candidates)
    for (const id of c.ids) {
      const edge = result.connections.find((e) => e.id === id);
      if (!edge) continue;
      if (active.has(c)) {
        const patch = c.trial.connections.find((e) => e.id === id);
        edge.sections = patch.sections;
        if (patch.routingInfo === undefined) delete edge.routingInfo;
        else
          edge.routingInfo =
            patch.routingInfo?.channelStatus === 'routed'
              ? {
                  ...patch.routingInfo,
                  channelCorridor: c.corridor.id,
                  channelPlanners: [...new Set(c.corridor.offers.map((p) => p.kind))].sort(),
                }
              : patch.routingInfo;
      }
    }
  return {
    corridors: corridors.length,
    committed: active.size,
    blocked: candidates.length - active.size,
    attempts,
  };
}
