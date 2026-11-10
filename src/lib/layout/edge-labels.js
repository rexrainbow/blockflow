import { textSize, textBounds } from '../geometry.js';

const CLEARANCE = 3;
const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const inflate = (r, n) => ({ x: r.x - n, y: r.y - n, width: r.width + 2 * n, height: r.height + 2 * n });
const strokeBox = (a, b, n) => ({
  x: Math.min(a.x, b.x) - n,
  y: Math.min(a.y, b.y) - n,
  width: Math.abs(a.x - b.x) + 2 * n,
  height: Math.abs(a.y - b.y) + 2 * n,
});

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

/** Place labels on FINAL routes. Only the supporting segment may pass beneath Inline text. */
export function placeEdgeLabels({ modules, groups, terminals = [], connections }) {
  const obstacles = modules.map((node) => ({ bounds: inflate(node, CLEARANCE) }));
  const add = (bounds) => obstacles.push({ bounds: inflate(bounds, CLEARANCE) });
  for (const terminal of terminals) if (!terminal.style.hidden) add(terminal.labelBounds);
  for (const edge of connections)
    for (const arrow of [edge.arrow, edge.startArrow]) if (arrow) add(arrow.bounds);
  for (const group of groups) {
    if (group.collapsed) {
      add(group);
      continue;
    }
    for (const port of group.ports ?? []) if (!port.style.hidden) add(port.labelBounds);
    if (!group.style.label.hidden) add(group.labelBounds);
    const half = group.style.borderWidth / 2 + CLEARANCE;
    obstacles.push(
      ...[
        { x: group.x - half, y: group.y - half, width: group.width + 2 * half, height: 2 * half },
        {
          x: group.x - half,
          y: group.y + group.height - half,
          width: group.width + 2 * half,
          height: 2 * half,
        },
        { x: group.x - half, y: group.y - half, width: 2 * half, height: group.height + 2 * half },
        {
          x: group.x + group.width - half,
          y: group.y - half,
          width: 2 * half,
          height: group.height + 2 * half,
        },
      ].map((bounds) => ({ bounds, border: true })),
    );
  }
  const routes = new Map();
  for (const edge of connections) {
    let distance = 0;
    const parts = [];
    for (const section of edge.sections)
      for (let i = 1; i < section.points.length; i++) {
        const a = section.points[i - 1],
          b = section.points[i],
          length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        if (!length) continue;
        const part = {
          a,
          b,
          length,
          horizontal: Math.abs(a.y - b.y) < 1e-6,
          distance,
          index: parts.length,
          edge,
        };
        parts.push(part);
        distance += length;
        obstacles.push({ bounds: strokeBox(a, b, edge.style.strokeWidth / 2 + CLEARANCE), part });
      }
    routes.set(edge.id, { parts, length: distance });
    delete edge.labelInstances;
    if (edge.label !== undefined && edge.style.label.hidden) {
      const point = edge.sections[0].points[0];
      edge.labelInstances = [];
      edge.labelPosition = { ...point, anchor: 'middle' };
      edge.labelBounds = { ...point, width: 0, height: 0 };
    }
  }
  const labeled = connections
    .filter((edge) => edge.label !== undefined && !edge.style.label.hidden)
    .map((edge) => ({ edge, size: edgeLabelSize(edge) }))
    .sort(
      (a, b) =>
        b.size.width * b.size.height - a.size.width * a.size.height ||
        a.edge.id.localeCompare(b.edge.id, 'en'),
    );
  const warnings = [];
  const pinned = new Set();
  for (const { edge } of labeled)
    if (edge.signalLabel && !pinned.has(edge.signalLabel.sharedKey)) {
      pinned.add(edge.signalLabel.sharedKey);
      add(edge.signalLabel.bounds);
    }
  for (const { edge, size } of labeled) {
    const route = routes.get(edge.id);
    if (!route.parts.length || !edge.signalLabel) throw new Error('Missing source signal label: ' + edge.id);
    const extent = (part) => (part.horizontal ? size.width : size.height);
    const repeat = edge.style.label.repeatAtEnd;
    const roles =
      repeat === 'always' || (repeat === 'auto' && route.length > edge.style.label.longThreshold)
        ? ['end']
        : [];
    edge.labelInstances = [structuredClone(edge.signalLabel)];
    for (const role of roles) {
      let best;
      const modes = ['callout', 'adaptiveCallout'];
      for (const searchMode of modes) {
        const mode = 'callout';
        let modeBest;
        for (const part of route.parts) {
          const { a, b, horizontal, length, distance } = part;
          const alongExtent = extent(part),
            low = Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
          const minimum = Math.min(12, length / 2);
          const clamp = (value) => Math.max(low + minimum, Math.min(low + length - minimum, value));
          const positions = new Set([
            clamp(low + length / 2),
            clamp(low + minimum),
            clamp(low + length - minimum),
            clamp(low + length / 4),
            clamp(low + (length * 3) / 4),
          ]);
          for (const { bounds } of obstacles) {
            positions.add(clamp((horizontal ? bounds.x : bounds.y) - alongExtent / 2 - 1));
            positions.add(
              clamp((horizontal ? bounds.x + bounds.width : bounds.y + bounds.height) + alongExtent / 2 + 1),
            );
          }
          for (const coordinate of positions)
            for (const side of [-1, 1])
              for (const gap of searchMode === 'adaptiveCallout'
                ? calloutGaps(part, coordinate, side, size, obstacles)
                : [12, 24, 40, 64, 96]) {
                const offset =
                  side * ((horizontal ? size.height : size.width) / 2 + edge.style.strokeWidth / 2 + gap);
                const position = {
                  x: horizontal ? coordinate : a.x + offset,
                  y: horizontal ? a.y + offset : coordinate,
                  anchor: 'middle',
                };
                const bounds = textBounds(edge.label, position, edge.style.label);
                const anchor = { x: horizontal ? coordinate : a.x, y: horizontal ? a.y : coordinate };
                const leader =
                  mode === 'callout'
                    ? [
                        anchor,
                        {
                          x: horizontal ? coordinate : position.x - (side * size.width) / 2,
                          y: horizontal ? position.y - (side * size.height) / 2 : coordinate,
                        },
                      ]
                    : undefined;
                let collisions = 0;
                for (const obstacle of obstacles) {
                  if (overlaps(bounds, obstacle.bounds)) collisions++;
                  if (
                    leader &&
                    !obstacle.border &&
                    obstacle.part !== part &&
                    overlaps(strokeBox(...leader, 1), obstacle.bounds) &&
                    !sharedLeaderAnchor(obstacle.part, part, anchor)
                  )
                    collisions++;
                }
                const along = Math.abs(coordinate - (horizontal ? a.x : a.y)),
                  at = distance + along;
                const target = route.length;
                const conflict = collisions > 0;
                const score = collisions * 1e9 + Math.abs(at - target) + gap + (side === 1 ? 0.5 : 0);
                const candidate = {
                  position,
                  bounds,
                  placement: mode,
                  role,
                  distance: at,
                  ...(leader ? { leader } : {}),
                  score,
                  conflict,
                  part,
                };
                if (!modeBest || score < modeBest.score) modeBest = candidate;
              }
        }
        if (!best || modeBest.score < best.score) best = modeBest;
        if (!modeBest.conflict) {
          best = modeBest;
          break;
        }
      }
      const { score, conflict, part, ...instance } = best;
      edge.labelInstances.push(instance);
      add(instance.bounds);
      if (instance.leader) obstacles.push({ bounds: strokeBox(...instance.leader, 2) });
      if (conflict)
        warnings.push({
          code: 'EDGE_LABEL_OVERLAP',
          connectionId: edge.id,
          position: role,
          message:
            'Connection label could not be placed with full clearance. Increase spacing or shorten the label.',
        });
    }
    edge.labelPosition = edge.labelInstances[0].position;
    edge.labelBounds = edge.labelInstances[0].bounds;
    delete edge.signalLabel;
  }
  // Shared labels need independent coordinates during the final origin translation.
  for (const { edge } of labeled) edge.labelInstances = structuredClone(edge.labelInstances);
  return warnings;
}

