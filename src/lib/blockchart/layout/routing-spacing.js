import { connectionStyle } from '../styles.js';

/** Body ink is a channel requirement; arrowheads are endpoint-local. */
export const lineWidth = (edge) => Math.max(edge.style.strokeWidth, edge.netStyle?.strokeWidth ?? 0);
export const obstacleClearance = (edge) =>
  edge._signalTrunk || edge._signalTail ? 1 : Math.max(3, lineWidth(edge) / 2 + 2);

export function endpointEscape(edge, source) {
  if (edge._signalTrunk || edge._signalTail) return 3;
  const style = source ? (edge.netStyle ?? edge.style) : edge.style;
  const arrow =
    style[source ? 'startArrow' : 'endArrow'] === 'triangle' ? Math.max(8, style.strokeWidth * 3) : 0;
  return Math.max(6, obstacleClearance(edge) + 1, arrow + 1);
}

export function routingSpacing(edges) {
  return {
    stroke: Math.max(0, ...edges.map(lineWidth)),
    extra: Math.max(0, ...edges.map((edge) => lineWidth(edge) - connectionStyle(edge.width).strokeWidth)),
    gutter: Math.max(
      8,
      ...edges.map(
        (edge) =>
          Math.max(endpointEscape(edge, true), endpointEscape(edge, false)) + obstacleClearance(edge) + 1,
      ),
    ),
  };
}

/** Clip a preferred escape ray before the first foreign inflated obstacle. */
export function fitEndpointEscape(endpoint, point, vector, obstacles) {
  const axis = vector.x ? 'x' : 'y',
    cross = axis === 'x' ? 'y' : 'x';
  const extent = axis === 'x' ? 'width' : 'height',
    crossExtent = axis === 'x' ? 'height' : 'width';
  const sign = vector[axis],
    p = endpoint.p;
  let distance = (point[axis] - p[axis]) * sign;
  for (const box of obstacles) {
    if (endpoint.node && box._owner === endpoint.node.id) continue;
    if (p[cross] <= box[cross] + 1e-6 || p[cross] >= box[cross] + box[crossExtent] - 1e-6) continue;
    const entry = sign > 0 ? box[axis] - p[axis] : p[axis] - box[axis] - box[extent];
    if (entry > 1e-6) distance = Math.min(distance, Math.max(0, entry - 1));
  }
  point[axis] = p[axis] + sign * distance;
}
