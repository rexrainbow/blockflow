import { connectionStyle } from '../styles.js';
import { connectionLabels } from './edge-labels.js';
import { EPS, samePoint } from './routing-geometry.js';

const on = (p, s) =>
  s.horizontal
    ? Math.abs(p.y - s.a.y) < EPS &&
      p.x >= Math.min(s.a.x, s.b.x) - EPS &&
      p.x <= Math.max(s.a.x, s.b.x) + EPS
    : Math.abs(p.x - s.a.x) < EPS &&
      p.y >= Math.min(s.a.y, s.b.y) - EPS &&
      p.y <= Math.max(s.a.y, s.b.y) + EPS;
function distance(p, s) {
  const dx = s.b.x - s.a.x,
    dy = s.b.y - s.a.y,
    t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - s.a.x - t * dx, p.y - s.a.y - t * dy);
}
const touchesBox = (p, r, b, padding = 0) =>
  b &&
  p.x + r + padding > b.x - EPS &&
  p.x - r - padding < b.x + b.width + EPS &&
  p.y + r + padding > b.y - EPS &&
  p.y - r - padding < b.y + b.height + EPS;
function inkBoxes(node) {
  if (!node.body?.shapes) return [node];
  return node.body.shapes.map((s) => {
    if (s.kind === 'rect') return { x: node.x + s.x, y: node.y + s.y, width: s.width, height: s.height };
    const xs = s.points.map((p) => p.x),
      ys = s.points.map((p) => p.y);
    return {
      x: node.x + Math.min(...xs),
      y: node.y + Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  });
}
/** Geometric degree of the same-Net segment union. Duplicate/overlapping strokes
 * contribute directions once; no routing coordinates or input objects change. */
export function netJunctions({ modules = [], groups = [], terminals = [], connections }) {
  const nets = new Map(),
    segments = [];
  for (const edge of [...connections].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    const net = edge.netId ?? edge.id;
    if (!nets.has(net)) nets.set(net, { edges: [], segments: [] });
    const entry = nets.get(net);
    entry.edges.push(edge);
    for (const [index, section] of edge.sections.entries())
      for (let i = 1; i < section.points.length; i++) {
        const a = section.points[i - 1],
          b = section.points[i];
        if (samePoint(a, b)) continue;
        const style = {
          ...connectionStyle(edge.width),
          ...(edge.netStyle && index < edge.netTrunkSections ? edge.netStyle : edge.style),
        };
        const segment = {
          a,
          b,
          net,
          edgeId: edge.id,
          style,
          horizontal: Math.abs(a.y - b.y) < EPS,
          orthogonal: Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS,
        };
        segments.push(segment);
        if (segment.orthogonal) entry.segments.push(segment);
      }
  }
  const ports = [...modules, ...groups]
    .flatMap((n) => n.ports ?? [])
    .concat(terminals.map((t) => t.anchor).filter(Boolean));
  const boxes = [...modules, ...groups.filter((g) => g.collapsed)].flatMap(inkBoxes);
  const labels = [
    ...connections
      .flatMap(connectionLabels)
      .filter((l) => l.placement === 'inline')
      .map((l) => l.bounds),
    ...groups
      .filter((g) => !g.style?.label?.hidden)
      .map((g) => g.labelBounds)
      .filter(Boolean),
  ];
  const result = [];
  for (const [net, entry] of [...nets.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    if (entry.edges.length < 2) continue;
    const candidates = entry.segments.flatMap((s) => [s.a, s.b]);
    for (let i = 0; i < entry.segments.length; i++)
      for (const b of entry.segments.slice(i + 1)) {
        const a = entry.segments[i];
        if (a.horizontal === b.horizontal) continue;
        const h = a.horizontal ? a : b,
          v = a.horizontal ? b : a,
          p = { x: v.a.x, y: h.a.y };
        if (on(p, a) && on(p, b)) candidates.push(p);
      }
    // Neighboring epsilon buckets also cover points that straddle a rounding edge.
    const buckets = new Map(),
      unique = [];
    for (const p of [...candidates].sort((a, b) => a.x - b.x || a.y - b.y)) {
      const x = Math.floor(p.x / EPS),
        y = Math.floor(p.y / EPS);
      let exists = false;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          if ((buckets.get(x + dx + ':' + (y + dy)) ?? []).some((q) => samePoint(p, q))) exists = true;
      if (exists) continue;
      const key = x + ':' + y;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
      unique.push(p);
    }
    for (const p of unique) {
      const touching = entry.segments.filter((s) => on(p, s)),
        directions = new Set(),
        ids = new Set();
      for (const s of touching) {
        ids.add(s.edgeId);
        if (s.horizontal) {
          if (Math.min(s.a.x, s.b.x) < p.x - EPS) directions.add('left');
          if (Math.max(s.a.x, s.b.x) > p.x + EPS) directions.add('right');
        } else {
          if (Math.min(s.a.y, s.b.y) < p.y - EPS) directions.add('up');
          if (Math.max(s.a.y, s.b.y) > p.y + EPS) directions.add('down');
        }
      }
      if (directions.size < 3 || ids.size < 2) continue;
      const radius = Math.max(2.5, ...touching.map((s) => s.style.strokeWidth));
      if (ports.some((port) => Math.hypot(p.x - port.x, p.y - port.y) <= radius + EPS)) continue;
      if (boxes.some((b) => touchesBox(p, radius, b)) || labels.some((b) => touchesBox(p, radius, b, 2)))
        continue;
      // Never bridge another Net with the marker's ink, even at a true own-Net fork.
      if (segments.some((s) => s.net !== net && distance(p, s) <= radius + s.style.strokeWidth / 2 + EPS))
        continue;
      const style = {
        ...connectionStyle(entry.edges[0].width),
        ...(entry.edges[0].netStyle ?? entry.edges[0].style),
      };
      result.push({
        netId: net,
        x: p.x,
        y: p.y,
        radius,
        connectionIds: [...ids].sort(),
        style: { strokeColor: style.strokeColor, opacity: style.opacity },
      });
    }
  }
  return result;
}
