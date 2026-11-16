import { modKey } from '../ui/dom.js';
import { showMenu } from '../ui/controls.js';
import { FlowchartStudio } from '../flowchart/studio.js';
import { StatechartStore } from './state/store.js';
import { StatechartCanvas } from './components/canvas.js';
import { StatechartOutline } from './components/outline.js';
import { StatechartInspector } from './components/inspector.js';
import { LayoutService } from '../../editor/statechart/services/layout.js';
import { emptyDocument, validateDocument, addState, removeState, addTransition, removeTransition, reconnectTransition } from '../../editor/statechart/commands.js';
import { STATE_KINDS, kindInfo, findState, findTransition, stateName, transitionKey, transitionTitle } from './state/actions.js';
import { EXAMPLES } from './examples.js';

const newId = (before, after) => after.find((x) => !before.some((y) => y.id === x.id))?.id;
const pseudo = (s) => (s?.kind ?? 'state') !== 'state';

/**
 * Statechart (flat FSM) editor session. It shares the graph editor's canvas, undo-able
 * runtime commands and inline rename with the Flowchart session; states and transitions
 * replace steps and edges, and there are no groups or notes. Commands come from
 * src/editor/statechart/commands.js; layout and SVG from the Statechart Worker.
 */
export class StatechartStudio extends FlowchartStudio {
  get kind() {
    return 'statechart';
  }

  createParts(initial) {
    this.store = new StatechartStore(initial ?? structuredClone(EXAMPLES[0].document));
    const cb = {
      select: (sel, opts) => this.select(sel, opts),
      commit: (fn, message) => this.commit(fn, message),
      notify: (m, kind) => this.notify(m, kind),
      remove: (sel) => this.remove(sel),
      run: (cmd, arg) => this.run(cmd, arg),
      contextMenu: (sel, at) => this.contextMenu(sel, at),
      addMenu: (anchor) => this.addMenu(anchor),
      place: () => {},
      rename: (sel, value) => (value === undefined ? this.startRename(sel) : this.rename(sel, value)),
      connect: (from, to) => this.connect(from, to),
      addNext: (from) => this.addNext(from),
      reconnect: (key, end, state) => this.reconnect(key, end, state),
      attachNote: () => {},
      labelFor: (sel) => this.labelFor(sel),
      toolbarItems: (sel) => this.toolbarItems(sel),
    };
    this.canvas = new StatechartCanvas(this.store, cb);
    this.outline = new StatechartOutline(this.store, cb);
    this.inspector = new StatechartInspector(this.store, cb);
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
    return `${doc.states.length} states · ${doc.transitions.length} transitions`;
  }

  statusHint() {
    return 'Drag a state’s handle to add a transition · Double-click to rename';
  }

  shortcutRows() {
    return [
      ['Add state · next state after the selected one', 'N'],
      ['Add menu', 'A'],
    ];
  }

  /* ---------------- edits ---------------- */
  addStep(props = {}) {
    const before = this.store.document.states;
    const next = this.tryCommand((d) => addState(d, props));
    if (!next) return;
    const id = newId(before, next.states);
    this.store.select({ type: 'node', id });
    this.notify(`Added ${kindInfo(props.kind).label.toLowerCase()} state ${id}.`, 'info', this.undoAction());
    if (!pseudo(props)) this.renameAfterLayout(id);
  }

  addNext(from) {
    let id;
    const next = this.tryCommand((d) => {
      const withState = addState(d, {});
      id = newId(d.states, withState.states);
      return addTransition(withState, from, id);
    });
    if (!next) return;
    this.store.select({ type: 'node', id });
    this.notify(`Added ${id} after ${stateName(findState(next, from))}.`, 'info', this.undoAction());
    this.renameAfterLayout(id);
  }

  connect(from, to) {
    const next = this.tryCommand((d) => addTransition(d, from, to));
    if (!next) return;
    const i = next.transitions.length - 1;
    this.store.select({ type: 'edge', key: transitionKey(next.transitions[i], i) });
    this.notify(`Added transition ${transitionTitle(next, next.transitions[i])}. Type its condition next.`, 'info', this.undoAction());
    this.inspector.setTab('properties');
    requestAnimationFrame(() => this.inspector.body.querySelector('[data-fid="t-label"]')?.focus());
  }

