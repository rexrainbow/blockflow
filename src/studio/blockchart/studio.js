import { h, fill, modKey, singleLine } from '../ui/dom.js';
import { showMenu } from '../ui/controls.js';
import { StudioShell } from '../core/shell.js';
import { Store } from './state/store.js';
import { Canvas } from './components/canvas.js';
import { Outline } from './components/outline.js';
import { Inspector } from './components/inspector.js';
import { LayoutService } from '../../editor/blockchart/services/layout.js';
import { emptyDocument, placeBlock, validateDocument } from '../../editor/blockchart/commands.js';
import { itemPath } from '../../lib/blockchart/hierarchy.js';
import { normalizeDisplayText } from '../../lib/blockchart/model.js';
import {
  findModule,
  findGroup,
  findOwner,
  displayName,
  addBlock,
  addTerminal,
  applyConnection,
  createConcat,
  setFlowDirection,
  deleteSelection,
  deleteGroupDeep,
  duplicateBlock,
  groupItems,
  newPort,
  netTitle,
  groupType,
  moveTargets,
} from './state/actions.js';
import { EXAMPLES } from './examples.js';

/** Block diagram (Blockchart) editor session. */
export class BlockchartStudio extends StudioShell {
  get kind() {
    return 'blockchart';
  }

  createParts(initial) {
    this.store = new Store(initial ?? structuredClone(EXAMPLES[0].document));
    const cb = {
      select: (sel, opts) => this.select(sel, opts),
      commit: (fn, message) => this.commit(fn, message),
      notify: (m, kind) => this.notify(m, kind),
      remove: (sel) => this.remove(sel),
      run: (cmd, arg) => this.run(cmd, arg),
      enterGroup: (id) => this.enterGroup(id),
      contextMenu: (sel, at) => this.contextMenu(sel, at),
      addMenu: (anchor) => this.addMenu(anchor),
      place: (id, group) => this.place(id, group),
      rename: (sel, value) => (value === undefined ? this.startRename(sel) : this.rename(sel, value)),
      connect: (plan) => this.connect(plan),
      labelFor: (sel) => this.labelFor(sel),
      toolbarItems: (sel) => this.toolbarItems(sel),
    };
    this.canvas = new Canvas(this.store, cb);
    this.outline = new Outline(this.store, cb);
    this.inspector = new Inspector(this.store, cb);
    this.layoutService = new LayoutService((result) => this.onLayout(result));
  }

  emptyDocument() {
    return emptyDocument();
  }

  validateDocument(document) {
    return validateDocument(document);
  }

  layoutOptions() {
    return { rootGroupId: this.store.root || null };
  }

  countText() {
    const doc = this.store.document;
    return `${doc.modules.length} blocks · ${doc.connections?.length ?? 0} nets`;
  }

  statusExtras() {
    return this.store.multi.length ? [h('span', { class: 'st' }, `${this.store.multi.length + 1} ports selected — Concat available`)] : [];
  }

  statusHint() {
    return 'Drag a port to connect · Double-click to rename';
  }

  emptyMessage() {
    return this.store.document.modules.length ? 'The diagram could not be laid out. Check Problems in the outline.' : 'Start by adding a block.';
  }

  shortcutRows() {
    return [
      ['Add block · group', 'B · G'],
      ['Add menu', 'A'],
      ['Duplicate · group selection', `${modKey} D · ${modKey} G`],
      ['Leave group view', 'Escape (nothing selected)'],
      ['Multi-select ports for Concat', 'Shift + click port'],
    ];
  }

  domainKey(e, { mod }) {
    const key = e.key.toLowerCase();
    if (mod && key === 'd') return this.run('duplicate'), true;
    if (mod && key === 'g') return this.run('group'), true;
    if (mod) return false;
    if (key === 'b') return this.run('add-block'), true;
    if (key === 'g') return this.run('add-group'), true;
    return false;
  }

