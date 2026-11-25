import { groupGeometry } from './groups.js';
import { defaultSide } from '../port-sides.js';
import { containerClearance } from './routing-spacing.js';

const layerSpacing = 'elk.layered.spacing.nodeNodeBetweenLayers';

/** Space for a branch to turn between the last child it exits and its common parent. */
export function containerExitMargins(model) {
  const margins = new Map();
  const parents = new Map();
  for (const group of model.groups) for (const member of group.members) parents.set(member, group);
  const ordinary = (g) => g?.type === 'container' && !g.collapsed;
  if (!model.groups.some((g) => ordinary(g) && ordinary(parents.get(g.id)))) return margins;
  const modules = new Map(model.modules.map((m) => [m.id, m]));
  for (const edge of model.connections) {
    let owner = parents.get(edge.source.moduleId);
    if (!ordinary(owner) || !ordinary(parents.get(owner.id)) || !edge.target.moduleId) continue;
    const source = modules.get(edge.source.moduleId);
    const port = source?.ports.find((p) => p.id === edge.source.portId);
    if (!port) continue;
    const targetPath = new Set([edge.target.moduleId]);
    for (let g = parents.get(edge.target.moduleId); g; g = parents.get(g.id)) targetPath.add(g.id);
    let child;
    while (ordinary(owner) && !targetPath.has(owner.id)) {
      child = owner;
      owner = parents.get(owner.id);
    }
    if (!child || !ordinary(owner) || !targetPath.has(owner.id)) continue;
    const side = port.side ?? defaultSide(port, model.layout.direction);
    const margin = margins.get(child.id) ?? { left: 0, right: 0, top: 0, bottom: 0 };
    margin[side] = Math.max(margin[side], 2 * containerClearance(edge));
    margins.set(child.id, margin);
  }
  return margins;
}

/** Credit existing inner gutters only in homogeneous Auto Container regions. */
export function budgetContainerSpacing(graph, model) {
  if (
    model.layout.type === 'grid' ||
    model.groups.some((group) => !group.collapsed && group.layout?.type === 'grid')
  )
    return;
  const refs = new Map(model.groups.map((group) => [group.id, group]));
  const ordinary = (group) =>
    group?.type === 'container' && !group.collapsed && !group._signalWrapper && group.portMode !== 'boundary';
  function visit(node) {
    node.children?.forEach(visit);
    if (!node.children || node.children.length < 2) return;
    if (node !== graph && !ordinary(refs.get(node.id))) return;
    const children = node.children.map((child) => refs.get(child.id));
    if (!children.every(ordinary)) return;
    const base = Number(node.layoutOptions[layerSpacing]);
    const pads = children.map((child) => groupGeometry(child, model.layout.direction, model));
    // Either child can precede the other. The smallest entry plus smallest exit
    // cannot exceed the two facing gutters of any pair, even if ELK reorders it.
    const [entry, exit] = model.layout.direction === 'down' ? ['top', 'bottom'] : ['left', 'right'];
    const credit = Math.min(...pads.map((pad) => pad[entry])) + Math.min(...pads.map((pad) => pad[exit]));
    const floor = Math.max(8, Number(graph.layoutOptions['elk.spacing.edgeEdge']));
    node.layoutOptions[layerSpacing] = String(Math.min(base, Math.max(floor, base - credit)));
  }
  visit(graph);
}
