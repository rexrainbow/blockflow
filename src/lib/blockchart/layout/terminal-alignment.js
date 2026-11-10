import { translateNode } from './translate.js';
import { routeFixed } from './fixed.js';

const EPS = 1e-6;
const crosses = (a, b, box) =>
  Math.abs(a.y - b.y) < EPS
    ? a.y > box.y - EPS &&
      a.y < box.y + box.height + EPS &&
      Math.max(a.x, b.x) > box.x &&
      Math.min(a.x, b.x) < box.x + box.width
    : a.x > box.x - EPS &&
      a.x < box.x + box.width + EPS &&
      Math.max(a.y, b.y) > box.y &&
      Math.min(a.y, b.y) < box.y + box.height;

/** Put each external interface on a common side rail, including its reserved signal names. */
export function alignTerminals(result, model) {
  if (!result.terminals?.length) return;
  const normal = model.layout.direction === 'down' ? 'y' : 'x',
    tangent = normal === 'x' ? 'y' : 'x',
    extent = normal === 'x' ? 'width' : 'height',
    crossExtent = normal === 'x' ? 'height' : 'width';
  const units = result.terminals.map((terminal) => {
    const ids = new Set();
    for (const signal of model._signals ?? []) {
      if (model.connections.find((e) => e.id === signal.trunkId).source.terminal === terminal.id)
        ids.add(signal.signalId);
      for (const receiver of signal.receivers ?? [])
        if (model.connections.find((e) => e.id === receiver.tailId).target.terminal === terminal.id)
          ids.add(receiver.signalId);
    }
    const nodes = result.modules.filter((n) => ids.has(n.id)),
      wrapper = result.groups.find((g) => g._signalTerminal === terminal.id);
    return { terminal, nodes, wrapper, parts: [terminal, ...nodes, ...(wrapper ? [wrapper] : [])] };
  });
  const external = new Set(units.flatMap((unit) => unit.parts)),
    internal = [...result.modules, ...result.groups].filter((n) => !external.has(n));
  if (!internal.length) return;
  const low = Math.min(...internal.map((n) => n[normal])),
    high = Math.max(...internal.map((n) => n[normal] + n[extent]));
  const moved = new Set(),
    boxes = [];
  function translate(unit, dn, dt) {
    if (Math.abs(dn) < EPS && Math.abs(dt) < EPS) return;
    for (const node of unit.parts) translateNode(node, normal === 'x' ? dn : dt, normal === 'x' ? dt : dn);
    moved.add(unit.terminal.id);
    for (const node of unit.nodes) moved.add(node.id);
    boxes.push(unit.terminal, ...unit.nodes);
  }
  for (const direction of ['input', 'output']) {
    const side = units.filter((unit) => unit.terminal.direction === direction);
    if (!side.length) continue;
    const input = direction === 'input';
    const reach = Math.max(
      ...side.map((unit) =>
        input
          ? Math.max(...unit.parts.map((n) => n[normal] + n[extent])) - unit.terminal.anchor[normal]
          : unit.terminal.anchor[normal] - Math.min(...unit.parts.map((n) => n[normal])),
      ),
    );
    // Preserve any existing clearance, and keep the complete label envelope outside hardware.
    const rail = input
      ? Math.min(low - 60 - reach, ...side.map((unit) => unit.terminal.anchor[normal]))
      : Math.max(high + 60 + reach, ...side.map((unit) => unit.terminal.anchor[normal]));
    side.sort((a, b) => a.terminal.anchor[tangent] - b.terminal.anchor[tangent]);
    let previous = -Infinity;
    for (const unit of side) {
      const start = Math.min(...unit.parts.map((n) => n[tangent])),
        end = Math.max(...unit.parts.map((n) => n[tangent] + n[crossExtent])),
        shift = Math.max(0, previous + 24 - start);
      translate(unit, rail - unit.terminal.anchor[normal], shift);
      previous = end + shift;
    }
  }
  if (!moved.size) return;
  const selected = new Set(
    result.connections
      .filter((edge) => {
        const ref = model.connections.find((e) => e.id === edge.id);
        return (
          [ref.source, ref.target].some((end) => moved.has(end.terminal ?? end.moduleId)) ||
          edge.sections.some((section) =>
            section.points.slice(1).some((b, i) => boxes.some((box) => crosses(section.points[i], b, box))),
          )
        );
      })
      .map((e) => e.id),
  );
  routeFixed(result, model, false, selected, 'terminal-alignment');
}