  domainCommands() {
    const sel = this.store.selection;
    const has = (t) => sel?.type === t;
    return [
      { group: 'Create', label: 'Add block', icon: 'block', shortcut: 'B', run: () => this.run('add-block') },
      { group: 'Create', label: 'Add group', icon: 'group', shortcut: 'G', run: () => this.run('add-group') },
      { group: 'Create', label: 'Add external input', icon: 'terminal', run: () => this.run('add-input') },
      { group: 'Create', label: 'Add external output', icon: 'terminal', run: () => this.run('add-output') },
      { group: 'Create', label: this.store.multi.length ? 'Concat selected ports' : 'Add concat', icon: 'concat', run: () => this.run('add-concat') },
      has('block') ? { group: 'Edit', label: 'Duplicate block', icon: 'copy', shortcut: modKey + '+D', run: () => this.run('duplicate') } : null,
      has('block') || has('group') ? { group: 'Edit', label: 'Group selection', icon: 'group', shortcut: modKey + '+G', run: () => this.run('group') } : null,
    ];
  }

  gotoCommands() {
    const doc = this.store.document;
    const list = [];
    for (const m of doc.modules) list.push({ group: 'Go to', label: displayName(m), hint: m.id, icon: 'block', run: () => this.select({ type: 'block', id: m.id }, { reveal: true, zoom: true }) });
    for (const g of doc.groups ?? []) list.push({ group: 'Go to', label: displayName(g), hint: g.id, icon: 'group', run: () => this.select({ type: 'group', id: g.id }, { reveal: true, zoom: true }) });
    for (const t of doc.terminals ?? []) list.push({ group: 'Go to', label: displayName(t), hint: t.id, icon: 'terminal', run: () => this.select({ type: 'terminal', id: t.id }, { reveal: true, zoom: true }) });
    for (const [i, n] of (doc.connections ?? []).entries()) list.push({ group: 'Go to', label: netTitle(n), hint: n.id ?? '', icon: 'net', run: () => this.select({ type: 'net', index: i }, { reveal: true, zoom: true }) });
    for (const g of doc.groups ?? []) list.push({ group: 'Open view', label: 'View ' + displayName(g), hint: g.id, icon: 'enter', run: () => this.enterGroup(g.id) });
    return list;
  }

  renderCanvasHead() {
    const doc = this.store.document;
    const root = this.store.root;
    const parts = [{ id: '', label: 'Top' }, ...(root ? itemPath(doc, root).map((p) => ({ id: p.id, label: singleLine(p.label) })) : [])];
    fill(this.crumbs, 
      ...parts.flatMap((p, i) => [
        i ? h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›') : null,
        i === parts.length - 1
          ? h('span', { class: 'crumb current', 'aria-current': 'page' }, p.label)
          : h('button', { type: 'button', class: 'crumb', onclick: () => this.enterGroup(p.id) }, p.label),
      ]),
    );
    const dir = doc.layout?.direction ?? 'right';
    this.dirSeg.replaceChildren(
      h(
        'div',
        { class: 'segmented small', role: 'radiogroup', 'aria-label': 'Flow direction' },
        [
          ['right', 'L → R'],
          ['down', 'T → B'],
        ].map(([v, t]) =>
          h('button', {
            type: 'button',
            role: 'radio',
            'aria-checked': String(dir === v),
            class: dir === v ? 'on' : '',
            title: v === 'right' ? 'Flow left to right' : 'Flow top to bottom',
            onclick: () =>
              dir !== v &&
              this.tryCommit((d) => setFlowDirection(d, v)),
          }, t),
        ),
      ),
    );
  }


  remove(sel) {
    if (!sel) return;
    try {
      let message = '';
      this.commit((d) => (message = deleteSelection(d, sel)));
      this.store.select(null);
      this.notify(message, 'info', { label: 'Undo', run: () => this.undo() });
    } catch (error) {
      this.notify(error.message, 'error');
    }
  }

  place(id, group) {
    const current = (this.store.document.groups ?? []).find((g) => g.members.includes(id))?.id ?? '';
    if (current === group) return;
    try {
      this.commit((d) => placeBlock(d, id, group));
      const name = group ? displayName(findGroup(this.store.document, group)) : 'top level';
      this.notify(`Moved ${id} into ${name}.`, 'info', { label: 'Undo', run: () => this.undo() });
      this.store.select(findGroup(this.store.document, id) ? { type: 'group', id } : { type: 'block', id });
    } catch (error) {
      this.notify(error.message, 'error');
    }
  }

