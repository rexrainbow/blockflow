import { h } from './dom.js';
import { icon } from './icons.js';

let fidCounter = 0;
export const fid = (prefix = 'f') => `${prefix}-${++fidCounter}`;

export function iconButton(name, label, onclick, extra = {}) {
  return h(
    'button',
    { type: 'button', class: ['icon-btn', extra.class], title: label + (extra.shortcut ? ` (${extra.shortcut})` : ''), 'aria-label': label, onclick, ...extra.attrs, disabled: extra.disabled },
    icon(name),
  );
}

export function button(label, onclick, extra = {}) {
  return h(
    'button',
    {
      type: 'button',
      class: ['btn', extra.variant && `btn-${extra.variant}`, extra.class],
      onclick,
      title: extra.title,
      disabled: extra.disabled,
      ...extra.attrs,
    },
    extra.icon ? icon(extra.icon) : null,
    label ? h('span', label) : null,
  );
}

/** Field wrapper: label above control, optional hint/error below. */
export function field(label, control, extra = {}) {
  const id = control.id || (control.id = fid('c'));
  return h(
    'div',
    { class: ['field', extra.class, extra.error && 'has-error'] },
    h('label', { for: id, class: 'field-label' }, label, extra.badge ?? null),
    control,
    extra.error ? h('div', { class: 'field-error', role: 'alert' }, extra.error) : null,
    extra.hint ? h('div', { class: 'field-hint' }, extra.hint) : null,
  );
}

/**
 * Text input that commits on change/Enter and reverts on Escape.
 * commit(value) may throw; the message is shown inline and the draft is kept.
 */
export function textInput({ value = '', placeholder = '', commit, fidKey, mono = false, multiline = false, type = 'text', ariaLabel, min, step }) {
  const el = h(multiline ? 'textarea' : 'input', {
    class: ['input', mono && 'mono', multiline && 'multiline'],
    value: value ?? '',
    placeholder,
    type: multiline ? undefined : type,
    rows: multiline ? Math.min(6, Math.max(1, String(value ?? '').split('\n').length)) : undefined,
    spellcheck: 'false',
    'data-fid': fidKey,
    'aria-label': ariaLabel,
    min,
    step,
  });
  let original = value ?? '';
  const fail = (message) => {
    el.setAttribute('aria-invalid', message ? 'true' : 'false');
    el.title = message || '';
    el.closest('.field')?.classList.toggle('has-error', Boolean(message));
    let box = el.parentElement?.querySelector(':scope > .field-error');
    if (message) {
      if (!box) el.after((box = h('div', { class: 'field-error', role: 'alert' })));
      box.textContent = message;
    } else box?.remove();
  };
  const run = () => {
    if (el.value === original) return fail('');
    try {
      commit(el.value);
      original = el.value;
      fail('');
    } catch (error) {
      fail(error.message);
    }
  };
  el.addEventListener('change', run);
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      el.value = original;
      fail('');
      el.blur();
      event.stopPropagation();
    } else if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      run();
    }
  });
  if (multiline)
    el.addEventListener('input', () => {
      el.rows = Math.min(6, Math.max(1, el.value.split('\n').length));
    });
  return el;
}

export function select(options, value, onchange, extra = {}) {
  return h(
    'select',
    { class: ['input', 'select', extra.class], 'data-fid': extra.fidKey, 'aria-label': extra.ariaLabel, onchange: (event) => onchange(event.target.value), disabled: extra.disabled },
    options.map((option) =>
      h('option', { value: option.value, selected: option.value === value, disabled: option.disabled }, option.label),
    ),
  );
}

/** Segmented control for 2–4 mutually exclusive values. */
export function segmented(options, value, onchange, extra = {}) {
  return h(
    'div',
    { class: ['segmented', extra.class], role: 'radiogroup', 'aria-label': extra.ariaLabel },
    options.map((option) =>
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(option.value === value),
          class: option.value === value ? 'on' : '',
          title: option.title,
          disabled: option.disabled,
          'data-fid': extra.fidKey ? extra.fidKey + '-' + option.value : undefined,
          onclick: () => option.value !== value && onchange(option.value),
        },
        option.icon ? icon(option.icon) : null,
        option.label,
      ),
    ),
  );
}

