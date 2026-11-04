import { textSize, textBounds } from '../geometry.js';

const CLEARANCE = 3;
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const inflate = (r, n) => ({ x: r.x - n, y: r.y - n, width: r.width + 2 * n, height: r.height + 2 * n });

export function edgeLabelSize(connection) {
  const size = textSize(connection.label, connection.style.label);
  const padding = connection.style.label.padding;
  const result = { width: size.width + 2 * padding, height: size.height + 2 * padding };
  if (!Object.values(result).every(Number.isFinite)) throw new Error('Non-finite connection label dimensions');
  return result;
}

/** Place text beside the FINAL routes, including optional custom feedback routes. */
export function placeEdgeLabels({ modules, groups, connections }) {
  const obstacles = modules.map(node => inflate(node, CLEARANCE));
  for (const group of groups) {
    if(group.collapsed) {obstacles.push(inflate(group,CLEARANCE));continue;}
    for(const port of group.ports??[]) obstacles.push(inflate(port.labelBounds,CLEARANCE));
    // A container's interior can hold labels; its title and border cannot.
    obstacles.push(inflate(group.labelBounds, CLEARANCE));
    const half = group.style.borderWidth / 2 + CLEARANCE;
    obstacles.push(
      { x: group.x - half, y: group.y - half, width: group.width + 2 * half, height: 2 * half },
      { x: group.x - half, y: group.y + group.height - half, width: group.width + 2 * half, height: 2 * half },
      { x: group.x - half, y: group.y - half, width: 2 * half, height: group.height + 2 * half },
      { x: group.x + group.width - half, y: group.y - half, width: 2 * half, height: group.height + 2 * half },
    );
  }
  const segments = new Map();
  for (const edge of connections) {
    let distance = 0;
    const parts = [];
    for (const section of edge.sections) for (let i = 1; i < section.points.length; i++) {
      const a = section.points[i - 1], b = section.points[i];
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (!length) continue;
      const horizontal = Math.abs(a.y - b.y) < 1e-6;
      parts.push({ a, b, length, horizontal, distance });
      distance += length;
      const half = edge.style.strokeWidth / 2 + CLEARANCE;
      obstacles.push({ x: Math.min(a.x, b.x) - half, y: Math.min(a.y, b.y) - half,
        width: Math.abs(a.x - b.x) + 2 * half, height: Math.abs(a.y - b.y) + 2 * half });
    }
    segments.set(edge.id, { parts, length: distance });
  }
  const warnings = [];
  const labeled = connections.filter(edge => edge.label !== undefined).map(edge => ({ edge, size: edgeLabelSize(edge) }));
  // Larger labels get first choice. Fixed tie breakers keep repeated layout stable.
  labeled.sort((a, b) => b.size.width * b.size.height - a.size.width * a.size.height || a.edge.id.localeCompare(b.edge.id, 'en'));
  for (const { edge, size } of labeled) {
    const route = segments.get(edge.id);
    let best;
    for (const segment of route.parts) {
      const { a, b, horizontal, length, distance } = segment;
      const extent = horizontal ? size.width : size.height;
      const low = Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
      const fit = length >= extent + 16;
      const minimum = low + extent / 2 + 8, maximum = low + length - extent / 2 - 8;
      const clamp = value => fit ? Math.max(minimum, Math.min(maximum, value)) : low + length / 2;
      const positions = new Set([clamp(low + length / 2), clamp(low + length / 4), clamp(low + length * 3 / 4)]);
      // Candidate boundaries find gaps missed by regular midpoint sampling.
      for (const obstacle of obstacles) {
        positions.add(clamp((horizontal ? obstacle.x : obstacle.y) - extent / 2 - 1));
        positions.add(clamp((horizontal ? obstacle.x + obstacle.width : obstacle.y + obstacle.height) + extent / 2 + 1));
      }
      if (edge.labelHint) positions.add(clamp(horizontal ? edge.labelHint.x : edge.labelHint.y));
      for (const coordinate of positions) for (const side of [-1, 1]) for (const gap of [6, 12, 20]) {
        const offset = (horizontal ? size.height : size.width) / 2 + edge.style.strokeWidth / 2 + gap;
        const position = { x: horizontal ? coordinate : a.x + side * offset,
          y: horizontal ? a.y + side * offset : coordinate, anchor: 'middle' };
        const bounds = textBounds(edge.label, position, edge.style.label);
        const collisions = obstacles.reduce((sum, obstacle) => sum + Number(overlaps(bounds, obstacle)), 0);
        const along = Math.abs(coordinate - (horizontal ? a.x : a.y));
        const score = (collisions + Number(!fit)) * 1e6 + Math.abs(distance + along - route.length / 2)
          + (horizontal ? 0 : 24) + gap + (side === 1 ? 0.5 : 0);
        if (!best || score < best.score) best = { position, bounds, score, conflict: collisions > 0 || !fit };
      }
    }
    if (!best) throw new Error('No segment for connection label: ' + edge.id);
    edge.labelPosition = best.position;
    edge.labelBounds = best.bounds;
    delete edge.labelHint;
    obstacles.push(inflate(best.bounds, CLEARANCE));
    if (best.conflict) warnings.push({ code: 'EDGE_LABEL_OVERLAP', connectionId: edge.id,
      message: 'Connection label could not be placed with full clearance. Increase spacing or shorten the label.' });
  }
  return warnings;
}