  reconnect(key, end, state) {
    if (this.tryCommand((d) => reconnectTransition(d, key, end, state))) {
      this.store.select({ type: 'edge', key });
      this.notify(`Transition now ${end === 'from' ? 'leaves' : 'goes to'} ${stateName(findState(this.store.document, state))}.`, 'info', this.undoAction());
    }
  }

  remove(sel) {
    if (!sel) return;
    const doc = this.store.document;
    if (sel.type === 'node') {
      const s = findState(doc, sel.id);
      if (this.tryCommand((d) => removeState(d, sel.id))) {
        this.notify(`Deleted ${stateName(s)} and its transitions.`, 'info', this.undoAction());
      }
    } else if (sel.type === 'edge') {
      const t = findTransition(doc, sel.key);
      if (this.tryCommand((d) => removeTransition(d, sel.key))) {
        this.notify(`Deleted transition ${transitionTitle(doc, t)}.`, 'info', this.undoAction());
      }
    }
  }

  reverse(key) {
    this.tryCommit((d) => {
      const t = findTransition(d, key);
      [t.from, t.to] = [t.to, t.from];
      const sides = [t.fromSide, t.toSide];
      delete t.fromSide;
      delete t.toSide;
      if (sides[1]) t.fromSide = sides[1];
      if (sides[0]) t.toSide = sides[0];
    }, 'Reversed the transition.');
  }

  labelFor(sel) {
    const doc = this.store.document;
    if (sel.type === 'node') return findState(doc, sel.id)?.label ?? sel.id;
    if (sel.type === 'edge') return findTransition(doc, sel.key)?.label ?? '';
    return '';
  }

  startRename(sel) {
    if (sel?.type === 'node' && pseudo(findState(this.store.document, sel.id))) {
      this.store.select(sel);
      return this.notify('Initial and final states have no name; change the ID in the inspector.', 'info');
    }
    super.startRename(sel);
  }

  rename(sel, value) {
    const label = value.trim() ? value.replace(/\r\n?/g, '\n').replace(/\s+$/, '') : undefined;
    this.tryCommit((d) => {
      const item = sel.type === 'node' ? findState(d, sel.id) : sel.type === 'edge' ? findTransition(d, sel.key) : null;
      if (!item) return;
      if (label === undefined) delete item.label;
      else item.label = label;
    });
  }

  /* ---------------- commands ---------------- */
  runDomain(cmd, arg) {
    const sel = this.store.selection;
    switch (cmd) {
      case 'set-direction':
        return this.changeDirection(arg);
      case 'add-node':
      case 'add-state':
        return this.addStep(arg && arg !== 'state' ? { kind: arg } : {});
      case 'add-next': {
        const from = arg ?? (sel?.type === 'node' ? sel.id : null);
        return from ? this.addNext(from) : this.addStep();
      }
      case 'add-self': {
        const id = arg ?? (sel?.type === 'node' ? sel.id : null);
        return id && this.connect(id, id);
      }
      default:
        return undefined;
    }
  }

  domainKey(e, { mod }) {
    if (mod) return false;
    if (e.key.toLowerCase() === 'n') return this.run('add-next'), true;
    return false;
  }

  domainCommands() {
    const sel = this.store.selection;
    const st = sel?.type === 'node' ? findState(this.store.document, sel.id) : null;
    return [
      ...STATE_KINDS.map((k) => ({ group: 'Create', label: 'Add ' + k.label.toLowerCase() + ' state', icon: k.icon, run: () => this.run('add-state', k.value) })),
      st && st.kind !== 'final' ? { group: 'Create', label: 'Add next state after ' + stateName(st), icon: 'nextStep', shortcut: 'N', run: () => this.run('add-next') } : null,
      st && !pseudo(st) ? { group: 'Create', label: 'Add self transition on ' + stateName(st), icon: 'redo', run: () => this.run('add-self') } : null,
    ];
  }

  gotoCommands() {
    const doc = this.store.document;
    return [
      ...doc.states.map((s) => ({ group: 'Go to', label: stateName(s), hint: s.id, icon: kindInfo(s.kind).icon, run: () => this.select({ type: 'node', id: s.id }, { reveal: true, zoom: true }) })),
      ...doc.transitions.map((t, i) => ({ group: 'Go to', label: t.label ? `${t.label.replace(/\s*\n\s*/g, ' ')} (${transitionTitle(doc, t)})` : transitionTitle(doc, t), hint: transitionKey(t, i), icon: 'edge', run: () => this.select({ type: 'edge', key: transitionKey(t, i) }, { reveal: true, zoom: true }) })),
    ];
  }

