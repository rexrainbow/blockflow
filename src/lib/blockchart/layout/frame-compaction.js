import { ancestors } from '../hierarchy.js';
import { createGridPlan, directGridMembers } from '../grid.js';
import { groupGeometry } from './groups.js';
import { containerExitMargins } from './container-spacing.js';

/** Reclaim the old tangent extent after Auto children move, before rerouting. */
export function compactMovedFrames(result, model, before) {
  const semantic = model._signalOriginal ?? model;
  const nodes = new Map([...result.modules, ...result.groups].map((n) => [n.id, n]));
  const owners = new Set();
  for (const group of semantic.groups) {
    const old = before.get(group.id),
      node = nodes.get(group.id);
    if (
      old &&
      node &&
      (node.x !== old.x || node.y !== old.y || node.width !== old.width || node.height !== old.height)
    )
      for (const id of ancestors(semantic, group.id)) owners.add(id);
  }
  const expanded =
    !model.rootGroupId && semantic.layout.type === 'grid'
      ? new Set(
          createGridPlan(semantic.layout.cells, directGridMembers(semantic), semantic.groups)
            .expandedContainers,
        )
      : new Set();
  const axis = model.layout.direction === 'down' ? 'x' : 'y';
  const size = axis === 'x' ? 'width' : 'height';
  const margins = containerExitMargins(semantic);
  let changed = false;
  for (const id of [...owners].sort(
    (a, b) => ancestors(semantic, b).length - ancestors(semantic, a).length,
  )) {
    const ref = model.groups.find((g) => g.id === id),
      node = nodes.get(id);
    if (
      !ref ||
      !node ||
      ref.collapsed ||
      (ref.type ?? 'container') !== 'container' ||
      ref.layout?.type === 'grid' ||
      ref.portMode === 'boundary' ||
      ref.ports?.length ||
      expanded.has(id)
    )
      continue;
    // Expanded cross-group Grid frames are sized by the owning Grid.
    if (
      ancestors(semantic, id).some(
        (parent) =>
          expanded.has(parent) || semantic.groups.find((g) => g.id === parent)?.layout?.type === 'grid',
      )
    )
      continue;
    const children = (node.members ?? []).map((child) => nodes.get(child)).filter(Boolean);
    if (!children.length) continue;
    const pad = groupGeometry(ref, model.layout.direction, model);
    const tail = axis === 'x' ? 'right' : 'bottom';
    const extent = Math.max(
      pad[size],
      ...children.map(
        (child) =>
          child[axis] + child[size] - node[axis] + Math.max(pad[tail], margins.get(child.id)?.[tail] ?? 0),
      ),
    );
    if (extent < node[size] - 1e-6) {
      node[size] = extent;
      changed = true;
    }
  }
  return changed;
}

export function canRepackRoot(model) {
  if (model.rootGroupId || model.layout.type !== 'grid') return false;
  const semantic = model._signalOriginal ?? model;
  return !createGridPlan(semantic.layout.cells, directGridMembers(semantic), semantic.groups)
    .expandedContainers.length;
}
