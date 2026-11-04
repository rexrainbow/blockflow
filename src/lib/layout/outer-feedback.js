const EPSILON = 1e-6;

function crossesInterior(a, b, node) {
  return (Math.abs(a.y - b.y) <= EPSILON && a.y > node.y + EPSILON && a.y < node.y + node.height - EPSILON
    && Math.max(a.x, b.x) > node.x + EPSILON && Math.min(a.x, b.x) < node.x + node.width - EPSILON)
    || (Math.abs(a.x - b.x) <= EPSILON && a.x > node.x + EPSILON && a.x < node.x + node.width - EPSILON
    && Math.max(a.y, b.y) > node.y + EPSILON && Math.min(a.y, b.y) < node.y + node.height - EPSILON);
}

function routeCost(sections) {
  let bends = 0, length = 0;
  for (const section of sections) {
    let previous;
    for (let i = 1; i < section.points.length; i++) {
      const a = section.points[i - 1], b = section.points[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) continue;
      const direction = Math.abs(dx) > EPSILON ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      if (previous && direction !== previous) bends++;
      previous = direction;
      length += Math.abs(dx) + Math.abs(dy);
    }
  }
  return { bends, length };
}

/** Post-placement exterior routing. All geometry here is locally owned by layout. */
export function routeOuterFeedback(result, model) {
  const { modules, connections } = result;
  const boundsNodes = [...modules, ...(result.groups ?? [])];
  if(!boundsNodes.length) return;
  const bounds = {
    left: Math.min(...boundsNodes.map(node => node.x)),
    right: Math.max(...boundsNodes.map(node => node.x + node.width)),
    top: Math.min(...boundsNodes.map(node => node.y)),
    bottom: Math.max(...boundsNodes.map(node => node.y + node.height)),
  };
  const ports = new Map(boundsNodes.flatMap(node => (node.ports??[]).map(port => [`${node.id}.${port.id}`, port])));
  const refs = new Map(model.connections.map(connection => [connection.id, connection]));
  const endpoints = connection => {
    const ref = refs.get(connection.id);
    return { source: ports.get(`${ref.source.moduleId}.${ref.source.portId}`), target: ports.get(`${ref.target.moduleId}.${ref.target.portId}`) };
  };
  const candidates = connections.filter(connection => {
    const ref=refs.get(connection.id);
    if(model.rootGroupId || ref.boundaryScoped) {connection.routingInfo={method:'elk',reason:model.rootGroupId?'group-view':'boundary-scope'};return false;}
    const { source, target } = endpoints(connection);
    return source.x > target.x + EPSILON;
  }).sort((a, b) => {
    const key = connection => { const ref = refs.get(connection.id); return `${ref.source.moduleId}.${ref.source.portId}->${ref.target.moduleId}.${ref.target.portId}`; };
    return key(a).localeCompare(key(b), 'en');
  });
  let lane = 0;
  for (const connection of candidates) {
    const { source, target } = endpoints(connection);
    const halfStroke = (connection.style?.strokeWidth ?? (connection.width > 1 ? 2.5 : 1.5)) / 2;
    const extraStroke = Math.max(0, halfStroke - (connection.width > 1 ? 1.25 : 0.75));
    const margin = (model.layout.feedbackMargin ?? 20) + lane * (model.layout.feedbackLaneSpacing ?? 12) + extraStroke;
    const right = bounds.right + margin, left = bounds.left - margin;
    const routes = ['top', 'bottom'].map(side => {
      const y = side === 'top' ? bounds.top - margin : bounds.bottom + margin;
      // The two corners constrain the exterior main segment; elbow points
      // preserve eastbound output departure and eastbound input arrival.
      const waypoints = [{ x: right, y }, { x: left, y }];
      const points = [
        { x: source.x, y: source.y }, { x: right, y: source.y },
        ...waypoints.map(point => ({ ...point })),
        { x: left, y: target.y }, { x: target.x, y: target.y },
      ];
      const obstacles = [...modules, ...(result.groups ?? [])];
      const valid = points.slice(1).every((b, i) => !obstacles.some(node => {
        const endpoint = refs.get(connection.id);
        const terminal = (i === 0 && (node.id === endpoint.source.moduleId || (node.blockIds ?? node.members)?.includes(endpoint.source.moduleId)))
          || (i === points.length - 2 && (node.id === endpoint.target.moduleId || (node.blockIds ?? node.members)?.includes(endpoint.target.moduleId)));
        if (terminal && node.members && !node.collapsed) return crossesInterior(points[i], b, { ...node, height: node.labelBounds.y + node.labelBounds.height - node.y + 8 });
        const obstacle = terminal || extraStroke === 0 ? node : {
          x: node.x - halfStroke, y: node.y - halfStroke,
          width: node.width + 2 * halfStroke, height: node.height + 2 * halfStroke,
        };
        return crossesInterior(points[i], b, obstacle);
      }));
      return { side, waypoints, points, valid, ...routeCost([{ points }]) };
    }).filter(route => route.valid).sort((a, b) => a.bends - b.bends || a.length - b.length || (a.side === 'top' ? -1 : 1));
    const chosen = routes[0];
    const original = routeCost(connection.sections);
    if (!chosen) {
      connection.routingInfo = { method: 'elk', reason: 'outer-access-blocked', originalBends: original.bends };
      continue;
    }
    connection.sections = [{ points: chosen.points }];
    connection.routingInfo = {
      method: 'outer-aabb', side: chosen.side, clearance: margin,
      originalBends: original.bends, waypoints: chosen.waypoints,
    };
    lane++;
  }
}
