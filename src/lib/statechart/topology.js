/** Structural roles only: never interpret names or execute transition conditions. */
export function analyzeTopology(model) {
  const ids = model.states.map((s) => s.id),
    index = new Map(ids.map((id, i) => [id, i]));
  const incoming = new Map(ids.map((id) => [id, new Set()])),
    outgoing = new Map(ids.map((id) => [id, new Set()]));
  for (const t of model.transitions)
    if (t.from !== t.to) {
      outgoing.get(t.from).add(t.to);
      incoming.get(t.to).add(t.from);
    }
  const neighbors = new Map(ids.map((id) => [id, new Set([...incoming.get(id), ...outgoing.get(id)])]));
  const satellites = new Map();
  for (const state of model.states)
    if (state.kind === 'state' && neighbors.get(state.id).size === 1) {
      const owner = [...neighbors.get(state.id)][0];
      if (
        neighbors.get(owner).size > 1 &&
        incoming.get(state.id).has(owner) &&
        outgoing.get(state.id).has(owner)
      )
        satellites.set(state.id, owner);
    }
  const core = ids.filter((id) => !satellites.has(id)),
    coreSet = new Set(core),
    components = [],
    low = new Map(),
    discovery = new Map(),
    stack = [],
    active = new Set();
  let next = 0;
  function visit(id) {
    discovery.set(id, next);
    low.set(id, next++);
    stack.push(id);
    active.add(id);
    for (const to of outgoing.get(id))
      if (coreSet.has(to)) {
        if (!discovery.has(to)) {
          visit(to);
          low.set(id, Math.min(low.get(id), low.get(to)));
        } else if (active.has(to)) low.set(id, Math.min(low.get(id), discovery.get(to)));
      }
    if (low.get(id) === discovery.get(id)) {
      const group = [];
      let member;
      do {
        member = stack.pop();
        active.delete(member);
        group.push(member);
      } while (member !== id);
      components.push(group);
    }
  }
  core.forEach((id) => {
    if (!discovery.has(id)) visit(id);
  });
  const cycle = new Set(components.filter((c) => c.length > 1).flat());
  const roles = new Map();
  for (const state of model.states) {
    const id = state.id,
      ins = [...incoming.get(id)].filter((n) => coreSet.has(n)),
      outs = [...outgoing.get(id)].filter((n) => coreSet.has(n)),
      adjacent = new Set([...ins, ...outs]),
      labels = new Map();
    for (const t of model.transitions.filter(
      (t) => t.to === id && coreSet.has(t.from) && t.from !== id && t.label,
    )) {
      const key = t.label.replace(/\s+/g, ' ').trim();
      if (!labels.has(key)) labels.set(key, new Set());
      labels.get(key).add(t.from);
    }
    const convergence = [...labels.values()].reduce((n, s) => n + Math.max(0, s.size - 1), 0);
    const pressure = Math.min(
      2,
      Math.log2(
        1 +
          model.transitions
            .filter((t) => t.from === id || t.to === id)
            .reduce((n, t) => n + (t.label?.length ?? 0), 0),
      ) / 8,
    );
    roles.set(id, {
      id,
      owner: satellites.get(id),
      role: satellites.has(id)
        ? 'satellite'
        : state.kind !== 'state'
          ? state.kind
          : convergence || ins.length > outs.length + 1
            ? 'convergence'
            : cycle.has(id)
              ? 'cycle'
              : 'connector',
      score: adjacent.size * 4 + ins.length * 2 + outs.length + convergence * 3 + pressure,
    });
  }
  return { ids, index, incoming, outgoing, neighbors, satellites, core, components, roles };
}
export function topologyPlans(model, graph) {
  const topology = analyzeTopology(model),
    { index, core, roles, outgoing, satellites } = topology;
  const componentOf = new Map(topology.components.flatMap((members, i) => members.map((id) => [id, i])));
  const ranked = [...core].sort(
    (a, b) =>
      (model.states.find((s) => s.id === b).kind === 'initial') -
        (model.states.find((s) => s.id === a).kind === 'initial') ||
      roles.get(b).score - roles.get(a).score ||
      index.get(a) - index.get(b),
  );
  function build(reverse) {
    const order = [],
      seen = new Set(),
      backbone = new Set();
    function walk(id) {
      if (seen.has(id)) return;
      seen.add(id);
      order.push(id);
      const targets = [...outgoing.get(id)].filter((to) => core.includes(to) && !seen.has(to));
      targets.sort((a, b) => {
        const direct = (to) =>
          graph.edges.some((e) => e.from === id && e.to === to && e.kind !== 'loop') ? 0 : 1;
        return (
          Number(componentOf.get(a) !== componentOf.get(id)) -
            Number(componentOf.get(b) !== componentOf.get(id)) ||
          direct(a) - direct(b) ||
          (reverse ? roles.get(b).score - roles.get(a).score : roles.get(a).score - roles.get(b).score) ||
          index.get(a) - index.get(b)
        );
      });
      for (const to of targets)
        if (!seen.has(to)) {
          backbone.add(JSON.stringify([id, to]));
          walk(to);
        }
    }
    ranked.forEach(walk);
    return {
      order: [
        ...order,
        ...model.states
          .filter((s) => satellites.has(s.id))
          .sort(
            (a, b) =>
              order.indexOf(satellites.get(a.id)) - order.indexOf(satellites.get(b.id)) ||
              index.get(a.id) - index.get(b.id),
          )
          .map((s) => s.id),
      ],
      backbone,
    };
  }
  const first = build(false),
    alternate = build(true);
  return [
    { name: 'core-first', ...first, topology, labelOrder: 'source' },
    { name: 'core-target-order', ...first, topology, labelOrder: 'target' },
    { name: 'alternate-core', ...alternate, topology, labelOrder: 'source' },
    { name: 'declaration', order: topology.ids, backbone: new Set(), topology, baseline: true },
  ];
}
export function routeQuality(layout) {
  const segments = layout.transitions.flatMap((e) =>
    e.sections.flatMap((s) => s.points.slice(1).map((b, i) => ({ id: e.id, a: s.points[i], b }))),
  );
  const crossings = new Set(),
    overlaps = new Set();
  const endpoints = new Map(
    layout.transitions.map((e) => [
      e.id,
      e.sections.length
        ? [
            { point: e.sections[0].points[0], state: e.from },
            { point: e.sections.at(-1).points.at(-1), state: e.to },
          ]
        : [],
    ]),
  );
  let overlapLength = 0,
    length = 0,
    bends = 0;
  const eps = 1e-6;
  const sharedPort = (first, second, x, y) =>
    endpoints
      .get(first)
      .some(
        (a) =>
          a.state != null &&
          Math.abs(a.point.x - x) < eps &&
          Math.abs(a.point.y - y) < eps &&
          endpoints
            .get(second)
            .some(
              (b) => b.state === a.state && Math.abs(b.point.x - x) < eps && Math.abs(b.point.y - y) < eps,
            ),
      );
  const crossing = (pair, x, y) => {
    if (!sharedPort(pair[0], pair[1], x, y))
      crossings.add(JSON.stringify([...pair, Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]));
  };
  for (const e of layout.transitions)
    bends += e.sections.reduce((n, s) => n + Math.max(0, s.points.length - 2), 0);
  for (const p of segments) length += Math.abs(p.a.x - p.b.x) + Math.abs(p.a.y - p.b.y);
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const p = segments[i],
        q = segments[j];
      if (p.id === q.id) continue;
      const pair = [p.id, q.id].sort(),
        ph = Math.abs(p.a.y - p.b.y) < eps,
        qh = Math.abs(q.a.y - q.b.y) < eps;
      if (ph === qh) {
        const axis = ph ? 'x' : 'y',
          fixed = ph ? 'y' : 'x',
          amount =
            Math.min(Math.max(p.a[axis], p.b[axis]), Math.max(q.a[axis], q.b[axis])) -
            Math.max(Math.min(p.a[axis], p.b[axis]), Math.min(q.a[axis], q.b[axis]));
        if (Math.abs(p.a[fixed] - q.a[fixed]) < eps && amount > eps) {
          overlaps.add(JSON.stringify(pair));
          overlapLength += amount;
        } else if (Math.abs(p.a[fixed] - q.a[fixed]) < eps && Math.abs(amount) < eps) {
          const at = Math.max(Math.min(p.a[axis], p.b[axis]), Math.min(q.a[axis], q.b[axis]));
          crossing(pair, ph ? at : p.a.x, ph ? p.a.y : at);
        }
      } else {
        const h = ph ? p : q,
          v = ph ? q : p;
        if (
          v.a.x >= Math.min(h.a.x, h.b.x) - eps &&
          v.a.x <= Math.max(h.a.x, h.b.x) + eps &&
          h.a.y >= Math.min(v.a.y, v.b.y) - eps &&
          h.a.y <= Math.max(v.a.y, v.b.y) + eps
        )
          crossing(pair, v.a.x, h.a.y);
      }
    }
  return {
    overlaps: overlaps.size,
    crossings: crossings.size,
    overlapLength,
    length,
    bends,
    area: layout.width * layout.height,
  };
}
export function compareQuality(a, b) {
  const score = (q) => [q.overlaps, q.crossings, q.overlapLength, q.length + 20 * q.bends, q.area];
  const left = score(a),
    right = score(b);
  for (let i = 0; i < left.length; i++) if (Math.abs(left[i] - right[i]) > 1e-6) return left[i] - right[i];
  return 0;
}
