import { h, modKey } from '../ui/dom.js';
import { showMenu } from '../ui/controls.js';
import { StudioShell } from '../core/shell.js';
import { FlowchartStore } from './state/store.js';
import { FlowchartCanvas } from './components/canvas.js';
import { FlowchartOutline } from './components/outline.js';
import { FlowchartInspector } from './components/inspector.js';
import { LayoutService } from '../../editor/flowchart/services/layout.js';
import {
  emptyDocument,
  validateDocument,
  addNode,
  removeNode,
  addEdge,
  removeEdge,
  reconnectEdge,
  addGroup,
  ungroup,
  placeNode,
  placeGroup,
  attachNote,
} from '../../editor/flowchart/commands.js';
import {
  NODE_TYPES,
  NOTE_TYPE,
  swap,
  edgeKey,
  findEdge,
  findNode,
  findGroup,
  parentOf,
  displayName,
  edgeTitle,
  noteOf,
  moveTargets,
  typeInfo,
  setDirection,
} from './state/actions.js';
import { EXAMPLES } from './examples.js';

const newIds = (before, after) => after.filter((x) => !before.some((y) => y.id === x.id)).map((x) => x.id);

/**
 * Flowchart editor session. Structural edits use the runtime commands (each returns a new
 * validated document, committed as one undoable change); simple properties are written
 * directly and validated by the store. Layout and SVG come from the Flowchart Worker and
 * equal convertFlowchart output, so the canvas is the export.
 */
export class FlowchartStudio extends StudioShell {
  get kind() {
    return 'flowchart';
  }

  createParts(initial) {
    this.store = new FlowchartStore(initial ?? structuredClone(EXAMPLES[0].document));
    const cb = {
      select: (sel, opts) => this.select(sel, opts),
      commit: (fn, message) => this.commit(fn, message),
      notify: (m, kind) => this.notify(m, kind),
      remove: (sel) => this.remove(sel),
      run: (cmd, arg) => this.run(cmd, arg),
      contextMenu: (sel, at) => this.contextMenu(sel, at),
      addMenu: (anchor) => this.addMenu(anchor),
      place: (id, group) => this.place(id, group),
      rename: (sel, value) => (value === undefined ? this.startRename(sel) : this.rename(sel, value)),
      connect: (from, to) => this.connect(from, to),
      addNext: (from, group) => this.addNext(from, group),
      reconnect: (key, end, node) => this.reconnect(key, end, node),
      attachNote: (note, owner) => this.attach(note, owner),
      labelFor: (sel) => this.labelFor(sel),
      toolbarItems: (sel) => this.toolbarItems(sel),
    };
    this.canvas = new FlowchartCanvas(this.store, cb);
    this.outline = new FlowchartOutline(this.store, cb);
    this.inspector = new FlowchartInspector(this.store, cb);
    this.layoutService = new LayoutService((result) => this.onLayout(result));
  }

  emptyDocument() {
    return emptyDocument();
  }

  validateDocument(document) {
    return validateDocument(document);
  }

  countText() {
    const doc = this.store.document;
    return `${doc.nodes.length} steps · ${doc.edges.length} edges`;
  }

  statusHint() {
    return 'Drag a step’s handle to connect · Double-click to rename';
  }

  shortcutRows() {
    return [
      ['Add step · next step after the selected one', 'N'],
      ['Group the selected step', 'G'],
      ['Add menu', 'A'],
    ];
  }

  renderCanvasHead() {
    this.crumbs.replaceChildren();
    const dir = this.store.document.layout?.direction ?? 'down';
    this.dirSeg.replaceChildren(
      h(
        'div',
        { class: 'segmented small', role: 'radiogroup', 'aria-label': 'Flow direction' },
        [
          ['down', '↓', 'Flow top to bottom'],
          ['right', '→', 'Flow left to right'],
          ['up', '↑', 'Flow bottom to top'],
          ['left', '←', 'Flow right to left'],
        ].map(([v, t, title]) =>
          h('button', {
            type: 'button',
            role: 'radio',
            'aria-checked': String(dir === v),
            'aria-label': title,
            class: dir === v ? 'on' : '',
            title,
            onclick: () => dir !== v && this.changeDirection(v),
          }, t),
        ),
      ),
    );
  }

