import { directGridMembers } from '../../../lib/blockchart/grid.js';
import { groupType } from '../../../lib/blockchart/group-type.js';

/**
 * Keep Grid cells consistent with a membership change made by one Studio command.
 *
 * Only the IDs that the command added, removed or moved (and the groups whose
 * expandability it changed) are touched. Cells the user typed are never repaired:
 * a Cells edit changes no membership, so its errors still reach the user.
 *
 * Rules (one Undo step together with the command):
 * - A removed ID leaves an empty cell.
 * - A moved ID leaves its old cell, unless its old parent was ungrouped (it keeps its place).
 * - A new or moved child of an expanded Container is placed inside that Container's
 *   rectangle: the first empty cell, otherwise a new row (column in Down flow) below it.
 * - A new group made from placed items takes the first item's cell as one atomic cell.
 * - A Container that can no longer expand (type change, hidden contents) folds back into
 *   one cell at the top-left of its old rectangle.
 *
 * This only decides where cells go. It runs on intermediate cells that the runtime would
 * reject (a new child is a member before it has a cell), so it cannot use
 * createGridPlan().regions; the bounding box below is a placement choice, not validation.
 * Store.commit validates the result with the runtime's reconcileGrids afterwards.
 */
export function syncGridMembership(before, after) {
  const p0 = parents(before),
    p1 = parents(after);
  const removed = new Set([...p0.keys()].filter((id) => !p1.has(id)));
  const added = [...p1.keys()].filter((id) => !p0.has(id));
  const moved = [...p1.keys()].filter((id) => p0.has(id) && p0.get(id) !== p1.get(id));
  const folded = (after.groups ?? [])
    .filter((g) => {
      const old = before.groups?.find((x) => x.id === g.id);
      return old && expandable(old) && !expandable(g);
    })
    .map((g) => g.id);
  if (!removed.size && !added.length && !moved.length && !folded.length) return;

  const groups = new Map((after.groups ?? []).map((g) => [g.id, g]));
  const newGroups = new Set(added.filter((id) => groups.has(id)));
  const leaves = new Set(moved.filter((id) => !removed.has(p0.get(id)) || !p0.get(id)));
  const down = after.layout?.direction === 'down';

  for (const [config, members] of scopes(after)) {
    let cells = config.cells;
    const at = (id) => {
      for (const [r, row] of cells.entries()) {
        const c = row.indexOf(id);
        if (c >= 0) return { r, c };
      }
      return null;
    };
    const clear = (id) => {
      const p = at(id);
      if (p) cells[p.r][p.c] = null;
      return p;
    };

    for (const id of folded) {
      if (!members.includes(id)) continue;
      const spots = groups.get(id).members.map(clear).filter(Boolean);
      if (spots.length) {
        const r = Math.min(...spots.map((p) => p.r));
        const c = Math.min(...spots.filter((p) => p.r === r).map((p) => p.c));
        cells[r][c] = id;
      }
    }
    for (const id of removed) clear(id);
    const firstSpot = new Map();
    for (const id of leaves) {
      const p = clear(id);
      const parent = p1.get(id);
      if (p && newGroups.has(parent) && !firstSpot.has(parent)) firstSpot.set(parent, p);
    }
    for (const [id, p] of firstSpot) if (members.includes(id) && !at(id)) cells[p.r][p.c] = id;

    for (const id of [...added, ...moved]) {
      const parent = groups.get(p1.get(id));
      if (!parent || !members.includes(parent.id) || at(id) || !expandable(parent)) continue;
      const spots = parent.members.map(at).filter(Boolean);
      if (!spots.length) continue; // the Container is one cell or Auto here
      const top = Math.min(...spots.map((p) => p.r)),
        bottom = Math.max(...spots.map((p) => p.r)),
        left = Math.min(...spots.map((p) => p.c)),
        right = Math.max(...spots.map((p) => p.c));
      let spot = null;
      for (let r = top; r <= bottom && !spot; r++)
        for (let c = left; c <= right && !spot; c++) if (cells[r][c] === null) spot = { r, c };
      if (!spot && down) {
        cells = cells.map((row) => [...row.slice(0, right + 1), null, ...row.slice(right + 1)]);
        spot = { r: top, c: right + 1 };
      } else if (!spot) {
        cells = [...cells.slice(0, bottom + 1), cells[0].map(() => null), ...cells.slice(bottom + 1)];
        spot = { r: bottom + 1, c: left };
      }
      cells[spot.r][spot.c] = id;
    }
    config.cells = cells;
  }
}

function parents(doc) {
  const map = new Map([...doc.modules, ...(doc.groups ?? [])].map((x) => [x.id, '']));
  for (const g of doc.groups ?? []) for (const id of g.members) map.set(id, g.id);
  return map;
}

const expandable = (g) => groupType(g) === 'container' && !g.collapsed && g.members.length > 0;

function scopes(doc) {
  return [
    [doc.layout, directGridMembers(doc)],
    ...(doc.groups ?? []).map((g) => [g.layout, g.members]),
  ].filter(([config]) => config?.type === 'grid' && Array.isArray(config.cells));
}
