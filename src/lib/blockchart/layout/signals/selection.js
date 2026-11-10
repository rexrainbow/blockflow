export const routeLength = (edge) =>
  edge.sections.reduce(
    (total, section) =>
      total +
      section.points
        .slice(1)
        .reduce(
          (sum, p, i) => sum + Math.abs(p.x - section.points[i].x) + Math.abs(p.y - section.points[i].y),
          0,
        ),
    0,
  );

/** Freeze Auto choices from the first routed layout; the second pass never removes them. */
export function receiverLabels(model, firstPass) {
  const routes = new Map(firstPass?.connections.map((e) => [e.id, e]) ?? []);
  return new Set(
    model.connections
      .filter(
        (edge) =>
          edge.netId &&
          edge.label !== undefined &&
          !edge.style.label.hidden &&
          (edge.style.label.repeatAtEnd === 'always' ||
            (edge.style.label.repeatAtEnd === 'auto' &&
              routes.has(edge.id) &&
              routeLength(routes.get(edge.id)) > edge.style.label.longThreshold)),
      )
      .map((e) => e.id),
  );
}
