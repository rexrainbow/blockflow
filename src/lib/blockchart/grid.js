import { groupType } from './group-type.js';

export function directGridMembers(document, scope = '') {
  if (scope) return document.groups?.find((g) => g.id === scope)?.members ?? [];
  const nested = new Set((document.groups ?? []).flatMap((g) => g.members));
  return [...document.modules, ...(document.groups ?? [])].filter((n) => !nested.has(n.id)).map((n) => n.id);
}

export function expandedGridMembers(members, groups, expanded = []) {
  const map = new Map(groups.map((g) => [g.id, g]));
  return members.flatMap((id) => (expanded.includes(id) ? (map.get(id)?.members ?? []) : [id]));
}

/** Rectangular, disjoint Container regions can include empty cells, never outsiders. */
function gridRegions(
  cells,
  expanded,
  groups,
  path = 'layout',
  fail = (message) => {
    throw new Error(message);
  },
) {
  const regions = [];
  for (const id of expanded) {
    const group = groups.find((g) => g.id === id),
      members = new Set(group.members),
      positions = [];
    cells.forEach((row, r) =>
      row.forEach((member, c) => {
        if (members.has(member)) positions.push({ r, c });
      }),
    );
    if (positions.length !== members.size)
      fail(
        `Expanded container ${id} requires every direct member in the Grid`,
        `${path}.cells[${positions[0]?.r ?? 0}][${positions[0]?.c ?? 0}]`,
      );
    const region = {
      id,
      firstRow: Math.min(...positions.map((p) => p.r)),
      lastRow: Math.max(...positions.map((p) => p.r)),
      firstColumn: Math.min(...positions.map((p) => p.c)),
      lastColumn: Math.max(...positions.map((p) => p.c)),
    };
    for (let r = region.firstRow; r <= region.lastRow; r++)
      for (let c = region.firstColumn; c <= region.lastColumn; c++)
        if (cells[r][c] !== null && !members.has(cells[r][c]))
          fail(
            `Container ${id} must occupy a rectangle without outside members`,
            `${path}.cells[${r}][${c}]`,
          );
    if (
      regions.some(
        (other) =>
          region.firstRow <= other.lastRow &&
          region.lastRow >= other.firstRow &&
          region.firstColumn <= other.lastColumn &&
          region.lastColumn >= other.firstColumn,
      )
    )
      fail(
        'Expanded container regions must not overlap',
        `${path}.cells[${positions[0]?.r ?? 0}][${positions[0]?.c ?? 0}]`,
      );
    regions.push(region);
  }
  return regions;
}

/** Derive a runtime-only plan. Never repair or annotate authoring cells. */
export function createGridPlan(cells, members, groups = [], path = 'layout', fail = gridFailure) {
  if (!Array.isArray(cells) || !cells.length || !Array.isArray(cells[0]) || !cells[0].length)
    fail('Grid needs at least one row and column', path + '.cells');
  const width = cells[0].length,
    seen = new Set(),
    positions = new Map();
  for (const [r, row] of cells.entries()) {
    if (!Array.isArray(row) || row.length !== width)
      fail('Grid rows must have equal column counts', `${path}.cells[${r}]`);
    for (const [c, id] of row.entries()) {
      if (id === null) continue;
      const at = `${path}.cells[${r}][${c}]`;
      if (typeof id !== 'string') fail('Grid cells must contain member IDs or null', at);
      if (seen.has(id)) fail('A member may occur only once in a grid', at);
      seen.add(id);
      positions.set(id, at);
    }
  }
  const expandable = groups.filter(
    (g) => members.includes(g.id) && groupType(g) === 'container' && !g.collapsed && g.members.length,
  );
  const expandedContainers = expandable.filter((g) => g.members.some((id) => seen.has(id))).map((g) => g.id);
  for (const id of expandedContainers)
    if (seen.has(id))
      fail(`Container ${id} and its children cannot occur in the same Grid`, positions.get(id));
  const eligible = new Set(expandedGridMembers(members, groups, expandedContainers));
  for (const [id, at] of positions)
    if (!eligible.has(id))
      fail('Grid cells must reference direct members or direct children of nonempty Containers', at);
  for (const id of expandedContainers) {
    const group = groups.find((g) => g.id === id),
      missing = group.members.filter((id) => !seen.has(id));
    if (missing.length)
      fail(
        `Expanded container ${id} requires every direct member in the Grid; missing: ${missing.join(', ')}`,
        positions.get(group.members.find((id) => seen.has(id))),
      );
  }
  return { expandedContainers, regions: gridRegions(cells, expandedContainers, groups, path, fail) };
}

