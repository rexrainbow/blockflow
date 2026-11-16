import { h, singleLine, replaceKeepingFocus } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { iconButton } from '../../ui/controls.js';
import { groupType } from '../../../lib/blockchart/group-type.js';
import { endpointKey } from '../../../lib/blockchart/endpoints.js';
import { targetEndpoints } from '../../../lib/blockchart/nets.js';
import { netTitle, netSummary, problems as listProblems } from '../state/actions.js';

const sameSel = (a, b) =>
  !!a && !!b && a.type === b.type &&
  (a.type === 'port' ? a.owner === b.owner && a.port === b.port : a.type === 'net' ? a.index === b.index && a.branch === b.branch : a.id === b.id);

export class Outline {
  constructor(store, callbacks) {
    this.store = store;
    this.cb = callbacks;
    this.filter = '';
    this.collapsed = new Set(store.prefs.collapsedGroups ?? []);
    this.openNets = new Set();
    this.sections = { blocks: true, terminals: true, nets: true, problems: true, ...(store.prefs.outlineSections ?? {}) };
    this.search = h('input', {
      class: 'input outline-filter',
      type: 'search',
      placeholder: 'Filter blocks, ports, nets…',
      'aria-label': 'Filter outline',
      oninput: (e) => {
        this.filter = e.target.value.trim().toLowerCase();
        this.render();
      },
      onkeydown: (e) => {
        if (e.key === 'ArrowDown') {
          this.body.querySelector('.row')?.focus();
          e.preventDefault();
        }
      },
    });
    this.body = h('div', { class: 'outline-body', role: 'tree', 'aria-label': 'Document outline' });
    this.el = h(
      'aside',
      { class: 'pane outline', 'aria-label': 'Outline' },
      h('div', { class: 'pane-head' }, h('h2', 'Outline'), h('div', { class: 'spacer' }), iconButton('plus', 'Add…', (e) => this.cb.addMenu(e.currentTarget), { shortcut: 'A' })),
      h('div', { class: 'outline-search' }, icon('search'), this.search),
      this.body,
    );
    this.body.addEventListener('keydown', (e) => this.keys(e));
  }

  match(...values) {
    if (!this.filter) return true;
    return values.some((v) => String(v ?? '').toLowerCase().includes(this.filter));
  }

  section(key, title, count, content, extra) {
    const open = this.sections[key] || Boolean(this.filter);
    return h(
      'section',
      { class: 'outline-section' },
      h(
        'div',
        { class: 'section-head' },
        h(
          'button',
          {
            type: 'button',
            class: 'section-toggle',
            'aria-expanded': String(open),
            onclick: () => {
              this.sections[key] = !this.sections[key];
              this.store.setPref('outlineSections', this.sections);
              this.render();
            },
          },
          icon(open ? 'chevronDown' : 'chevronRight', 12),
          h('span', title),
          h('span', { class: 'count' }, String(count)),
        ),
        extra ?? null,
      ),
      open ? content : null,
    );
  }

