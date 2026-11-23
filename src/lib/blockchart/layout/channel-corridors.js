import { allocateTracks, requiredTrackSpace, TRACK_GAP } from './channel-allocation.js';
import { EPS } from './routing-geometry.js';

const order = (a, b) => a.localeCompare(b, 'en');
const ids = (nodes) => [...new Set(nodes.map((n) => n.id))].sort(order);
/** Frozen geometry identifies only provably adjacent bands. Planner identity is
 * kept for unresolved/expanded tracks; coordinate proximity alone never merges. */
export function collectCorridors(result, model, proposals) {
  const nodes = new Map([...result.modules, ...result.groups].map((n) => [n.id, n]));
  const refs = new Map(model.groups.map((g) => [g.id, g]));
  const semanticId = (node) => {
    while (refs.get(node.id)?._signalWrapper) node = nodes.get(node.members[0]);
    return node.id;
  };
  const cache = new Map();
  function bands(owner, axis) {
    const key = JSON.stringify([owner, axis]);
    if (cache.has(key)) return cache.get(key);
    const children = owner
      ? (nodes.get(owner)?.members ?? []).map((id) => nodes.get(id)).filter(Boolean)
      : [...nodes.values()].filter((n) => !result.groups.some((g) => g.members?.includes(n.id)));
    const extent = axis === 'x' ? 'width' : 'height',
      groups = [];
    for (const node of [...children].sort((a, b) => a[axis] - b[axis] || order(a.id, b.id))) {
      const last = groups.at(-1);
      if (last && node[axis] < last.end - EPS) {
        last.nodes.push(node);
        last.end = Math.max(last.end, node[axis] + node[extent]);
      } else groups.push({ nodes: [node], end: node[axis] + node[extent] });
    }
    cache.set(key, groups);
    return groups;
  }
  const covers = (root, node) => {
    const pending = [root],
      seen = new Set();
    while (pending.length) {
      const item = pending.pop();
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      if (semanticId(item) === semanticId(node)) return true;
      for (const id of item.members ?? []) pending.push(nodes.get(id));
    }
    return false;
  };
  function keyFor(p) {
    const levels = bands(p.owner, p.axis),
      indexOf = (list) => {
        const indices = new Set(list.map((n) => levels.findIndex((b) => b.nodes.some((a) => covers(a, n)))));
        return indices.size === 1 ? [...indices][0] : -1;
      };
    const a = indexOf(p.before),
      b = indexOf(p.after);
    const known = a >= 0 && b === a + 1;
    const faces = known
      ? [levels[a].nodes, levels[b].nodes].map((list) => list.map(semanticId).sort(order))
      : [p.before, p.after].map((list) => list.map(semanticId).sort(order));
    return {
      key: JSON.stringify([p.owner, p.axis, known ? 'adjacent' : p.kind, ...faces]),
      min: known ? Math.max(levels[a].end + (p.margin ?? 0), p.accessMin ?? -Infinity) : p.min,
      max: known
        ? Math.min(
            Math.min(...levels[b].nodes.map((n) => n[p.axis])) - (p.margin ?? 0),
            p.accessMax ?? Infinity,
          )
        : p.max,
    };
  }
  const corridors = new Map();
  for (const p of [...proposals].sort((a, b) => order(a.key, b.key))) {
    const identity = keyFor(p),
      key = identity.key;
    if (!corridors.has(key))
      corridors.set(key, {
        id: key,
        owner: p.owner,
        axis: p.axis,
        offers: [],
        demands: new Map(),
        min: -Infinity,
        max: Infinity,
      });
    const c = corridors.get(key);
    c.offers.push(p);
    c.min = Math.max(c.min, identity.min);
    c.max = Math.min(c.max, identity.max);
    for (const branch of p.branches) {
      const old = c.demands.get(branch.id);
      if (old && old.net !== branch.net) throw new Error('Inconsistent channel Net identity: ' + branch.id);
      const d = old ?? { id: branch.id, net: branch.net, lo: Infinity, hi: -Infinity, width: 0, offers: [] };
      d.lo = Math.min(d.lo, branch.lo);
      d.hi = Math.max(d.hi, branch.hi);
      d.width = Math.max(d.width, branch.width);
      d.offers.push({ proposal: p, branch });
      c.demands.set(d.id, d);
    }
  }
  return [...corridors.values()]
    .sort((a, b) => order(a.id, b.id))
    .map((c) => {
      const demands = [...c.demands.values()].sort((a, b) => order(a.id, b.id)),
        tracks = allocateTracks(demands);
      const required = requiredTrackSpace(tracks);
      return {
        ...c,
        demands,
        tracks,
        required,
        available: c.max - c.min,
        fits: Number.isFinite(c.min) && Number.isFinite(c.max) && required <= c.max - c.min + EPS,
      };
    });
}

/** Grid/Auto intervals become physical scene spans only after geometry freezes.
 * Their original spacing plans still own placement and retain live node refs. */
export function trackProposals(result, kind) {
  return ((kind === 'auto' ? result._autoChannels : result._gridChannels) ?? []).map((plan, index) => {
    const axis = plan.axis,
      cross = axis === 'x' ? 'y' : 'x',
      extent = axis === 'x' ? 'width' : 'height',
      crossExtent = cross === 'x' ? 'width' : 'height';
    const start = Math.max(...plan.nodes.map((n) => n[axis] + n[extent])) + (plan.inset ?? 0);
    const gap = kind === 'auto' ? Math.min(...plan.targets.map((n) => n[axis])) - start : plan.gap;
    return {
      key: JSON.stringify([kind, plan.owner ?? '', axis, ids(plan.nodes), plan.index ?? index]),
      kind,
      owner: plan.owner ?? '',
      axis,
      before: plan.nodes,
      after: plan.targets ?? [],
      margin: plan.margin,
      min: start + plan.margin,
      max: start + gap - plan.margin,
      plan,
      branches: plan.branches.map((b) => {
        if (!b.sourceNode || !b.targetNode)
          throw new Error('Channel demand lacks physical geometry: ' + b.id);
        return {
          ...b,
          lo: Math.min(b.sourceNode[cross], b.targetNode[cross]),
          hi: Math.max(
            b.sourceNode[cross] + b.sourceNode[crossExtent],
            b.targetNode[cross] + b.targetNode[crossExtent],
          ),
        };
      }),
    };
  });
}

export function corridorAssignments(corridor, reverse = false) {
  const assignments = new Map();
  if (!corridor.fits) return assignments;
  const tracks = reverse ? [...corridor.tracks].reverse() : corridor.tracks;
  let offset = corridor.min + (corridor.available - corridor.required) / 2;
  for (const track of tracks) {
    const coordinate = offset + track.width / 2,
      index = corridor.tracks.indexOf(track);
    for (const n of track.nets)
      for (const id of n.branches)
        assignments.set(id, {
          axis: corridor.axis,
          coordinate,
          track: index,
          count: tracks.length,
          owner: corridor.owner,
          corridorId: corridor.id,
        });
    offset += track.width + TRACK_GAP;
  }
  return assignments;
}