  /** Flow direction as one change; a loop side that no longer lies across the flow resets to Auto. */
  changeDirection(direction) {
    const dropped = this.tryCommit((d) => setDirection((d.layout ??= {}), direction));
    if (dropped) this.notify(`Loops now choose their side automatically: ${dropped} is not across a ${direction} flow.`, 'info', this.undoAction());
  }

  /* ---------------- edits ---------------- */
  /** A runtime command as one undoable change; returns the new document. */
  command(fn, message) {
    let next;
    this.commit((d) => swap(d, (next = fn(d))), message);
    return next;
  }

  tryCommand(fn, message) {
    try {
      return this.command(fn, message);
    } catch (error) {
      this.notify(error.message, 'error');
      return undefined;
    }
  }

  undoAction() {
    return { label: 'Undo', run: () => this.undo() };
  }

  /** Group a new step goes into: the selected group, or the selected step's group. */
  parentForNew() {
    const sel = this.store.selection;
    const doc = this.store.document;
    if (sel?.type === 'group') return sel.id;
    if (sel?.type === 'node') return parentOf(doc, sel.id);
    return null;
  }

  addStep(props = {}, group = this.parentForNew()) {
    const before = this.store.document.nodes;
    const next = this.tryCommand((d) => addNode(d, props, group));
    if (!next) return;
    const id = newIds(before, next.nodes)[0];
    this.store.select({ type: 'node', id });
    this.notify(`Added ${typeInfo(props.type).label.toLowerCase()} ${id}${group ? ' in ' + displayName(findGroup(next, group)) : ''}.`, 'info', this.undoAction());
    this.renameAfterLayout(id);
  }

  /** Adds a step after `from`, connected to it, in one undoable change. */
  addNext(from, group, props = {}) {
    const doc = this.store.document;
    const target = group === undefined ? parentOf(doc, from) : group || null;
    let id;
    const next = this.tryCommand((d) => {
      const withNode = addNode(d, props, target);
      id = newIds(d.nodes, withNode.nodes)[0];
      return addEdge(withNode, from, id);
    });
    if (!next) return;
    this.store.select({ type: 'node', id });
    this.notify(`Added ${id} after ${displayName(findNode(next, from))}.`, 'info', this.undoAction());
    this.renameAfterLayout(id);
  }

  /** Opens the inline label editor on a new step once the layout has placed it. */
  renameAfterLayout(id) {
    this.pendingRename = id;
  }

  onLayout(result) {
    super.onLayout(result);
    const id = this.pendingRename;
    if (!id || this.store.layoutPending) return;
    this.pendingRename = null;
    const sel = this.store.selection;
    if (!result.error && sel?.type === 'node' && sel.id === id && this.canvas.layout?.nodes.some((n) => n.id === id)) {
      this.canvas.revealSelection();
      this.canvas.startRename(sel);
    }
  }

  connect(from, to) {
    const before = this.store.document.edges;
    const next = this.tryCommand((d) => addEdge(d, from, to));
    if (!next) return;
    const i = next.edges.length - 1;
    this.store.select({ type: 'edge', key: edgeKey(next.edges[i], i) });
    this.notify(`Connected ${edgeTitle(next, next.edges[i])}.`, 'info', this.undoAction());
    void before;
  }

  reconnect(key, end, node) {
    if (this.tryCommand((d) => reconnectEdge(d, key, end, node))) {
      this.store.select({ type: 'edge', key });
      this.notify(`Edge now ${end === 'from' ? 'leaves' : 'goes to'} ${displayName(findNode(this.store.document, node))}.`, 'info', this.undoAction());
    }
  }

