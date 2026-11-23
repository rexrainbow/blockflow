/** Edges between distinct explicit Grid cells have no remaining placement freedom.
 * Keep them in the routing model, but defer their initial routes until Grid repair.
 * Atomic cells and their label wrappers qualify. A compound cell can still have
 * movable Auto descendants, whose placement relationships must remain in ELK.
 */
export function gridInternalEdges(model) {
  const nodes = new Map([...model.modules, ...(model.groups ?? [])].map((n) => [n.id, n]));
  const configs = (model.groups ?? [])
    .filter((g) => !g.collapsed && g.layout?.type === 'grid')
    .map((g) => g.layout);
  if (!model.rootGroupId && model.layout.type === 'grid') configs.unshift(model.layout);
  const deferred = new Set();
  for (const config of configs) {
    const owners = new Map();
    function register(id, cell) {
      const node = nodes.get(id);
      if (!node || owners.has(id)) return;
      owners.set(id, cell);
      if (!node.collapsed) for (const member of node.members ?? []) register(member, cell);
    }
    for (const id of config.cells.flat()) {
      const node = nodes.get(id);
      if (!node) continue;
      const owner = node._signalWrapper ? nodes.get(node.members[0]) : node;
      if (owner && !owner.members) register(id, id);
    }
    for (const edge of model.connections) {
      const from = owners.get(edge.source.moduleId),
        to = owners.get(edge.target.moduleId);
      if (from !== undefined && to !== undefined && from !== to) deferred.add(edge.id);
    }
  }
  return deferred;
}
