export const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

const paths = {
  settings:
    'M7 2h4l.5 2 2 .8 1.8-.6 2 3.5-1.5 1.4.2 2.2 1.3 1.5-2 3.4-2-.5-1.8 1-1 1.8H7l-.5-2-2-.8-1.8.6-2-3.5 1.5-1.4L2 9.2.7 7.7l2-3.4 2 .5 1.8-1L7 2M12 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0',
  plus: 'M9 3v12M3 9h12',
  minus: 'M3 9h12',
  close: 'm5 5 8 8M13 5l-8 8',
  trash: 'M3 5h12M7 5V3h4v2M5 5l1 10h6l1-10M8 8v4M10 8v4',
  grip: 'M6 4h.01M12 4h.01M6 9h.01M12 9h.01M6 14h.01M12 14h.01',
  up: 'm4 11 5-5 5 5',
  down: 'm4 7 5 5 5-5',
  more: 'M4 9h.01M9 9h.01M14 9h.01',
  undo: 'M6 4 2 8l4 4M2 8h8a5 5 0 0 1 0 10',
  redo: 'm12 4 4 4-4 4M16 8H8a5 5 0 0 0 0 10',
  open: 'M2 5h6l2 2h6l-2 8H2V5M2 5V3h5l2 2h6v2',
  save: 'M3 2h10l3 3v11H2V2h1M5 2v5h7V2M5 16v-6h8v6',
  download: 'M9 2v9m-4-4 4 4 4-4M3 12v4h12v-4',
  fit: 'M6 2H2v4M12 2h4v4M2 12v4h4M16 12v4h-4M6 6h6v6H6z',
  refresh: 'M15 7a6 6 0 1 0 0 5M15 2v5h-5',
  arrow: 'M2 9h13m-5-5 5 5-5 5',
  check: 'm3 9 4 4 8-8',
  grid: 'M3 3h4v4H3zM11 3h4v4h-4zM3 11h4v4H3zM11 11h4v4h-4z',
  split: 'M2 2h14v14H2zM9 2v14',
  editor: 'M2 2h14v14H2zM5 5h8M5 9h8M5 13h5',
  preview: 'M2 3h14v12H2zM6 7h6v4H6z',
};

export function icon(name) {
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.more}"/></svg>`;
}

export function button(
  action,
  label,
  { glyph, className = '', disabled = false, attrs = '', iconOnly = false, ariaLabel = label } = {},
) {
  return `<button type="button" class="button ${iconOnly ? 'icon-button' : ''} ${className}" data-action="${action}" aria-label="${escape(ariaLabel)}" title="${escape(ariaLabel)}" ${disabled ? 'disabled' : ''} ${attrs}>${glyph ? icon(glyph) : ''}${iconOnly ? '' : `<span>${escape(label)}</span>`}</button>`;
}

export function field(label, input, help = '') {
  return `<label class="field"><span class="field-label">${escape(label)}</span>${input}${help ? `<span class="field-help">${escape(help)}</span>` : ''}</label>`;
}

export function input(value, attrs = '', type = 'text') {
  return `<input type="${type}" value="${escape(value)}" ${attrs}/>`;
}

export const singleLine = (value) => value.replace(/\s*\r?\n\s*/g, ' / ');

export function textarea(value, attrs = '') {
  // A leading LF in HTML textarea content is stripped by the HTML parser.
  return `<textarea rows="2" class="display-text" ${attrs}>&#10;${escape(value)}</textarea>`;
}

export function resizeTextareas(root) {
  for (const element of root.querySelectorAll('textarea.display-text')) {
    element.style.height = 'auto';
    element.style.height = Math.min(240, Math.max(52, element.scrollHeight + 2)) + 'px';
  }
}

export function select(options, value, attrs = '') {
  return `<select ${attrs}>${options.map((option) => `<option value="${escape(option.value)}" ${String(option.value) === String(value) ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}>${escape(option.label)}</option>`).join('')}</select>`;
}

export function hideContentsControl(checked, attrs = '') {
  return (
    '<label class="check-label" title="Draw this group as one block; keep its contents in JSON."><input type="checkbox" ' +
    (checked ? 'checked' : '') +
    ' ' +
    attrs +
    ' aria-description="Hide descendants and internal connections in the diagram. Contents remain editable in the list."/>Hide contents</label>'
  );
}

