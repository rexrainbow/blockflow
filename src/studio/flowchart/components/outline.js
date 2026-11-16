import { h, singleLine, replaceKeepingFocus } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { iconButton } from '../../ui/controls.js';
import { edgeKey, edgeTitle, findEdge, findGroup, findNode, parentOf, problems, selectionForPath, typeInfo, displayName } from '../state/actions.js';

const sameSel = (a, b) => !!a && !!b && a.type === b.type && (a.type === 'edge' ? a.key === b.key : a.id === b.id);
const DRAG_TYPE = 'application/x-blockflow-step';

/** Flowchart outline: steps by group (notes under their step), edges, problems. */
export class FlowchartOutline {
  constructor(store, callbacks) {
    this.store = store;
    this.cb = callbacks;
    this.filter = '';
    this.collapsed = new Set(store.prefs.flowCollapsedGroups ?? []);
    this.sections = { steps: true, edges: true, problems: true, ...(store.prefs.flowOutlineSections ?? {}) };
    this.search = h('input', {
      class: 'input outline-filter',
      type: 'search',
      placeholder: 'Filter steps, groups, edges…',
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
    this.body = h('div', { class: 'outline-body', role: 'tree', 'aria-label': 'Flowchart outline' });
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

  section(key, title, count, content) {
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
              this.store.setPref(this.sectionsPref ?? 'flowOutlineSections', this.sections);
              this.render();
            },
          },
          icon(open ? 'chevronDown' : 'chevronRight', 12),
          h('span', title),
          h('span', { class: 'count' }, String(count)),
        ),
      ),
      open ? content : null,
    );
  }

  row({ sel, depth = 0, label, key, ico, chevron, onChevron, draggable, dropGroup, title, tone }) {
    const selected = sameSel(sel, this.store.selection);
    const row = h(
      'div',
      {
        class: ['row', selected && 'selected', tone],
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
          this.cb.select(sel, { reveal: true });
        },
        ondblclick: () => this.cb.rename(sel),
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
          this.cb.select(sel);
          this.cb.contextMenu(sel, e.currentTarget);
        },
      }, icon('more')),
    );
    row._sel = sel;
    if (draggable) {
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData(DRAG_TYPE, sel.id);
        e.dataTransfer.effectAllowed = 'move';
        this.dragging = sel.id;
      });
      row.addEventListener('dragend', () => (this.dragging = null));
    }
    if (dropGroup !== undefined) this.dropTarget(row, dropGroup);
    return row;
  }

  dropTarget(el, group) {
    el.addEventListener('dragover', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      el.classList.add('drop-into');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-into'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-into');
      const id = e.dataTransfer.getData(DRAG_TYPE);
      if (id) this.cb.place(id, group);
    });
  }

  ico(type) {
    const t = typeInfo(type);
    return h('span', { class: ['node-ico', 'flow', 'flow-' + t.value], title: t.label }, icon(t.icon, 12));
  }

  stepRows(doc) {
    const nested = new Set((doc.groups ?? []).flatMap((g) => g.members));
    const notes = new Map(doc.nodes.filter((n) => n.type === 'note' && n.attachTo).map((n) => [n.attachTo, n]));
    const attached = new Set([...notes.values()].map((n) => n.id));
    const roots = [...doc.nodes.map((n) => n.id), ...(doc.groups ?? []).map((g) => g.id)].filter((id) => !nested.has(id));
    const rows = [];
    const subtreeMatches = (id) => {
      const g = findGroup(doc, id);
      const item = g ?? findNode(doc, id);
      if (this.match(item.id, item.label, notes.get(id)?.label)) return true;
      return g ? g.members.some(subtreeMatches) : false;
    };
    const visit = (id, depth) => {
      if (attached.has(id) || !subtreeMatches(id)) return;
      const g = findGroup(doc, id);
      if (g) {
        const open = !this.collapsed.has(id) || Boolean(this.filter);
        rows.push(
          this.row({
            sel: { type: 'group', id },
            depth,
            label: singleLine(g.label ?? g.id),
            key: g.id,
            ico: h('span', { class: ['node-ico', 'grp', 'container'], title: 'Group' }),
            chevron: open ? 'open' : 'closed',
            onChevron: () => {
              if (this.collapsed.has(id)) this.collapsed.delete(id);
              else this.collapsed.add(id);
              this.store.setPref('flowCollapsedGroups', [...this.collapsed]);
              this.render();
            },
            dropGroup: id,
            draggable: true,
          }),
        );
        if (open) for (const member of g.members) visit(member, depth + 1);
        return;
      }
      const n = findNode(doc, id);
      rows.push(this.row({ sel: { type: 'node', id }, depth, label: singleLine(n.label ?? n.id), key: n.id, ico: this.ico(n.type), draggable: n.type !== 'note' }));
      const note = notes.get(id);
      if (note) rows.push(this.row({ sel: { type: 'node', id: note.id }, depth: depth + 1, label: singleLine(note.label ?? note.id), key: note.id, ico: this.ico('note'), tone: 'branch' }));
    };
    for (const id of roots) visit(id, 0);
    // Notes whose owner the runtime infers from an association are listed at their place.
    return rows;
  }

  render() {
    const doc = this.store.document;
    const out = [];
    const rows = this.stepRows(doc);
    const topDrop = h('div', { class: 'top-drop', title: 'Drop here to move to top level' }, 'Top level');
    this.dropTarget(topDrop, '');
    out.push(this.section('steps', 'Steps', doc.nodes.length + (doc.groups?.length ?? 0), h('div', { class: 'rows' }, rows.length ? rows : h('div', { class: 'empty-row' }, 'No matches'), doc.groups?.length ? topDrop : null)));
    const edgeRows = [];
    for (const [i, e] of doc.edges.entries()) {
      const title = edgeTitle(doc, e);
      if (!this.match(e.id, e.label, title, e.from, e.to)) continue;
      const kind = e.kind ?? 'flow';
      edgeRows.push(
        this.row({
          sel: { type: 'edge', key: edgeKey(e, i) },
          label: e.label ? singleLine(e.label) : title,
          key: e.label ? title : kind !== 'flow' ? kind : '',
          title: `${e.from} → ${e.to}${kind !== 'flow' ? ' (' + kind + ')' : ''}`,
          ico: h('span', { class: ['node-ico', 'net', kind === 'loop' && 'fb'], title: kind[0].toUpperCase() + kind.slice(1) }, icon('edge', 12)),
        }),
      );
    }
    out.push(this.section('edges', 'Edges', doc.edges.length, h('div', { class: 'rows' }, edgeRows.length ? edgeRows : h('div', { class: 'empty-row' }, this.filter ? 'No matches' : 'Drag from a step’s handle to connect'))));
    const probs = problems(this.store).filter((p) => this.match(p.message));
    out.push(
      this.section(
        'problems',
        'Problems',
        probs.length,
        h(
          'div',
          { class: 'rows' },
          probs.length
            ? probs.map((p) => {
                const select = selectionForPath(doc, p.path) ?? (p.edge ? { type: 'edge', key: p.edge } : p.node ? { type: 'node', id: p.node } : null);
                return h(
                  'div',
                  { class: ['row', 'problem', p.kind], role: 'treeitem', tabindex: '-1', onclick: () => select && this.cb.select(select, { reveal: true }) },
                  h('span', { class: 'chev-space' }),
                  icon(p.kind === 'error' ? 'error' : 'warn', 14),
                  this.problemText(doc, p, select),
                );
              })
            : h('div', { class: 'empty-row' }, 'No problems'),
        ),
      ),
    );
    replaceKeepingFocus(this.body, out);
  }

  /** Item first, then the message: several warnings can share one message. */
  problemText(doc, p, select) {
    const item = select ? this.problemItem(doc, select) : '';
    return h(
      'span',
      { class: 'problem-text' },
      item ? h('span', { class: 'problem-item', title: item }, item) : null,
      h('span', { class: 'row-label' }, p.message),
    );
  }

  /** A short name for the item a problem points at (an edge's ends and label, or a step). */
  problemItem(doc, sel) {
    if (sel.type === 'edge') {
      const edge = this.edgeOf(doc, sel.key);
      if (!edge) return sel.key;
      const label = edge.label ? ` (${edge.label.replace(/\s+/g, ' ').trim()})` : '';
      return this.edgeName(doc, edge) + label;
    }
    if (sel.type === 'node') return this.nodeName(doc, sel.id);
    return sel.id ?? '';
  }

  edgeOf(doc, key) {
    return findEdge(doc, key);
  }

  edgeName(doc, edge) {
    return edgeTitle(doc, edge);
  }

  nodeName(doc, id) {
    return displayName(findNode(doc, id) ?? { id });
  }

  revealSelection() {
    const sel = this.store.selection;
    if (!sel) return;
    let changed = false;
    if (sel.type === 'node' || sel.type === 'group') {
      for (let p = parentOf(this.store.document, sel.id); p; p = parentOf(this.store.document, p)) if (this.collapsed.delete(p)) changed = true;
      if (!this.sections.steps) (this.sections.steps = true), (changed = true);
    }
    if (sel.type === 'edge' && !this.sections.edges) (this.sections.edges = true), (changed = true);
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
        if (next._sel) this.cb.select(next._sel, { reveal: true });
      } else if (e.key === 'ArrowUp') this.search.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') rows[i].querySelector('.chev')?.click();
    else if (e.key === 'Enter') rows[i].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
