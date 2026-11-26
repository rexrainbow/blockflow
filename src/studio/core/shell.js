import { h, fill, modKey } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { iconButton, button, showMenu, closeMenu, modal } from '../ui/controls.js';
import { CommandPalette } from '../ui/palette.js';
import { downloadBlob, svgToPngBlob } from '../../lib/shared/export/browser.js';
import { DIAGRAM_KINDS, diagramKind, parseDiagramFile } from './kinds.js';

const THEMES = ['system', 'light', 'dark'];
const safeName = (name) =>
  (name || 'diagram').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram';

/**
 * One editor session for one diagram kind. The shell owns everything that does not depend
 * on the kind: top bar, panes, theme, toasts, command palette, files, exports, keyboard
 * routing and the canvas camera. A kind subclass creates its store, canvas, outline,
 * inspector and layout service in createParts() and supplies the domain hooks marked
 * "domain" below. The host disposes a session before starting one of another kind.
 */
export class StudioShell {
  constructor(root, host, initial) {
    this.root = root;
    this.host = host;
    this.cleanups = [];
    this.createParts(initial);
    this.palette = new CommandPalette(() => this.commands());
    this.buildShell();
    this.applyTheme();
    this.store.on((reason) => this.onChange(reason));
    this.bindKeys();
    this.bindDrop();
    this.renderAll();
    this.requestLayout();
    if (this.store.restored && !host?.switching)
      this.notify(
        `Restored your last diagram from this browser.${this.store.migrated ? ' ' + this.store.migrated : ''}`,
        'info',
      );
    if (this.store.rejected) this.noticeRejectedDraft(this.store.rejected);
  }

  get kindInfo() {
    return DIAGRAM_KINDS[this.kind];
  }