export function toggle(label, checked, onchange, extra = {}) {
  const input = h('input', { type: 'checkbox', class: 'switch-input', checked, disabled: extra.disabled, 'data-fid': extra.fidKey, onchange: (event) => onchange(event.target.checked) });
  return h('label', { class: ['switch', extra.class], title: extra.title }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), h('span', { class: 'switch-label' }, label));
}

export function checkbox(label, checked, onchange, extra = {}) {
  return h(
    'label',
    { class: ['check', extra.class], title: extra.title },
    h('input', { type: 'checkbox', checked, disabled: extra.disabled, 'aria-label': extra.ariaLabel, 'data-fid': extra.fidKey, onchange: (event) => onchange(event.target.checked) }),
    label ? h('span', label) : null,
  );
}

/* ---------------- Popover menus ---------------- */
let openMenu = null;
export function closeMenu() {
  if (!openMenu) return;
  const { el, restore } = openMenu;
  openMenu = null;
  el.remove();
  restore?.focus?.({ preventScroll: true });
}

/**
 * items: [{label, icon, shortcut, action, danger, disabled, checked}|'-'|{heading}]
 * anchor: Element or {x,y}
 */
export function showMenu(anchor, items, extra = {}) {
  closeMenu();
  const restore = document.activeElement;
  const menu = h(
    'div',
    { class: 'menu', role: 'menu', 'aria-label': extra.label ?? 'Actions' },
    items.filter(Boolean).map((item) => {
      if (item === '-') return h('div', { class: 'menu-sep', role: 'separator' });
      if (item.heading) return h('div', { class: 'menu-heading' }, item.heading);
      return h(
        'button',
        {
          type: 'button',
          role: item.checked !== undefined ? 'menuitemradio' : 'menuitem',
          'aria-checked': item.checked !== undefined ? String(item.checked) : undefined,
          class: ['menu-item', item.danger && 'danger'],
          disabled: item.disabled,
          onclick: () => {
            closeMenu();
            item.action?.();
          },
        },
        h('span', { class: 'menu-icon' }, item.checked ? icon('check') : item.icon ? icon(item.icon) : null),
        h('span', { class: 'menu-label' }, item.label),
        item.shortcut ? h('kbd', item.shortcut) : null,
      );
    }),
  );
  document.body.append(menu);
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const w = menu.offsetWidth,
    hgt = menu.offsetHeight;
  let x = extra.align === 'right' ? rect.right - w : rect.left;
  // Open below the anchor, or above when only that side fits. A menu taller than either
  // side takes the roomier one and scrolls inside it, so every item stays reachable.
  const below = innerHeight - 8 - (rect.bottom + 4),
    above = rect.top - 4 - 8;
  const down = hgt <= below || (hgt > above && below >= above);
  const room = Math.max(0, down ? below : above);
  if (hgt > room) menu.style.maxHeight = room + 'px';
  const y = down ? rect.bottom + 4 : rect.top - 4 - Math.min(hgt, room);
  x = Math.max(8, Math.min(x, innerWidth - w - 8));
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  openMenu = { el: menu, restore };
  const buttons = () => [...menu.querySelectorAll('.menu-item:not(:disabled)')];
  buttons()[0]?.focus();
  menu.addEventListener('keydown', (event) => {
    const list = buttons(),
      index = list.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') list[(index + 1) % list.length]?.focus();
    else if (event.key === 'ArrowUp') list[(index - 1 + list.length) % list.length]?.focus();
    else if (event.key === 'Escape') closeMenu();
    else if (event.key === 'Tab') closeMenu();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  return menu;
}
addEventListener(
  'pointerdown',
  (event) => {
    if (openMenu && !openMenu.el.contains(event.target)) closeMenu();
  },
  true,
);
addEventListener('blur', () => closeMenu());

/* ---------------- Searchable combobox ---------------- */
/**
 * options: [{value,label,hint,disabled,reason,group}]
 * Renders an input that filters a listbox popup. onpick(value).
 */
export function combobox({ options, value, onpick, placeholder = 'Search…', fidKey, ariaLabel, compact = false }) {
  const current = options.find((option) => option.value === value);
  const input = h('input', {
    class: ['input', 'combo-input', compact && 'compact'],
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-autocomplete': 'list',
    'aria-label': ariaLabel,
    placeholder: current ? current.label : placeholder,
    value: current ? current.label : '',
    'data-fid': fidKey,
    spellcheck: 'false',
  });
  const wrap = h('div', { class: 'combo' }, input, h('span', { class: 'combo-caret', 'aria-hidden': 'true' }, icon('chevronDown')));
  let list = null,
    active = 0,
    shown = [];
  const close = () => {
    list?.remove();
    list = null;
    input.setAttribute('aria-expanded', 'false');
  };
  const pick = (option) => {
    if (!option || option.disabled) return;
    close();
    input.value = option.label;
    onpick(option.value);
  };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const showAll = current && input.value === current.label;
    shown = options.filter((option) => showAll || !q || (option.label + ' ' + (option.hint ?? '') + ' ' + option.value).toLowerCase().includes(q)).slice(0, 200);
    active = Math.max(0, Math.min(active, shown.length - 1));
    if (!list) {
      list = h('div', { class: 'combo-list', role: 'listbox' });
      document.body.append(list);
    }
    const r = input.getBoundingClientRect();
    list.style.left = r.left + 'px';
    list.style.minWidth = Math.max(r.width, 240) + 'px';
    const below = innerHeight - r.bottom;
    list.style.maxHeight = Math.max(160, Math.min(320, below > 200 ? below - 12 : r.top - 12)) + 'px';
    if (below > 200 || below > r.top) {
      list.style.top = r.bottom + 2 + 'px';
      list.style.bottom = '';
    } else {
      list.style.top = '';
      list.style.bottom = innerHeight - r.top + 2 + 'px';
    }
    let lastGroup = null;
    list.replaceChildren(
      ...(shown.length
        ? shown.flatMap((option, i) => {
            const nodes = [];
            if (option.group && option.group !== lastGroup) {
              lastGroup = option.group;
              nodes.push(h('div', { class: 'combo-group' }, option.group));
            }
            nodes.push(
              h(
                'div',
                {
                  role: 'option',
                  class: ['combo-option', i === active && 'active', option.disabled && 'disabled', option.value === value && 'current'],
                  'aria-selected': String(i === active),
                  'aria-disabled': String(Boolean(option.disabled)),
                  onpointerdown: (event) => {
                    event.preventDefault();
                    pick(option);
                  },
                },
                h('span', { class: 'combo-label' }, option.label),
                option.reason ? h('span', { class: 'combo-reason' }, option.reason) : option.hint ? h('span', { class: 'combo-hint' }, option.hint) : null,
              ),
            );
            return nodes;
          })
        : [h('div', { class: 'combo-empty' }, 'No matches')]),
    );
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('focus', () => {
    input.select();
    render();
  });
  input.addEventListener('input', () => {
    active = 0;
    render();
  });
  input.addEventListener('blur', () => {
    close();
    input.value = current ? current.label : '';
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!list) render();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      for (let n = 0; n < shown.length; n++) {
        active = (active + step + shown.length) % shown.length;
        if (!shown[active].disabled) break;
      }
      render();
    } else if (event.key === 'Enter') pick(shown[active]);
    else if (event.key === 'Escape') {
      if (!list) return;
      close();
      input.value = current ? current.label : '';
      event.stopPropagation();
    } else return;
    event.preventDefault();
  });
  return wrap;
}

/* ---------------- Modal dialog (rare: file replace, shortcuts) ---------------- */
export function modal({ title, body, actions = [], onclose, wide = false }) {
  const dialog = h('dialog', { class: ['modal', wide && 'wide'], 'aria-label': title });
  const close = () => {
    dialog.close();
    dialog.remove();
    onclose?.();
  };
  dialog.append(
    h('header', { class: 'modal-head' }, h('h2', title), (() => {
      const b = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close'));
      return b;
    })()),
    h('div', { class: 'modal-body' }, body),
    actions.length
      ? h(
          'footer',
          { class: 'modal-foot' },
          actions.map((action) =>
            button(action.label, () => {
              if (action.run?.() !== false) close();
            }, { variant: action.variant }),
          ),
        )
      : null,
  );
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close };
}
