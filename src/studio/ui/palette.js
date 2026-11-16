import { h } from './dom.js';
import { icon } from './icons.js';

/** Ctrl/Cmd+K command palette: run commands or jump to any item. */
export class CommandPalette {
  constructor(source) {
    this.source = source;
    this.isOpen = false;
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    const restore = document.activeElement;
    const input = h('input', { class: 'palette-input', placeholder: 'Type a command or an item name…', 'aria-label': 'Command', role: 'combobox', 'aria-expanded': 'true', spellcheck: 'false' });
    const list = h('div', { class: 'palette-list', role: 'listbox' });
    const box = h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' }, h('div', { class: 'palette-search' }, icon('search'), input), list);
    const backdrop = h('div', { class: 'palette-backdrop' }, box);
    document.body.append(backdrop);
    const all = this.source().filter((c) => !c.disabled);
    let shown = [],
      active = 0;
    const close = () => {
      this.isOpen = false;
      backdrop.remove();
      restore?.focus?.({ preventScroll: true });
    };
    const run = (c) => {
      close();
      c?.run();
    };
    const score = (c, q) => {
      const text = (c.label + ' ' + (c.hint ?? '')).toLowerCase();
      if (!q) return c.group === 'Go to' || c.group === 'Open view' || c.group === 'Examples' ? -1 : 1;
      if (text.startsWith(q)) return 3;
      if (text.includes(' ' + q)) return 2;
      if (text.includes(q)) return 1;
      let i = 0;
      for (const ch of text) if (ch === q[i]) i++;
      return i === q.length ? 0.5 : -1;
    };
    const render = () => {
      const q = input.value.trim().toLowerCase();
      shown = all
        .map((c) => ({ c, s: score(c, q) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 60)
        .map((x) => x.c);
      active = Math.min(active, Math.max(0, shown.length - 1));
      let group = null;
      list.replaceChildren(
        ...(shown.length
          ? shown.flatMap((c, i) => {
              const out = [];
              if (c.group !== group) {
                group = c.group;
                out.push(h('div', { class: 'palette-group' }, group));
              }
              out.push(
                h(
                  'div',
                  { role: 'option', class: ['palette-item', i === active && 'active'], 'aria-selected': String(i === active), onpointerdown: (e) => (e.preventDefault(), run(c)), onpointermove: () => { if (active !== i) { active = i; render(); } } },
                  icon(c.icon ?? 'block', 14),
                  h('span', { class: 'palette-label' }, c.label),
                  c.hint ? h('span', { class: 'palette-hint' }, c.hint) : null,
                  c.shortcut ? h('kbd', c.shortcut) : null,
                ),
              );
              return out;
            })
          : [h('div', { class: 'palette-empty' }, 'No matching command')]),
      );
      list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => {
      active = 0;
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') active = Math.min(shown.length - 1, active + 1);
      else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
      else if (e.key === 'Enter') return run(shown[active]);
      else if (e.key === 'Escape') {
        e.stopPropagation();
        return close();
      }
      else return;
      e.preventDefault();
      render();
    });
    backdrop.addEventListener('pointerdown', (e) => e.target === backdrop && close());
    render();
    input.focus();
  }
}
