import { field, input, select, button, textarea, escape as e, singleLine } from './ui.js';
import { viewScopeOptions } from '../state/view-scope.js';
import { directGridMembers, expandedGridMembers } from '../../lib/blockchart/grid.js';
import { groupType } from '../../lib/blockchart/group-type.js';

export function resizeGridDraft(draft, rows, columns) {
  if (
    !Number.isSafeInteger(rows) ||
    !Number.isSafeInteger(columns) ||
    rows < 1 ||
    columns < 1 ||
    rows * columns > 10000
  )
    throw new Error('Use positive whole numbers, with at most 10,000 cells.');
  draft.cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: columns }, (_, c) => draft.cells[r]?.[c] ?? null),
  );
  delete draft.sizeError;
}

export function layoutMembers(doc, scope, expanded = []) {
  return expandedGridMembers(directGridMembers(doc, scope), doc.groups ?? [], expanded);
}
export function layoutConfig(doc, scope) {
  return scope ? doc.groups.find((g) => g.id === scope)?.layout : doc.layout;
}
export function newGridDraft(doc, scope) {
  const config = layoutConfig(doc, scope);
  return {
    scope,
    type: config?.type ?? 'auto',
    cells: structuredClone(config?.cells ?? [[null]]),
    rowGap: config?.rowGap ?? 50,
    columnGap: config?.columnGap ?? 80,
    ...(config?.expandGroups?.length ? { expandGroups: [...config.expandGroups] } : {}),
  };
}

