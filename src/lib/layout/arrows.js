// Compute arrow geometry once, after all routing adjustments.
export function connectionArrow(edge) {
  if (edge.style.endArrow !== 'triangle') return undefined;
  const section = edge.sections.at(-1),
    tip = section.points.at(-1);
  let before;
  for (let i = section.points.length - 2; i >= 0; i--)
    if (Math.hypot(tip.x - section.points[i].x, tip.y - section.points[i].y) > 1e-6) {
      before = section.points[i];
      break;
    }
  if (!before) return undefined;
  const distance = Math.hypot(tip.x - before.x, tip.y - before.y),
    size = Math.min(Math.max(8, edge.style.strokeWidth * 3), distance);
  const dx = (tip.x - before.x) / distance,
    dy = (tip.y - before.y) / distance,
    half = size / 2;
  const x = tip.x - dx * size,
    y = tip.y - dy * size;
  const points = [{ ...tip }, { x: x - dy * half, y: y + dx * half }, { x: x + dy * half, y: y - dx * half }];
  const left = Math.min(...points.map((p) => p.x)),
    top = Math.min(...points.map((p) => p.y));
  return {
    points,
    bounds: {
      x: left,
      y: top,
      width: Math.max(...points.map((p) => p.x)) - left,
      height: Math.max(...points.map((p) => p.y)) - top,
    },
  };
}
