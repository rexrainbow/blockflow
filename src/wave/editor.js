import './wave.css';
import { h, fill, replaceKeepingFocus, storage, store as save, modKey } from '../studio/ui/dom.js';
import { iconButton, button, field, textInput, segmented, checkbox, showMenu, closeMenu, modal } from '../studio/ui/controls.js';
import { icon } from '../studio/ui/icons.js';
import { PREFS_KEY } from '../studio/core/store.js';
import { downloadBlob, svgToPngBlob } from '../lib/shared/export/browser.js';
import {
  WAVEFORM_FORMAT,
  parseWaveform,
  waveformProblems,
  snapWaveformTime,
  applyWaveformOps,
  layoutWaveform,
  renderWaveformSvg,
  importVcd,
  listVcdSignals,
} from '../lib/waveform/index.js';
import { pageUrl, STUDIO_PAGE, receiveHandoff, WAVE_RETURN } from '../story/handoff.js';
import dshotExample from '../../examples/waveform/dshot.json';

/** The waveform this page last showed, so a reload continues where it was. */
export const SESSION_KEY = 'blockflow.wave.session';
const PANES_KEY = 'blockflow.wave.panes';
/** View preferences of this page (link drawing); never saved in the waveform. */
const VIEW_KEY = 'blockflow.wave.view';
const LINK_ROUTES = ['auto', 'local', 'rail'];
const THEMES = ['system', 'light', 'dark'];
const EDGE_HIT = 6; // px either side of a transition that grabs it
const ID_PREFIX = 'wave-edit';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const safeName = (name) => (name || 'waveform').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'waveform';
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

export const newWaveform = () => ({
  format: WAVEFORM_FORMAT,
  version: 1,
  title: 'Waveform',
  timescale: 'clk',
  grid: { ticksPerBit: 8, offset: 0 },
  length: 32,
  signals: [
    { id: 'clk', label: 'Clock', width: 1, changes: [[0, 0]] },
    { id: 'data', label: 'Data', width: 1, changes: [[0, 0]] },
  ],
});

/**
 * The Waveform editor (wave.html): synchronous timing diagrams with integer ticks, an
 * optional bit grid, bit and bus lanes, named transitions, causal links and markers.
 * Format, checks, edits, drawing and VCD import are the runtime's (src/lib/waveform,
 * docs/waveform-runtime.md); every change is an applyWaveformOps batch or a whole document
 * parsed by the runtime. The page shows the runtime SVG unchanged and draws selection
 * on a separate overlay; hits use the runtime layout geometry and SVG identity metadata.
 */
export class WaveEditor {
  constructor(root) {
    this.root = root;
    this.cleanups = [];
    this.doc = null;
    this.problems = [];
    this.past = [];
    this.future = [];
    this.sel = null; // {type:'doc'|'signal'|'range'|'edge'|'link'|'marker', ...}
    this.linkFrom = null; // edge selection waiting for a link target
    this.zoom = 24; // pixels per tick
    this.snap = 'tick';
    // How links are drawn: a renderer option only (docs/waveform-runtime.md), kept per browser.
    const route = storage(VIEW_KEY, {}).linkRoute;
    this.linkRoute = LINK_ROUTES.includes(route) ? route : 'auto';
    this.hover = null;
    this.build();
    this.applyTheme();
    this.bindKeys();
    this.bindDrop();
    const session = storage(SESSION_KEY, null);
    if (session?.doc) this.tryRun(() => this.open(session.doc, { message: null, fit: true }));
    this.render();
    /** Settles once a Story editor hand-off (if any) has been opened. */
    this.started = this.receiveFromStory();
  }

  /** Opened by the Story editor for a chapter: edit its waveform and send it back. */
  async receiveFromStory() {
    const message = await receiveHandoff();
    if (!message?.waveform) return;
    this.tryRun(() => {
      this.open(message.waveform, { message: `Editing the waveform of ${message.label}. Send to Story editor puts it back.`, fit: true });
      this.returnTo = { ci: message.ci, label: message.label };
      this.render();
    }, 'the waveform from the Story editor');
  }

  sendToStory() {
    const opener = window.opener;
    if (!this.returnTo || !opener || opener.closed) return this.notify('The Story editor tab that opened this waveform is closed. Save JSON and open it there instead.', 'error');
    opener.postMessage({ type: WAVE_RETURN, ci: this.returnTo.ci, waveform: this.doc }, '*');
    this.notify(`Sent to the Story editor (${this.returnTo.label}).`);
  }

