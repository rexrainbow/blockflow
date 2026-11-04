import { singleLine, escape as e, button, icon, sortActions } from './ui.js';
import { ancestors, descendants, itemPath } from '../../lib/hierarchy.js';
import { groupOf } from '../state/commands.js';

export function renderBlockList(document, selected, selectedGroup, collapsed, search = '') {
  const modules = document.modules;
  const row = (module, siblingIndex, count) => {
    const index = modules.indexOf(module);
    const menu = `<details class="command-menu block-menu"><summary class="button icon-button" aria-label="Block actions: ${e(module.id)}" title="Block actions">${icon('more')}</summary><div class="command-popover">${button('move-to-group', 'Move to group...', { attrs: `data-id="${e(module.id)}"` })}${button('group-block', 'Create group with this block', { attrs: `data-id="${e(module.id)}"` })}${button('convert-boundary', 'Convert to boundary group', { attrs: `data-id="${e(module.id)}"` })}</div></details>`;
    const actions = sortActions('module', siblingIndex, count, `data-block-id="${e(module.id)}"`).replace(
      /<\/div>\s*$/,
      menu + '</div>',
    );
    return `<div class="block-row ${module.id === selected ? 'selected' : ''}" data-drop-kind="module" data-index="${index}" data-id="${e(module.id)}" data-parent-group="${e(groupOf(document, module.id))}">
      <button type="button" class="block-select" data-action="select-block" data-id="${e(module.id)}" aria-pressed="${module.id === selected}"><span class="block-monogram">${e((module.label ?? module.id).slice(0, 1))}</span><span class="block-row-text"><strong>${e(singleLine(module.label ?? module.id))}</strong><small><span class="block-list-key">${e(module.id)}</span></small></span></button>${actions}</div>`;
  };

  const groups = new Map((document.groups ?? []).map((group) => [group.id, group]));
  const items = new Map([...modules, ...(document.groups ?? [])].map((item) => [item.id, item]));
  const query = search.trim().toLocaleLowerCase('en-US');
  const visible = new Set();
  if (query)
    for (const item of items.values())
      if ((item.id + ' ' + (item.label ?? '')).toLocaleLowerCase('en-US').includes(query)) {
        visible.add(item.id);
        ancestors(document, item.id).forEach((id) => visible.add(id));
        if (groups.has(item.id)) descendants(document, item.id).forEach((id) => visible.add(id));
      }
  function render(id, index, count) {
    if (query && !visible.has(id)) return '';
    const item = items.get(id);
    if (!item) return '';
    if (!groups.has(id)) return row(item, index, count);
    const group = item,
      label = singleLine(group.label ?? group.id);
    const expanded = Boolean(query) || !collapsed.has(id);
    const menu = `<details class="command-menu group-menu"><summary class="button icon-button" aria-label="Group actions: ${e(id)}" title="Group actions">${icon('more')}</summary><div class="command-popover">${button('view-contents', 'View contents', { attrs: `data-id="${e(id)}"` })}${button('add-subgroup', 'Add subgroup', { attrs: `data-id="${e(id)}"` })}${button('move-to-group', 'Move to group...', { attrs: `data-id="${e(id)}"` })}</div></details>`;
    return `<section class="group-section" data-group-id="${e(id)}" data-parent-group="${e(groupOf(document, id))}" data-drop-kind="group" aria-label="Group ${e(label)}">
      <div class="group-row ${id === selectedGroup ? 'selected' : ''}">
        ${button('toggle-group', expanded ? 'Collapse ' + label : 'Expand ' + label, { glyph: expanded ? 'down' : 'arrow', iconOnly: true, disabled: Boolean(query), attrs: `data-id="${e(id)}" data-focus-key="toggle-group-${e(id)}" aria-expanded="${expanded}" aria-controls="group-members-${e(id)}"` })}
        ${button('drag', 'Drag group', { glyph: 'grip', iconOnly: true, className: 'grip', attrs: `draggable="true" data-kind="group" data-block-id="${e(id)}"` })}
        <button type="button" class="group-select" data-action="select-group" data-id="${e(id)}" aria-pressed="${id === selectedGroup}" title="${e(
          itemPath(document, id)
            .map((item) => item.label)
            .join(' / '),
        )}"><strong>${e(label)}</strong><small>${group.members.length}</small></button>
        ${menu}${button('ungroup', 'Ungroup ' + label + ' (keep contents)', { glyph: 'trash', iconOnly: true, className: 'danger-quiet', attrs: `data-id="${e(id)}"` })}
      </div>
      <div class="group-members" id="group-members-${e(id)}" role="group" aria-label="${e(label)} contents" ${expanded ? '' : 'hidden'}>
        ${group.members.map((member, i) => render(member, i, group.members.length)).join('') || '<div class="group-empty">Drop blocks or groups here</div>'}
      </div></section>`;
  }
  const roots = [...modules, ...(document.groups ?? [])].filter((item) => !groupOf(document, item.id));
  const rootBlocks = roots.filter((item) => !groups.has(item.id));
  let html = roots
    .map((item, i) =>
      render(
        item.id,
        groups.has(item.id) ? i : rootBlocks.indexOf(item),
        groups.has(item.id) ? roots.length : rootBlocks.length,
      ),
    )
    .join('');
  if (!html)
    html = query
      ? '<div class="list-empty" role="status">No matching blocks or groups.</div>'
      : '<div class="list-empty">No blocks yet<br/><span>Add your first block or group below.</span></div>';
  if (groups.size)
    html += '<div class="root-drop-zone" data-drop-kind="root">Drop here to move to root</div>';
  return html;
}