  connect(plan) {
    try {
      const index = this.commit((d) => applyConnection(d, plan));
      this.store.select({ type: 'net', index, branch: plan.existingIndex >= 0 ? this.store.document.connections[index].to.length - 1 : undefined });
      this.notify(plan.message.replace(/^New net/, 'Connected'), 'info', { label: 'Undo', run: () => this.undo() });
    } catch (error) {
      this.notify(error.message, 'error');
    }
  }

  labelFor(sel) {
    const doc = this.store.document;
    if (sel.type === 'block') return findModule(doc, sel.id)?.label ?? sel.id;
    if (sel.type === 'group') return findGroup(doc, sel.id)?.label ?? sel.id;
    if (sel.type === 'terminal') return doc.terminals?.find((t) => t.id === sel.id)?.label ?? sel.id;
    if (sel.type === 'net') return doc.connections?.[sel.index]?.label ?? '';
    return '';
  }

  rename(sel, value) {
    const text = value.trim() ? normalizeDisplayText(value.replace(/\s+$/, '')) : undefined;
    this.tryCommit((d) => {
      const item =
        sel.type === 'block' ? findModule(d, sel.id) : sel.type === 'group' ? findGroup(d, sel.id) : sel.type === 'terminal' ? d.terminals.find((t) => t.id === sel.id) : sel.type === 'net' ? d.connections[sel.index] : null;
      if (!item) return;
      if (text === undefined) delete item.label;
      else item.label = text;
    });
  }


  enterGroup(id) {
    if (id && !findGroup(this.store.document, id)) return;
    this.store.setRoot(id);
    this.notify(id ? `Viewing ${displayName(findGroup(this.store.document, id))}. Exports use this view.` : 'Viewing the whole diagram.');
  }


  selectedIds() {
    const sel = this.store.selection;
    if (sel?.type === 'block' || sel?.type === 'group') return [sel.id];
    return [];
  }


  runDomain(cmd, arg) {
    const sel = this.store.selection;
    const doc = this.store.document;
    const parentForNew = () => {
      if (sel?.type === 'group' && groupType(findGroup(doc, sel.id)) !== 'collection') return sel.id;
      if (sel?.type === 'block') return (doc.groups ?? []).find((g) => g.members.includes(sel.id))?.id ?? this.store.root;
      return this.store.root;
    };
    switch (cmd) {
      case 'add-block':
      case 'add-block-in': {
        const parent = cmd === 'add-block-in' ? arg : parentForNew();
        const id = this.tryCommit((d) => addBlock(d, 'block', parent));
        if (id) {
          this.store.select({ type: 'block', id });
          this.notify(`Added ${id}${parent ? ' in ' + parent : ''}. Drag from its ports to connect.`);
          requestAnimationFrame(() => this.inspector.body.querySelector('[data-fid="b-label"]')?.focus());
        }
        break;
      }
      case 'add-group': {
        const ids = this.selectedIds();
        const id = ids.length ? this.tryCommit((d) => groupItems(d, ids)) : this.tryCommit((d) => {
          const parent = parentForNew();
          const gid = groupItems(d, [addBlock(d, 'block', parent)]);
          return gid;
        });
        if (id) this.store.select({ type: 'group', id });
        break;
      }
      case 'group': {
        const ids = this.selectedIds();
        const id = this.tryCommit((d) => groupItems(d, ids));
        if (id) {
          this.store.select({ type: 'group', id });
          this.notify(`Grouped into ${id}.`, 'info', { label: 'Undo', run: () => this.undo() });
        }
        break;
      }
      case 'add-input':
      case 'add-output': {
        const id = this.tryCommit((d) => addTerminal(d, cmd === 'add-input' ? 'input' : 'output'));
        if (id) {
          this.store.select({ type: 'terminal', id });
          this.notify(`Added ${cmd === 'add-input' ? 'external input' : 'external output'} ${id}. Drag from it to connect.`);
        }
        break;
      }
      case 'add-concat': {
        const ports = [sel, ...this.store.multi].filter((x) => x?.type === 'port' || x?.owner).map((x) => x.owner + '.' + x.port);
        if (ports.length >= 2) {
          const id = this.tryCommit((d) => createConcat(d, ports));
          if (id) {
            this.store.select({ type: 'block', id });
            this.notify(`Concat ${id} created with ${ports.length} inputs. Connect its output next.`, 'info', { label: 'Undo', run: () => this.undo() });
          }
        } else {
          const id = this.tryCommit((d) => addBlock(d, 'concat', parentForNew()));
          if (id) {
            this.store.select({ type: 'block', id });
            this.notify('Concat added. Tip: Shift-click two or more output ports, then choose Concat to wire it in one step.');
          }
        }
        break;
      }
      case 'add-port-in':
      case 'add-port-out': {
        const owner = sel?.type === 'port' ? sel.owner : sel?.id;
        const portId = this.tryCommit((d) => newPort(d, owner, cmd === 'add-port-in' ? 'input' : 'output'));
        if (portId) this.store.select({ type: 'port', owner, port: portId });
        break;
      }
      case 'duplicate': {
        if (sel?.type !== 'block') return;
        const id = this.tryCommit((d) => duplicateBlock(d, sel.id));
        if (id) this.store.select({ type: 'block', id });
        break;
      }
      case 'delete-group-deep': {
        const id = arg ?? sel?.id;
        if (this.tryCommit((d) => deleteGroupDeep(d, id)) !== undefined || !findGroup(this.store.document, id)) {
          this.store.select(null);
          this.notify(`Deleted ${id} and its contents.`, 'info', { label: 'Undo', run: () => this.undo() });
        }
        break;
      }
      default:
        break;
    }
  }