function gridFailure(message, path) {
  const error = new Error(message);
  error.path = path;
  throw error;
}

/** Grid references layout participants, never rewrites membership or connectivity. */
export function parseGrid(value, members, path, fail, root = false, groups = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected a layout object', path);
  if (Object.hasOwn(value, 'expandGroups'))
    fail('Remove expandGroups; Container expansion is inferred from cells', path + '.expandGroups');
  const type = value.type ?? 'auto';
  if (
    !['auto', 'grid'].includes(type) ||
    (Object.hasOwn(value, 'type') && !['auto', 'grid'].includes(value.type))
  )
    fail('Expected auto or grid layout', path + '.type');
  if (!root)
    for (const key of Object.keys(value))
      if (
        ![
          'type',
          'cells',
          'rowGap',
          'columnGap',
          'moduleSpacing',
          'layerSpacing',
          'blockMinWidth',
          'blockMinHeight',
          'blockAlign',
        ].includes(key)
      )
        fail('Unsupported grid property: ' + key, path + '.' + key);
  const alignment = {};
  if (Object.hasOwn(value, 'blockAlign')) {
    if (type !== 'grid') fail('Block alignment requires type grid', path + '.blockAlign');
    if (!['left', 'center', 'right'].includes(value.blockAlign))
      fail('Expected left, center or right Block alignment', path + '.blockAlign');
    alignment.blockAlign = value.blockAlign;
  }
  const local = {};
  const minimums = {};
  for (const key of ['blockMinWidth', 'blockMinHeight']) {
    if (!Object.hasOwn(value, key)) continue;
    if (type !== 'grid') fail('Block minimums require type grid', path + '.' + key);
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] <= 0)
      fail('Block minimum must be finite and positive', path + '.' + key);
    minimums[key] = value[key];
  }
  if (!root)
    for (const key of ['moduleSpacing', 'layerSpacing'])
      if (Object.hasOwn(value, key)) {
        if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] <= 0)
          fail('Spacing must be finite and positive', path + '.' + key);
        local[key] = value[key];
      }
  for (const key of ['rowGap', 'columnGap'])
    if (
      Object.hasOwn(value, key) &&
      (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0)
    )
      fail('Grid gap must be finite and non-negative', path + '.' + key);
  if (type === 'auto') {
    if (Object.hasOwn(value, 'cells')) fail('Grid cells require type grid', path + '.cells');
    return { type, ...local };
  }
  createGridPlan(value.cells, members, groups, path, fail);
  return {
    type,
    ...local,
    ...minimums,
    ...alignment,
    cells: structuredClone(value.cells),
    rowGap: value.rowGap ?? 50,
    columnGap: value.columnGap ?? 80,
  };
}

export function renameGridMember(document, from, to) {
  for (const config of [document.layout, ...(document.groups ?? []).map((g) => g.layout)]) {
    if (config?.cells) config.cells = config.cells.map((row) => row.map((id) => (id === from ? to : id)));
  }
}
/** Validate all scopes without silently clearing cells or writing derived fields.
 * Deletion/membership commands must explicitly clean references they invalidate.
 */
export function reconcileGrids(document) {
  if (document.layout)
    parseGrid(
      document.layout,
      directGridMembers(document),
      'layout',
      gridFailure,
      true,
      document.groups ?? [],
    );
  for (const [i, group] of (document.groups ?? []).entries())
    if (group.layout)
      parseGrid(
        group.layout,
        group.members,
        `groups[${i}].layout`,
        gridFailure,
        false,
        document.groups ?? [],
      );
}
