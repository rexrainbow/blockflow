import { h, fill, singleLine, modKey, debounce } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { iconButton, button, showMenu, closeMenu, modal } from './ui/controls.js';
import { Store } from './state/store.js';
import { Canvas } from './components/canvas.js';
import { Outline } from './components/outline.js';
import { Inspector } from './components/inspector.js';
import { CommandPalette } from './components/palette.js';
import { EXAMPLES } from './examples.js';
import { LayoutService } from '../editor/services/layout.js';
import { emptyDocument, placeBlock, validateDocument } from '../editor/state/commands.js';
import { downloadBlob, svgToPngBlob } from '../lib/shared/export/browser.js';
import { itemPath } from '../lib/blockchart/hierarchy.js';
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
import { normalizeDisplayText } from '../lib/blockchart/model.js';

const THEMES = ['system', 'light', 'dark'];

export function startStudio(root) {
  return new Studio(root);
}

class Studio {
  constructor(root) {
    this.root = root;
    this.store = new Store(structuredClone(EXAMPLES[0].document));
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
    this.palette = new CommandPalette(() => this.commands());
    this.layoutService = new LayoutService((result) => this.onLayout(result));
    this.buildShell();
    this.applyTheme();
    this.store.on((reason) => this.onChange(reason));
    this.bindKeys();
    this.bindDrop();
    this.renderAll();
    this.requestLayout();
    if (this.store.restored) this.notify('Restored your last diagram from this browser.', 'info');
    if (this.store.rejected) this.noticeRejectedDraft(this.store.rejected);
  }

  /** A stored draft the runtime no longer accepts: report why and offer the original. */
  noticeRejectedDraft({ message, path }) {
    const where = path && !message.includes(path) ? `${path}: ` : '';
    const reason = /[.!?]$/.test(message.trim()) ? message.trim() : message.trim() + '.';
    this.notify(
      `Your last browser diagram was not opened: ${where}${reason} A copy is kept: File › Save unopened draft.`,
      'error',
      { label: 'Save copy', run: () => this.saveKeptDraft() },
    );
  }

  /** Downloads the draft kept aside at startup, unchanged, then forgets it. */
  saveKeptDraft() {
    const kept = Store.keptDraft();
    if (!kept) return this.notify('There is no unopened draft.');
    const name = (kept.document.diagram?.name || 'diagram').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram';
    downloadBlob(new Blob([JSON.stringify(kept.document, null, 2) + '\n'], { type: 'application/json' }), `${name}-unopened.json`);
    Store.clearKeptDraft();
    this.notify('Saved the unopened draft. Fix the reported field, then open it.');
  }