  addMenu(anchor) {
    showMenu(anchor, [
      { label: 'Block', icon: 'block', shortcut: 'B', action: () => this.run('add-block') },
      { label: 'Group', icon: 'group', shortcut: 'G', action: () => this.run('add-group') },
      { label: this.store.multi.length ? 'Concat selected ports' : 'Concat', icon: 'concat', action: () => this.run('add-concat') },
      '-',
      { label: 'External input', icon: 'terminal', action: () => this.run('add-input') },
      { label: 'External output', icon: 'terminal', action: () => this.run('add-output') },
    ], { label: 'Add' });
  }


  /** "Move to…" opens a second menu of groups (the same command as dragging onto a group). */
  moveToItem(sel) {
    const targets = moveTargets(this.store.document, sel.id);
    return {
      label: 'Move to…',
      icon: 'up',
      disabled: targets.length < 2,
      action: () =>
        showMenu(
          this.menuAt ?? this.root,
          [
            { heading: 'Move ' + displayName(findOwner(this.store.document, sel.id)) + ' into' },
            ...targets.map((t) => ({ label: '  '.repeat(Math.max(0, t.depth - 1)) + t.label, checked: t.current, disabled: t.current, action: () => this.place(sel.id, t.id) })),
          ],
          { label: 'Move to' },
        ),
    };
  }

