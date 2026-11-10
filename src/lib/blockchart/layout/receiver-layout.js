import { translateNode } from './translate.js';
import { routeFixed } from './fixed.js';
import { ancestors, parentOf } from '../hierarchy.js';

const EPS = 1e-6;
const overlap = (a, b) =>
  a.x < b.x + b.width - EPS &&
  a.x + a.width > b.x + EPS &&
  a.y < b.y + b.height - EPS &&
  a.y + a.height > b.y + EPS;
const contains = (a, b) =>
  b.x >= a.x - EPS &&
  b.y >= a.y - EPS &&
  b.x + b.width <= a.x + a.width + EPS &&
  b.y + b.height <= a.y + a.height + EPS;

/** Align local receiver nodes inside their reserved owner envelope, then repair only their routes. */
export function alignReceivers(result, model) {
  for (const receiver of (model._signals ?? []).flatMap((s) => s.receivers ?? [])) {
    const tail = model.connections.find((e) => e.id === receiver.tailId);
    const nodes = [...result.modules, ...result.groups],
      node = nodes.find((n) => n.id === receiver.signalId);
    const owner = nodes.find((n) => n.id === tail.target.moduleId),
      port =
        owner?.ports.find((p) => p.id === tail.target.portId) ??
        result.terminals?.find((t) => t.id === tail.target.terminal)?.anchor;
    const parent = nodes.find((n) => n.id === parentOf(model, node.id));
    const side = node.ports[0].side;
    // A visible boundary Port name occupies its own lane on the inside face.
    const inside = owner?.members && ancestors(model, node.id).includes(owner.id),
      bounds = port.labelBounds;
    let gap = 8;
    if (inside && !port.style.hidden)
      gap += ['left', 'right'].includes(side)
        ? Math.max(0, side === 'left' ? port.x - bounds.x : bounds.x + bounds.width - port.x)
        : Math.max(0, side === 'top' ? port.y - bounds.y : bounds.y + bounds.height - port.y);
    const box = {
      x:
        side === 'left'
          ? port.x - gap - node.width
          : side === 'right'
            ? port.x + gap
            : port.x - node.width / 2,
      y:
        side === 'top'
          ? port.y - gap - node.height
          : side === 'bottom'
            ? port.y + gap
            : port.y - node.height / 2,
      width: node.width,
      height: node.height,
    };
    if (Math.abs(box.x - node.x) < EPS && Math.abs(box.y - node.y) < EPS) continue;
    const ancestorsOfNode = new Set(ancestors(model, node.id));
    if (
      (parent && !contains(parent, box)) ||
      nodes.some((n) => n !== node && !ancestorsOfNode.has(n.id) && overlap(box, n)) ||
      result.groups.some((g) => !g.style.label.hidden && overlap(box, g.labelBounds)) ||
      result.connections.some(
        (e) =>
          e.netId !== tail.netId &&
          e.sections.some((s) =>
            s.points.slice(1).some((b, i) => {
              const a = s.points[i],
                half = e.style.strokeWidth / 2;
              return overlap(box, {
                x: Math.min(a.x, b.x) - half,
                y: Math.min(a.y, b.y) - half,
                width: Math.abs(a.x - b.x) + 2 * half,
                height: Math.abs(a.y - b.y) + 2 * half,
              });
            }),
          ),
      )
    )
      continue;
    const trial = structuredClone(result),
      moved = trial.modules.find((n) => n.id === node.id),
      dx = box.x - node.x,
      dy = box.y - node.y;
    translateNode(moved, dx, dy);
    const selected = new Set(
      model.connections
        .filter((e) => e.source.moduleId === node.id || e.target.moduleId === node.id)
        .map((e) => e.id),
    );
    try {
      routeFixed(trial, model, false, selected);
      Object.assign(result, trial);
    } catch {
      // ELK's valid route remains available if another Port's access lane blocks alignment.
    }
  }
}
