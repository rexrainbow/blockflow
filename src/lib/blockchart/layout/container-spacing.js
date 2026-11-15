import { groupGeometry } from './groups.js';

const layerSpacing = 'elk.layered.spacing.nodeNodeBetweenLayers';

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