  /* ---------------- menus ---------------- */
  addMenu(anchor) {
    showMenu(anchor, [{ heading: 'State' }, ...STATE_KINDS.map((k) => ({ label: k.label, icon: k.icon, action: () => this.run('add-state', k.value) }))], { label: 'Add' });
  }

  kindMenu(id) {
    const st = findState(this.store.document, id);
    showMenu(this.menuAt ?? this.root, [
      { heading: 'Change kind' },
      ...STATE_KINDS.map((k) => ({
        label: k.label,
        icon: k.icon,
        checked: (st.kind ?? 'state') === k.value,
        action: () => {
          this.inspector.setTab('properties');
          this.inspector.body.querySelector(`[data-fid="s-kind-${k.value}"]`)?.click();
        },
      })),
    ], { label: 'Kind' });
  }

  menuItems(sel) {
    const doc = this.store.document;
    if (!sel)
      return [
        ...STATE_KINDS.map((k) => ({ label: 'Add ' + k.label.toLowerCase() + ' state', icon: k.icon, action: () => this.run('add-state', k.value) })),
        '-',
        { label: 'Fit diagram', icon: 'fit', action: () => this.run('fit') },
      ];
    if (sel.type === 'node') {
      const st = findState(doc, sel.id);
      return [
        pseudo(st) ? null : { label: 'Rename', icon: 'pen', shortcut: 'F2', action: () => this.startRename(sel) },
        { label: 'Edit style', icon: 'style', action: () => this.inspector.setTab('style') },
        { label: 'Add next state', icon: 'nextStep', shortcut: 'N', disabled: st.kind === 'final', action: () => this.run('add-next', sel.id) },
        { label: 'Add self transition', icon: 'redo', disabled: pseudo(st), action: () => this.run('add-self', sel.id) },
        { label: 'Change kind…', icon: kindInfo(st.kind).icon, action: () => this.kindMenu(sel.id) },
        '-',
        { label: 'Delete', icon: 'trash', shortcut: 'Del', danger: true, disabled: doc.states.length < 2, action: () => this.remove(sel) },
      ].filter(Boolean);
    }
    if (sel.type === 'edge')
      return [
        { label: 'Edit condition', icon: 'pen', shortcut: 'F2', action: () => this.startRename(sel) },
        { label: 'Edit style', icon: 'style', action: () => this.inspector.setTab('style') },
        { label: 'Reverse direction', icon: 'redo', action: () => this.reverse(sel.key) },
        '-',
        { label: 'Delete transition', icon: 'trash', shortcut: 'Del', danger: true, action: () => this.remove(sel) },
      ];
    return [];
  }

  toolbarItems(sel) {
    const doc = this.store.document;
    if (sel.type === 'node') {
      const st = findState(doc, sel.id);
      if (!st) return [];
      return [
        pseudo(st) ? null : { icon: 'pen', label: 'Rename', shortcut: 'F2', action: () => this.startRename(sel) },
        { icon: 'nextStep', label: 'Add next state', shortcut: 'N', text: 'Next', disabled: st.kind === 'final', action: () => this.run('add-next', sel.id) },
        pseudo(st) ? null : { icon: 'redo', label: 'Add self transition', action: () => this.run('add-self', sel.id) },
        { icon: 'style', label: 'Style', action: () => this.inspector.setTab('style') },
        '-',
        { icon: 'trash', label: 'Delete', shortcut: 'Del', danger: true, disabled: doc.states.length < 2, action: () => this.remove(sel) },
      ].filter(Boolean);
    }
    if (sel.type === 'edge')
      return [
        { icon: 'pen', label: 'Edit condition', shortcut: 'F2', action: () => this.startRename(sel) },
        { icon: 'style', label: 'Style', action: () => this.inspector.setTab('style') },
        '-',
        { icon: 'trash', label: 'Delete transition', danger: true, action: () => this.remove(sel) },
      ];
    return [];
  }
}

export { modKey };