  dispose() {
    closeMenu();
    for (const undo of this.cleanups.splice(0)) undo();
  }

  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  /* ---------------- page ---------------- */
  build() {
    this.undoBtn = iconButton('undo', 'Undo', () => this.undo(), { shortcut: modKey + '+Z' });
    this.redoBtn = iconButton('redo', 'Redo', () => this.redo(), { shortcut: modKey + '+Shift+Z' });
    this.themeBtn = iconButton('system', 'Theme', () => this.cycleTheme());
    this.themeBtn.classList.add('theme-btn');
    this.titleEl = h('span', { class: 'story-source' });
    const topbar = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand', title: 'blockflow Waveform editor' }, h('span', { class: 'logo' }, icon('logo')), h('span', { class: 'brand-name' }, 'blockflow')),
      iconButton('panelLeft', 'Toggle signal list', () => this.togglePane('outline'), { class: 'pane-toggle' }),
      h('span', { class: 'kind-chip', 'data-kind': 'wave', title: 'Waveform editor: synchronous timing diagrams' }, icon('net', 14), h('span', { class: 'kind-chip-text' }, 'Waveform editor')),
      this.titleEl,
      h('div', { class: 'spacer' }),
      this.undoBtn,
      this.redoBtn,
      h('span', { class: 'bar-sep' }),
      this.themeBtn,
      button('File', (e) => this.fileMenu(e.currentTarget), { variant: 'ghost', class: 'menu-btn', attrs: { 'aria-haspopup': 'menu' } }),
      button('Export', (e) => this.exportMenu(e.currentTarget), { variant: 'primary', icon: 'download', class: 'export-btn', attrs: { 'aria-haspopup': 'menu', 'aria-label': 'Export' } }),
      iconButton('panelRight', 'Toggle inspector', () => this.togglePane('inspector'), { class: 'pane-toggle' }),
    );
    this.crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Waveform' });
    this.tools = h('div', { class: 'canvas-tools' });
    this.startEl = h('div', { class: 'story-start' });
    this.sheet = h('div', { class: 'wv-sheet' });
    this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.overlay.setAttribute('class', 'wv-overlay');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.canvas = h('div', { class: 'wv-canvas', tabindex: '0', 'aria-label': 'Waveform canvas' }, this.sheet, this.overlay);
    this.scroller = h('div', { class: 'wv-scroll' }, this.canvas);
    this.status = h('footer', { class: 'statusbar', role: 'status', 'aria-live': 'polite' });
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    const center = h('main', { class: 'center', 'aria-label': 'Waveform' }, h('div', { class: 'canvas-head' }, this.crumbs, h('div', { class: 'spacer' }), this.tools), this.startEl, this.scroller, this.status, this.toasts);
    this.listHead = h('div', { class: 'pane-head' });
    this.listBody = h('div', { class: 'story-list wv-list' });
    this.listEl = h('aside', { class: 'pane outline', 'aria-label': 'Signals' }, this.listHead, this.listBody);
    this.editHead = h('div', { class: 'insp-head' });
    this.editBody = h('div', { class: 'insp-body' });
    this.editEl = h('aside', { class: 'pane inspector', 'aria-label': 'Inspector' }, this.editHead, this.editBody);
    this.scrim = h('div', { class: 'scrim', onclick: () => (this.el.dataset.drawer = '') });
    this.fileInput = h('input', {
      type: 'file',
      accept: '.json,application/json,.vcd,text/plain',
      hidden: true,
      onchange: (e) => {
        this.openFile(e.target.files[0]);
        e.target.value = '';
      },
    });
    this.el = h('div', { class: 'studio story-app wave-app', 'data-kind': 'wave' }, topbar, h('div', { class: 'workspace' }, this.listEl, center, this.editEl, this.scrim), this.fileInput);
    this.root.replaceChildren(this.el);
    const narrow = matchMedia('(max-width: 1000px)');
    const sync = () => this.el.classList.toggle('narrow', narrow.matches);
    this.listen(narrow, 'change', sync);
    sync();
    this.listen(this.canvas, 'pointerdown', (e) => this.pointerDown(e));
    this.listen(this.canvas, 'pointermove', (e) => this.pointerMove(e));
    this.listen(this.canvas, 'pointerup', (e) => this.pointerUp(e));
    this.listen(this.canvas, 'pointercancel', () => this.cancelDrag());
    this.listen(this.canvas, 'pointerleave', () => ((this.hover = null), this.renderStatus()));
    this.listen(this.canvas, 'dblclick', (e) => this.doubleClick(e));
  }

  togglePane(which) {
    if (this.el.classList.contains('narrow')) {
      this.el.dataset.drawer = this.el.dataset.drawer === which ? '' : which;
      return;
    }
    const panes = storage(PANES_KEY, {});
    panes[which] = !panes[which];
    save(PANES_KEY, panes);
    this.render();
  }

  applyTheme() {
    const theme = storage(PREFS_KEY, {}).theme ?? 'system';
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = theme;
    this.themeBtn.replaceChildren(icon(theme === 'system' ? 'system' : theme === 'dark' ? 'moon' : 'sun'));
    const label = `Theme: ${theme[0].toUpperCase() + theme.slice(1)} (click to change)`;
    this.themeBtn.title = label;
    this.themeBtn.setAttribute('aria-label', label);
  }

  cycleTheme() {
    const prefs = storage(PREFS_KEY, {});
    const next = THEMES[(THEMES.indexOf(prefs.theme ?? 'system') + 1) % THEMES.length];
    save(PREFS_KEY, { ...prefs, theme: next });
    this.applyTheme();
    this.notify(`Theme: ${next}. The waveform itself always shows on white.`);
  }

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

  tryRun(run, name) {
    try {
      return run();
    } catch (error) {
      this.notify(`${name ? `Could not open ${name}: ` : ''}${error.message}`, 'error');
      this.render();
      return undefined;
    }
  }

  fileMenu(anchor) {
    showMenu(
      anchor,
      [
        { label: 'New waveform', icon: 'file', action: () => this.confirmReplace(() => this.open(newWaveform(), { message: 'Started a new waveform.', fit: true })) },
        { label: 'Open…', icon: 'file', shortcut: modKey + '+O', action: () => this.fileInput.click() },
        { label: 'Save JSON', icon: 'download', shortcut: modKey + '+S', disabled: !this.doc, action: () => this.saveJson() },
        '-',
        { heading: 'Examples' },
        { label: 'DShot timing', action: () => this.confirmReplace(() => this.open(dshotExample, { message: 'Loaded the DShot example.', fit: true })) },
        '-',
        { label: 'Open the Studio', icon: 'enter', action: () => window.open(pageUrl(STUDIO_PAGE), '_blank') },
      ],
      { label: 'File' },
    );
  }

  exportMenu(anchor) {
    showMenu(
      anchor,
      [
        { heading: 'The whole waveform' },
        { label: 'SVG', icon: 'download', disabled: !this.doc, action: () => this.exportSvg() },
        { label: 'PNG 2×', icon: 'download', disabled: !this.doc, action: () => this.exportPng() },
        '-',
        { heading: 'Source' },
        { label: 'Save JSON', icon: 'download', disabled: !this.doc, action: () => this.saveJson() },
      ],
      { label: 'Export', align: 'right' },
    );
  }

  confirmReplace(go) {
    if (!this.doc || !this.past.length) return go();
    modal({
      title: 'Replace this waveform?',
      body: h('p', 'The current waveform is replaced. Save JSON first to keep it; this replacement can be undone.'),
      actions: [{ label: 'Cancel' }, { label: 'Replace', variant: 'primary', run: () => (go(), true) }],
    });
  }

  bindKeys() {
    this.listen(document, 'keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'o') return e.preventDefault(), this.fileInput.click();
      if (mod && key === 's') return e.preventDefault(), this.saveJson();
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('.modal-backdrop, .menu')) return;
      if (mod && key === 'z') return e.preventDefault(), e.shiftKey ? this.redo() : this.undo();
      if (mod && key === 'y') return e.preventDefault(), this.redo();
      if (!this.doc || mod || e.altKey) return;
      if (e.key === 'Escape') return this.linkFrom ? this.cancelLink() : this.select(null);
      if (e.key === '+' || e.key === '=') return this.zoomBy(1.5);
      if (e.key === '-' || e.key === '_') return this.zoomBy(1 / 1.5);
      if (e.key === '!') return this.fit();
      if (e.key === 'Delete' || e.key === 'Backspace') return e.preventDefault(), this.deleteSelection();
      const s = this.sel;
      if (s?.type === 'range' && ['0', '1', 'x', 'z'].includes(key) && this.signal(s.signalId)?.width === 1)
        return this.setRange(s, key === '0' || key === '1' ? Number(key) : key);
      if (s?.type === 'edge' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const step = this.snap === 'bit' && this.doc.grid ? this.doc.grid.ticksPerBit : 1;
        return this.moveEdge(s, s.t + (e.key === 'ArrowLeft' ? -step : step), { followLocked: !e.shiftKey });
      }
    });
  }

  bindDrop() {
    this.listen(this.el, 'dragover', (e) => {
      e.preventDefault();
      this.el.classList.add('file-over');
    });
    this.listen(this.el, 'dragleave', () => this.el.classList.remove('file-over'));
    this.listen(this.el, 'drop', (e) => {
      e.preventDefault();
      this.el.classList.remove('file-over');
      this.openFile(e.dataTransfer.files[0]);
    });
  }

  /* ---------------- documents and history ---------------- */
  /** Opens a waveform document (normalized by the runtime). Undo returns to the previous one. */
  open(value, { message = '', fit = false } = {}) {
    const doc = parseWaveform(value);
    if (this.doc) this.past.push(JSON.stringify(this.doc));
    this.future = [];
    this.sel = null;
    this.linkFrom = null;
    this.setDoc(doc);
    if (fit) requestAnimationFrame(() => this.fit());
    if (message) this.notify(message);
  }

  async openFile(file) {
    if (!file) return;
    const text = await file.text();
    if (/\.vcd$/i.test(file.name) || /^\s*\$(date|version|timescale|scope|comment|var)\b/.test(text)) return this.importDialog(text, file.name);
    this.tryRun(() => {
      let value;
      try {
        value = JSON.parse(text.replace(/^﻿/, ''));
      } catch (error) {
        throw new Error(`not valid JSON (${error.message}).`);
      }
      if (value?.format !== WAVEFORM_FORMAT && (Array.isArray(value?.modules) || Array.isArray(value?.nodes) || Array.isArray(value?.states)))
        throw new Error('this is a diagram. Diagrams open in the Studio.');
      this.open(value, { message: `Opened ${file.name}.`, fit: true });
    }, file.name);
  }

  /**
   * VCD: the runtime lists what the file declares (listVcdSignals); the user picks signals from
   * that checklist, a source-tick window (defaults: the capture's first and last timestamps)
   * and an optional timescale; the runtime imports.
   */
  importDialog(text, name) {
    let info;
    try {
      info = listVcdSignals(text);
    } catch (error) {
      return this.notify(`Could not read ${name}: ${error.message}`, 'error');
    }
    const LIMIT = 256; // importVcd's default selected-lane limit
    const stem = name.replace(/\.vcd$/i, '');
    const all = info.signals.map((s) => s.name);
    const chosen = new Set(all.length <= LIMIT ? all : []);
    const state = { filter: '', from: String(info.firstTimestamp), to: String(info.lastTimestamp), timescale: '', title: stem };
    const error = h('p', { class: 'field-error', role: 'alert', hidden: true });
    const count = h('span', { class: 'count' });
    const list = h('div', { class: 'wv-vcd-list', role: 'group', 'aria-label': 'Signals to import' });
    const shown = () => info.signals.filter((s) => s.name.toLowerCase().includes(state.filter.toLowerCase()));
    const renderList = () => {
      count.textContent = `${chosen.size} of ${all.length}`;
      list.replaceChildren(
        ...shown().map((s) =>
          h(
            'label',
            { class: 'wv-vcd-row' },
            h('input', { type: 'checkbox', checked: chosen.has(s.name), onchange: (e) => (e.target.checked ? chosen.add(s.name) : chosen.delete(s.name), (count.textContent = `${chosen.size} of ${all.length}`)) }),
            h('span', { class: 'mono' }, s.name),
            h('span', { class: 'wv-vcd-meta' }, `${s.width === 1 ? '1 bit' : `${s.width} bits`} · ${s.type}`),
          ),
        ),
        ...(shown().length ? [] : [h('p', { class: 'insp-hint wv-empty' }, 'No signal matches the filter.')]),
      );
    };
    const pick = (on) => {
      for (const s of shown()) on ? chosen.add(s.name) : chosen.delete(s.name);
      renderList();
    };
    const input = (key, label, hint, extra = {}) =>
      field(label, h('input', { class: 'input', 'data-fid': `vcd-${key}`, placeholder: extra.placeholder ?? '', value: state[key], oninput: (e) => (state[key] = e.target.value) }), { hint });
    renderList();
    modal({
      title: `Import ${name}`,
      wide: true,
      body: [
        h(
          'p',
          { class: 'insp-hint' },
          `${plural(all.length, 'signal')} · timescale ${info.timescale} · ticks ${info.firstTimestamp}–${info.lastTimestamp}. Up to ${LIMIT} signals per import.`,
        ),
        h(
          'div',
          { class: 'wv-vcd-head' },
          h('input', {
            class: 'input',
            type: 'search',
            'data-fid': 'vcd-filter',
            placeholder: 'Filter signals',
            'aria-label': 'Filter signals',
            oninput: (e) => ((state.filter = e.target.value), renderList()),
          }),
          button('All', () => pick(true), { variant: 'ghost', title: 'Select the listed signals' }),
          button('None', () => pick(false), { variant: 'ghost', title: 'Clear the listed signals' }),
          count,
        ),
        list,
        h('div', { class: 'grid2' }, input('from', 'From tick', 'Source ticks; the window is rebased to 0.'), input('to', 'To tick', 'Changes exactly at the end are kept.')),
        input('timescale', 'Convert to timescale', `Optional, for example 1ns. The file uses ${info.timescale}; fractional results are refused.`),
        input('title', 'Title', ''),
        error,
      ],
      actions: [
        { label: 'Cancel' },
        {
          label: 'Import',
          variant: 'primary',
          run: () => {
            try {
              if (!chosen.size) throw new Error('Choose at least one signal.');
              const options = { title: state.title.trim() || stem, signals: all.filter((n) => chosen.has(n)) };
              for (const key of ['from', 'to']) if (state[key].trim()) options[key] = Number(state[key]);
              if (state.timescale.trim()) options.timescale = state.timescale.trim();
              const doc = importVcd(text, options);
              this.confirmReplace(() => this.open(doc, { message: `Imported ${plural(doc.signals.length, 'signal')} from ${name}.`, fit: true }));
              return true;
            } catch (e) {
              error.hidden = false;
              error.textContent = e.message;
              return false;
            }
          },
        },
      ],
    });
  }

  setDoc(doc) {
    this.doc = doc;
    this.problems = waveformProblems(doc);
    if (!save(SESSION_KEY, { doc })) this.notify('This browser is out of storage; the waveform will not be restored after a reload.', 'error');
    this.fixSelection();
    this.render();
  }

  /** Applies runtime operations as one undoable change. Problems are allowed and listed. */
  apply(ops, message) {
    try {
      const { document } = applyWaveformOps(this.doc, ops, { allowProblems: true });
      if (JSON.stringify(document) === JSON.stringify(this.doc)) return true;
      this.past.push(JSON.stringify(this.doc));
      if (this.past.length > 200) this.past.shift();
      this.future = [];
      this.setDoc(document);
      if (message) this.notify(message);
      return true;
    } catch (error) {
      this.notify(error.message, 'error');
      this.render();
      return false;
    }
  }

  /** A change the operations do not cover (lane order, lane removal): the runtime parses the result. */
  replace(change, message) {
    const next = structuredClone(this.doc);
    change(next);
    try {
      const doc = parseWaveform(next);
      this.past.push(JSON.stringify(this.doc));
      this.future = [];
      this.setDoc(doc);
      if (message) this.notify(message, 'info', { label: 'Undo', run: () => this.undo() });
      return true;
    } catch (error) {
      this.notify(error.message, 'error');
      return false;
    }
  }

  undo() {
    if (!this.past.length) return;
    this.future.push(JSON.stringify(this.doc));
    this.setDoc(JSON.parse(this.past.pop()));
    this.notify('Undone.');
  }

  redo() {
    if (!this.future.length) return;
    this.past.push(JSON.stringify(this.doc));
    this.setDoc(JSON.parse(this.future.pop()));
    this.notify('Redone.');
  }

  saveJson() {
    if (!this.doc) return this.notify('Nothing to save yet.', 'error');
    downloadBlob(new Blob([JSON.stringify(this.doc, null, 2) + '\n'], { type: 'application/json' }), `${safeName(this.doc.title)}.waveform.json`);
    this.notify('Saved the waveform JSON.');
  }

  exportSvg() {
    const svg = this.tryRun(() => renderWaveformSvg(this.doc, this.exportOptions()));
    if (!svg) return;
    downloadBlob(new Blob([svg.endsWith('\n') ? svg : svg + '\n'], { type: 'image/svg+xml' }), `${safeName(this.doc.title)}.svg`);
    this.notify('Exported SVG.');
  }

  async exportPng() {
    const svg = this.tryRun(() => renderWaveformSvg(this.doc, this.exportOptions()));
    if (!svg) return;
    try {
      downloadBlob(await svgToPngBlob(svg, 2), `${safeName(this.doc.title)}@2x.png`);
      this.notify('Exported PNG 2×.');
    } catch (error) {
      this.notify(error.message, 'error');
    }
  }

  /** Exports draw the whole capture at the runtime's default scale, with a readable tick step and the chosen link drawing. */
  exportOptions() {
    return { tickStep: this.tickStep(24), linkRoute: this.linkRoute };
  }

  /* ---------------- lookups and selection ---------------- */
  signal(id) {
    return this.doc?.signals.find((s) => s.id === id) ?? null;
  }

  edgeById(edgeId) {
    for (const s of this.doc.signals) for (const c of s.changes) if (c[2] === edgeId) return { signalId: s.id, t: c[0], id: edgeId };
    return null;
  }

  edgeAt(signalId, t) {
    const c = this.signal(signalId)?.changes.find((x) => x[0] === t);
    return c && t > 0 ? { signalId, t, id: c[2] } : null;
  }

  /** The value of a lane on [t, t+1). */
  valueAt(signalId, t) {
    let v = null;
    for (const c of this.signal(signalId)?.changes ?? []) if (c[0] <= t) v = c[1];
    return v;
  }

  select(sel) {
    this.sel = sel;
    this.fixSelection();
    this.render();
  }

  /** Keeps the selection valid after edits and Undo. */
  fixSelection() {
    const s = this.sel;
    if (!s || !this.doc) return;
    const gone = () => (this.sel = null);
    if ((s.type === 'signal' || s.type === 'range') && !this.signal(s.signalId)) return gone();
    if (s.type === 'range') {
      s.from = Math.max(0, Math.min(s.from, this.doc.length - 1));
      s.to = Math.max(s.from + 1, Math.min(s.to, this.doc.length));
    }
    if (s.type === 'edge') {
      const found = s.id ? this.edgeById(s.id) : this.edgeAt(s.signalId, s.t);
      if (!found) return gone();
      Object.assign(s, found);
    }
    if (s.type === 'link' && !this.doc.links?.[s.index]) return gone();
    if (s.type === 'marker' && !this.doc.markers?.some((m) => m.id === s.id)) return gone();
  }

  /* ---------------- view ---------------- */
  /** A grid label step that keeps labels apart and the grid within the renderer's limits. */
  tickStep(ppt = this.zoom) {
    const length = this.doc?.length ?? 1;
    return STEPS.find((s) => ppt * s >= 18 && length / s <= 4000) ?? STEPS.at(-1);
  }

  viewOptions() {
    return { pixelsPerTick: this.zoom, tickStep: this.tickStep(), idPrefix: ID_PREFIX, linkRoute: this.linkRoute };
  }

  setLinkRoute(route) {
    this.linkRoute = route;
    save(VIEW_KEY, { ...storage(VIEW_KEY, {}), linkRoute: route });
    this.renderStage();
    this.renderHead();
  }

  zoomBy(k) {
    const max = 10_000_000 / Math.max(1, this.doc.length) / 1.2;
    this.zoom = Math.min(Math.max(this.zoom * k, 0.05), 400, max);
    this.renderStage();
    this.renderHead();
  }

  fit() {
    if (!this.doc) return;
    const width = this.scroller.clientWidth || 800;
    const left = this.geo?.left ?? 160;
    const right = (this.geo?.width ?? 0) - (this.geo?.right ?? 0) || 160; // link rails
    this.zoom = Math.max(0.05, Math.min(400, (width - left - right - 24) / this.doc.length));
    this.renderStage();
    this.renderHead();
  }

  x(t) {
    return this.geo.left + (t - this.geo.from) * this.geo.pixelsPerTick;
  }

  tAt(x) {
    return this.geo.from + (x - this.geo.left) / this.geo.pixelsPerTick;
  }

  laneAt(y) {
    const half = this.geo.laneHeight / 2;
    return this.geo.lanes.find((l) => Math.abs(y - l.y) <= half) ?? null;
  }

  snapTime(raw, invert = false) {
    let level = this.snap === 'bit' && this.doc.grid ? 'bit' : 'tick';
    if (invert && this.doc.grid) level = level === 'bit' ? 'tick' : 'bit';
    return snapWaveformTime(this.doc, raw, level);
  }

  /**
   * What is under a point of the canvas, in this order:
   *  1. a link's label or delay dimension (their boxes, padded a few pixels);
   *  2. a transition within EDGE_HIT pixels on the lane under the pointer, so linked
   *     transitions stay draggable where link paths start and arrows end;
   *  3. a link path or arrow (within a few pixels): an arrow on its target transition
   *     therefore selects that transition, which is the one to drag;
   *  4. a marker's label or cursor line (a span's shaded band never takes the click);
   *  5. the lane label (selects the signal), then the lane itself.
   */
  hit(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (!this.geo) return { x, y };
    const linkIndex = (g) => (this.doc.links ?? []).findIndex((l) => l.from === g.dataset.fromEdge && l.to === g.dataset.toEdge);
    const PAD = 4;
    for (const part of this.sheet.querySelectorAll('[data-link] [data-role="link-label"], [data-link] [data-role="delay-dimension"]')) {
      const b = part.getBoundingClientRect();
      if (e.clientX >= b.left - PAD && e.clientX <= b.right + PAD && e.clientY >= b.top - PAD && e.clientY <= b.bottom + PAD) {
        const index = linkIndex(part.closest('[data-link]'));
        if (index >= 0) return { x, y, link: index };
      }
    }
    const lane = this.laneAt(y);
    const t = this.tAt(x);
    if (lane && x >= this.geo.left) {
      let edge = null, best = EDGE_HIT + 1;
      for (const ed of lane.edges) {
        const d = Math.abs(ed.x - x);
        if (ed.t > 0 && d < best) (best = d), (edge = ed);
      }
      if (edge) return { x, y, lane: lane.id, t, edge: { signalId: lane.id, t: edge.t, id: edge.id } };
    }
    // Link strokes are thin: look a few pixels around the pointer.
    for (const [dx, dy] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]])
      for (const el of document.elementsFromPoint(e.clientX + dx, e.clientY + dy)) {
        if (!this.sheet.contains(el)) continue;
        const g = el.closest('[data-link]');
        if (g) {
          const index = linkIndex(g);
          if (index >= 0) return { x, y, link: index };
        }
      }
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      if (!this.sheet.contains(el)) continue;
      const marker = el.closest('[data-marker]');
      if (marker && (el.tagName === 'text' || (el.tagName === 'path' && !lane))) return { x, y, marker: marker.dataset.marker };
    }
    if (!lane) return { x, y };
    if (x < this.geo.left) return { x, y, label: lane.id };
    return { x, y, lane: lane.id, t, edge: null };
  }

  /* ---------------- pointer ---------------- */
  pointerDown(e) {
    if (!this.doc || e.button !== 0) return;
    this.canvas.focus({ preventScroll: true });
    const hit = this.hit(e);
    if (this.linkFrom) {
      if (hit.edge) this.finishLink(hit.edge);
      else this.notify('Click a transition to link to, or press Escape.');
      return;
    }
    if (hit.link != null) return this.select({ type: 'link', index: hit.link });
    if (hit.marker) return this.select({ type: 'marker', id: hit.marker });
    if (hit.label) return this.select({ type: 'signal', signalId: hit.label });
    if (!hit.lane) return this.select(null);
    this.canvas.setPointerCapture(e.pointerId);
    if (hit.edge) {
      this.drag = { kind: 'edge', edge: hit.edge, to: hit.edge.t, moved: false };
      this.select({ type: 'edge', ...hit.edge });
    } else {
      const a = Math.min(this.doc.length - 1, Math.max(0, Math.floor(hit.t)));
      this.drag = { kind: 'range', signalId: hit.lane, a, b: a + 1, moved: false, t: hit.t };
    }
  }

  pointerMove(e) {
    if (!this.doc || !this.geo) return;
    const hit = this.hit(e);
    this.hover = hit.lane != null || hit.edge ? { t: Math.max(0, Math.min(this.doc.length, hit.t ?? 0)), lane: hit.lane } : null;
    this.canvas.classList.toggle('over-edge', Boolean(hit.edge) || this.drag?.kind === 'edge');
    const d = this.drag;
    if (d?.kind === 'edge') {
      const to = this.snapTime(this.tAt(hit.x), e.shiftKey);
      if (to !== d.to) {
        d.to = to;
        d.moved = true;
        d.preview = this.preview([this.moveOp(d.edge, to, { followLocked: !e.altKey })]);
        this.renderStage(d.preview?.doc);
      }
    } else if (d?.kind === 'range') {
      const t = Math.max(0, Math.min(this.doc.length, hit.t ?? 0));
      const s = this.snapTime(t, e.shiftKey);
      const start = Math.min(this.snapTime(d.t, e.shiftKey), s), end = Math.max(this.snapTime(d.t, e.shiftKey), s);
      if (end > start) {
        d.a = start;
        d.b = end;
        d.moved = true;
        this.drawOverlay();
      }
    }
    this.renderStatus();
  }

  pointerUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'edge') {
      if (d.moved && d.to !== d.edge.t) {
        if (d.preview?.error) {
          this.notify(d.preview.error, 'error');
          this.renderStage();
        } else this.moveEdge(d.edge, d.to, { followLocked: !e.altKey });
      } else this.renderStage();
      return;
    }
    if (d.kind === 'range') {
      if (d.moved) return this.select({ type: 'range', signalId: d.signalId, from: d.a, to: d.b });
      // A click selects the value segment under the pointer.
      const lane = this.geo.lanes.find((l) => l.id === d.signalId);
      const seg = lane?.segments.find((s) => d.t >= s.from && d.t < s.to) ?? lane?.segments.at(-1);
      if (seg) this.select({ type: 'range', signalId: d.signalId, from: seg.from, to: Math.max(seg.to, seg.from + 1) });
    }
  }

  cancelDrag() {
    this.drag = null;
    this.renderStage();
  }

  /** Double-click on a bit lane flips the clicked segment between 0 and 1. */
  doubleClick(e) {
    const hit = this.hit(e);
    if (!hit.lane || hit.edge || this.signal(hit.lane)?.width !== 1) return;
    const lane = this.geo.lanes.find((l) => l.id === hit.lane);
    const seg = lane.segments.find((s) => hit.t >= s.from && hit.t < s.to);
    if (!seg) return;
    const range = { type: 'range', signalId: hit.lane, from: seg.from, to: seg.to };
    this.setRange(range, seg.value === 1 ? 0 : 1);
  }

  /** Runs operations on a copy for a drag preview. */
  preview(ops) {
    try {
      return { doc: applyWaveformOps(this.doc, ops, { allowProblems: true }).document };
    } catch (error) {
      return { error: error.message };
    }
  }

  /* ---------------- edits ---------------- */
  moveOp(edge, to, { followLocked = true } = {}) {
    const op = edge.id ? { op: 'moveEdge', edgeId: edge.id, to } : { op: 'moveEdge', signalId: edge.signalId, t: edge.t, to };
    if (!followLocked) op.followLocked = false;
    return op;
  }

  moveEdge(edge, to, opts) {
    if (to === edge.t) return;
    const moved = this.apply([this.moveOp(edge, to, opts)]);
    if (moved) this.select({ type: 'edge', signalId: edge.signalId, t: to, id: edge.id });
  }

  setRange(range, value) {
    if (this.apply([{ op: 'setValue', signalId: range.signalId, from: range.from, to: range.to, value }])) this.select({ ...range });
  }

  /** A name for an unnamed transition: signal_t, made unique. */
  edgeName(edge) {
    const used = new Set(this.doc.signals.flatMap((s) => s.changes.map((c) => c[2]).filter(Boolean)));
    const base = `${edge.signalId}_${edge.t}`.replace(/[^\w.-]/g, '_').replace(/^(?=[^A-Za-z_])/, 'e_');
    let name = base, n = 2;
    while (used.has(name)) name = `${base}_${n++}`;
    return name;
  }

  startLink(edge) {
    this.linkFrom = edge;
    this.render();
    this.notify('Click the transition this one causes. Escape cancels.');
  }

  cancelLink() {
    this.linkFrom = null;
    this.render();
  }

  /** Links two transitions, naming them if needed; the expected delay is their current distance. */
  finishLink(target) {
    const source = this.linkFrom;
    this.linkFrom = null;
    if (source.signalId === target.signalId && source.t === target.t) return this.render();
    const ops = [];
    const fromId = source.id ?? this.edgeName(source);
    if (!source.id) ops.push({ op: 'nameEdge', signalId: source.signalId, t: source.t, name: fromId });
    let toId = target.id;
    if (!toId) {
      toId = this.edgeName(target);
      if (toId === fromId) toId += '_b';
      ops.push({ op: 'nameEdge', signalId: target.signalId, t: target.t, name: toId });
    }
    const links = [...(this.doc.links ?? []), { from: fromId, to: toId, delay: Math.max(0, target.t - source.t), locked: true }];
    ops.push({ op: 'setLinks', links });
    if (this.apply(ops, `Linked ${fromId} → ${toId}. Moving ${fromId} now moves ${toId}.`)) this.select({ type: 'link', index: links.length - 1 });
  }

  deleteSelection() {
    const s = this.sel;
    if (!s) return;
    if (s.type === 'link') {
      const links = this.doc.links.filter((_, i) => i !== s.index);
      if (this.apply([{ op: 'setLinks', links }], 'Removed the link.')) this.select(null);
    } else if (s.type === 'marker') {
      const markers = this.doc.markers.filter((m) => m.id !== s.id);
      if (this.apply([{ op: 'setMarkers', markers }], 'Removed the marker.')) this.select(null);
    } else if (s.type === 'edge') this.removeEdge(s);
    else if (s.type === 'signal') this.removeSignal(s.signalId);
  }

  /** Removes a transition by holding the previous value through the next one. */
  removeEdge(edge) {
    const lane = this.signal(edge.signalId);
    const next = lane.changes.find((c) => c[0] > edge.t)?.[0] ?? this.doc.length;
    const before = this.valueAt(edge.signalId, edge.t - 1);
    if (edge.id && (this.doc.links ?? []).some((l) => l.from === edge.id || l.to === edge.id))
      return this.notify(`${edge.id} has links. Remove its links first.`, 'error');
    const ops = [];
    if (edge.id) ops.push({ op: 'setSignal', signal: { ...lane, changes: lane.changes.map((c) => (c[0] === edge.t ? [c[0], c[1]] : c)) } });
    ops.push({ op: 'setValue', signalId: edge.signalId, from: edge.t, to: next, value: before });
    if (this.apply(ops, 'Removed the transition.')) this.select({ type: 'range', signalId: edge.signalId, from: Math.max(0, edge.t - 1), to: next });
  }

  addSignal(width) {
    const used = new Set(this.doc.signals.map((s) => s.id));
    let n = this.doc.signals.length + 1;
    while (used.has(`sig${n}`)) n++;
    const id = `sig${n}`;
    if (this.apply([{ op: 'setSignal', signal: { id, label: width > 1 ? `Bus ${n}` : `Signal ${n}`, width, changes: [[0, 0]] } }], `Added ${id}.`)) this.select({ type: 'signal', signalId: id });
  }

  removeSignal(id) {
    const lane = this.signal(id);
    const names = new Set(lane.changes.map((c) => c[2]).filter(Boolean));
    const dropped = (this.doc.links ?? []).filter((l) => names.has(l.from) || names.has(l.to)).length;
    if (this.replace((d) => {
      d.signals = d.signals.filter((s) => s.id !== id);
      if (d.links) d.links = d.links.filter((l) => !names.has(l.from) && !names.has(l.to));
    }, `Removed ${lane.label ?? id}${dropped ? ` and ${plural(dropped, 'link')}` : ''}.`))
      this.select(null);
  }

  moveSignal(id, delta) {
    const i = this.doc.signals.findIndex((s) => s.id === id);
    const j = i + delta;
    if (j < 0 || j >= this.doc.signals.length) return;
    this.replace((d) => d.signals.splice(j, 0, ...d.signals.splice(i, 1)));
  }

  /** A lane field: id and width rename/reshape the lane, the rest go through setSignal. */
  setSignalField(id, key, value) {
    const lane = this.signal(id);
    if (key === 'id') {
      if (value === id) return;
      if (this.replace((d) => (d.signals.find((s) => s.id === id).id = value))) this.select({ type: 'signal', signalId: value });
      return;
    }
    const next = structuredClone(lane);
    if (value === '' || value === undefined) delete next[key];
    else next[key] = value;
    this.apply([{ op: 'setSignal', signal: next }]);
  }

  addMarker() {
    const s = this.sel;
    const ids = new Set((this.doc.markers ?? []).map((m) => m.id));
    let n = (this.doc.markers?.length ?? 0) + 1;
    while (ids.has(`m${n}`)) n++;
    const id = `m${n}`;
    const marker = s?.type === 'range' ? { id, from: s.from, to: s.to, label: `${s.to - s.from} ticks` } : { id, t: s?.type === 'edge' ? s.t : Math.round(this.hover?.t ?? 0), label: id };
    if (this.apply([{ op: 'setMarkers', markers: [...(this.doc.markers ?? []), marker] }], `Added marker ${id}.`)) this.select({ type: 'marker', id });
  }

  /* ---------------- rendering ---------------- */
  render() {
    const open = Boolean(this.doc);
    const panes = storage(PANES_KEY, {});
    this.startEl.hidden = open;
    this.scroller.hidden = !open;
    this.el.classList.toggle('outline-hidden', !open || Boolean(panes.outline));
    this.el.classList.toggle('inspector-hidden', !open || Boolean(panes.inspector));
    this.el.classList.toggle('linking', Boolean(this.linkFrom));
    this.undoBtn.disabled = !this.past.length;
    this.redoBtn.disabled = !this.future.length;
    document.title = open ? `${this.doc.title} — blockflow Waveform editor` : 'blockflow Waveform editor';
    this.titleEl.textContent = open ? this.doc.title : '';
    this.renderHead();
    if (!open) {
      this.renderStatus();
      return this.renderStart();
    }
    this.renderStage();
    this.renderList();
    this.renderInspector();
    this.renderStatus();
  }

  renderStart() {
    fill(
      this.startEl,
      h('h2', 'Draw synchronous timing'),
      h('p', 'Start a new waveform, load the DShot example, or open a waveform JSON or a VCD from a simulation. You can also drop the file on this page.'),
      h(
        'div',
        { class: 'insp-actions' },
        button('New waveform', () => this.open(newWaveform(), { message: 'Started a new waveform.', fit: true }), { variant: 'primary', icon: 'plus' }),
        button('DShot example', () => this.open(dshotExample, { message: 'Loaded the DShot example.', fit: true }), { variant: 'ghost' }),
        button('Open a file…', () => this.fileInput.click(), { variant: 'ghost', icon: 'file' }),
      ),
    );
  }

  renderHead() {
    fill(this.crumbs, h('span', { class: 'crumb current', 'aria-current': 'page' }, this.doc ? this.doc.title : 'No waveform'));
    if (!this.doc) return this.tools.replaceChildren();
    // fill() skips null children; replaceChildren would print them.
    fill(
      this.tools,
      this.doc.grid
        ? segmented(
            [
              { value: 'tick', label: 'Tick', title: 'Snap to ticks (Shift while dragging: bits)' },
              { value: 'bit', label: 'Bit', title: 'Snap to bit boundaries (Shift while dragging: ticks)' },
            ],
            this.snap,
            (v) => ((this.snap = v), this.renderHead()),
            { class: 'small', ariaLabel: 'Snap to', fidKey: 'snap' },
          )
        : null,
      (this.doc.links ?? []).length
        ? segmented(
            [
              { value: 'auto', label: 'Auto', title: 'Links run between nearby lanes; far or crowded ones use the right-hand rail' },
              { value: 'local', label: 'Local', title: 'Every link runs between the lanes' },
              { value: 'rail', label: 'Rail', title: 'Every link uses the right-hand rail' },
            ],
            this.linkRoute,
            (v) => this.setLinkRoute(v),
            { class: 'small', ariaLabel: 'Link drawing', fidKey: 'link-route' },
          )
        : null,
      iconButton('minus', 'Zoom out (−)', () => this.zoomBy(1 / 1.5)),
      h('span', { class: 'wv-zoom' }, `${+this.zoom.toFixed(this.zoom < 1 ? 2 : 1)} px/tick`),
      iconButton('plus', 'Zoom in (+)', () => this.zoomBy(1.5)),
      iconButton('fit', 'Fit the whole waveform (Shift+1)', () => this.fit()),
      button('Marker', () => this.addMarker(), { variant: 'ghost', icon: 'plus', title: 'Add a marker at the selection' }),
      this.returnTo ? button('Send to Story editor', () => this.sendToStory(), { variant: 'primary', icon: 'enter', title: `Put this waveform back into ${this.returnTo.label}` }) : null,
    );
  }

  /**
   * Draws the runtime SVG for `doc` at the current zoom. The SVG is rebuilt only when the
   * document or the view changed; a selection change only refreshes the overlay, so the
   * elements under the pointer survive between the two clicks of a double-click.
   */
  renderStage(doc = this.doc) {
    if (!doc) return;
    try {
      const options = this.viewOptions();
      const key = JSON.stringify(options);
      if (doc !== this.drawn?.doc || key !== this.drawn?.key) {
        this.geo = layoutWaveform(doc, options);
        this.sheet.innerHTML = renderWaveformSvg(doc, options);
        this.drawn = { doc, key };
      }
      this.stageError = null;
    } catch (error) {
      this.drawn = null;
      this.stageError = error.message;
      this.sheet.replaceChildren(h('p', { class: 'wv-error' }, `This view cannot be drawn: ${error.message} Zoom out or in to change the grid.`));
      this.geo = null;
    }
    const w = this.geo?.width ?? 400, hgt = this.geo?.height ?? 120;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = hgt + 'px';
    this.overlay.setAttribute('width', w);
    this.overlay.setAttribute('height', hgt);
    this.overlay.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
    this.markSelected();
    this.drawOverlay();
  }

  /** Selected links and markers are the runtime's own groups, found by their identity. */
  markSelected() {
    for (const el of this.sheet.querySelectorAll('.wv-selected')) {
      el.classList.remove('wv-selected');
      if (!el.classList.length) el.removeAttribute('class'); // leave the runtime markup as it was
    }
    const s = this.sel;
    if (s?.type === 'link') {
      const l = this.doc.links[s.index];
      for (const g of this.sheet.querySelectorAll('[data-link]')) if (g.dataset.fromEdge === l.from && g.dataset.toEdge === l.to) g.classList.add('wv-selected');
    }
    if (s?.type === 'marker') for (const g of this.sheet.querySelectorAll('[data-marker]')) if (g.dataset.marker === s.id) g.classList.add('wv-selected');
  }

  drawOverlay() {
    const g = this.geo;
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      return n;
    };
    const parts = [];
    if (g) {
      const laneOf = (id) => g.lanes.find((l) => l.id === id);
      const band = (id, from, to, cls) => {
        const lane = laneOf(id);
        if (lane) parts.push(el('rect', { class: cls, x: this.x(from), y: lane.y - g.laneHeight / 2 + 4, width: Math.max(2, this.x(to) - this.x(from)), height: g.laneHeight - 8, rx: 3 }));
      };
      const edgeMark = (edge, cls) => {
        const lane = laneOf(edge.signalId);
        if (lane) parts.push(el('rect', { class: cls, x: this.x(edge.t) - 3, y: lane.y - g.laneHeight / 2 + 2, width: 6, height: g.laneHeight - 4, rx: 2 }));
      };
      const s = this.sel;
      if (this.drag?.kind === 'range' && this.drag.moved) band(this.drag.signalId, this.drag.a, this.drag.b, 'wv-range');
      else if (s?.type === 'range') band(s.signalId, s.from, s.to, 'wv-range');
      if (s?.type === 'signal') {
        const lane = laneOf(s.signalId);
        if (lane) parts.push(el('rect', { class: 'wv-lane-sel', x: 2, y: lane.y - g.laneHeight / 2 + 1, width: g.width - 4, height: g.laneHeight - 2, rx: 4 }));
      }
      if (s?.type === 'edge') edgeMark(this.drag?.kind === 'edge' ? { ...s, t: this.drag.to } : s, 'wv-edge-sel');
      if (this.linkFrom) edgeMark(this.linkFrom, 'wv-edge-link');
    }
    this.overlay.replaceChildren(...parts);
  }

  renderStatus() {
    if (!this.doc) return fill(this.status, h('span', 'No waveform open'), h('div', { class: 'spacer' }), h('span', { class: 'hints' }, `${modKey} O opens a file`));
    const grid = this.doc.grid;
    const at = (t) => (grid ? `t = ${t} (bit ${Math.floor((t - (grid.offset ?? 0)) / grid.ticksPerBit)} + ${(((t - (grid.offset ?? 0)) % grid.ticksPerBit) + grid.ticksPerBit) % grid.ticksPerBit})` : `t = ${t}`);
    const d = this.drag;
    const where = d?.kind === 'edge' ? `${at(d.to)} · Δ ${d.to - d.edge.t}${d.preview?.error ? ' · cannot move here' : ''}` : d?.kind === 'range' && d.moved ? `${d.a}–${d.b} · ${d.b - d.a} ticks` : this.hover ? at(Math.floor(this.hover.t)) : '';
    fill(
      this.status,
      h('span', `${plural(this.doc.signals.length, 'signal')} · ${this.doc.length} ${this.doc.timescale}`),
      where ? h('span', { class: 'mono' }, where) : null,
      this.problems.length ? h('span', { class: 'st warn' }, icon('warn', 12), ` ${plural(this.problems.length, 'problem')}`) : h('span', { class: 'st ok' }, icon('check', 12), ' No problems'),
      h('div', { class: 'spacer' }),
      h('span', { class: 'hints' }, this.linkFrom ? 'Click the transition to link to · Escape cancels' : 'Drag a transition to move it · drag on a lane to select · 0 1 X Z set values · double-click flips'),
    );
  }

  renderList() {
    fill(
      this.listHead,
      h('h2', 'Signals'),
      h('div', { class: 'spacer' }),
      iconButton('plus', 'Add signal', (e) =>
        showMenu(
          e.currentTarget,
          [
            { label: 'Bit signal', action: () => this.addSignal(1) },
            { label: 'Bus (8 bits)', action: () => this.addSignal(8) },
          ],
          { label: 'Add signal' },
        ),
      ),
    );
    const s = this.sel;
    const row = (selected, onclick, ...children) => h('button', { type: 'button', class: ['row', 'story-row', selected && 'selected'], 'aria-current': selected ? 'true' : undefined, onclick }, ...children);
    const problemAt = (path) => this.problems.some((p) => p.path.startsWith(path));
    replaceKeepingFocus(
      this.listBody,
      h(
        'div',
        { class: 'rows story-rows' },
        row(s == null, () => this.select(null), icon('file', 14), h('span', { class: 'row-label' }, 'Waveform settings')),
        ...this.doc.signals.map((sig, i) =>
          row(
            (s?.type === 'signal' || s?.type === 'range') && s.signalId === sig.id,
            () => this.select({ type: 'signal', signalId: sig.id }),
            h('span', { class: 'story-n' }, sig.width > 1 ? `[${sig.width}]` : '1'),
            h('span', { class: 'row-label' }, sig.label ?? sig.id),
            problemAt(`signals[${i}]`) ? h('span', { class: 'story-warn' }, icon('warn', 12)) : null,
          ),
        ),
      ),
      h('h3', { class: 'wv-list-head' }, 'Links'),
      h(
        'div',
        { class: 'rows story-rows' },
        (this.doc.links ?? []).length
          ? this.doc.links.map((l, i) =>
              row(
                s?.type === 'link' && s.index === i,
                () => this.select({ type: 'link', index: i }),
                icon('link', 14),
                h('span', { class: 'row-label' }, l.label || `${l.from} → ${l.to}`),
                l.locked ? h('span', { class: 'story-tag' }, 'locked') : null,
                problemAt(`links[${i}]`) ? h('span', { class: 'story-warn' }, icon('warn', 12)) : null,
              ),
            )
          : h('p', { class: 'insp-hint wv-empty' }, 'Select a transition and choose Link to show what it causes.'),
      ),
      h('h3', { class: 'wv-list-head' }, 'Markers'),
      h(
        'div',
        { class: 'rows story-rows' },
        (this.doc.markers ?? []).length
          ? this.doc.markers.map((m) => row(s?.type === 'marker' && s.id === m.id, () => this.select({ type: 'marker', id: m.id }), icon('target', 14), h('span', { class: 'row-label' }, m.label || m.id), h('span', { class: 'count' }, m.t != null ? String(m.t) : `${m.from}–${m.to}`)))
          : h('p', { class: 'insp-hint wv-empty' }, 'Marker in the canvas head adds one at the selection.'),
      ),
      this.problems.length
        ? h('div', { class: 'wv-problems' }, h('h3', { class: 'wv-list-head' }, 'Problems'), ...this.problems.map((p) => h('p', { class: 'insp-hint story-problems' }, icon('warn', 12), ` ${p.path}: ${p.message}`)))
        : null,
    );
  }

  /* ---------------- inspector ---------------- */
  renderInspector() {
    const s = this.sel;
    const title = (text, sub, ...actions) => fill(this.editHead, h('div', { class: 'insp-title' }, h('div', { class: 'insp-title-text' }, h('h2', text), sub ? h('div', { class: 'insp-sub' }, sub) : null)), ...actions);
    const num = (value, fid, label, commit, extra = {}) => textInput({ type: 'number', value: value == null ? '' : String(value), fidKey: fid, ariaLabel: label, min: extra.min ?? 0, commit });
    const int = (v, what) => {
      const n = Number(v);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${what} must be a whole number of ticks, 0 or more.`);
      return n;
    };
    const sections = [];
    if (!s) {
      title('Waveform', `${plural(this.doc.signals.length, 'signal')} · ${this.doc.length} ticks`);
      const grid = this.doc.grid;
      sections.push(
        h(
          'div',
          { class: 'insp-section stack' },
          field('Title', textInput({ value: this.doc.title, fidKey: 'w-title', commit: (v) => this.apply([{ op: 'updateDocument', patch: { title: v.trim() || 'Waveform' } }]) })),
          h(
            'div',
            { class: 'grid2' },
            field('Timescale', textInput({ value: this.doc.timescale, fidKey: 'w-timescale', commit: (v) => this.apply([{ op: 'updateDocument', patch: { timescale: v.trim() } }]) }), { hint: 'A description such as clk or 1ns.' }),
            field('Length', num(this.doc.length, 'w-length', 'Length in ticks', (v) => this.apply([{ op: 'updateDocument', patch: { length: int(v, 'Length') } }])), { hint: 'Ticks shown.' }),
          ),
        ),
        h(
          'div',
          { class: 'insp-section stack' },
          h('div', { class: 'insp-section-head' }, h('h3', 'Bit grid')),
          checkbox('Show a bit grid', Boolean(grid), (on) =>
            on ? this.apply([{ op: 'updateDocument', patch: { grid: { ticksPerBit: 8, offset: 0 } } }]) : this.replace((d) => delete d.grid),
          ),
          grid
            ? h(
                'div',
                { class: 'grid2' },
                field('Ticks per bit', num(grid.ticksPerBit, 'w-tpb', 'Ticks per bit', (v) => this.apply([{ op: 'updateDocument', patch: { grid: { ...grid, ticksPerBit: Math.max(1, int(v, 'Ticks per bit')) } } }]))),
                field('First bit at', num(grid.offset ?? 0, 'w-offset', 'First bit at tick', (v) => this.apply([{ op: 'updateDocument', patch: { grid: { ...grid, offset: int(v, 'First bit') } } }]))),
              )
            : null,
        ),
      );
    } else if (s.type === 'signal' || s.type === 'range') {
      const sig = this.signal(s.signalId);
      title(sig.label ?? sig.id, sig.width > 1 ? `Bus · ${sig.width} bits` : 'Bit signal',
        iconButton('more', 'Signal actions', (e) =>
          showMenu(
            e.currentTarget,
            [
              { label: 'Move up', icon: 'up', action: () => this.moveSignal(sig.id, -1) },
              { label: 'Move down', icon: 'down', action: () => this.moveSignal(sig.id, 1) },
              '-',
              { label: 'Delete signal', icon: 'trash', danger: true, action: () => this.removeSignal(sig.id) },
            ],
            { label: 'Signal actions', align: 'right' },
          ),
        ),
      );
      if (s.type === 'range') sections.push(this.rangeSection(s, sig));
      sections.push(
        h(
          'div',
          { class: 'insp-section stack' },
          h('div', { class: 'grid2' },
            field('ID', textInput({ value: sig.id, fidKey: 's-id', mono: true, commit: (v) => this.setSignalField(sig.id, 'id', v.trim()) })),
            field('Width', num(sig.width, 's-width', 'Width in bits', (v) => this.setSignalField(sig.id, 'width', Math.max(1, int(v, 'Width'))), { min: 1 })),
          ),
          field('Label', textInput({ value: sig.label ?? '', placeholder: sig.id, fidKey: 's-label', commit: (v) => this.setSignalField(sig.id, 'label', v.trim()) })),
          h('div', { class: 'grid2' },
            field('Scope', textInput({ value: sig.scope ?? '', placeholder: 'e.g. FC.TX', fidKey: 's-scope', commit: (v) => this.setSignalField(sig.id, 'scope', v.trim()) })),
            field('Block port', textInput({ value: sig.port ?? '', placeholder: 'Module.port', fidKey: 's-port', mono: true, commit: (v) => this.setSignalField(sig.id, 'port', v.trim()) })),
          ),
          field('Color', textInput({ value: sig.style?.color ?? '', placeholder: '#2457d6', fidKey: 's-color', mono: true, commit: (v) => this.setSignalField(sig.id, 'style', v.trim() ? { color: v.trim() } : '') })),
        ),
      );
      if (sig.width === 1 && this.doc.grid) sections.push(this.encodeSection(sig));
    } else if (s.type === 'edge') {
      const sig = this.signal(s.signalId);
      const before = this.valueAt(s.signalId, s.t - 1), after = this.valueAt(s.signalId, s.t);
      const links = (this.doc.links ?? []).map((l, i) => ({ ...l, i })).filter((l) => s.id && (l.from === s.id || l.to === s.id));
      title(s.id ?? 'Transition', `${sig.label ?? sig.id} · ${before} → ${after}`,
        iconButton('link', 'Link to the transition this one causes', () => this.startLink({ signalId: s.signalId, t: s.t, id: s.id })),
      );
      sections.push(
        h(
          'div',
          { class: 'insp-section stack' },
          h('div', { class: 'grid2' },
            field('Time', num(s.t, 'e-t', 'Transition time', (v) => this.moveEdge(s, int(v, 'Time'))), { hint: 'Locked links follow.' }),
            field('Name', textInput({ value: s.id ?? '', placeholder: 'unnamed', fidKey: 'e-name', mono: true, commit: (v) => this.renameEdge(s, v.trim()) }), { hint: 'Needed for links.' }),
          ),
          h('div', { class: 'insp-actions' },
            button('Link to…', () => this.startLink({ signalId: s.signalId, t: s.t, id: s.id }), { icon: 'link', variant: 'ghost' }),
            button('Remove', () => this.removeEdge(s), { icon: 'trash', variant: 'ghost' }),
          ),
        ),
        h(
          'div',
          { class: 'insp-section' },
          h('div', { class: 'insp-section-head' }, h('h3', 'Links'), h('span', { class: 'count' }, String(links.length))),
          ...(links.length
            ? links.map((l) => h('button', { type: 'button', class: 'row story-row', onclick: () => this.select({ type: 'link', index: l.i }) }, icon('link', 14), h('span', { class: 'row-label' }, `${l.from === s.id ? 'causes' : 'caused by'} ${l.from === s.id ? l.to : l.from}`), l.locked ? h('span', { class: 'story-tag' }, 'locked') : null))
            : [h('p', { class: 'insp-hint' }, 'None. Link to… then click another transition.')]),
        ),
      );
    } else if (s.type === 'link') {
      const l = this.doc.links[s.index];
      const a = this.edgeById(l.from), b = this.edgeById(l.to);
      const actual = a && b ? b.t - a.t : null;
      const edit = (patch) => this.apply([{ op: 'setLinks', links: this.doc.links.map((x, i) => (i === s.index ? Object.fromEntries(Object.entries({ ...x, ...patch }).filter(([, v]) => v !== undefined)) : x)) }]);
      title(l.label || 'Link', `${l.from} → ${l.to}`, iconButton('trash', 'Delete link', () => this.deleteSelection()));
      sections.push(
        h(
          'div',
          { class: 'insp-section stack' },
          field('Label', textInput({ value: l.label ?? '', fidKey: 'l-label', commit: (v) => edit({ label: v.trim() || undefined }) })),
          h('div', { class: 'grid2' },
            field('Expected delay', num(l.delay, 'l-delay', 'Expected delay in ticks', (v) => edit({ delay: v === '' ? undefined : int(v, 'Delay') })), { hint: actual == null ? 'An end is missing.' : `Now ${actual} ticks.` }),
            field('Follow', checkbox('Locked: the target moves with the source', Boolean(l.locked), (on) => edit({ locked: on || undefined }))),
          ),
          h('div', { class: 'insp-actions' },
            button('Apply the delay now', () => this.apply([{ op: 'followLocked', edgeId: l.from }], 'Moved the linked transitions.'), { variant: 'ghost', disabled: !l.locked || !a }),
            a ? button(`Select ${l.from}`, () => this.select({ type: 'edge', ...a }), { variant: 'ghost' }) : null,
            b ? button(`Select ${l.to}`, () => this.select({ type: 'edge', ...b }), { variant: 'ghost' }) : null,
          ),
          ...this.problems.filter((p) => p.path.startsWith(`links[${s.index}]`)).map((p) => h('p', { class: 'insp-hint story-problems' }, icon('warn', 12), ` ${p.message}`)),
        ),
      );
    } else if (s.type === 'marker') {
      const m = this.doc.markers.find((x) => x.id === s.id);
      const edit = (patch) => this.apply([{ op: 'setMarkers', markers: this.doc.markers.map((x) => (x.id === s.id ? { ...x, ...patch } : x)) }]);
      title(m.label || m.id, m.t != null ? 'Cursor' : 'Span', iconButton('trash', 'Delete marker', () => this.deleteSelection()));
      sections.push(
        h(
          'div',
          { class: 'insp-section stack' },
          field('Label', textInput({ value: m.label ?? '', fidKey: 'm-label', commit: (v) => edit({ label: v }) })),
          m.t != null
            ? field('Time', num(m.t, 'm-t', 'Marker time', (v) => edit({ t: int(v, 'Time') })))
            : h('div', { class: 'grid2' }, field('From', num(m.from, 'm-from', 'Span start', (v) => edit({ from: int(v, 'From') }))), field('To', num(m.to, 'm-to', 'Span end', (v) => edit({ to: int(v, 'To') })))),
        ),
      );
    }
    replaceKeepingFocus(this.editBody, ...sections);
  }

  rangeSection(s, sig) {
    const len = s.to - s.from;
    const value = this.valueAt(sig.id, s.from);
    return h(
      'div',
      { class: 'insp-section stack' },
      h('div', { class: 'insp-section-head' }, h('h3', `Ticks ${s.from}–${s.to}`), h('span', { class: 'count' }, `${len}`)),
      sig.width === 1
        ? field('Value', segmented(['0', '1', 'x', 'z'].map((v) => ({ value: v, label: v.toUpperCase(), title: `Set ${v.toUpperCase()} (key ${v.toUpperCase()})` })), String(value), (v) => this.setRange(s, v === '0' || v === '1' ? Number(v) : v), { fidKey: 'r-value', ariaLabel: 'Value' }))
        : field('Value', textInput({ value: value == null ? '' : String(value), fidKey: 'r-value', mono: true, commit: (v) => this.setRange(s, /^\d+$/.test(v.trim()) ? Number(v.trim()) : v.trim()) }), { hint: 'A number, 0x/0b text, b-vector, x, z or any label.' }),
      h(
        'div',
        { class: 'insp-actions' },
        button(`Insert ${len} ticks here`, () => this.apply([{ op: 'insertTicks', at: s.from, count: len }], `Inserted ${len} ticks at ${s.from}.`), { variant: 'ghost', icon: 'plus' }),
        button('Delete these ticks', () => this.apply([{ op: 'deleteTicks', from: s.from, to: s.to }], `Deleted ticks ${s.from}–${s.to}.`), { variant: 'ghost', icon: 'trash' }),
        button('Span marker', () => this.addMarker(), { variant: 'ghost', icon: 'target' }),
      ),
    );
  }

  /** Generates a bit lane from a bit sequence at the grid: high ticks per 0 and per 1. */
  encodeSection(sig) {
    const tpb = this.doc.grid.ticksPerBit;
    const state = { bits: '', zero: String(Math.round((tpb * 3) / 8)), one: String(Math.round((tpb * 6) / 8)) };
    return h(
      'div',
      { class: 'insp-section stack' },
      h('div', { class: 'insp-section-head' }, h('h3', 'Generate from bits')),
      h('p', { class: 'insp-hint' }, `Replaces this lane: each bit is ${tpb} ticks, high for the given ticks, low otherwise (DShot: 1 = 6, 0 = 3 of 8). Use ${tpb} and 0 for NRZ.`),
      field('Bits', h('input', { class: 'input mono', 'data-fid': 'enc-bits', placeholder: '1011', oninput: (e) => (state.bits = e.target.value) })),
      h('div', { class: 'grid2' },
        field('High ticks for 0', h('input', { class: 'input', type: 'number', min: 0, max: tpb, value: state.zero, 'data-fid': 'enc-zero', oninput: (e) => (state.zero = e.target.value) })),
        field('High ticks for 1', h('input', { class: 'input', type: 'number', min: 0, max: tpb, value: state.one, 'data-fid': 'enc-one', oninput: (e) => (state.one = e.target.value) })),
      ),
      h('div', { class: 'insp-actions' },
        button('Generate', () => {
          const bits = state.bits.replace(/\s+/g, '');
          if (!/^[01]+$/.test(bits)) return this.notify('Bits must be 0s and 1s.', 'error');
          this.apply([{ op: 'encodeBits', signalId: sig.id, bits: [...bits].map(Number), zeroHigh: Number(state.zero), oneHigh: Number(state.one) }], `Generated ${bits.length} bits.`);
        }, { variant: 'primary' }),
      ),
    );
  }

  renameEdge(edge, name) {
    if ((edge.id ?? '') === name) return;
    if (!name) return this.notify('A transition name cannot be cleared here; it may be linked.', 'error');
    const ops = [edge.id ? { op: 'nameEdge', edgeId: edge.id, name } : { op: 'nameEdge', signalId: edge.signalId, t: edge.t, name }];
    if (edge.id && this.doc.links?.length) ops.push({ op: 'setLinks', links: this.doc.links.map((l) => ({ ...l, from: l.from === edge.id ? name : l.from, to: l.to === edge.id ? name : l.to })) });
    if (this.apply(ops)) this.select({ type: 'edge', signalId: edge.signalId, t: edge.t, id: name });
  }
}
