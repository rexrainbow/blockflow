import { textSize } from '../geometry.js';

export function edgeLabelSize(connection) {
  if (connection.style.label.hidden) return { width: 0, height: 0 };
  const size = textSize(connection.label, connection.style.label);
  const padding = connection.style.label.padding;
  const result = { width: size.width + 2 * padding, height: size.height + 2 * padding };
  if (!Object.values(result).every(Number.isFinite))
    throw new Error('Non-finite connection label dimensions');
  return result;
}

/** All visible instances; first-position aliases remain available to layout consumers. */
export function connectionLabels(edge) {
  return edge.labelInstances ?? [];
}

/** Publish labels whose space and attachment were reserved by the layout graph. */
export function placeEdgeLabels({ modules, groups = [], terminals = [], connections }) {
  for (const edge of connections) {
    delete edge.labelInstances;
    if (edge.label === undefined) continue;
    if (edge.style.label.hidden) {
      const point = edge.sections[0].points[0];
      edge.labelInstances = [];
      edge.labelPosition = { ...point, anchor: 'middle' };
      edge.labelBounds = { ...point, width: 0, height: 0 };
      continue;
    }
    if (!edge.signalLabel) throw new Error('Missing source signal label: ' + edge.id);
    edge.labelInstances = structuredClone([
      edge.signalLabel,
      ...(edge.signalEndLabel ? [edge.signalEndLabel] : []),
    ]);
    edge.labelPosition = edge.labelInstances[0].position;
    edge.labelBounds = edge.labelInstances[0].bounds;
    delete edge.signalLabel;
    delete edge.signalEndLabel;
  }
  // Routing and Grid repair must still respect every reserved receiver footprint.
  // Keep diagnostics for unusual routes rather than silently masking another Net.
  const overlaps = (a, b) =>
    a.x < b.x + b.width - 1e-6 &&
    a.x + a.width > b.x + 1e-6 &&
    a.y < b.y + b.height - 1e-6 &&
    a.y + a.height > b.y + 1e-6;
  const boxes = [
    ...modules,
    ...groups.filter((g) => g.collapsed),
    ...groups.filter((g) => !g.style.label.hidden).map((g) => g.labelBounds),
    ...terminals.filter((t) => !t.style.hidden).map((t) => t.labelBounds),
  ];
  const labels = connections.flatMap((edge) => connectionLabels(edge).map((label) => ({ edge, label })));
  return connections
    .filter((edge) => {
      const label = connectionLabels(edge).find((l) => l.role === 'end');
      if (!label) return false;
      return (
        boxes.some((b) => overlaps(label.bounds, b)) ||
        labels.some(
          (other) =>
            other.edge !== edge &&
            (!label.sharedKey || other.label.sharedKey !== label.sharedKey) &&
            overlaps(label.bounds, other.label.bounds),
        ) ||
        connections.some(
          (other) =>
            other.netId !== edge.netId &&
            other.sections.some((section) =>
              section.points.slice(1).some((b, i) => {
                const a = section.points[i],
                  half = other.style.strokeWidth / 2;
                return overlaps(label.bounds, {
                  x: Math.min(a.x, b.x) - half,
                  y: Math.min(a.y, b.y) - half,
                  width: Math.abs(a.x - b.x) + 2 * half,
                  height: Math.abs(a.y - b.y) + 2 * half,
                });
              }),
            ),
        )
      );
    })
    .map((edge) => ({
      code: 'EDGE_LABEL_OVERLAP',
      connectionId: edge.id,
      position: 'end',
      message:
        'Connection label could not be placed with full clearance. Increase spacing or shorten the label.',
    }));
}