  attach(note, owner) {
    if (this.tryCommand((d) => attachNote(d, note, owner))) {
      this.store.select({ type: 'node', id: note });
      this.notify(`Note attached to ${displayName(findNode(this.store.document, owner))}.`, 'info', this.undoAction());
    }
  }

  addNote(owner) {
    const doc = this.store.document;
    const existing = noteOf(doc, owner);
    if (existing) return this.select({ type: 'node', id: existing }, { reveal: true });
    this.addStep({ type: 'note', label: 'Note', attachTo: owner }, parentOf(doc, owner));
  }

  place(id, group) {
    const doc = this.store.document;
    if ((parentOf(doc, id) ?? '') === (group ?? '')) return;
    const isGroup = Boolean(findGroup(doc, id));
    const name = displayName(findNode(doc, id) ?? findGroup(doc, id));
    if (this.tryCommand((d) => (isGroup ? placeGroup : placeNode)(d, id, group || null))) {
      this.notify(`Moved ${name} into ${group ? displayName(findGroup(this.store.document, group)) : 'the top level'}.`, 'info', this.undoAction());
      this.store.select({ type: isGroup ? 'group' : 'node', id });
    }
  }

  groupSelection() {
    const sel = this.store.selection;
    if (sel?.type !== 'node' && sel?.type !== 'group') return this.notify('Select a step or group to group it.', 'error');
    const doc = this.store.document;
    const note = sel.type === 'node' && findNode(doc, sel.id).type === 'note';
    const id = note ? findNode(doc, sel.id).attachTo ?? sel.id : sel.id;
    const before = doc.groups ?? [];
    const next = this.tryCommand((d) => addGroup(d, [id], parentOf(d, id)));
    if (!next) return;
    const gid = newIds(before, next.groups ?? [])[0];
    this.store.select({ type: 'group', id: gid });
    this.notify(`Grouped into ${gid}. Drag more steps onto it.`, 'info', this.undoAction());
  }

  remove(sel) {
    if (!sel) return;
    const doc = this.store.document;
    if (sel.type === 'node') {
      const n = findNode(doc, sel.id);
      const note = n.type !== 'note' && noteOf(doc, n.id);
      if (this.tryCommand((d) => removeNode(d, sel.id))) {
        this.notify(`Deleted ${displayName(n)}${note ? ' and its note' : ''}.`, 'info', this.undoAction());
      }
    } else if (sel.type === 'edge') {
      const e = findEdge(doc, sel.key);
      if (this.tryCommand((d) => removeEdge(d, sel.key))) {
        this.notify(`Deleted edge ${edgeTitle(doc, e)}.`, 'info', this.undoAction());
      }
    } else if (sel.type === 'group') {
      if (this.tryCommand((d) => ungroup(d, sel.id))) {
        this.notify(`Ungrouped ${sel.id}; its members stay.`, 'info', this.undoAction());
      }
    }
  }

  /** Deletes a group and every step inside it (with their notes and edges) in one change. */
  removeGroupDeep(id) {
    const doc = this.store.document;
    const steps = [];
    const visit = (gid) => findGroup(doc, gid).members.forEach((m) => (findGroup(doc, m) ? visit(m) : steps.push(m)));
    visit(id);
    const next = this.tryCommand((d) => steps.filter((s) => findNode(d, s)?.type !== 'note').reduce((acc, s) => (findNode(acc, s) ? removeNode(acc, s) : acc), d));
    if (next) {
      this.store.select(null);
      this.notify(`Deleted ${id} and its ${steps.length} step${steps.length === 1 ? '' : 's'}.`, 'info', this.undoAction());
    }
  }

