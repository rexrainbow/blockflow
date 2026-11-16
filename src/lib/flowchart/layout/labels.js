import { textSize } from '../../shared/text.js';

const inflate = (r, gap) => ({
  x: r.x - gap,
  y: r.y - gap,
  width: r.width + gap * 2,
  height: r.height + gap * 2,
});
const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const segments = (edge) =>
  edge.sections.flatMap(({ points }) => points.slice(1).map((p, i) => [points[i], p]));

/** Include wire thickness and a readable gap, even for dashed/transparent wires. */
export function labelTouchesEdge(box, edge) {
  const gap = edge.style.strokeWidth / 2 + 3;
  return segments(edge).some(([a, b]) =>
    overlaps(box, {
      x: Math.min(a.x, b.x) - gap,
      y: Math.min(a.y, b.y) - gap,
      width: Math.abs(b.x - a.x) + gap * 2,
      height: Math.abs(b.y - a.y) + gap * 2,
    }),
  );
}

// Intersections include collinear overlap boundaries (the split of a shared trunk).
function intersections([a, b], [c, d]) {
  const horizontal = Math.abs(a.y - b.y) < 1e-6;
  const otherHorizontal = Math.abs(c.y - d.y) < 1e-6;
  const within = (x, lo, hi) => x >= Math.min(lo, hi) - 1e-6 && x <= Math.max(lo, hi) + 1e-6;
  if (horizontal !== otherHorizontal) {
    const p = horizontal ? { x: c.x, y: a.y } : { x: a.x, y: c.y };
    return within(p.x, a.x, b.x) && within(p.y, a.y, b.y) && within(p.x, c.x, d.x) && within(p.y, c.y, d.y)
      ? [p]
      : [];
  }
  if (Math.abs(horizontal ? a.y - c.y : a.x - c.x) > 1e-6) return [];
  return [a, b, c, d].filter(
    (p) => within(p.x, a.x, b.x) && within(p.y, a.y, b.y) && within(p.x, c.x, d.x) && within(p.y, c.y, d.y),
  );
}

/** Prefer inline labels on exclusive straight sections, clear of junctions. */
export function placeEdgeLabels({ edges, nodes, groups, reroute }) {
  const labelBoxes = [],
    warnings = [];
  for (const edge of edges.filter((e) => e.label !== undefined)) {
    const size = textSize(edge.label, edge.style),
      width = size.width + 8,
      height = size.height + 6;
    const inline = [],
      beside = [],
      ownSegments = segments(edge);
    const margin = Math.max(14, edge.style.fontSize);
    const junctions = ownSegments.flatMap((segment) =>
      edges
        .filter((e) => e !== edge)
        .flatMap((e) => segments(e).flatMap((other) => intersections(segment, other))),
    );
    for (const [index, [a, b]] of ownSegments.entries()) {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        horizontal = Math.abs(dy) < 1e-6;
      const length = Math.abs(dx) + Math.abs(dy),
        extent = horizontal ? width : height;
      if (length < 12) continue;
      const endMargin = Math.max(margin, edge.arrow ? edge.style.strokeWidth * 3 + 3 : 0);
      const first = extent / 2 + endMargin,
        last = length - first;
      // Midpoints first; then search within the segment while retaining end clearance.
      const distances = [length / 2, length * 0.35, length * 0.65, first, last];
      for (let d = first; d <= last && distances.length < 69; d += extent + 8) distances.push(d);
      for (const distance of [...new Set(distances)]) {
        const x = a.x + (dx * distance) / length,
          y = a.y + (dy * distance) / length;
        const box = { x: x - width / 2, y: y - height / 2, width, height };
        if (distance >= first && distance <= last) inline.push({ box, index });
        if (distance < 0 || distance > length) continue;
        for (const extra of [0, margin])
          for (const sign of [1, -1]) {
            const offset = (horizontal ? height : width) / 2 + edge.style.strokeWidth / 2 + 5 + extra;
            beside.push({
              box: {
                ...box,
                x: box.x + (horizontal ? 0 : sign * offset),
                y: box.y + (horizontal ? sign * offset : 0),
              },
              index,
            });
          }
      }
    }
    const blockers = [...nodes, ...groups.map((g) => g.labelBounds), ...labelBoxes];
    const free = ({ box }) =>
      !blockers.some((b) => overlaps(inflate(box, 3), b)) &&
      !junctions.some((p) => overlaps(inflate(box, margin), { ...p, width: 1e-6, height: 1e-6 }));
    const conflicts = ({ box, index }, onWire) =>
      edges.filter((other) => {
        const wire =
          other === edge && onWire
            ? {
                ...other,
                sections: ownSegments.filter((_, i) => i !== index).map(([a, b]) => ({ points: [a, b] })),
              }
            : other;
        return labelTouchesEdge(box, wire);
      });
    const available = inline.filter(free);
    let chosen = available.find((candidate) => !conflicts(candidate, true).length);
    if (!chosen && reroute) {
      for (const candidate of available.slice(0, 8)) {
        const wires = conflicts(candidate, true);
        if (wires.length > 3 || wires.some((other) => other === edge || other.labelBounds)) continue;
        const trials = wires.map((other) => reroute(other, [...labelBoxes, candidate.box]));
        if (
          trials.some(
            (trial) => !trial || [...labelBoxes, candidate.box].some((b) => labelTouchesEdge(b, trial)),
          )
        )
          continue;
        const owners = [
          { wire: edge, box: candidate.box },
          ...edges.filter((e) => e.labelBounds).map((wire) => ({ wire, box: wire.labelBounds })),
        ];
        if (
          owners.some(({ wire, box }) =>
            segments(wire).some((segment) =>
              trials.some((trial) =>
                segments(trial).some((other) =>
                  intersections(segment, other).some((p) =>
                    overlaps(inflate(box, Math.max(14, wire.style.fontSize)), {
                      ...p,
                      width: 1e-6,
                      height: 1e-6,
                    }),
                  ),
                ),
              ),
            ),
          )
        )
          continue;
        wires.forEach((other, i) => Object.assign(other, trials[i]));
        chosen = candidate;
        break;
      }
    }
    if (!chosen) {
      chosen = beside.filter(free).find((candidate) => !conflicts(candidate, false).length);
      warnings.push({
        code: 'FLOW_LABEL_OVERLAP',
        edgeId: edge.id,
        message: chosen
          ? 'Could not place the condition label inline with junction clearance; placed beside its wire.'
          : 'Could not place the condition label with full node, label and wire clearance.',
      });
    }
    const p = edge.sections[0].points[0];
    const box = chosen?.box ??
      available[0]?.box ??
      beside.find(free)?.box ??
      beside[0]?.box ?? { x: p.x + 10, y: p.y + 10, width, height };
    labelBoxes.push(box);
    edge.labelBounds = box;
    edge.labelPosition = { x: box.x + width / 2, y: box.y + height / 2, anchor: 'middle' };
  }
  return { labelBoxes, warnings };
}