  menuItems(sel) {
    const doc = this.store.document;
    if (!sel)
      return [
        { label: 'Add block', icon: 'block', action: () => this.run('add-block') },
        { label: 'Add group', icon: 'group', action: () => this.run('add-group') },
        { label: 'Add external input', icon: 'terminal', action: () => this.run('add-input') },
        { label: 'Add external output', icon: 'terminal', action: () => this.run('add-output') },
        '-',
        { label: 'Fit diagram', icon: 'fit', action: () => this.run('fit') },
      ];
    const common = [
      { label: 'Rename', icon: 'pen', shortcut: 'F2', action: () => this.startRename(sel) },
      { label: 'Edit style', icon: 'style', action: () => this.inspector.setTab('style') },
    ];
    if (sel.type === 'block')
      return [
        ...common,
        { label: 'Add input port', icon: 'plus', action: () => this.run('add-port-in') },
        {
          label: 'Add output port',
          icon: 'plus',
          action: () => this.run('add-port-out'),
          disabled: findModule(doc, sel.id)?.type === 'concat' && findModule(doc, sel.id).ports?.some((p) => p.direction === 'output'),
        },
        '-',
        { label: 'Duplicate', icon: 'copy', shortcut: modKey + '+D', action: () => this.run('duplicate'), disabled: findModule(doc, sel.id)?.type === 'concat' },
        { label: 'Group', icon: 'group', shortcut: modKey + '+G', action: () => this.run('group') },
        this.moveToItem(sel),
        '-',
        { label: 'Delete', icon: 'trash', shortcut: 'Del', danger: true, action: () => this.remove(sel) },
      ];
    if (sel.type === 'group') {
      const g = findGroup(doc, sel.id);
      return [
        { label: 'Open view', icon: 'enter', action: () => this.enterGroup(sel.id) },
        ...common,
        { label: 'Add block inside', icon: 'plus', action: () => this.run('add-block-in', sel.id) },
        this.moveToItem(sel),
        groupType(g) !== 'container' ? { label: g.collapsed ? 'Show contents' : 'Hide contents', icon: g.collapsed ? 'eye' : 'eyeOff', action: () => this.tryCommit((d) => (findGroup(d, sel.id).collapsed = !g.collapsed)) } : null,
        '-',
        { label: 'Ungroup', icon: 'ungroup', action: () => this.remove(sel) },
        { label: 'Delete with contents', icon: 'trash', danger: true, action: () => this.run('delete-group-deep', sel.id) },
      ].filter(Boolean);
    }
    if (sel.type === 'net')
      return [
        ...common,
        sel.branch !== undefined ? { label: 'Remove this target', icon: 'trash', danger: true, action: () => this.remove(sel), disabled: doc.connections[sel.index].to.length < 2 } : null,
        { label: 'Delete net', icon: 'trash', danger: true, action: () => this.remove({ type: 'net', index: sel.index }) },
      ].filter(Boolean);
    if (sel.type === 'terminal') return [...common, '-', { label: 'Delete', icon: 'trash', danger: true, action: () => this.remove(sel) }];
    if (sel.type === 'port') {
      const concat = this.store.multi.length > 0;
      return [
        concat ? { label: `Concat ${this.store.multi.length + 1} ports`, icon: 'concat', action: () => this.run('add-concat') } : null,
        { label: 'Edit label style', icon: 'style', action: () => this.inspector.setTab('style') },
        { label: 'Delete port', icon: 'trash', danger: true, action: () => this.remove(sel) },
      ].filter(Boolean);
    }
    return [];
  }

  toolbarItems(sel) {
    const doc = this.store.document;
    if (sel.type === 'block')
      return [
        { icon: 'pen', label: 'Rename', shortcut: 'F2', action: () => this.startRename(sel) },
        { icon: 'style', label: 'Style', action: () => this.inspector.setTab('style') },
        findModule(doc, sel.id)?.type === 'concat'
          ? { icon: 'plus', label: 'Add input port (next in order)', text: 'Input', action: () => this.run('add-port-in') }
          : { icon: 'plus', label: 'Add output port', text: 'Port', action: () => this.run('add-port-out') },
        { icon: 'group', label: 'Group', shortcut: modKey + '+G', action: () => this.run('group') },
        '-',
        { icon: 'trash', label: 'Delete', shortcut: 'Del', danger: true, action: () => this.remove(sel) },
      ];
    if (sel.type === 'group')
      return [
        { icon: 'enter', label: 'Open view', action: () => this.enterGroup(sel.id) },
        { icon: 'pen', label: 'Rename', shortcut: 'F2', action: () => this.startRename(sel) },
        { icon: 'style', label: 'Style', action: () => this.inspector.setTab('style') },
        { icon: 'plus', label: 'Add block inside', action: () => this.run('add-block-in', sel.id) },
        '-',
        { icon: 'ungroup', label: 'Ungroup', action: () => this.remove(sel) },
      ];
    if (sel.type === 'net')
      return [
        { icon: 'pen', label: 'Rename label', shortcut: 'F2', action: () => this.startRename(sel) },
        { icon: 'style', label: 'Style', action: () => this.inspector.setTab('style') },
        '-',
        { icon: 'trash', label: sel.branch !== undefined && doc.connections[sel.index]?.to.length > 1 ? 'Remove this target' : 'Delete net', danger: true, action: () => this.remove(sel) },
      ];
    if (sel.type === 'port' && this.store.multi.length)
      return [{ icon: 'concat', label: `Concat ${this.store.multi.length + 1} ports`, text: 'Concat', action: () => this.run('add-concat') }];
    if (sel.type === 'terminal')
      return [
        { icon: 'pen', label: 'Rename', shortcut: 'F2', action: () => this.startRename(sel) },
        { icon: 'trash', label: 'Delete', danger: true, action: () => this.remove(sel) },
      ];
    return [];
  }
}
