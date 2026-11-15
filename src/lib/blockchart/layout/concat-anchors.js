import { moduleGeometry, textBounds } from '../geometry.js';

/** ELK places side Ports on the full text envelope; Concat Ports belong to its thin bar. */
export function restoreConcatAnchors(result, model) {
  const changed = new Set();
  for (const module of model.modules) {
    if (module.type !== 'concat') continue;
    const node = result.modules.find((n) => n.id === module.id);
    const geometry = moduleGeometry(module, model.layout.direction);
    for (const port of node.ports) {
      const local = geometry.portPoints[port.id];
      const x = node.x + local.x,
        y = node.y + local.y;
      if (Math.abs(x - port.x) < 1e-6 && Math.abs(y - port.y) < 1e-6) continue;
      changed.add(node.id);
      port.x = x;
      port.y = y;
      const label = geometry.portLabels[port.id];
      port.labelPosition = { ...label, x: node.x + label.x, y: node.y + label.y };
      port.labelBounds = port.style.hidden
        ? { x, y, width: 0, height: 0 }
        : textBounds(port.displayName, port.labelPosition, port.style);
    }
  }
  return new Set(
    model.connections
      .filter((edge) => changed.has(edge.source.moduleId) || changed.has(edge.target.moduleId))
      .map((edge) => edge.id),
  );
}