  reverse(key) {
    this.tryCommit((d) => {
      const e = findEdge(d, key);
      [e.from, e.to] = [e.to, e.from];
      const sides = [e.fromSide, e.toSide];
      delete e.fromSide;
      delete e.toSide;
      if (sides[1]) e.fromSide = sides[1];
      if (sides[0]) e.toSide = sides[0];
    }, 'Reversed the edge.');
  }

  labelFor(sel) {
    const doc = this.store.document;
    if (sel.type === 'node') return findNode(doc, sel.id)?.label ?? sel.id;
    if (sel.type === 'group') return findGroup(doc, sel.id)?.label ?? sel.id;
    if (sel.type === 'edge') return findEdge(doc, sel.key)?.label ?? '';
    return '';
  }

  rename(sel, value) {
    const text = value.trim() ? value.replace(/\r\n?/g, '\n').replace(/\s+$/, '') : undefined;
    this.tryCommit((d) => {
      const item = sel.type === 'node' ? findNode(d, sel.id) : sel.type === 'group' ? findGroup(d, sel.id) : sel.type === 'edge' ? findEdge(d, sel.key) : null;
      if (!item) return;
      if (text === undefined) delete item.label;
      else item.label = text;
    });
  }

  /* ---------------- commands ---------------- */
  runDomain(cmd, arg) {
    const sel = this.store.selection;
    switch (cmd) {
      case 'set-direction':
        return this.changeDirection(arg);
      case 'add-node':
        return this.addStep(arg ? { type: arg } : {});
      case 'add-node-in':
        return this.addStep({}, arg);
      case 'add-next': {
        const from = arg ?? (sel?.type === 'node' ? sel.id : null);
        return from ? this.addNext(from) : this.addStep();
      }
      case 'add-note':
        return this.addNote(arg ?? sel?.id);
      case 'group':
      case 'add-group':
        return this.groupSelection();
      case 'delete-group-deep':
        return this.removeGroupDeep(arg ?? sel?.id);
      default:
        return undefined;
    }
  }

  domainKey(e, { mod, sel }) {
    if (mod) {
      if (e.key.toLowerCase() === 'g') return this.groupSelection(), true;
      return false;
    }
    const key = e.key.toLowerCase();
    if (key === 'n') return this.run('add-next'), true;
    if (key === 'g') return this.groupSelection(), true;
    void sel;
    return false;
  }

  domainCommands() {
    const sel = this.store.selection;
    const node = sel?.type === 'node' ? findNode(this.store.document, sel.id) : null;
    return [
      ...NODE_TYPES.map((t) => ({ group: 'Create', label: 'Add ' + t.label.toLowerCase(), icon: t.icon, run: () => this.run('add-node', t.value) })),
      node && node.type !== 'note' ? { group: 'Create', label: 'Add next step after ' + displayName(node), icon: 'nextStep', shortcut: 'N', run: () => this.run('add-next') } : null,
      node && node.type !== 'note' ? { group: 'Create', label: 'Add note to ' + displayName(node), icon: 'note', run: () => this.run('add-note') } : null,
      sel?.type === 'node' || sel?.type === 'group' ? { group: 'Edit', label: 'Group selection', icon: 'group', shortcut: 'G', run: () => this.run('group') } : null,
    ];
  }

  gotoCommands() {
    const doc = this.store.document;
    return [
      ...doc.nodes.map((n) => ({ group: 'Go to', label: displayName(n), hint: n.id, icon: typeInfo(n.type).icon, run: () => this.select({ type: 'node', id: n.id }, { reveal: true, zoom: true }) })),
      ...(doc.groups ?? []).map((g) => ({ group: 'Go to', label: displayName(g), hint: g.id, icon: 'group', run: () => this.select({ type: 'group', id: g.id }, { reveal: true, zoom: true }) })),
      ...doc.edges.map((e, i) => ({ group: 'Go to', label: e.label ? `${displayName({ label: e.label })} (${edgeTitle(doc, e)})` : edgeTitle(doc, e), hint: edgeKey(e, i), icon: 'edge', run: () => this.select({ type: 'edge', key: edgeKey(e, i) }, { reveal: true, zoom: true }) })),
    ];
  }