export function portAdjustmentFields(layout = {}, context = 'page') {
  return `<div class="settings-grid">${field(
    'Port adjustment',
    select(
      [
        { value: 'fixed', label: 'Fixed' },
        { value: 'reduce-bends', label: 'Reduce bends' },
      ],
      layout.portAdjustment ?? 'reduce-bends',
      `data-field="setting" data-property="portAdjustment" ${context === 'page' ? 'data-focus-key="page-port-adjustment"' : ''} aria-label="Port adjustment"`,
    ),
  )}${field('Maximum shift', input(layout.maxPortShift ?? 40, `data-field="setting" data-property="maxPortShift" ${context === 'page' ? 'data-focus-key="page-port-shift"' : ''} aria-label="Maximum shift" min="0" step="1"`, 'number'))}</div><p class="field-help">Applies immediately to every layout scope. Reduce bends slides rectangular and stacked block ports along their current side. Terminal anchors and names move together perpendicular to flow. Maximum shift is in logical SVG units; 0 keeps all anchors fixed. Port order, labels and spacing may limit movement. Block positions and sizes stay unchanged.</p>`;
}
export function renderLayoutPanel(doc, draft) {
  const scope = draft.scope,
    all = [...doc.modules, ...(doc.groups ?? [])],
    direct = directGridMembers(doc, scope),
    containers = (doc.groups ?? []).filter((g) => direct.includes(g.id) && groupType(g) === 'container'),
    expanded = draft.expandGroups ?? [],
    owners = new Map(
      (doc.groups ?? [])
        .filter((g) => expanded.includes(g.id))
        .flatMap((g) => g.members.map((id) => [id, g])),
    ),
    members = layoutMembers(doc, scope, expanded),
    counts = new Map([['Empty', 1]]);
  const nameOf = (n) => (owners.has(n.id) ? owners.get(n.id).id + ' / ' : '') + singleLine(n.label ?? n.id);
  for (const n of all.filter((n) => members.includes(n.id))) {
    const name = nameOf(n);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const labels = new Map(
      all.map((n) => {
        const name = nameOf(n);
        return [n.id, name + (counts.get(name) > 1 ? ' [' + n.id + ']' : '')];
      }),
    ),
    selected = new Set(draft.cells.flat().filter(Boolean)),
    automatic = members.filter((id) => !selected.has(id) && !owners.has(id)),
    unplaced = members.filter((id) => !selected.has(id) && owners.has(id)),
    controller = scope
      ? [
          { label: 'Top', layout: doc.layout },
          ...(doc.groups ?? []).map((g) => ({ label: singleLine(g.label ?? g.id), layout: g.layout })),
        ].find((g) => g.layout?.type === 'grid' && g.layout.expandGroups?.includes(scope))
      : null;
  return `<section class="panel layout-panel"><header class="panel-header"><h2>Layout</h2></header><div class="panel-scroll layout-controls" data-scroll="layout">
    <div class="settings-grid">${field('Layout scope', select(viewScopeOptions(doc), scope, 'data-field="grid-scope" aria-label="Layout scope"'))}${field(
      'Arrangement',
      select(
        [
          { value: 'auto', label: 'Auto' },
          { value: 'grid', label: 'Grid' },
        ],
        draft.type,
        'data-field="grid-type" aria-label="Arrangement"',
      ),
    )}</div>
    <p class="field-help">Grid fixes only the members you select; other members stay automatic. Drafts stay in this session until Apply layout; apply before closing.</p>
    ${controller ? `<p class="field-help" role="note">Expanded by ${e(controller.label)} Grid. That Grid controls member positions when active; these settings are used in this group's own view.</p>` : ''}
    ${draft.type === 'grid' && containers.length ? `<fieldset class="grid-expand"><legend>Expand containers for layout</legend>${containers.map((g) => `<label class="check-label"><input type="checkbox" data-field="grid-expand" data-group="${e(g.id)}" ${expanded.includes(g.id) ? 'checked' : ''} ${!g.members.length ? 'disabled' : ''}/> ${e(singleLine(g.label ?? g.id))}${!g.members.length ? ' (empty)' : ''}</label>`).join('')}<p class="field-help">Place every member of an expanded Container in this Grid. Each Container must occupy a rectangle without outside members. Its own layout is kept for group views.</p></fieldset>` : ''}
    ${
      draft.type === 'grid'
        ? `<div class="settings-grid">${field('Rows', input(draft.sizeError?.rows ?? draft.cells.length, 'data-field="grid-size" data-property="rows" aria-label="Rows" min="1" max="10000" step="1"', 'number'))}${field('Columns', input(draft.sizeError?.columns ?? draft.cells[0].length, 'data-field="grid-size" data-property="columns" aria-label="Columns" min="1" max="10000" step="1"', 'number'))}${field('Row gap', input(draft.rowGap, 'data-field="grid-gap" data-property="rowGap" aria-label="Row gap" min="0"', 'number'))}${field('Column gap', input(draft.columnGap, 'data-field="grid-gap" data-property="columnGap" aria-label="Column gap" min="0"', 'number'))}</div>
    <div class="grid-table-scroll"><table class="grid-editor"><caption class="sr-only">Grid cells</caption><tbody>${draft.cells.map((row, r) => `<tr>${row.map((id, c) => `<td>${select([{ value: '', label: 'Empty' }, ...members.map((value) => ({ value, label: labels.get(value) }))], id ?? '', `data-field="grid-cell" data-row="${r}" data-column="${c}" aria-label="Row ${r + 1} column ${c + 1}"`)}</td>`).join('')}<td>${button('grid-remove-row', 'Remove row ' + (r + 1), { className: 'text-button', attrs: `data-row="${r}"`, disabled: draft.cells.length === 1 })}</td></tr>`).join('')}</tbody></table></div>
    <div class="dialog-actions">${button('grid-add-row', 'Add row', { className: 'outline' })}${button('grid-add-column', 'Add column', { className: 'outline' })}${button('grid-remove-column', 'Remove last column', { className: 'outline', disabled: draft.cells[0].length === 1 })}</div><p class="field-help">Empty cells reserve space inside the Grid. Selecting a member moves it from its previous cell. Removing cells returns their members to Auto.</p><section class="grid-auto" aria-label="Auto arranged"><h3>Auto arranged <span class="count">${automatic.length}</span></h3><p class="field-help">${automatic.length ? automatic.map((id) => e(labels.get(id))).join(', ') : 'All members are in the Grid.'}</p></section>`
        : '<p class="field-help">Choose Grid in Arrangement to edit rows and columns for this scope.</p>'
    }
    ${draft.type === 'grid' && unplaced.length ? `<section class="grid-auto" aria-label="Needs Grid placement"><h3>Needs Grid placement <span class="count">${unplaced.length}</span></h3><p class="field-help">${unplaced.map((id) => e(labels.get(id))).join(', ')}</p></section>` : ''}
    <p id="grid-error" class="field-error" role="alert"></p><div class="dialog-actions">${button('grid-cancel', 'Reset draft', { className: 'outline' })}${button('grid-apply', 'Apply layout', { className: 'primary' })}</div>
    <hr/>${portAdjustmentFields(doc.layout)}
    <hr/>${field('Diagram caption', textarea(doc.diagram.caption ?? '', 'data-field="diagram-caption" data-focus-key="diagram-caption" aria-label="Diagram caption" placeholder="Optional image footer"'))}<p class="field-help">The caption is global and is included below SVG/PNG and DOM exports. Leave blank to remove it.</p>
  </div></section>`;
}