// A callout may attach to a shared fan-out segment carrying the same named signal.
// Only the coincident supporting segment is exempt; crossings and other branches remain obstacles.
function sharedLeaderAnchor(other, part, anchor) {
  if (!other || !part.edge.source || other.horizontal !== part.horizontal) return false;
  if (
    JSON.stringify(other.edge.source) !== JSON.stringify(part.edge.source) ||
    other.edge.label !== part.edge.label
  )
    return false;
  if (part.horizontal ? other.a.y !== part.a.y : other.a.x !== part.a.x) return false;
  const coordinate = part.horizontal ? anchor.x : anchor.y;
  return (
    coordinate >=
      Math.min(part.horizontal ? other.a.x : other.a.y, part.horizontal ? other.b.x : other.b.y) &&
    coordinate <= Math.max(part.horizontal ? other.a.x : other.a.y, part.horizontal ? other.b.x : other.b.y)
  );
}

// Fixed offsets can miss a narrow free strip between a block and a group frame.
// Search obstacle boundaries locally only after the inexpensive standard candidates fail.
function calloutGaps(part, coordinate, side, size, obstacles) {
  const horizontal = part.horizontal,
    half = (horizontal ? size.height : size.width) / 2;
  const extent = (horizontal ? size.width : size.height) / 2,
    axis = horizontal ? part.a.y : part.a.x;
  const base = half + part.edge.style.strokeWidth / 2,
    maximum = Math.max(96, size.width, size.height) * 2;
  const gaps = new Set([12, 24, 40, 64, 96]);
  for (const { bounds } of obstacles) {
    const along = horizontal ? bounds.x : bounds.y,
      length = horizontal ? bounds.width : bounds.height;
    if (along > coordinate + extent || along + length < coordinate - extent) continue;
    const low = horizontal ? bounds.y : bounds.x,
      high = low + (horizontal ? bounds.height : bounds.width);
    for (const center of [low - half - 1, high + half + 1]) {
      const gap = side * (center - axis) - base;
      if (gap >= 12 && gap <= maximum) gaps.add(gap);
    }
  }
  return gaps;
}