  /* ---------------- menus ---------------- */
  addMenu(anchor) {
    const sel = this.store.selection;
    const node = sel?.type === 'node' ? findNode(this.store.document, sel.id) : null;
    showMenu(anchor, [
      { heading: 'Step' },
      ...NODE_TYPES.map((t) => ({ label: t.label, icon: t.icon, action: () => this.run('add-node', t.value) })),
      '-',
      { label: node && node.type !== 'note' ? 'Note on ' + displayName(node) : 'Note (select a step first)', icon: NOTE_TYPE.icon, disabled: !node || node.type === 'note', action: () => this.run('add-note') },
      { label: 'Group selection', icon: 'group', shortcut: 'G', disabled: !sel || sel.type === 'edge', action: () => this.run('group') },
    ], { label: 'Add' });
  }

  typeMenu(id) {
    const n = findNode(this.store.document, id);
    showMenu(this.menuAt ?? this.root, [
      { heading: 'Change type' },
      ...NODE_TYPES.map((t) => ({
        label: t.label,
        icon: t.icon,
        checked: (n.type ?? 'process') === t.value,
        action: () => this.tryCommit((d) => (t.value === 'process' ? delete findNode(d, id).type : (findNode(d, id).type = t.value))),
      })),
    ], { label: 'Type' });
  }

  moveToItem(id) {
    const targets = moveTargets(this.store.document, id);
    return {
      label: 'Move to…',
      icon: 'up',
      disabled: targets.length < 2,
      action: () =>
        showMenu(this.menuAt ?? this.root, [
          { heading: 'Move ' + displayName(findNode(this.store.document, id) ?? findGroup(this.store.document, id)) + ' into' },
          ...targets.map((t) => ({ label: '  '.repeat(Math.max(0, t.depth - 1)) + t.label, checked: t.current, disabled: t.current, action: () => this.place(id, t.id) })),
        ], { label: 'Move to' }),
    };
  }

  attachMenu(id) {
    const doc = this.store.document;
    const owner = findNode(doc, id).attachTo;
    showMenu(this.menuAt ?? this.root, [
      { heading: 'Attach note to' },
      ...doc.nodes.filter((n) => n.type !== 'note').map((n) => ({ label: displayName(n), checked: n.id === owner, disabled: n.id === owner || Boolean(noteOf(doc, n.id)), action: () => this.attach(id, n.id) })),
    ], { label: 'Attach to' });
  }