export function feedbackControl(checked, attrs = '') {
  const description =
    'Prefer this connection as feedback when a cycle exists. Block positions may still change.';
  return `<label class="check-label feedback-control" title="${description}"><input type="checkbox" ${checked ? 'checked' : ''} ${attrs} aria-description="${description}"/>Feedback</label>`;
}

export function sortActions(kind, index, count, attrs = '') {
  return `<div class="row-actions">
    ${button('drag', 'Drag to reorder (Alt+Up/Down)', { glyph: 'grip', iconOnly: true, className: 'grip', attrs: `draggable="true" data-kind="${kind}" data-index="${index}" ${attrs}` })}
    <details class="sort-menu"><summary aria-label="Reorder options" title="Reorder options">${icon('more')}</summary><div class="sort-popover">
      ${button('move-up', 'Move up', { glyph: 'up', disabled: index === 0, attrs: `data-kind="${kind}" data-index="${index}" ${attrs}` })}
      ${button('move-down', 'Move down', { glyph: 'down', disabled: index === count - 1, attrs: `data-kind="${kind}" data-index="${index}" ${attrs}` })}
    </div></details>
    ${button('delete', 'Delete', { glyph: 'trash', iconOnly: true, className: 'danger-quiet', attrs: `data-kind="${kind}" data-index="${index}" ${attrs}` })}
  </div>`;
}

let errorId = 0;

export function setFieldError(element, message, focus = true) {
  const container = element.closest('.field') ?? element.parentElement;
  let help = container.querySelector('.field-error');
  if (!help) {
    help = document.createElement('span');
    help.className = 'field-error';
    help.id = `field-error-${++errorId}`;
    container.append(help);
  }
  help.textContent = message;
  element.setAttribute('aria-invalid', 'true');
  element.setAttribute('aria-describedby', help.id);
  if (focus) element.focus();
}

export function clearFieldError(element) {
  element.removeAttribute('aria-invalid');
  element.removeAttribute('aria-describedby');
  (element.closest('.field') ?? element.parentElement)?.querySelector('.field-error')?.remove();
}

export function positionDisclosureMenu(menu) {
  const popover = menu.querySelector('.sort-popover, .command-popover');
  const point = menu.contextPoint;
  const summary = point
    ? { top: point.y, bottom: point.y - 4, right: point.x + popover.offsetWidth }
    : menu.querySelector('summary').getBoundingClientRect();
  const top =
    summary.bottom + popover.offsetHeight + 8 <= innerHeight
      ? summary.bottom + 4
      : summary.top - popover.offsetHeight - 4;
  popover.style.top = `${Math.max(8, top)}px`;
  popover.style.left = `${Math.max(8, Math.min(innerWidth - popover.offsetWidth - 8, summary.right - popover.offsetWidth))}px`;
}

export function bindDisclosureMenus(root) {
  const selector = '.sort-menu, .command-menu';
  const openMenus = () => [...root.querySelectorAll('.sort-menu[open], .command-menu[open]')];
  root.addEventListener(
    'toggle',
    (event) => {
      const menu = event.target;
      if (!menu.matches(selector)) return;
      if (!menu.open) {
        menu.contextPoint = null;
        return;
      }
      openMenus()
        .filter((other) => other !== menu)
        .forEach((other) => {
          other.open = false;
        });
      positionDisclosureMenu(menu);
    },
    true,
  );
  root.addEventListener('click', (event) => {
    if (!event.target.closest(selector))
      openMenus().forEach((menu) => {
        menu.open = false;
      });
  });
  window.addEventListener(
    'scroll',
    (event) => {
      if (event.target.closest?.(selector)) return;
      openMenus().forEach((menu) => {
        menu.open = false;
      });
    },
    true,
  );
  root.addEventListener('focusout', (event) => {
    const menu = event.target.closest(selector);
    if (menu && event.relatedTarget && !menu.contains(event.relatedTarget)) menu.open = false;
  });
  window.addEventListener('resize', () =>
    openMenus().forEach((menu) => {
      menu.open = false;
    }),
  );
  root.addEventListener('keydown', (event) => {
    const menu = event.target.closest(selector);
    if (menu?.open && event.key === 'Escape' && !event.target.closest('select')) {
      event.preventDefault();
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
}