  /* ---------------- shell ---------------- */
  buildShell() {
    this.nameInput = h('input', {
      class: 'doc-name',
      'aria-label': 'Diagram name',
      spellcheck: 'false',
      onchange: (e) => {
        const v = e.target.value.trim();
        if (!v) return (e.target.value = this.store.document.diagram.name);
        this.tryCommit((d) => (d.diagram.name = v));
      },
      onkeydown: (e) => {
        if (e.key === 'Enter') e.target.blur();
        if (e.key === 'Escape') {
          e.target.value = this.store.document.diagram.name;
          e.target.blur();
        }
      },
    });
    this.saveBadge = h('span', { class: 'save-state', role: 'status' });
    this.undoBtn = iconButton('undo', 'Undo', () => this.undo(), { shortcut: modKey + '+Z' });
    this.redoBtn = iconButton('redo', 'Redo', () => this.redo(), { shortcut: modKey + '+Shift+Z' });
    this.themeBtn = iconButton('system', 'Theme', () => this.cycleTheme());
    this.outlineBtn = iconButton('panelLeft', 'Toggle outline', () => this.togglePane('outline'), { class: 'pane-toggle' });
    this.inspectorBtn = iconButton('panelRight', 'Toggle inspector', () => this.togglePane('inspector'), { class: 'pane-toggle' });
    const topbar = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand', title: 'blockflow Studio' }, h('span', { class: 'logo' }, icon('logo')), h('span', { class: 'brand-name' }, 'blockflow')),
      this.outlineBtn,
      this.nameInput,
      this.saveBadge,
      h('div', { class: 'spacer' }),
      h(
        'button',
        { type: 'button', class: 'cmdk', onclick: () => this.palette.open(), 'aria-label': 'Search commands', title: `Search commands (${modKey}+K)` },
        icon('search'),
        h('span', { class: 'cmdk-text' }, 'Search or run a command…'),
        h('kbd', modKey + ' K'),
      ),
      h('div', { class: 'spacer' }),
      this.undoBtn,
      this.redoBtn,
      h('span', { class: 'bar-sep' }),
      this.themeBtn,
      button('File', (e) => this.fileMenu(e.currentTarget), { variant: 'ghost', class: 'menu-btn', attrs: { 'aria-haspopup': 'menu' } }),
      button('Export', (e) => this.exportMenu(e.currentTarget), { variant: 'primary', icon: 'download', attrs: { 'aria-haspopup': 'menu' } }),
      this.inspectorBtn,
    );
    this.crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Group view' });
    this.dirSeg = h('div', { class: 'canvas-tools' });
    const canvasHead = h('div', { class: 'canvas-head' }, this.crumbs, h('div', { class: 'spacer' }), this.dirSeg);
    this.status = h('footer', { class: 'statusbar', role: 'status', 'aria-live': 'polite' });
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    const center = h('main', { class: 'center', 'aria-label': 'Canvas' }, canvasHead, this.canvas.el, this.status, this.toasts);
    this.scrim = h('div', { class: 'scrim', onclick: () => this.closeDrawers() });
    this.workspace = h('div', { class: 'workspace' }, this.outline.el, center, this.inspector.el, this.scrim);
    this.fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => this.openFile(e.target.files[0]) });
    this.root.replaceChildren(h('div', { class: 'studio' }, topbar, this.workspace, this.fileInput));
    const narrow = matchMedia('(max-width: 1000px)');
    const sync = () => this.root.querySelector('.studio').classList.toggle('narrow', narrow.matches);
    narrow.addEventListener('change', sync);
    sync();
  }

  togglePane(which) {
    const studio = this.root.querySelector('.studio');
    if (studio.classList.contains('narrow')) {
      const open = studio.dataset.drawer === which;
      studio.dataset.drawer = open ? '' : which;
    } else {
      const key = which + 'Hidden';
      this.store.setPref(key, !this.store.prefs[key]);
      studio.classList.toggle(which + '-hidden', this.store.prefs[key]);
    }
    requestAnimationFrame(() => this.canvas.applyCamera());
  }

  closeDrawers() {
    this.root.querySelector('.studio').dataset.drawer = '';
  }

  applyTheme() {
    const theme = this.store.prefs.theme;
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = theme;
    this.themeBtn.replaceChildren(icon(theme === 'system' ? 'system' : theme === 'dark' ? 'moon' : 'sun'));
    const label = `Theme: ${theme[0].toUpperCase() + theme.slice(1)} (click to change)`;
    this.themeBtn.title = label;
    this.themeBtn.setAttribute('aria-label', label);
    const studio = this.root.querySelector('.studio');
    studio?.classList.toggle('outline-hidden', Boolean(this.store.prefs.outlineHidden));
    studio?.classList.toggle('inspector-hidden', Boolean(this.store.prefs.inspectorHidden));
  }

  cycleTheme(to) {
    const next = to ?? THEMES[(THEMES.indexOf(this.store.prefs.theme) + 1) % THEMES.length];
    this.store.setPref('theme', next);
    this.applyTheme();
    this.notify(`Theme: ${next}. The diagram itself always exports on white.`);
  }

  /* ---------------- rendering ---------------- */
  onChange(reason) {
    if (reason === 'document' || reason === 'replace' || reason === 'root') {
      if (reason !== 'document') this.canvas.requestFit();
      this.requestLayout();
      this.renderAll();
    } else if (reason === 'selection') {
      this.outline.render();
      this.inspector.render();
      this.canvas.renderSelection();
      this.renderStatus();
    } else this.renderAll();
  }

  renderAll() {
    const doc = this.store.document;
    if (document.activeElement !== this.nameInput) this.nameInput.value = doc.diagram?.name ?? '';
    this.undoBtn.disabled = !this.store.history.past.length;
    this.redoBtn.disabled = !this.store.history.future.length;
    this.saveBadge.textContent = this.store.saveState === 'error' ? 'Not saved — storage full' : 'Saved in browser';
    this.saveBadge.classList.toggle('error', this.store.saveState === 'error');
    this.outline.render();
    this.inspector.render();
    this.canvas.renderSelection();
    this.renderCrumbs();
    this.renderStatus();
  }

  renderCrumbs() {
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

  renderStatus() {
    const doc = this.store.document;
    const L = this.store.layout?.layout;
    const warnings = L?.warnings?.length ?? 0;
    const state = this.store.layoutError
      ? h('span', { class: 'st error' }, icon('error', 12), ' Layout failed — see Problems')
      : this.store.layoutPending
        ? h('span', { class: 'st busy' }, h('span', { class: 'spinner small' }), ' Laying out…')
        : h('span', { class: 'st ok' }, icon('check', 12), ' Up to date');
    fill(this.status, 
      h('span', `${doc.modules.length} blocks · ${doc.connections?.length ?? 0} nets`),
      L ? h('span', `${Math.round(L.width)} × ${Math.round(L.height)} px`) : null,
      state,
      warnings ? h('button', { type: 'button', class: 'st warn', onclick: () => this.outline.showProblems() }, icon('warn', 12), ` ${warnings} label warning${warnings > 1 ? 's' : ''}`) : null,
      this.store.multi.length ? h('span', { class: 'st' }, `${this.store.multi.length + 1} ports selected — Concat available`) : null,
      h('div', { class: 'spacer' }),
      h('span', { class: 'hints' }, 'Drag a port to connect · Double-click to rename · Space+drag to pan · ', h('kbd', modKey + ' K'), ' commands'),
    );
  }

  /* ---------------- layout ---------------- */
  requestLayout() {
    this.store.layoutPending = true;
    this.canvas.setBusy(!this.store.layout);
    this.layoutService.request(this.store.document, { rootGroupId: this.store.root || null });
    this.renderStatus();
  }

  onLayout(result) {
    this.store.layoutPending = false;
    this.canvas.setBusy(false);
    if (result.error) {
      this.store.layoutError = { message: result.error, path: result.path };
      if (!this.store.layout)
        this.canvas.showEmpty(this.store.document.modules.length ? 'The diagram could not be laid out. Check Problems in the outline.' : 'Start by adding a block.', [
          button('Add block', () => this.run('add-block'), { icon: 'plus', variant: 'primary' }),
          button('Load an example', (e) => this.examplesMenu(e.currentTarget), { variant: 'ghost' }),
        ]);
    } else {
      this.store.layoutError = null;
      this.store.layout = { layout: result.layout, svg: result.svg };
      this.canvas.setLayout(result);
    }
    this.outline.render();
    this.inspector.render();
    this.renderStatus();
  }

  /* ---------------- commits ---------------- */
  commit(fn, message) {
    const result = this.store.commit(fn);
    if (message) this.notify(message);
    return result;
  }

  tryCommit(fn, message) {
    try {
      return this.commit(fn, message);
    } catch (error) {
      this.notify(error.message, 'error');
      return undefined;
    }
  }

  undo() {
    if (this.store.undo()) this.notify('Undone.');
  }

  redo() {
    if (this.store.redo()) this.notify('Redone.');
  }

  select(sel, opts = {}) {
    this.store.select(sel, { additive: opts.additive });
    if (opts.reveal) {
      this.outline.revealSelection();
      if (opts.zoom) this.canvas.zoomToSelection();
      else this.canvas.revealSelection();
    }
    if (!opts.keepFocus && opts.reveal) {
      /* keep outline focus when navigating with keys */
    }
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

  startRename(sel) {
    if (!sel) return;
    this.store.select(sel);
    if (!this.canvas.startRename(sel)) {
      this.inspector.setTab('properties');
      requestAnimationFrame(() => this.inspector.body.querySelector('[data-fid$="-label"], [data-fid="n-label"]')?.focus());
    }
  }

  enterGroup(id) {
    if (id && !findGroup(this.store.document, id)) return;
    this.store.setRoot(id);
    this.notify(id ? `Viewing ${displayName(findGroup(this.store.document, id))}. Exports use this view.` : 'Viewing the whole diagram.');
  }

  /* ---------------- commands ---------------- */
  selectedIds() {
    const sel = this.store.selection;
    if (sel?.type === 'block' || sel?.type === 'group') return [sel.id];
    return [];
  }

  run(cmd, arg) {
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
      case 'fit':
        this.canvas.fit();
        break;
      case 'zoom-selection':
        this.canvas.zoomToSelection();
        break;
      case 'rename':
        this.startRename(sel);
        break;
      case 'delete':
        this.remove(sel);
        break;
      case 'new':
        this.confirmReplace(() => {
          this.store.replace(emptyDocument());
          this.notify('New diagram. Add a block to begin.');
        });
        break;
      case 'open':
        this.fileInput.value = '';
        this.fileInput.click();
        break;
      case 'save':
        this.saveJson();
        break;
      case 'copy-json':
        this.copyJson();
        break;
      case 'export-svg':
        this.exportSvg();
        break;
      case 'export-png':
        this.exportPng(arg ?? this.store.prefs.pngScale);
        break;
      case 'shortcuts':
        this.showShortcuts();
        break;
      default:
        break;
    }
  }

  commands() {
    const sel = this.store.selection;
    const doc = this.store.document;
    const has = (t) => sel?.type === t;
    const list = [
      { group: 'Create', label: 'Add block', icon: 'block', shortcut: 'B', run: () => this.run('add-block') },
      { group: 'Create', label: 'Add group', icon: 'group', shortcut: 'G', run: () => this.run('add-group') },
      { group: 'Create', label: 'Add external input', icon: 'terminal', run: () => this.run('add-input') },
      { group: 'Create', label: 'Add external output', icon: 'terminal', run: () => this.run('add-output') },
      { group: 'Create', label: this.store.multi.length ? 'Concat selected ports' : 'Add concat', icon: 'concat', run: () => this.run('add-concat') },
      { group: 'Edit', label: 'Undo', icon: 'undo', shortcut: modKey + '+Z', run: () => this.undo(), disabled: !this.store.history.past.length },
      { group: 'Edit', label: 'Redo', icon: 'redo', shortcut: modKey + '+Shift+Z', run: () => this.redo(), disabled: !this.store.history.future.length },
      sel ? { group: 'Edit', label: 'Rename selection', icon: 'pen', shortcut: 'F2', run: () => this.run('rename') } : null,
      has('block') ? { group: 'Edit', label: 'Duplicate block', icon: 'copy', shortcut: modKey + '+D', run: () => this.run('duplicate') } : null,
      has('block') || has('group') ? { group: 'Edit', label: 'Group selection', icon: 'group', shortcut: modKey + '+G', run: () => this.run('group') } : null,
      sel ? { group: 'Edit', label: 'Delete selection', icon: 'trash', shortcut: 'Del', run: () => this.run('delete') } : null,
      { group: 'View', label: 'Fit diagram', icon: 'fit', shortcut: 'Shift+1', run: () => this.run('fit') },
      sel ? { group: 'View', label: 'Zoom to selection', icon: 'target', shortcut: 'Shift+2', run: () => this.run('zoom-selection') } : null,
      this.store.root ? { group: 'View', label: 'Back to whole diagram', icon: 'up', run: () => this.enterGroup('') } : null,
      ...THEMES.map((t) => ({ group: 'View', label: `Theme: ${t}`, icon: t === 'system' ? 'system' : t === 'dark' ? 'moon' : 'sun', run: () => this.cycleTheme(t) })),
      { group: 'View', label: 'Toggle outline', icon: 'panelLeft', run: () => this.togglePane('outline') },
      { group: 'View', label: 'Toggle inspector', icon: 'panelRight', run: () => this.togglePane('inspector') },
      { group: 'File', label: 'New diagram', icon: 'file', run: () => this.run('new') },
      { group: 'File', label: 'Open JSON…', icon: 'file', shortcut: modKey + '+O', run: () => this.run('open') },
      { group: 'File', label: 'Save JSON', icon: 'download', shortcut: modKey + '+S', run: () => this.run('save') },
      { group: 'File', label: 'Copy JSON to clipboard', icon: 'copy', run: () => this.run('copy-json') },
      { group: 'File', label: 'Export SVG', icon: 'download', run: () => this.run('export-svg') },
      ...[1, 2, 3].map((n) => ({ group: 'File', label: `Export PNG ${n}×`, icon: 'download', run: () => this.run('export-png', n) })),
      ...EXAMPLES.map((ex) => ({ group: 'Examples', label: 'Load example: ' + ex.name, icon: 'file', run: () => this.loadExample(ex) })),
      { group: 'Help', label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', run: () => this.run('shortcuts') },
    ].filter(Boolean);
    // Jump-to entries for every item in the document.
    for (const m of doc.modules) list.push({ group: 'Go to', label: displayName(m), hint: m.id, icon: 'block', run: () => this.select({ type: 'block', id: m.id }, { reveal: true, zoom: true }) });
    for (const g of doc.groups ?? []) list.push({ group: 'Go to', label: displayName(g), hint: g.id, icon: 'group', run: () => this.select({ type: 'group', id: g.id }, { reveal: true, zoom: true }) });
    for (const t of doc.terminals ?? []) list.push({ group: 'Go to', label: displayName(t), hint: t.id, icon: 'terminal', run: () => this.select({ type: 'terminal', id: t.id }, { reveal: true, zoom: true }) });
    for (const [i, n] of (doc.connections ?? []).entries()) list.push({ group: 'Go to', label: netTitle(n), hint: n.id ?? '', icon: 'net', run: () => this.select({ type: 'net', index: i }, { reveal: true, zoom: true }) });
    for (const g of doc.groups ?? []) list.push({ group: 'Open view', label: 'View ' + displayName(g), hint: g.id, icon: 'enter', run: () => this.enterGroup(g.id) });
    return list;
  }

  /* ---------------- menus ---------------- */
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

  fileMenu(anchor) {
    showMenu(anchor, [
      { label: 'New diagram', icon: 'file', action: () => this.run('new') },
      { label: 'Open JSON…', icon: 'file', shortcut: modKey + '+O', action: () => this.run('open') },
      { label: 'Save JSON', icon: 'download', shortcut: modKey + '+S', action: () => this.run('save') },
      { label: 'Copy JSON to clipboard', icon: 'copy', action: () => this.run('copy-json') },
      Store.keptDraft() ? { label: 'Save unopened draft', icon: 'download', action: () => this.saveKeptDraft() } : null,
      '-',
      { heading: 'Examples' },
      ...EXAMPLES.map((ex) => ({ label: ex.name, action: () => this.loadExample(ex) })),
      '-',
      { label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', action: () => this.run('shortcuts') },
    ], { label: 'File' });
  }

  examplesMenu(anchor) {
    showMenu(anchor, EXAMPLES.map((ex) => ({ label: ex.name, action: () => this.loadExample(ex) })), { label: 'Examples' });
  }

  exportMenu(anchor) {
    const view = this.store.root ? `view ${this.store.root}` : 'whole diagram';
    showMenu(anchor, [
      { heading: `Exports the ${view}` },
      { label: 'SVG', icon: 'download', action: () => this.run('export-svg') },
      ...[1, 2, 3].map((n) => ({ label: `PNG ${n}×`, icon: 'download', checked: this.store.prefs.pngScale === n, action: () => (this.store.setPref('pngScale', n), this.run('export-png', n)) })),
      '-',
      { heading: 'Whole diagram source' },
      { label: 'JSON', icon: 'download', action: () => this.run('save') },
      { label: 'Copy JSON', icon: 'copy', action: () => this.run('copy-json') },
    ], { label: 'Export', align: 'right' });
  }

  contextMenu(sel, at) {
    this.menuAt = at;
    const items = this.menuItems(sel);
    if (items.length) showMenu(at, items, { label: 'Actions' });
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

  /* ---------------- files ---------------- */
  filename() {
    const base = (this.store.document.diagram?.name || 'diagram').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram';
    return this.store.root ? `${base}-${this.store.root}` : base;
  }

  /** The diagram source exactly as Save JSON writes it; always the whole document. */
  jsonText() {
    return JSON.stringify(this.store.document, null, 2) + '\n';
  }

  saveJson() {
    const base = (this.store.document.diagram?.name || 'diagram').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram';
    downloadBlob(new Blob([this.jsonText()], { type: 'application/json' }), base + '.json');
    this.notify('Saved JSON.');
  }

  /**
   * Copies the same text as Save JSON. Falls back to execCommand, then to a dialog with the
   * text selected, so the user can always get it.
   */
  async copyJson() {
    const text = this.jsonText();
    const doc = this.store.document;
    const kb = new Blob([text]).size / 1024;
    const done = () =>
      this.notify(`Copied JSON · ${doc.modules.length} blocks · ${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`);
    try {
      await navigator.clipboard.writeText(text);
      return done();
    } catch {
      // Clipboard API missing or refused; try the legacy path inside this user gesture.
    }
    const area = h('textarea', { class: 'clip-buffer', readonly: '', 'aria-hidden': 'true' });
    area.value = text;
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    area.remove();
    if (copied) return done();
    const box = h('textarea', { class: 'input mono copy-json', readonly: '', rows: 16, spellcheck: 'false', 'aria-label': 'Diagram JSON' });
    box.value = text;
    modal({
      title: 'Copy JSON',
      wide: true,
      body: [h('p', { class: 'insp-hint' }, `The browser blocked clipboard access. The whole diagram is selected below: press ${modKey}+C to copy it.`), box],
      actions: [{ label: 'Close', variant: 'primary' }],
    });
    box.focus();
    box.select();
  }

  currentSvg() {
    if (this.store.layoutPending || this.store.layoutError || !this.store.layout) {
      this.notify(this.store.layoutError ? 'Fix the layout problem before exporting.' : 'Wait for the layout to finish, then export again.', 'error');
      return null;
    }
    return this.store.layout.svg;
  }

  exportSvg() {
    const svg = this.currentSvg();
    if (!svg) return;
    downloadBlob(new Blob([svg + '\n'], { type: 'image/svg+xml' }), this.filename() + '.svg');
    this.notify('Exported SVG.');
  }

  async exportPng(scale) {
    const svg = this.currentSvg();
    if (!svg) return;
    try {
      downloadBlob(await svgToPngBlob(svg, scale), `${this.filename()}${scale === 1 ? '' : '@' + scale + 'x'}.png`);
      this.notify(`Exported PNG ${scale}×.`);
    } catch (error) {
      this.notify(error.message, 'error');
    }
  }

  confirmReplace(go) {
    if (!this.store.history.past.length) return go();
    modal({
      title: 'Replace the current diagram?',
      body: h('p', 'Your current diagram is replaced. Save it as JSON first if you want to keep a copy. You can still undo this.'),
      actions: [
        { label: 'Save JSON first', run: () => (this.saveJson(), false) },
        { label: 'Cancel' },
        { label: 'Replace', variant: 'primary', run: () => (go(), true) },
      ],
    });
  }

  replaceKeepingUndo(document, message) {
    validateDocument(structuredClone(document));
    // Keep the replacement undoable by committing it as one change.
    this.store.commit(
      (d) => {
        for (const k of Object.keys(d)) delete d[k];
        Object.assign(d, structuredClone(document));
      },
      { replace: true },
    );
    this.store.select(null);
    this.store.setRoot('');
    this.canvas.requestFit();
    this.requestLayout();
    this.notify(message, 'info', { label: 'Undo', run: () => this.undo() });
  }

  loadExample(ex) {
    try {
      this.replaceKeepingUndo(ex.document, `Loaded example: ${ex.name}.`);
    } catch (error) {
      this.notify(error.message, 'error');
    }
  }

  async openFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const doc = JSON.parse(text.replace(/^﻿/, ''));
      this.replaceKeepingUndo(doc, `Opened ${file.name}.`);
    } catch (error) {
      this.notify(`Could not open ${file.name}: ${error.message}${error.path ? ' (at ' + error.path + ')' : ''}`, 'error');
    }
  }

  bindDrop() {
    const studio = this.root;
    studio.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.types ?? [])].includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        studio.classList.add('file-over');
      }
    });
    studio.addEventListener('dragleave', (e) => {
      if (e.target === studio || !studio.contains(e.relatedTarget)) studio.classList.remove('file-over');
    });
    studio.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      studio.classList.remove('file-over');
      this.openFile(e.dataTransfer.files[0]);
    });
  }

  /* ---------------- notifications ---------------- */
  notify(message, kind = 'info', action) {
    if (!message) return;
    const toast = h(
      'div',
      { class: ['toast', kind], role: kind === 'error' ? 'alert' : 'status' },
      icon(kind === 'error' ? 'error' : 'check', 14),
      h('span', { class: 'toast-text' }, message),
      action ? h('button', { type: 'button', class: 'link-btn', onclick: () => (action.run(), toast.remove()) }, action.label) : null,
      h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Dismiss', onclick: () => toast.remove() }, icon('close', 12)),
    );
    this.toasts.prepend(toast);
    while (this.toasts.children.length > 3) this.toasts.lastChild.remove();
    if (kind !== 'error') setTimeout(() => toast.remove(), action ? 6000 : 3200);
  }

  showShortcuts() {
    const rows = [
      ['Search commands / go to item', modKey + ' K'],
      ['Add block · group', 'B · G'],
      ['Add menu', 'A'],
      ['Rename selection', 'F2 or double-click'],
      ['Delete selection', 'Delete'],
      ['Duplicate · group selection', `${modKey} D · ${modKey} G`],
      ['Undo · redo', `${modKey} Z · ${modKey} Shift Z`],
      ['Select neighbour on canvas', 'Arrow keys'],
      ['Clear selection / leave group view', 'Escape'],
      ['Fit diagram · zoom to selection', 'Shift 1 · Shift 2'],
      ['Zoom in · out', '+ · −'],
      ['Pan', 'Space + drag, or drag empty canvas'],
      ['Multi-select ports for Concat', 'Shift + click port'],
      ['Open · save JSON', `${modKey} O · ${modKey} S`],
    ];
    modal({ title: 'Keyboard shortcuts', body: h('table', { class: 'shortcuts' }, h('tbody', rows.map(([a, b]) => h('tr', h('td', a), h('td', h('kbd', b)))))) });
  }

  /* ---------------- keyboard ---------------- */
  bindKeys() {
    addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        return this.palette.open();
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        return this.saveJson();
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        return this.run('open');
      }
      if (typing || document.querySelector('dialog[open]') || this.palette.isOpen) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        return e.shiftKey ? this.redo() : this.undo();
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        return this.redo();
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        return this.run('duplicate');
      }
      if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        return this.run('group');
      }
      if (mod) return;
      const sel = this.store.selection;
      const inCanvas = e.target === this.canvas.el || e.target === document.body;
      switch (e.key) {
        case 'Escape':
          closeMenu();
          if (sel) this.store.select(null);
          else if (this.store.root) this.enterGroup('');
          break;
        case 'Delete':
        case 'Backspace':
          if (sel) this.remove(sel);
          break;
        case 'F2':
          if (sel) this.startRename(sel);
          break;
        case 'Enter':
          if (sel && inCanvas) this.startRename(sel);
          else return;
          break;
        case 'b':
        case 'B':
          this.run('add-block');
          break;
        case 'g':
        case 'G':
          this.run('add-group');
          break;
        case 'a':
        case 'A':
          this.addMenu(this.outline.el.querySelector('.pane-head .icon-btn'));
          break;
        case '!':
          this.canvas.fit();
          break;
        case '@':
          this.canvas.zoomToSelection();
          break;
        case '+':
        case '=':
          this.canvas.zoomBy(1.25);
          break;
        case '-':
        case '_':
          this.canvas.zoomBy(0.8);
          break;
        case '?':
          this.showShortcuts();
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!inCanvas) return;
          const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
          const next = this.canvas.neighbor(...d);
          if (next) this.select(next, { reveal: true });
          break;
        }
        default:
          if (e.code === 'Digit1' && e.shiftKey) this.canvas.fit();
          else if (e.code === 'Digit2' && e.shiftKey) this.canvas.zoomToSelection();
          else return;
      }
      e.preventDefault();
    });
  }
}

export { findOwner, debounce };