  menuItems(sel) {
    const doc = this.store.document;
    if (!sel)
      return [
        ...NODE_TYPES.slice(0, 2).map((t) => ({ label: 'Add ' + t.label.toLowerCase(), icon: t.icon, action: () => this.run('add-node', t.value) })),
        { label: 'Add other step…', icon: 'plus', action: () => this.addMenu(this.menuAt) },
        '-',
        { label: 'Fit diagram', icon: 'fit', action: () => this.run('fit') },
      ];
    const common = [
      { label: 'Rename', icon: 'pen', shortcut: 'F2', action: () => this.startRename(sel) },
      { label: 'Edit style', icon: 'style', action: () => this.inspector.setTab('style') },
    ];
    if (sel.type === 'node') {
      const n = findNode(doc, sel.id);
      if (n.type === 'note')
        return [...common, { label: 'Attach to…', icon: 'link', action: () => this.attachMenu(sel.id) }, '-', { label: 'Delete note', icon: 'trash', shortcut: 'Del', danger: true, action: () => this.remove(sel) }];
      const note = noteOf(doc, sel.id);
      return [
        ...common,
        { label: 'Add next step', icon: 'nextStep', shortcut: 'N', action: () => this.run('add-next', sel.id) },
        note ? { label: 'Go to note', icon: 'note', action: () => this.select({ type: 'node', id: note }, { reveal: true }) } : { label: 'Add note', icon: 'note', action: () => this.run('add-note', sel.id) },
        { label: 'Change type…', icon: typeInfo(n.type).icon, action: () => this.typeMenu(sel.id) },
        '-',
        { label: 'Group', icon: 'group', shortcut: 'G', action: () => this.run('group') },
        this.moveToItem(sel.id),
        '-',
        { label: 'Delete', icon: 'trash', shortcut: 'Del', danger: true, disabled: doc.nodes.length < 2, action: () => this.remove(sel) },
      ];
    }
    if (sel.type === 'edge')
      return [
        { label: 'Edit label', icon: 'pen', shortcut: 'F2', action: () => this.startRename(sel) },
        { label: 'Edit style', icon: 'style', action: () => this.inspector.setTab('style') },
        { label: 'Reverse direction', icon: 'redo', action: () => this.reverse(sel.key) },
        '-',
        { label: 'Delete edge', icon: 'trash', shortcut: 'Del', danger: true, action: () => this.remove(sel) },
      ];
    if (sel.type === 'group')
      return [
        ...common,
        { label: 'Add step inside', icon: 'plus', action: () => this.run('add-node-in', sel.id) },
        { label: 'Group', icon: 'group', action: () => this.run('group') },
        this.moveToItem(sel.id),
        '-',
        { label: 'Ungroup', icon: 'ungroup', action: () => this.remove(sel) },
        { label: 'Delete with contents', icon: 'trash', danger: true, action: () => this.run('delete-group-deep', sel.id) },
      ];
    return [];
  }

  toolbarItems(sel) {
    const doc = this.store.document;
    if (sel.type === 'node') {
      const n = findNode(doc, sel.id);
      if (!n) return [];
      if (n.type === 'note')
        return [
          { icon: 'pen', label: 'Rename', shortcut: 'F2', action: () => this.startRename(sel) },
          { icon: 'link', label: 'Attach to another step', action: (e) => ((this.menuAt = e.currentTarget), this.attachMenu(sel.id)) },
          '-',
          { icon: 'trash', label: 'Delete note', danger: true, action: () => this.remove(sel) },
        ];
      return [
        { icon: 'pen', label: 'Rename', shortcut: 'F2', action: () => this.startRename(sel) },
        { icon: 'nextStep', label: 'Add next step', shortcut: 'N', text: 'Next', action: () => this.run('add-next', sel.id) },
        { icon: typeInfo(n.type).icon, label: 'Change type', action: (e) => ((this.menuAt = e.currentTarget), this.typeMenu(sel.id)) },
        { icon: 'note', label: noteOf(doc, sel.id) ? 'Go to note' : 'Add note', action: () => this.run('add-note', sel.id) },
        { icon: 'style', label: 'Style', action: () => this.inspector.setTab('style') },
        '-',
        { icon: 'trash', label: 'Delete', shortcut: 'Del', danger: true, disabled: doc.nodes.length < 2, action: () => this.remove(sel) },
      ];
    }
    if (sel.type === 'edge')
      return [
        { icon: 'pen', label: 'Edit label', shortcut: 'F2', action: () => this.startRename(sel) },
        { icon: 'style', label: 'Style', action: () => this.inspector.setTab('style') },
        '-',
        { icon: 'trash', label: 'Delete edge', danger: true, action: () => this.remove(sel) },
      ];
    if (sel.type === 'group')
      return [
        { icon: 'pen', label: 'Rename', shortcut: 'F2', action: () => this.startRename(sel) },
        { icon: 'plus', label: 'Add step inside', action: () => this.run('add-node-in', sel.id) },
        { icon: 'style', label: 'Style', action: () => this.inspector.setTab('style') },
        '-',
        { icon: 'ungroup', label: 'Ungroup', action: () => this.remove(sel) },
      ];
    return [];
  }
}

export { modKey };
