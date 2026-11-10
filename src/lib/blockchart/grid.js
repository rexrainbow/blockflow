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
export function gridRegions(
  cells,
  expanded,
  groups,
  path = 'layout',
  fail = (message) => {
    throw new Error(message);
  },
) {
  const regions = [];
  for (const [i, id] of expanded.entries()) {
    const group = groups.find((g) => g.id === id),
      members = new Set(group.members),
      positions = [];
    cells.forEach((row, r) =>
      row.forEach((member, c) => {
        if (members.has(member)) positions.push({ r, c });
      }),
    );
    if (positions.length !== members.size)
      fail(`Expanded container ${id} requires every direct member in the Grid`, `${path}.expandGroups[${i}]`);
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
      fail('Expanded container regions must not overlap', `${path}.expandGroups[${i}]`);
    regions.push(region);
  }
  return regions;
}

/** Grid references layout participants, never rewrites membership or connectivity. */
export function parseGrid(value, members, path, fail, root = false, groups = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected a layout object', path);
  const type = value.type ?? 'auto';
  if (
    !['auto', 'grid'].includes(type) ||
    (Object.hasOwn(value, 'type') && !['auto', 'grid'].includes(value.type))
  )
    fail('Expected auto or grid layout', path + '.type');
  if (!root)
    for (const key of Object.keys(value))
      if (!['type', 'cells', 'rowGap', 'columnGap', 'expandGroups'].includes(key))
        fail('Unsupported grid property: ' + key, path + '.' + key);
  for (const key of ['rowGap', 'columnGap'])
    if (
      Object.hasOwn(value, key) &&
      (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0)
    )
      fail('Grid gap must be finite and non-negative', path + '.' + key);
  if (type === 'auto') {
    if (Object.hasOwn(value, 'cells')) fail('Grid cells require type grid', path + '.cells');
    if (Object.hasOwn(value, 'expandGroups'))
      fail('Expanded containers require type grid', path + '.expandGroups');
    return { type };
  }
  if (
    !Array.isArray(value.cells) ||
    !value.cells.length ||
    !Array.isArray(value.cells[0]) ||
    !value.cells[0].length
  )
    fail('Grid needs at least one row and column', path + '.cells');
  const expanded = value.expandGroups ?? [];
  if (!Array.isArray(expanded) || (Object.hasOwn(value, 'expandGroups') && value.expandGroups === null))
    fail('Expected an array of container IDs', path + '.expandGroups');
  for (const [i, id] of expanded.entries()) {
    const group = groups.find((g) => g.id === id);
    if (
      !members.includes(id) ||
      !group ||
      groupType(group) !== 'container' ||
      group.collapsed ||
      !group.members.length
    )
      fail('Only nonempty direct Container groups can be expanded', `${path}.expandGroups[${i}]`);
    if (expanded.indexOf(id) !== i) fail('Duplicate expanded container', `${path}.expandGroups[${i}]`);
  }
  const eligible = expandedGridMembers(members, groups, expanded),
    seen = new Set(),
    width = value.cells[0].length;
  for (const [r, row] of value.cells.entries()) {
    if (!Array.isArray(row) || row.length !== width)
      fail('Grid rows must have equal column counts', path + `.cells[${r}]`);
    for (const [c, id] of row.entries())
      if (id !== null) {
        if (typeof id !== 'string' || !eligible.includes(id))
          fail(
            'Grid cells must reference direct members or children of expanded Containers',
            path + `.cells[${r}][${c}]`,
          );
        if (seen.has(id)) fail('A member may occur only once in a grid', path + `.cells[${r}][${c}]`);
        seen.add(id);
      }
  }
  const result = { type, cells: structuredClone(value.cells) };
  gridRegions(value.cells, expanded, groups, path, fail);
  if (Object.hasOwn(value, 'expandGroups')) result.expandGroups = [...expanded];
  for (const [key, fallback] of [
    ['rowGap', 50],
    ['columnGap', 80],
  ]) {
    const n = value[key] ?? fallback;
    if (
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      n < 0 ||
      (Object.hasOwn(value, key) && value[key] === null)
    )
      fail('Grid gap must be finite and non-negative', path + '.' + key);
    result[key] = n;
  }
  return result;
}

export function renameGridMember(document, from, to) {
  for (const config of [document.layout, ...(document.groups ?? []).map((g) => g.layout)]) {
    if (config?.cells) config.cells = config.cells.map((row) => row.map((id) => (id === from ? to : id)));
    if (config?.expandGroups) config.expandGroups = config.expandGroups.map((id) => (id === from ? to : id));
  }
}
export function reconcileGrids(document) {
  const nested = new Set((document.groups ?? []).flatMap((g) => g.members));
  const scopes = [
    [
      document.layout,
      [...document.modules, ...(document.groups ?? [])].filter((n) => !nested.has(n.id)).map((n) => n.id),
    ],
    ...(document.groups ?? []).map((g) => [g.layout, g.members]),
  ];
  for (const [config, members] of scopes)
    if (config?.type === 'grid') {
      if (config.expandGroups) {
        config.expandGroups = config.expandGroups.filter(
          (id) =>
            members.includes(id) &&
            document.groups?.some(
              (g) => g.id === id && groupType(g) === 'container' && g.members.length && !g.collapsed,
            ),
        );
        if (!config.expandGroups.length) delete config.expandGroups;
      }
      const eligible = expandedGridMembers(members, document.groups ?? [], config.expandGroups);
      const seen = new Set();
      config.cells = config.cells.map((row) =>
        row.map((id) => {
          if (id === null || !eligible.includes(id) || seen.has(id)) return null;
          seen.add(id);
          return id;
        }),
      );
    }
}