  /** Ends this session: stops layout work and every global listener. Idempotent. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.layoutService.dispose();
    this.canvas.dispose?.();
    closeMenu();
    this.palette.close?.();
    for (const undo of this.cleanups.splice(0)) undo();
  }

  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
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
    const kept = this.store.keptDraft();
    if (!kept) return this.notify('There is no unopened draft.');
    downloadBlob(
      new Blob([JSON.stringify(kept.document, null, 2) + '\n'], { type: 'application/json' }),
      `${safeName(kept.document.diagram?.name)}-unopened.json`,
    );
    this.store.clearKeptDraft();
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
    this.themeBtn.classList.add('theme-btn'); // phone widths: Theme is in the command palette
    this.outlineBtn = iconButton('panelLeft', 'Toggle outline', () => this.togglePane('outline'), {
      class: 'pane-toggle',
    });
    this.inspectorBtn = iconButton('panelRight', 'Toggle inspector', () => this.togglePane('inspector'), {
      class: 'pane-toggle',
    });
    this.kindBtn = h(
      'button',
      {
        type: 'button',
        class: 'kind-chip',
        'data-kind': this.kind,
        title: `This is a ${this.kindInfo.noun}. Click to start a new diagram of another kind.`,
        'aria-haspopup': 'menu',
        'aria-label': this.kindInfo.label, // the text is hidden on phone widths
        onclick: (e) => this.newMenu(e.currentTarget),
      },
      icon(this.kindInfo.icon, 14),
      h('span', { class: 'kind-chip-text' }, this.kindInfo.label),
    );
    const topbar = h(
      'header',
      { class: 'topbar' },
      h(
        'div',
        { class: 'brand', title: 'blockflow Studio' },
        h('span', { class: 'logo' }, icon('logo')),
        h('span', { class: 'brand-name' }, 'blockflow'),
      ),
      this.outlineBtn,
      this.kindBtn,
      this.nameInput,
      this.saveBadge,
      h('div', { class: 'spacer' }),
      h(
        'button',
        {
          type: 'button',
          class: 'cmdk',
          onclick: () => this.palette.open(),
          'aria-label': 'Search commands',
          title: `Search commands (${modKey}+K)`,
        },
        icon('search'),
        h('span', { class: 'cmdk-text' }, 'Search or run a command…'),
        h('kbd', modKey + ' K'),
      ),
      h('div', { class: 'spacer' }),
      this.undoBtn,
      this.redoBtn,
      h('span', { class: 'bar-sep' }),
      this.themeBtn,
      button('File', (e) => this.fileMenu(e.currentTarget), {
        variant: 'ghost',
        class: 'menu-btn',
        attrs: { 'aria-haspopup': 'menu' },
      }),
      button('Export', (e) => this.exportMenu(e.currentTarget), {
        variant: 'primary',
        icon: 'download',
        class: 'export-btn',
        attrs: { 'aria-haspopup': 'menu', 'aria-label': 'Export' },
      }),
      this.inspectorBtn,
    );
    this.crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Group view' });
    this.dirSeg = h('div', { class: 'canvas-tools' });
    const canvasHead = h(
      'div',
      { class: 'canvas-head' },
      this.crumbs,
      h('div', { class: 'spacer' }),
      this.dirSeg,
    );
    this.status = h('footer', { class: 'statusbar', role: 'status', 'aria-live': 'polite' });
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    const center = h(
      'main',
      { class: 'center', 'aria-label': 'Canvas' },
      canvasHead,
      this.canvas.el,
      this.status,
      this.toasts,
    );
    this.scrim = h('div', { class: 'scrim', onclick: () => this.closeDrawers() });
    this.workspace = h('div', { class: 'workspace' }, this.outline.el, center, this.inspector.el, this.scrim);
    this.fileInput = h('input', {
      type: 'file',
      accept: '.json,application/json,.mmd,.mermaid',
      hidden: true,
      onchange: (e) => this.openFile(e.target.files[0]),
    });
    this.studioEl = h(
      'div',
      { class: 'studio', 'data-kind': this.kind },
      topbar,
      this.workspace,
      this.fileInput,
    );
    this.root.replaceChildren(this.studioEl);
    const narrow = matchMedia('(max-width: 1000px)');
    const sync = () => this.studioEl.classList.toggle('narrow', narrow.matches);
    this.listen(narrow, 'change', sync);
    sync();
  }

  togglePane(which) {
    const studio = this.studioEl;
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
    this.studioEl.dataset.drawer = '';
  }

  applyTheme() {
    const theme = this.store.prefs.theme;
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = theme;
    this.themeBtn.replaceChildren(icon(theme === 'system' ? 'system' : theme === 'dark' ? 'moon' : 'sun'));
    const label = `Theme: ${theme[0].toUpperCase() + theme.slice(1)} (click to change)`;
    this.themeBtn.title = label;
    this.themeBtn.setAttribute('aria-label', label);
    this.studioEl?.classList.toggle('outline-hidden', Boolean(this.store.prefs.outlineHidden));
    this.studioEl?.classList.toggle('inspector-hidden', Boolean(this.store.prefs.inspectorHidden));
  }

  cycleTheme(to) {
    const next = to ?? THEMES[(THEMES.indexOf(this.store.prefs.theme) + 1) % THEMES.length];
    this.store.setPref('theme', next);
    this.applyTheme();
    this.notify(`Theme: ${next}. The diagram itself always exports on white.`);
  }

  /* ---------------- rendering ---------------- */
  onChange(reason) {
    // An inline label editor whose item disappeared (Undo, delete) closes without saving.
    const editing = this.canvas.editor?.sel;
    if (
      editing &&
      (reason === 'replace' ||
        (this.store.domain.exists && !this.store.domain.exists(this.store.document, editing)))
    )
      this.canvas.stopRename(false);
    if (reason === 'document' || reason === 'replace' || reason === 'root') {
      if (reason !== 'document') this.canvas.requestFit();
      this.requestLayout(reason);
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
    this.saveBadge.textContent =
      this.store.saveState === 'error' ? 'Not saved — storage full' : 'Saved in browser';
    this.saveBadge.classList.toggle('error', this.store.saveState === 'error');
    this.outline.render();
    this.inspector.render();
    this.canvas.renderSelection();
    this.renderCanvasHead();
    this.renderStatus();
  }

  /** domain: breadcrumbs (this.crumbs) and flow controls (this.dirSeg). */
  renderCanvasHead() {}

  renderStatus() {
    const L = this.store.layout?.layout;
    const warnings = this.layoutWarnings();
    const state = this.store.layoutError
      ? h('span', { class: 'st error' }, icon('error', 12), ' Layout failed — see Problems')
      : this.store.layoutPending
        ? h('span', { class: 'st busy' }, h('span', { class: 'spinner small' }), ' Laying out…')
        : h('span', { class: 'st ok' }, icon('check', 12), ' Up to date');
    fill(
      this.status,
      h('span', this.countText()),
      L ? h('span', `${Math.round(L.width)} × ${Math.round(L.height)} px`) : null,
      state,
      warnings
        ? h(
            'button',
            { type: 'button', class: 'st warn', onclick: () => this.outline.showProblems() },
            icon('warn', 12),
            ` ${warnings} label warning${warnings > 1 ? 's' : ''}`,
          )
        : null,
      ...this.statusExtras(),
      h('div', { class: 'spacer' }),
      h(
        'span',
        { class: 'hints' },
        this.statusHint(),
        ' · Space+drag to pan · ',
        h('kbd', modKey + ' K'),
        ' commands',
      ),
    );
  }

  layoutWarnings() {
    return this.store.layout?.layout?.warnings?.length ?? 0;
  }

  statusExtras() {
    return [];
  }

  /* ---------------- layout ---------------- */
  /** reason: the store change that asked for it ('document', 'replace', 'root'), or none. */
  requestLayout(reason) {
    this.store.layoutPending = true;
    this.canvas.setBusy(!this.store.layout);
    this.canvas.setStale(this.store.layout ? 'pending' : null);
    this.layoutService.request(this.store.document, { ...this.layoutOptions(), ...this.layoutHint(reason) });
    this.renderStatus();
  }

  layoutOptions() {
    return {};
  }

  /** domain: per-request hints for the layout service (e.g. Blockchart paintOnly). */
  layoutHint() {
    return {};
  }

  onLayout(result) {
    if (this.disposed) return;
    this.store.layoutPending = false;
    this.canvas.setBusy(false);
    this.canvas.setStale(result.error && this.store.layout ? 'error' : null);
    if (result.error) {
      this.store.layoutError = { message: result.error, path: result.path };
      if (!this.store.layout)
        this.canvas.showEmpty(this.emptyMessage(), [
          button(this.kindInfo.addLabel, () => this.run(this.kindInfo.addCommand), {
            icon: 'plus',
            variant: 'primary',
          }),
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

  emptyMessage() {
    return 'The diagram could not be laid out. Check Problems in the outline.';
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
  }

  startRename(sel) {
    if (!sel) return;
    this.store.select(sel);
    if (!this.canvas.startRename(sel)) {
      this.inspector.setTab('properties');
      requestAnimationFrame(() =>
        this.inspector.body.querySelector('[data-fid$="-label"], [data-fid="n-label"]')?.focus(),
      );
    }
  }

  enterGroup() {}

  /* ---------------- commands ---------------- */
  /** Commands every kind shares; a kind's own commands come first. */
  run(cmd, arg) {
    const sel = this.store.selection;
    switch (cmd) {
      case 'fit':
        return this.canvas.fit();
      case 'zoom-selection':
        return this.canvas.zoomToSelection();
      case 'rename':
        return this.startRename(sel);
      case 'delete':
        return this.remove(sel);
      case 'new': {
        const kind = arg ?? this.kind;
        return this.confirmReplace(() => {
          if (kind === this.kind) {
            this.store.replace(this.emptyDocument());
            this.notify(`New ${this.kindInfo.noun}. ${this.kindInfo.startHint}`);
          } else
            this.host.switchTo(kind, {
              document: DIAGRAM_KINDS[kind].empty(),
              message: `New ${DIAGRAM_KINDS[kind].noun}.`,
            });
        });
      }
      case 'open':
        this.fileInput.value = '';
        return this.fileInput.click();
      case 'save':
        return this.saveJson();
      case 'copy-json':
        return this.copyJson();
      case 'export-svg':
        return this.exportSvg();
      case 'export-png':
        return this.exportPng(arg ?? this.store.prefs.pngScale);
      case 'shortcuts':
        return this.showShortcuts();
      default:
        return this.runDomain(cmd, arg);
    }
  }

  runDomain() {}

  commands() {
    const sel = this.store.selection;
    const otherKinds = Object.entries(DIAGRAM_KINDS).filter(([k]) => k !== this.kind);
    return [
      ...this.domainCommands(),
      {
        group: 'Edit',
        label: 'Undo',
        icon: 'undo',
        shortcut: modKey + '+Z',
        run: () => this.undo(),
        disabled: !this.store.history.past.length,
      },
      {
        group: 'Edit',
        label: 'Redo',
        icon: 'redo',
        shortcut: modKey + '+Shift+Z',
        run: () => this.redo(),
        disabled: !this.store.history.future.length,
      },
      sel
        ? {
            group: 'Edit',
            label: 'Rename selection',
            icon: 'pen',
            shortcut: 'F2',
            run: () => this.run('rename'),
          }
        : null,
      sel
        ? {
            group: 'Edit',
            label: 'Delete selection',
            icon: 'trash',
            shortcut: 'Del',
            run: () => this.run('delete'),
          }
        : null,
      { group: 'View', label: 'Fit diagram', icon: 'fit', shortcut: 'Shift+1', run: () => this.run('fit') },
      sel
        ? {
            group: 'View',
            label: 'Zoom to selection',
            icon: 'target',
            shortcut: 'Shift+2',
            run: () => this.run('zoom-selection'),
          }
        : null,
      this.store.root
        ? { group: 'View', label: 'Back to whole diagram', icon: 'up', run: () => this.enterGroup('') }
        : null,
      ...THEMES.map((t) => ({
        group: 'View',
        label: `Theme: ${t}`,
        icon: t === 'system' ? 'system' : t === 'dark' ? 'moon' : 'sun',
        run: () => this.cycleTheme(t),
      })),
      { group: 'View', label: 'Toggle outline', icon: 'panelLeft', run: () => this.togglePane('outline') },
      {
        group: 'View',
        label: 'Toggle inspector',
        icon: 'panelRight',
        run: () => this.togglePane('inspector'),
      },
      { group: 'File', label: 'New ' + this.kindInfo.noun, icon: 'file', run: () => this.run('new') },
      ...otherKinds.map(([k, info]) => ({
        group: 'File',
        label: 'New ' + info.noun,
        icon: info.icon,
        run: () => this.run('new', k),
      })),
      {
        group: 'File',
        label: 'Open JSON…',
        icon: 'file',
        shortcut: modKey + '+O',
        run: () => this.run('open'),
      },
      {
        group: 'File',
        label: 'Save JSON',
        icon: 'download',
        shortcut: modKey + '+S',
        run: () => this.run('save'),
      },
      { group: 'File', label: 'Copy JSON to clipboard', icon: 'copy', run: () => this.run('copy-json') },
      { group: 'File', label: 'Export SVG', icon: 'download', run: () => this.run('export-svg') },
      ...[1, 2, 3].map((n) => ({
        group: 'File',
        label: `Export PNG ${n}×`,
        icon: 'download',
        run: () => this.run('export-png', n),
      })),
      ...this.allExamples().map((ex) => ({
        group: 'Examples',
        label: 'Load example: ' + ex.name,
        hint: DIAGRAM_KINDS[ex.kind].label,
        icon: 'file',
        run: () => this.loadExample(ex),
      })),
      {
        group: 'Help',
        label: 'Keyboard shortcuts',
        icon: 'keyboard',
        shortcut: '?',
        run: () => this.run('shortcuts'),
      },
      ...this.gotoCommands(),
    ].filter(Boolean);
  }

  /** Examples of this kind first, then the other kinds' (loading one switches kind). */
  allExamples() {
    const own = this.kindInfo.examples().map((ex) => ({ ...ex, kind: this.kind }));
    const other = Object.entries(DIAGRAM_KINDS)
      .filter(([k]) => k !== this.kind)
      .flatMap(([k, info]) => info.examples().map((ex) => ({ ...ex, kind: k })));
    return [...own, ...other];
  }

  /* ---------------- menus ---------------- */
  newMenu(anchor) {
    showMenu(
      anchor,
      [
        { heading: 'New diagram' },
        ...Object.entries(DIAGRAM_KINDS).map(([k, info]) => ({
          label: info.label,
          icon: info.icon,
          checked: k === this.kind,
          action: () => this.run('new', k),
        })),
      ],
      { label: 'New diagram' },
    );
  }

  fileMenu(anchor) {
    const otherKinds = Object.entries(DIAGRAM_KINDS).filter(([k]) => k !== this.kind);
    const examples = this.allExamples();
    showMenu(
      anchor,
      [
        { label: 'New ' + this.kindInfo.noun, icon: 'file', action: () => this.run('new') },
        ...otherKinds.map(([k, info]) => ({
          label: 'New ' + info.noun,
          icon: info.icon,
          action: () => this.run('new', k),
        })),
        { label: 'Open…', icon: 'file', shortcut: modKey + '+O', action: () => this.run('open') },
        { label: 'Save JSON', icon: 'download', shortcut: modKey + '+S', action: () => this.run('save') },
        { label: 'Copy JSON to clipboard', icon: 'copy', action: () => this.run('copy-json') },
        this.store.keptDraft()
          ? { label: 'Save unopened draft', icon: 'download', action: () => this.saveKeptDraft() }
          : null,
        '-',
        ...Object.entries(DIAGRAM_KINDS).flatMap(([k, info]) => {
          const list = examples.filter((ex) => ex.kind === k);
          return list.length
            ? [
                { heading: info.label + ' examples' },
                ...list.map((ex) => ({ label: ex.name, action: () => this.loadExample(ex) })),
              ]
            : [];
        }),
        '-',
        { label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', action: () => this.run('shortcuts') },
      ].filter(Boolean),
      { label: 'File' },
    );
  }

  examplesMenu(anchor) {
    showMenu(
      anchor,
      this.allExamples()
        .filter((ex) => ex.kind === this.kind)
        .map((ex) => ({ label: ex.name, action: () => this.loadExample(ex) })),
      { label: 'Examples' },
    );
  }

  exportMenu(anchor) {
    const view = this.store.root ? `view ${this.store.root}` : 'whole diagram';
    showMenu(
      anchor,
      [
        { heading: `Exports the ${view}` },
        { label: 'SVG', icon: 'download', action: () => this.run('export-svg') },
        ...[1, 2, 3].map((n) => ({
          label: `PNG ${n}×`,
          icon: 'download',
          checked: this.store.prefs.pngScale === n,
          action: () => (this.store.setPref('pngScale', n), this.run('export-png', n)),
        })),
        ...this.exportExtras(),
        '-',
        { heading: 'Whole diagram source' },
        { label: 'Save JSON', icon: 'download', action: () => this.run('save') },
        { label: 'Copy JSON to clipboard', icon: 'copy', action: () => this.run('copy-json') },
      ],
      { label: 'Export', align: 'right' },
    );
  }

  /** domain: extra Export menu items after the image formats. */
  exportExtras() {
    return [];
  }

  contextMenu(sel, at) {
    this.menuAt = at;
    const items = this.menuItems(sel);
    if (items.length) showMenu(at, items, { label: 'Actions' });
  }

  /* ---------------- files ---------------- */
  filename() {
    const base = safeName(this.store.document.diagram?.name);
    return this.store.root ? `${base}-${this.store.root}` : base;
  }

  /** The diagram source exactly as Save JSON writes it; always the whole document. */
  jsonText() {
    return JSON.stringify(this.store.document, null, 2) + '\n';
  }

  saveJson() {
    downloadBlob(
      new Blob([this.jsonText()], { type: 'application/json' }),
      safeName(this.store.document.diagram?.name) + '.json',
    );
    this.notify('Saved JSON.');
  }

  /**
   * Copies the same text as Save JSON. Falls back to execCommand, then to a dialog with the
   * text selected, so the user can always get it.
   */
  async copyJson() {
    const text = this.jsonText();
    const kb = new Blob([text]).size / 1024;
    const done = () =>
      this.notify(`Copied JSON · ${this.countText()} · ${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`);
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
    const box = h('textarea', {
      class: 'input mono copy-json',
      readonly: '',
      rows: 16,
      spellcheck: 'false',
      'aria-label': 'Diagram JSON',
    });
    box.value = text;
    modal({
      title: 'Copy JSON',
      wide: true,
      body: [
        h(
          'p',
          { class: 'insp-hint' },
          `The browser blocked clipboard access. The whole diagram is selected below: press ${modKey}+C to copy it.`,
        ),
        box,
      ],
      actions: [{ label: 'Close', variant: 'primary' }],
    });
    box.focus();
    box.select();
  }

  currentSvg() {
    if (this.store.layoutPending || this.store.layoutError || !this.store.layout) {
      this.notify(
        this.store.layoutError
          ? 'Fix the layout problem before exporting.'
          : 'Wait for the layout to finish, then export again.',
        'error',
      );
      return null;
    }
    return this.store.layout.svg;
  }

  /** domain: the exported text; Blockchart's layout SVG has no final newline, Flowchart's does. */
  svgFileText(svg) {
    return svg.endsWith('\n') ? svg : svg + '\n';
  }

  exportSvg() {
    const svg = this.currentSvg();
    if (!svg) return;
    downloadBlob(new Blob([this.svgFileText(svg)], { type: 'image/svg+xml' }), this.filename() + '.svg');
    this.notify('Exported SVG.');
  }

  async exportPng(scale) {
    const svg = this.currentSvg();
    if (!svg) return;
    try {
      downloadBlob(
        await svgToPngBlob(svg, scale),
        `${this.filename()}${scale === 1 ? '' : '@' + scale + 'x'}.png`,
      );
      this.notify(`Exported PNG ${scale}×.`);
    } catch (error) {
      this.notify(error.message, 'error');
    }
  }

  confirmReplace(go) {
    if (!this.store.history.past.length) return go();
    modal({
      title: 'Replace the current diagram?',
      body: h(
        'p',
        'Your current diagram is replaced. Save it as JSON first if you want to keep a copy. You can still undo this.',
      ),
      actions: [
        { label: 'Save JSON first', run: () => (this.saveJson(), false) },
        { label: 'Cancel' },
        { label: 'Replace', variant: 'primary', run: () => (go(), true) },
      ],
    });
  }

  replaceKeepingUndo(document, message, action) {
    this.validateDocument(structuredClone(document));
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
    this.notify(message, 'info', action ?? { label: 'Undo', run: () => this.undo() });
  }

  /** Takes a document of any kind: this session replaces its own, another kind switches. */
  openDocument(document, message) {
    const kind = diagramKind(document);
    const migrated = DIAGRAM_KINDS[kind].migrate?.(document);
    if (migrated) {
      document = migrated.document;
      message = `${message} ${migrated.note}`;
    }
    if (kind === this.kind) return this.replaceKeepingUndo(document, message);
    DIAGRAM_KINDS[kind].validate(structuredClone(document));
    this.host.switchTo(kind, { document, message, from: this.kind });
  }

  loadExample(ex) {
    try {
      this.openDocument(ex.document, `Loaded example: ${ex.name}.`);
    } catch (error) {
      this.notify(error.message, 'error');
    }
  }

  async openFile(file) {
    if (!file) return;
    try {
      const { document, note } = parseDiagramFile(file.name, await file.text());
      this.openDocument(document, `Opened ${file.name}.${note ? ' ' + note : ''}`);
    } catch (error) {
      this.notify(
        `Could not open ${file.name}: ${error.message}${error.path && !error.message.includes(error.path) ? ' (at ' + error.path + ')' : ''}`,
        'error',
      );
    }
  }

  bindDrop() {
    const studio = this.root;
    this.listen(studio, 'dragover', (e) => {
      if ([...(e.dataTransfer?.types ?? [])].includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        studio.classList.add('file-over');
      }
    });
    this.listen(studio, 'dragleave', (e) => {
      if (e.target === studio || !studio.contains(e.relatedTarget)) studio.classList.remove('file-over');
    });
    this.listen(studio, 'drop', (e) => {
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
      action
        ? h(
            'button',
            { type: 'button', class: 'link-btn', onclick: () => (action.run(), toast.remove()) },
            action.label,
          )
        : null,
      h(
        'button',
        { type: 'button', class: 'icon-btn small', 'aria-label': 'Dismiss', onclick: () => toast.remove() },
        icon('close', 12),
      ),
    );
    this.toasts.prepend(toast);
    while (this.toasts.children.length > 3) this.toasts.lastChild.remove();
    if (kind !== 'error') setTimeout(() => toast.remove(), action ? 6000 : 3200);
  }

  showShortcuts() {
    const rows = [
      ['Search commands / go to item', modKey + ' K'],
      ...this.shortcutRows(),
      ['Rename selection', 'F2 or double-click'],
      ['Delete selection', 'Delete'],
      ['Undo · redo', `${modKey} Z · ${modKey} Shift Z`],
      ['Select neighbour on canvas', 'Arrow keys'],
      ['Clear selection', 'Escape'],
      ['Fit diagram · zoom to selection', 'Shift 1 · Shift 2'],
      ['Zoom in · out', '+ · −'],
      ['Pan', 'Space + drag, or drag empty canvas'],
      ['Open · save JSON', `${modKey} O · ${modKey} S`],
    ];
    modal({
      title: 'Keyboard shortcuts',
      body: h(
        'table',
        { class: 'shortcuts' },
        h(
          'tbody',
          rows.map(([a, b]) => h('tr', h('td', a), h('td', h('kbd', b)))),
        ),
      ),
    });
  }

  /* ---------------- keyboard ---------------- */
  bindKeys() {
    this.listen(window, 'keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
      const key = e.key.toLowerCase();
      if (mod && key === 'k') {
        e.preventDefault();
        return this.palette.open();
      }
      if (mod && key === 's') {
        e.preventDefault();
        return this.saveJson();
      }
      if (mod && key === 'o') {
        e.preventDefault();
        return this.run('open');
      }
      if (typing || document.querySelector('dialog[open]') || this.palette.isOpen) return;
      if (mod && key === 'z') {
        e.preventDefault();
        return e.shiftKey ? this.redo() : this.undo();
      }
      if (mod && key === 'y') {
        e.preventDefault();
        return this.redo();
      }
      const sel = this.store.selection;
      const inCanvas = e.target === this.canvas.el || e.target === document.body;
      if (this.domainKey(e, { mod, sel, inCanvas }) === true) return e.preventDefault();
      if (mod) return;
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

  /** domain: kind-specific keys; return true when handled. */
  domainKey() {
    return false;
  }
}
