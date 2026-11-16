const EPSILON = 1e-6;
const range = values => Math.max(...values) - Math.min(...values);

/** Metrics for comparison, never an objective used to modify the layout. */
export function measureLayout(layout, mainPath = ['A', 'B', 'C', 'D']) {
  const selected = mainPath.map(id => {
    const module = layout.modules.find(module => module.id === id);
    if (!module) throw new Error(`Missing main-path module: ${id}`);
    return module;
  });
  let bends = 0;
  let wireLength = 0;
  const edges = layout.connections.map(connection => {
    let edgeBends = 0;
    let edgeLength = 0;
    for (const section of connection.sections) {
      let previousDirection;
      for (let i = 1; i < section.points.length; i++) {
        const a = section.points[i - 1], b = section.points[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) continue;
        if (Math.abs(dx) > EPSILON && Math.abs(dy) > EPSILON) throw new Error('Non-orthogonal route');
        const direction = Math.abs(dx) > EPSILON ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        if (previousDirection && previousDirection !== direction) edgeBends++;
        previousDirection = direction;
        edgeLength += Math.abs(dx) + Math.abs(dy);
      }
    }
    bends += edgeBends;
    wireLength += edgeLength;
    return { id: connection.id, bends: edgeBends, wireLength: edgeLength };
  });
  return {
    width: layout.width, height: layout.height,
    mainPath: [...mainPath],
    topYSpread: range(selected.map(module => module.y)),
    centerYSpread: range(selected.map(module => module.y + module.height / 2)),
    bends, wireLength, edges,
  };
}