  row({ sel, depth = 0, label, key, ico, chevron, onChevron, warn, draggable, dropGroup, onDbl, title, tone, menuSel }) {
    const selected = sameSel(sel, this.store.selection) || (sel?.type === 'port' && this.store.multi.some((m) => m.owner === sel.owner && m.port === sel.port));
    const row = h(
      'div',
      {
        class: ['row', selected && 'selected', warn && 'warn', tone],
        role: 'treeitem',
        'aria-selected': String(selected),
        'aria-expanded': chevron ? String(chevron === 'open') : undefined,
        tabindex: selected ? '0' : '-1',
        title: title ?? undefined,
        style: { paddingLeft: 6 + depth * 14 + 'px' },
        'data-fid': 'row-' + JSON.stringify(sel),
        draggable: draggable ? 'true' : undefined,
        onclick: (e) => {
          if (e.target.closest('.row-menu, .chev')) return;
          this.cb.select(sel, { reveal: true, additive: e.shiftKey && sel?.type === 'port' });
        },
        ondblclick: onDbl,
        oncontextmenu: (e) => {
          e.preventDefault();
          this.cb.select(sel);
          this.cb.contextMenu(sel, { x: e.clientX, y: e.clientY });
        },
      },
      chevron
        ? h('button', { type: 'button', class: 'chev', tabindex: '-1', 'aria-label': chevron === 'open' ? 'Collapse' : 'Expand', onclick: onChevron }, icon(chevron === 'open' ? 'chevronDown' : 'chevronRight', 12))
        : h('span', { class: 'chev-space' }),
      ico,
      h('span', { class: 'row-label' }, label),
      key && key !== label ? h('span', { class: 'row-key' }, key) : null,
      h('button', {
        type: 'button',
        class: 'row-menu',
        tabindex: '-1',
        'aria-label': 'Actions for ' + label,
        onclick: (e) => {
          this.cb.select(menuSel ?? sel);
          this.cb.contextMenu(menuSel ?? sel, e.currentTarget);
        },
      }, icon('more')),
    );
    row._sel = sel;
    if (draggable) {
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-blockflow-item', sel.id);
        e.dataTransfer.effectAllowed = 'move';
        this.dragging = sel.id;
      });
      row.addEventListener('dragend', () => (this.dragging = null));
    }
    if (dropGroup !== undefined) {
      row.addEventListener('dragover', (e) => {
        if (!this.dragging || this.dragging === dropGroup) return;
        e.preventDefault();
        row.classList.add('drop-into');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-into'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drop-into');
        const id = e.dataTransfer.getData('application/x-blockflow-item');
        if (id && id !== dropGroup) this.cb.place(id, dropGroup);
      });
    }
    return row;
  }

  nodeIcon(item, isGroup) {
    if (isGroup) {
      const t = groupType(item);
      return h('span', { class: ['node-ico', 'grp', t], title: t[0].toUpperCase() + t.slice(1) + ' group' }, t === 'boundary' ? 'B' : t === 'collection' ? 'C' : '');
    }
    if (item.type === 'concat') return h('span', { class: 'node-ico concat', title: 'Concat' }, icon('concat', 12));
    return h('span', { class: 'node-ico blk' }, (item.label ?? item.id).trim().charAt(0));
  }

  blockRows(doc) {
    const groups = new Map((doc.groups ?? []).map((g) => [g.id, g]));
    const modules = new Map(doc.modules.map((m) => [m.id, m]));
    const nested = new Set((doc.groups ?? []).flatMap((g) => g.members));
    const roots = [...doc.modules, ...(doc.groups ?? [])].filter((n) => !nested.has(n.id)).map((n) => n.id);
    const rows = [];
    const subtreeMatches = (id) => {
      const g = groups.get(id),
        m = modules.get(id);
      const item = g ?? m;
      if (this.match(item.id, item.label, ...(item.ports ?? []).map((p) => p.id))) return true;
      return g ? g.members.some(subtreeMatches) : false;
    };
    const visit = (id, depth) => {
      if (!subtreeMatches(id)) return;
      const g = groups.get(id),
        item = g ?? modules.get(id);
      const open = !this.collapsed.has(id) || Boolean(this.filter);
      const sel = { type: g ? 'group' : 'block', id };
      rows.push(
        this.row({
          sel,
          depth,
          label: singleLine(item.label ?? item.id),
          key: item.id,
          ico: this.nodeIcon(item, Boolean(g)),
          chevron: g ? (open ? 'open' : 'closed') : null,
          onChevron: () => {
            if (this.collapsed.has(id)) this.collapsed.delete(id);
            else this.collapsed.add(id);
            this.store.setPref('collapsedGroups', [...this.collapsed]);
            this.render();
          },
          draggable: true,
          dropGroup: g ? id : undefined,
          onDbl: g ? () => this.cb.enterGroup(id) : () => this.cb.rename(sel),
        }),
      );
      if (g && open) for (const member of g.members) visit(member, depth + 1);
    };
    for (const id of roots) visit(id, 0);
    return rows;
  }

  render() {
    const doc = this.store.document;
    const out = [];
    const blockRows = this.blockRows(doc);
    const topDrop = h('div', { class: 'top-drop', title: 'Drop here to move to top level' }, 'Top level');
    topDrop.addEventListener('dragover', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      topDrop.classList.add('drop-into');
    });
    topDrop.addEventListener('dragleave', () => topDrop.classList.remove('drop-into'));
    topDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      topDrop.classList.remove('drop-into');
      const id = e.dataTransfer.getData('application/x-blockflow-item');
      if (id) this.cb.place(id, '');
    });
    out.push(
      this.section(
        'blocks',
        'Blocks',
        doc.modules.length + (doc.groups?.length ?? 0),
        h('div', { class: 'rows' }, blockRows.length ? blockRows : h('div', { class: 'empty-row' }, this.filter ? 'No matches' : 'No blocks yet'), topDrop),
      ),
    );
    const terminals = (doc.terminals ?? []).filter((t) => this.match(t.id, t.label));
    out.push(
      this.section(
        'terminals',
        'Terminals',
        doc.terminals?.length ?? 0,
        h(
          'div',
          { class: 'rows' },
          terminals.length
            ? terminals.map((t) =>
                this.row({
                  sel: { type: 'terminal', id: t.id },
                  label: singleLine(t.label ?? t.id),
                  key: t.id,
                  ico: h('span', { class: ['node-ico', 'term', t.direction] }, t.direction === 'input' ? 'IN' : 'OUT'),
                  onDbl: () => this.cb.rename({ type: 'terminal', id: t.id }),
                }),
              )
            : h('div', { class: 'empty-row' }, 'External inputs and outputs appear here'),
        ),
      ),
    );
    const netRows = [];
    for (const [index, net] of (doc.connections ?? []).entries()) {
      const targets = targetEndpoints(net).map(endpointKey);
      if (!this.match(net.id, net.label, endpointKey(net.from), ...targets)) continue;
      const multi = targets.length > 1;
      const open = this.openNets.has(index) || (Boolean(this.filter) && multi);
      const sel = { type: 'net', index };
      netRows.push(
        this.row({
          sel,
          label: netTitle(net),
          key: netSummary(net),
          ico: h('span', { class: ['node-ico', 'net', net.feedback && 'fb', net.direction === 'both' && 'both'], title: net.direction === 'both' ? 'Bidirectional net' : 'Net' }, icon('net', 12)),
          chevron: multi ? (open ? 'open' : 'closed') : null,
          onChevron: () => {
            if (this.openNets.has(index)) this.openNets.delete(index);
            else this.openNets.add(index);
            this.render();
          },
          onDbl: () => this.cb.rename(sel),
          title: `${endpointKey(net.from)} → ${targets.join(', ')}`,
        }),
      );
      if (multi && open)
        for (const [j, key] of targets.entries())
          netRows.push(
            this.row({
              sel: { type: 'net', index, branch: j },
              depth: 1,
              label: '→ ' + (key.startsWith('@terminal:') ? 'Terminal ' + key.slice(10) : key),
              ico: null,
              tone: 'branch',
              menuSel: { type: 'net', index, branch: j },
            }),
          );
    }
    out.push(this.section('nets', 'Nets', doc.connections?.length ?? 0, h('div', { class: 'rows' }, netRows.length ? netRows : h('div', { class: 'empty-row' }, this.filter ? 'No matches' : 'Drag from a port on the canvas to connect'))));
    const probs = listProblems(doc, this.store.layoutError, this.store.layout?.layout?.warnings ?? []);
    const shown = probs.filter((p) => this.match(p.message));
    const badge = probs.some((p) => p.level === 'error') ? 'error' : probs.some((p) => p.level === 'warn') ? 'warn' : 'info';
    out.push(
      this.section(
        'problems',
        'Problems',
        probs.length,
        h(
          'div',
          { class: 'rows' },
          shown.length
            ? shown.slice(0, 200).map((p) =>
                h(
                  'div',
                  {
                    class: ['row', 'problem', p.level],
                    role: 'treeitem',
                    tabindex: '-1',
                    onclick: () => p.select && this.cb.select(p.select, { reveal: true }),
                  },
                  h('span', { class: 'chev-space' }),
                  icon(p.level === 'error' ? 'error' : p.level === 'warn' ? 'warn' : 'port', 14),
                  h('span', { class: 'row-label' }, p.message),
                ),
              )
            : h('div', { class: 'empty-row' }, 'No problems'),
        ),
      ),
    );
    this.problemLevel = probs.length ? badge : null;
    replaceKeepingFocus(this.body, out);
  }

  revealSelection() {
    const sel = this.store.selection;
    if (!sel) return;
    let changed = false;
    if (sel.type === 'block' || sel.type === 'group' || sel.type === 'port') {
      const id = sel.type === 'port' ? sel.owner : sel.id;
      let parent = (this.store.document.groups ?? []).find((g) => g.members.includes(id));
      while (parent) {
        if (this.collapsed.delete(parent.id)) changed = true;
        const pid = parent.id;
        parent = (this.store.document.groups ?? []).find((g) => g.members.includes(pid));
      }
      if (!this.sections.blocks) (this.sections.blocks = true), (changed = true);
    }
    if (sel.type === 'net') {
      if (sel.branch !== undefined && !this.openNets.has(sel.index)) this.openNets.add(sel.index), (changed = true);
      if (!this.sections.nets) (this.sections.nets = true), (changed = true);
    }
    if (changed) this.render();
    this.body.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
  }

  showProblems() {
    this.sections.problems = true;
    this.render();
    this.body.querySelector('.row.problem')?.scrollIntoView({ block: 'center' });
  }

  keys(e) {
    const rows = [...this.body.querySelectorAll('.row')];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        next.focus();
        if (next._sel) this.cb.select(next._sel, { reveal: true, keepFocus: true });
      } else if (e.key === 'ArrowUp') this.search.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      rows[i].querySelector('.chev')?.click();
    } else if (e.key === 'Enter') rows[i].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
