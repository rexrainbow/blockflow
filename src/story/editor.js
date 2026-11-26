import './player.css';
import './story.css';
import { h, fill, replaceKeepingFocus, storage, store as save, singleLine, modKey } from '../studio/ui/dom.js';
import { iconButton, button, field, textInput, select, segmented, checkbox, showMenu, closeMenu, modal } from '../studio/ui/controls.js';
import { icon } from '../studio/ui/icons.js';
import { PREFS_KEY } from '../studio/core/store.js';
import { downloadBlob } from '../lib/shared/export/browser.js';
import { LayoutService } from '../editor/blockchart/services/layout.js';
import { validateDocument } from '../editor/blockchart/commands.js';
import { createPlayer } from './player.js';
import {
  presentationData,
  svgIndex,
  storyProblems,
  parseStory,
  parseWave,
  emptyStory,
  newStep,
  newHop,
  newChapter,
  flatSteps,
  isStoryFile,
  readPresentationSources,
  diagramFingerprint,
  STORY_KINDS,
} from './model.js';
import { presentationHtml } from './export.js';
import { receiveHandoff, pageUrl, STUDIO_PAGE } from './handoff.js';

/** Browser copies of stories, one per diagram name. */
export const STORIES_KEY = 'blockflow.story.stories';
/** Stories written by the former Story mode of the Studio; read when no newer copy exists. */
const LEGACY_STORIES_KEY = 'blockflow.studio.stories';
/** The diagram this page last showed, so a reload continues where it was. */
export const SESSION_KEY = 'blockflow.story.session';
const PANES_KEY = 'blockflow.story.panes';
const THEMES = ['system', 'light', 'dark'];
const KIND_LABEL = { event: 'Trigger', level: 'Waveform', data: 'Data', control: 'Stop' };
const KIND_COLOR = { event: '#2563eb', level: '#059669', data: '#7c3aed', control: '#dc2626' }; // as player.css
const safeName = (name) => (name || 'diagram').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The Story editor (story.html): authors a stepped presentation of signal flow over a Block
 * diagram. The diagram is input only; it is laid out and drawn by the Block diagram runtime
 * (the same SVG the Studio exports) and never edited here. The story refers to wires by their
 * endpoints and to blocks by id. The left pane lists chapters and steps, the centre is the
 * presentation player in edit mode and the right pane edits the selected step or chapter.
 * Export writes one offline HTML page with the same player, the SVG and both sources.
 */
export class StoryEditor {
  constructor(root) {
    this.root = root;
    this.cleanups = [];
    this.diagram = null;
    this.diagramName = '';
    this.layout = null;
    this.layoutError = null;
    this.layoutPending = false;
    this.story = emptyStory();
    this.sel = { ci: 0, si: 0 };
    this.hop = 0;
    this.past = [];
    this.future = [];
    this.problems = [];
    this.layoutService = new LayoutService((result) => this.onLayout(result));
    this.build();
    this.applyTheme();
    this.bindKeys();
    this.bindDrop();
    /** Settles once a hand-off or the restored session (if any) has been opened. */
    this.started = this.start();
  }

  dispose() {
    this.layoutService.dispose();
    this.player?.destroy();
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
    this.sourceEl = h('span', { class: 'story-source' });
    const topbar = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand', title: 'blockflow Story editor' }, h('span', { class: 'logo' }, icon('logo')), h('span', { class: 'brand-name' }, 'blockflow')),
      iconButton('panelLeft', 'Toggle story list', () => this.togglePane('outline'), { class: 'pane-toggle' }),
      h('span', { class: 'kind-chip', 'data-kind': 'story', title: 'Story editor: presentations of Block diagrams' }, icon('nextStep', 14), h('span', { class: 'kind-chip-text' }, 'Story editor')),
      this.sourceEl,
      h('div', { class: 'spacer' }),
      this.undoBtn,
      this.redoBtn,
      h('span', { class: 'bar-sep' }),
      this.themeBtn,
      button('File', (e) => this.fileMenu(e.currentTarget), { variant: 'ghost', class: 'menu-btn', attrs: { 'aria-haspopup': 'menu' } }),
      button('Export', (e) => this.exportMenu(e.currentTarget), { variant: 'primary', icon: 'download', class: 'export-btn', attrs: { 'aria-haspopup': 'menu', 'aria-label': 'Export' } }),
      iconButton('panelRight', 'Toggle step editor', () => this.togglePane('inspector'), { class: 'pane-toggle' }),
    );
    this.crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Presentation' });
    this.tools = h('div', { class: 'canvas-tools' });
    this.startEl = h('div', { class: 'story-start' });
    this.host = h('div', { class: 'story-stage', 'aria-label': 'Presentation preview' });
    this.status = h('footer', { class: 'statusbar', role: 'status', 'aria-live': 'polite' });
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    const center = h('main', { class: 'center', 'aria-label': 'Presentation' }, h('div', { class: 'canvas-head' }, this.crumbs, h('div', { class: 'spacer' }), this.tools), this.startEl, this.host, this.status, this.toasts);
    this.listHead = h('div', { class: 'pane-head' });
    this.listBody = h('div', { class: 'story-list' });
    this.listEl = h('aside', { class: 'pane outline', 'aria-label': 'Story steps' }, this.listHead, this.listBody);
    this.editHead = h('div', { class: 'insp-head' });
    this.editBody = h('div', { class: 'insp-body' });
    this.editEl = h('aside', { class: 'pane inspector', 'aria-label': 'Step editor' }, this.editHead, this.editBody);
    this.scrim = h('div', { class: 'scrim', onclick: () => (this.el.dataset.drawer = '') });
    this.fileInput = h('input', {
      type: 'file',
      accept: '.json,application/json,.html,.htm,text/html',
      hidden: true,
      onchange: (e) => {
        this.openFile(e.target.files[0]);
        e.target.value = '';
      },
    });
    this.el = h('div', { class: 'studio story-app', 'data-kind': 'story' }, topbar, h('div', { class: 'workspace' }, this.listEl, center, this.editEl, this.scrim), this.fileInput);
    this.root.replaceChildren(this.el);
    const narrow = matchMedia('(max-width: 1000px)');
    const sync = () => this.el.classList.toggle('narrow', narrow.matches);
    this.listen(narrow, 'change', sync);
    sync();
    this.player = createPlayer(this.host, { edit: true, onStep: (i) => this.onPlayerStep(i), onPick: (pick) => this.pick(pick) });
  }

  togglePane(which) {
    if (this.el.classList.contains('narrow')) {
      this.el.dataset.drawer = this.el.dataset.drawer === which ? '' : which;
      return;
    }
    const panes = storage(PANES_KEY, {});
    panes[which] = !panes[which];
    save(PANES_KEY, panes);
    this.el.classList.toggle(`${which}-hidden`, panes[which]);
  }

  /** The Studio's theme preference, so both pages look the same. */
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
    this.notify(`Theme: ${next}. The diagram itself always shows on white.`);
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

  fileMenu(anchor) {
    showMenu(
      anchor,
      [
        { label: 'Open…', icon: 'file', shortcut: modKey + '+O', action: () => this.fileInput.click() },
        { label: 'Save story JSON', icon: 'download', shortcut: modKey + '+S', disabled: !this.diagram, action: () => this.saveStory() },
        { label: 'New story', icon: 'file', disabled: !this.diagram, action: () => this.newStory() },
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
        { heading: 'Presentation of the whole diagram' },
        { label: 'Presentation HTML', icon: 'download', action: () => this.exportHtml() },
        { label: 'Preview in a new tab', icon: 'enter', action: () => this.preview() },
        '-',
        { heading: 'Story source' },
        { label: 'Save story JSON', icon: 'download', action: () => this.saveStory() },
      ],
      { label: 'Export', align: 'right' },
    );
  }

  bindKeys() {
    this.listen(document, 'keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'o') return e.preventDefault(), this.fileInput.click();
      if (mod && key === 's') return e.preventDefault(), this.saveStory();
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('.modal-backdrop, .menu')) return;
      if (mod && key === 'z') return e.preventDefault(), e.shiftKey ? this.redo() : this.undo();
      if (mod && key === 'y') return e.preventDefault(), this.redo();
      if (this.diagram && this.player.key(e)) e.preventDefault();
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

  /* ---------------- diagram ---------------- */
  /** A hand-off from the Studio wins; otherwise the last diagram of this page; otherwise the start screen. */
  async start() {
    this.waiting = Boolean(window.opener);
    this.render();
    const incoming = await receiveHandoff();
    this.waiting = false;
    if (incoming?.html) return this.tryOpen(() => this.openSources(readPresentationSources(incoming.html), incoming.name));
    if (incoming?.diagram) {
      this.tryOpen(() => this.openDiagram(incoming.diagram, { name: incoming.diagram.diagram?.name, message: 'Opened the diagram from the Studio.' }));
      if (incoming.story) this.tryOpen(() => this.openStory(incoming.story, incoming.name ?? 'the story'));
      return;
    }
    const session = storage(SESSION_KEY, null);
    if (session?.diagram) this.tryOpen(() => this.openDiagram(session.diagram, { message: null }));
    this.render();
  }

  tryOpen(run, name) {
    try {
      return run();
    } catch (error) {
      this.notify(`${name ? `Could not open ${name}: ` : ''}${error.message}`, 'error');
      this.render();
    }
  }

  /** Any supported file: a Block diagram, a story JSON or an exported presentation HTML. */
  async openFile(file) {
    if (!file) return;
    const text = await file.text();
    this.tryOpen(() => {
      if (/\.html?$/i.test(file.name) || /^\s*<(!doctype|html)/i.test(text)) return this.openSources(readPresentationSources(text), file.name);
      let value;
      try {
        value = JSON.parse(text.replace(/^﻿/, ''));
      } catch (error) {
        throw new Error(`not valid JSON (${error.message}).`);
      }
      if (isStoryFile(value)) return this.openStory(value, file.name);
      if (value && typeof value === 'object' && Array.isArray(value.modules)) return this.openDiagram(value, { name: file.name, message: `Opened ${file.name}.` });
      if (value && typeof value === 'object' && (Array.isArray(value.nodes) || Array.isArray(value.states)))
        throw new Error('the Story editor presents Block diagrams. Flowcharts and statecharts open in the Studio.');
      throw new Error('expected a Block diagram, a story JSON or an exported presentation HTML.');
    }, file.name);
  }

  /** Shows a Block diagram and the story kept in this browser for its name (or a new one). */
  openDiagram(doc, { story = null, message = '' } = {}) {
    validateDocument(doc);
    if (!doc.modules.length) throw new Error('the diagram has no blocks to present.');
    this.diagram = structuredClone(doc);
    this.diagramName = doc.diagram?.name || 'diagram';
    if (!save(SESSION_KEY, { diagram: this.diagram })) this.notify('This browser is out of storage; the diagram will not be restored after a reload.', 'error');
    this.layout = null;
    this.layoutError = null;
    this.layoutPending = true;
    this.layoutService.request(this.diagram, { rootGroupId: null });
    this.story = story ?? this.storedStory() ?? emptyStory(this.diagramName);
    this.past = [];
    this.future = [];
    this.resetSelection();
    if (story) this.persist();
    this.refresh({ keepCamera: false });
    this.render();
    if (message) this.notify(message);
  }

  /** An exported presentation: its own diagram and story, both editable again. */
  openSources({ diagram, story }, name) {
    this.openDiagram(diagram, { story, message: `Opened ${name ?? 'the presentation'}: diagram and story are editable again.` });
  }

  /** A story JSON for the open diagram. Undo returns to the previous story. */
  openStory(value, name) {
    const story = parseStory(value);
    if (!this.diagram) throw new Error('open its Block diagram first, then the story.');
    this.replaceStory(story, `Opened story ${name}.`);
    const ref = story.diagram;
    if (ref?.name && ref.name !== this.diagramName) this.notify(`This story was made for “${ref.name}”, not “${this.diagramName}”. Missing wires and blocks are marked.`, 'error');
    else if (ref?.sha256)
      diagramFingerprint(this.diagram).then((sha) => {
        if (sha !== ref.sha256) this.notify('This story was saved with a different version of this diagram. Missing wires and blocks are marked.');
      });
  }

  onLayout(result) {
    this.layoutPending = false;
    if (result.error) {
      this.layoutError = { message: result.error, path: result.path };
      this.layout = null;
    } else {
      this.layoutError = null;
      this.layout = { svg: result.svg };
    }
    this.refresh({ keepCamera: false });
    this.render();
  }

  /* ---------------- storage and history ---------------- */
  storedStory() {
    for (const key of [STORIES_KEY, LEGACY_STORIES_KEY]) {
      const saved = storage(key, {})[this.diagramName];
      if (!saved) continue;
      try {
        return parseStory(saved);
      } catch {
        /* a damaged copy: start a new story */
      }
    }
    return null;
  }

  persist() {
    if (!this.diagram) return;
    const all = storage(STORIES_KEY, {});
    all[this.diagramName] = this.story;
    if (!save(STORIES_KEY, all)) this.notify('The story could not be saved in this browser: storage is full.', 'error');
  }

  /** Applies a change to a copy of the story; Undo restores the previous copy. */
  commit(change, { keepCamera = true } = {}) {
    const before = JSON.stringify(this.story);
    const next = structuredClone(this.story);
    change(next);
    if (JSON.stringify(next) === before) return;
    this.past.push(before);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.story = next;
    this.afterChange(keepCamera);
  }

  undo() {
    if (!this.past.length) return false;
    this.future.push(JSON.stringify(this.story));
    this.story = JSON.parse(this.past.pop());
    this.afterChange(true);
    this.notify('Undone.');
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.past.push(JSON.stringify(this.story));
    this.story = JSON.parse(this.future.pop());
    this.afterChange(true);
    this.notify('Redone.');
    return true;
  }

  afterChange(keepCamera) {
    this.fixSelection();
    this.persist();
    this.refresh({ keepCamera });
    this.render();
  }

  replaceStory(story, message) {
    this.past.push(JSON.stringify(this.story));
    this.future = [];
    this.story = story;
    this.resetSelection();
    this.persist();
    this.refresh({ keepCamera: false });
    this.render();
    this.notify(message, 'info', { label: 'Undo', run: () => this.undo() });
  }

  newStory() {
    if (!this.diagram) return;
    this.replaceStory(emptyStory(this.diagramName), 'Started a new story.');
  }

  /* ---------------- selection ---------------- */
  resetSelection() {
    this.sel = { ci: 0, si: this.story.chapters[0]?.steps.length ? 0 : null };
    this.hop = 0;
  }

  fixSelection() {
    const chapters = this.story.chapters;
    if (!chapters.length) return (this.sel = { ci: -1, si: null });
    const ci = Math.min(Math.max(this.sel.ci, 0), chapters.length - 1);
    const steps = chapters[ci].steps;
    const si = this.sel.si == null || !steps.length ? null : Math.min(this.sel.si, steps.length - 1);
    this.sel = { ci, si };
    const hops = this.step()?.hops.length ?? 0;
    this.hop = Math.max(0, Math.min(this.hop, hops - 1));
  }

  step(sel = this.sel) {
    return sel.si == null ? null : (this.story.chapters[sel.ci]?.steps[sel.si] ?? null);
  }

  flatIndex(sel = this.sel) {
    let i = 0;
    for (let c = 0; c < this.story.chapters.length; c++) {
      if (c === sel.ci) return i + (sel.si ?? 0);
      i += this.story.chapters[c].steps.length;
    }
    return 0;
  }

  select(sel, { play = false } = {}) {
    this.sel = sel;
    this.hop = 0;
    this.fixSelection();
    this.render();
    if (this.step()) this.player.show(this.flatIndex(), { instant: !play, hop: play ? null : this.hop });
  }

  /** The player moved (its own buttons, keys or autoplay): follow it in the panes. */
  onPlayerStep(i) {
    const at = flatSteps(this.story)[i];
    if (!at || (at.ci === this.sel.ci && at.si === this.sel.si)) return;
    this.sel = { ci: at.ci, si: at.si };
    this.hop = 0;
    this.render();
  }

  /* ---------------- player ---------------- */
  refresh({ keepCamera = true } = {}) {
    if (!this.diagram) return;
    if (!this.layout) {
      this.problems = [];
      return this.player.setData({ message: this.layoutError ? `The diagram could not be laid out: ${this.layoutError.message}` : 'Laying out the diagram…', chapters: [] });
    }
    this.problems = storyProblems(this.story, svgIndex(this.layout.svg));
    this.player.setData(presentationData({ svg: this.layout.svg, story: this.story }), { index: this.flatIndex(), instant: true, keepCamera, hop: this.step() ? this.hop : null });
  }

  pick({ type, id, shift }) {
    const step = this.step();
    if (!step) return this.notify('Select a step first, then click wires or blocks to add them.');
    if (type === 'wire') {
      if (step.scope) return this.notify('A chapter overview shows every wire of its chapter. Switch it to Animated hops to pick wires.');
      let added = false;
      this.commit((story) => {
        const s = story.chapters[this.sel.ci].steps[this.sel.si];
        if (!s.hops.length || shift) {
          s.hops.push({ ...newHop(s.hops.at(-1)?.kind ?? 'event'), wires: [id] });
          this.hop = s.hops.length - 1;
          added = true;
          return;
        }
        const hop = s.hops[this.hop];
        const at = hop.wires.indexOf(id);
        if (at >= 0) hop.wires.splice(at, 1);
        else hop.wires.push(id), (added = true);
      });
      this.notify(`${added ? 'Added' : 'Removed'} ${id} ${added ? 'to' : 'from'} hop ${this.hop + 1}.`);
    } else if (type === 'module') {
      const index = step.notes?.findIndex((n) => n.module === id) ?? -1;
      if (index < 0)
        this.commit((story) => {
          (story.chapters[this.sel.ci].steps[this.sel.si].notes ??= []).push({ module: id, text: '' });
        });
      const n = index < 0 ? this.step().notes.length - 1 : index;
      requestAnimationFrame(() => this.editBody.querySelector(`[data-fid="story-note-${n}"]`)?.focus());
    }
  }

  /* ---------------- files ---------------- */
  /** Player data once the diagram is laid out; otherwise null with a message shown. */
  ready(what) {
    if (!this.diagram) return this.notify(`Open a Block diagram first, then ${what}.`, 'error'), null;
    if (!this.layout) return this.notify(this.layoutError ? 'The diagram could not be laid out; nothing to export.' : `Wait for the layout to finish, then ${what} again.`, 'error'), null;
    return presentationData({ svg: this.layout.svg, story: this.story });
  }

  pageHtml(data) {
    return presentationHtml(data, { diagram: this.diagram, story: this.story });
  }

  exportHtml() {
    const data = this.ready('export');
    if (!data) return;
    if (!flatSteps(this.story).length) return this.notify('Add at least one step before exporting.', 'error');
    downloadBlob(new Blob([this.pageHtml(data)], { type: 'text/html' }), `${safeName(this.diagramName)}-presentation.html`);
    const missing = this.problems.length;
    this.notify(`Exported presentation HTML. Open it here again to keep editing.${missing ? ` ${plural(missing, 'missing reference')} skipped.` : ''}`);
  }

  preview() {
    const data = this.ready('preview');
    if (!data) return;
    const url = URL.createObjectURL(new Blob([this.pageHtml(data)], { type: 'text/html' }));
    const win = window.open(`${url}#step-${this.flatIndex() + 1}`, '_blank');
    if (!win) this.notify('The browser blocked the preview tab. Export the HTML instead.', 'error');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async saveStory() {
    if (!this.diagram) return this.notify('Open a Block diagram first; a story belongs to a diagram.', 'error');
    const story = { ...this.story, diagram: { name: this.diagramName, sha256: await diagramFingerprint(this.diagram) } };
    downloadBlob(new Blob([JSON.stringify(story, null, 2) + '\n'], { type: 'application/json' }), `${safeName(this.diagramName)}.story.json`);
    this.notify('Saved the story JSON.');
  }

  /* ---------------- panes ---------------- */
  render() {
    const open = Boolean(this.diagram);
    const panes = storage(PANES_KEY, {});
    this.startEl.hidden = open;
    this.host.hidden = !open;
    // Without a diagram there is nothing to list or edit: the start screen takes the width.
    this.el.classList.toggle('outline-hidden', !open || Boolean(panes.outline));
    this.el.classList.toggle('inspector-hidden', !open || Boolean(panes.inspector));
    this.undoBtn.disabled = !this.past.length;
    this.redoBtn.disabled = !this.future.length;
    document.title = open ? `${this.story.title} — blockflow Story editor` : 'blockflow Story editor';
    this.sourceEl.textContent = open ? this.diagramName : '';
    this.sourceEl.title = open ? `Block diagram: ${this.diagramName}` : '';
    this.renderHead();
    this.renderStatus();
    if (!open) return this.renderStart();
    this.renderList();
    this.renderEditor();
  }

  renderHead() {
    fill(this.crumbs, h('span', { class: 'crumb current', 'aria-current': 'page' }, this.diagram ? this.story.title : 'No diagram'));
    this.tools.replaceChildren(
      ...(this.diagram
        ? [
            button('Preview', () => this.preview(), { variant: 'ghost', icon: 'enter', title: 'Open the presentation in a new tab' }),
            button('Export HTML', () => this.exportHtml(), { variant: 'ghost', icon: 'download', title: 'Download the presentation as one HTML file' }),
          ]
        : []),
    );
  }

  renderStart() {
    if (this.waiting) return fill(this.startEl, h('h2', 'Receiving the diagram from the Studio…'));
    fill(
      this.startEl,
      h('h2', 'Present a Block diagram step by step'),
      h('p', 'Open a Block diagram JSON to start a story, a story JSON for the open diagram, or a presentation HTML exported here to keep editing it. You can also drop the file on this page.'),
      h('div', { class: 'insp-actions' }, button('Open a file…', () => this.fileInput.click(), { variant: 'primary', icon: 'file' })),
      h('p', 'In the Studio, Export › Open in Story editor brings the current Block diagram here.'),
    );
  }

  renderStatus() {
    const steps = this.story.chapters.reduce((n, c) => n + c.steps.length, 0);
    const state = !this.diagram
      ? null
      : this.layoutError
        ? h('span', { class: 'st error' }, icon('error', 12), ' Layout failed')
        : this.layoutPending
          ? h('span', { class: 'st busy' }, h('span', { class: 'spinner small' }), ' Laying out…')
          : h('span', { class: 'st ok' }, icon('check', 12), ' Up to date');
    fill(
      this.status,
      this.diagram ? h('span', `${plural(this.story.chapters.length, 'chapter')} · ${plural(steps, 'step')}`) : h('span', 'No diagram open'),
      state,
      this.problems.length ? h('span', { class: 'st warn' }, icon('warn', 12), ` ${plural(this.problems.length, 'missing reference')}`) : null,
      h('div', { class: 'spacer' }),
      this.diagram ? h('span', { class: 'hints' }, 'Click wires to add them to the selected hop · Shift+click starts a new hop · ← → steps') : h('span', { class: 'hints' }, `${modKey} O opens a file`),
    );
  }

  storyMenu(anchor) {
    showMenu(
      anchor,
      [
        { label: 'Preview presentation', icon: 'enter', action: () => this.preview() },
        { label: 'Export presentation HTML', icon: 'download', action: () => this.exportHtml() },
        '-',
        { label: 'Open…', icon: 'file', action: () => this.fileInput.click() },
        { label: 'Save story JSON', icon: 'download', action: () => this.saveStory() },
        { label: 'New story', icon: 'file', action: () => this.newStory() },
      ],
      { label: 'Story' },
    );
  }

  renderList() {
    fill(this.listHead, h('h2', 'Story'), h('div', { class: 'spacer' }), iconButton('plus', 'Add step', () => this.addStep()), iconButton('more', 'Story actions', (e) => this.storyMenu(e.currentTarget)));
    const bad = new Set(this.problems.map((p) => `${p.ci}:${p.si}`));
    const rows = [];
    this.story.chapters.forEach((ch, ci) => {
      const chapterSelected = this.sel.ci === ci && this.sel.si == null;
      rows.push(
        h(
          'button',
          { type: 'button', class: ['row', 'story-row', 'story-chapter', chapterSelected && 'selected'], 'aria-current': chapterSelected ? 'true' : undefined, onclick: () => this.select({ ci, si: null }) },
          icon('layers', 14),
          h('span', { class: 'row-label' }, ch.title || 'Untitled chapter'),
          h('span', { class: 'count' }, String(ch.steps.length)),
        ),
      );
      ch.steps.forEach((s, si) => {
        const selected = this.sel.ci === ci && this.sel.si === si;
        rows.push(
          h(
            'button',
            {
              type: 'button',
              class: ['row', 'story-row', 'story-step', selected && 'selected', bad.has(`${ci}:${si}`) && 'warn'],
              'aria-current': selected ? 'true' : undefined,
              onclick: () => this.select({ ci, si }),
              ondblclick: () => this.select({ ci, si }, { play: true }),
            },
            h('span', { class: 'story-n' }, String(si + 1)),
            h('span', { class: 'row-label' }, singleLine(s.title) || 'Untitled step'),
            s.scope ? h('span', { class: 'story-tag' }, 'overview') : null,
            bad.has(`${ci}:${si}`) ? h('span', { class: 'story-warn', title: 'Refers to wires or blocks the diagram does not have' }, icon('warn', 12)) : null,
          ),
        );
      });
    });
    replaceKeepingFocus(
      this.listBody,
      h('div', { class: 'story-title' }, field('Presentation title', textInput({ value: this.story.title, fidKey: 'story-title', commit: (v) => this.commit((st) => (st.title = v.trim() || 'Presentation')) }))),
      h('div', { class: 'rows story-rows' }, rows.length ? rows : h('div', { class: 'empty-row' }, 'No chapters yet')),
      h('div', { class: 'insp-actions' }, button('Add chapter', () => this.addChapter(), { icon: 'plus', variant: 'ghost' })),
      this.problems.length ? h('p', { class: 'insp-hint story-problems' }, icon('warn', 12), ` ${plural(this.problems.length, 'reference')} not in the diagram. They are kept in the story and skipped when playing.`) : null,
    );
  }

  renderEditor() {
    const step = this.step();
    const chapter = this.story.chapters[this.sel.ci];
    if (!chapter) {
      fill(this.editHead, h('div', { class: 'insp-title' }, h('div', { class: 'insp-title-text' }, h('h2', 'Story'))));
      return replaceKeepingFocus(this.editBody, h('div', { class: 'insp-section' }, h('p', { class: 'insp-hint' }, 'Add a chapter to start.')));
    }
    if (!step) return this.renderChapter(chapter);
    const chapterName = chapter.title || `Chapter ${this.sel.ci + 1}`;
    fill(
      this.editHead,
      h('div', { class: 'insp-title' }, h('div', { class: 'insp-title-text' }, h('h2', `Step ${this.sel.si + 1}`), h('div', { class: 'insp-sub' }, chapterName))),
      iconButton('nextStep', 'Play this step', () => this.player.show(this.flatIndex())),
      iconButton('more', 'Step actions', (e) =>
        showMenu(
          e.currentTarget,
          [
            { label: 'Move up', icon: 'up', disabled: this.sel.si === 0 && this.sel.ci === 0, action: () => this.moveStep(-1) },
            { label: 'Move down', icon: 'down', action: () => this.moveStep(1), disabled: this.sel.ci === this.story.chapters.length - 1 && this.sel.si === chapter.steps.length - 1 },
            { label: 'Duplicate', icon: 'copy', action: () => this.duplicateStep() },
            '-',
            { label: 'Delete step', icon: 'trash', danger: true, action: () => this.deleteStep() },
          ],
          { label: 'Step actions', align: 'right' },
        ),
      ),
    );
    const edit = (fn, opts) => this.commit((st) => fn(st.chapters[this.sel.ci].steps[this.sel.si], st), opts);
    const sections = [
      h(
        'div',
        { class: 'insp-section stack' },
        field('Title', textInput({ value: step.title, fidKey: 'story-step-title', commit: (v) => edit((s) => (s.title = v)) })),
        field('Caption', textInput({ value: step.body, multiline: true, fidKey: 'story-step-body', commit: (v) => edit((s) => (s.body = v)) }), { hint: 'Shown beside the diagram while this step plays.' }),
        field(
          'Shows',
          segmented(
            [
              { value: 'hops', label: 'Animated hops', title: 'Wires travel hop by hop' },
              { value: 'scope', label: 'Chapter overview', title: 'Every wire of this chapter at once' },
            ],
            step.scope ? 'scope' : 'hops',
            (v) => edit((s) => (v === 'scope' ? (s.scope = true) : delete s.scope), { keepCamera: false }),
            { fidKey: 'story-scope', ariaLabel: 'What the step shows' },
          ),
        ),
        field(
          'Camera',
          segmented(
            [
              { value: 'step', label: 'Follow the step', title: 'Zoom to the step, following each hop' },
              { value: 'all', label: 'Whole diagram', title: 'Keep the whole diagram in view' },
            ],
            step.camera === 'all' ? 'all' : 'step',
            (v) => edit((s) => (v === 'all' ? (s.camera = 'all') : delete s.camera), { keepCamera: false }),
            { fidKey: 'story-camera', ariaLabel: 'Camera' },
          ),
        ),
      ),
    ];
    if (!step.scope) sections.push(this.hopsSection(step, edit));
    sections.push(this.notesSection(step, edit));
    if (chapter.wave) sections.push(this.stepWaveSection(step, chapter.wave, edit));
    replaceKeepingFocus(this.editBody, ...sections);
  }

  hopsSection(step, edit) {
    const missing = new Set(this.problems.filter((p) => p.type === 'wire').map((p) => p.ref));
    return h(
      'div',
      { class: 'insp-section' },
      h('div', { class: 'insp-section-head' }, h('h3', 'Hops'), h('span', { class: 'count' }, String(step.hops.length))),
      h('p', { class: 'insp-hint' }, 'Click wires on the diagram to add or remove them in the selected hop. Shift+click starts a new hop. Hops play in order; wires in one hop travel together.'),
      ...step.hops.map((hop, hi) =>
        h(
          'div',
          {
            class: ['story-hop', hi === this.hop && 'selected'],
            onclick: (e) => {
              if (hi === this.hop || e.target.closest('input, select, button')) return;
              this.hop = hi;
              this.render();
              this.player.show(this.flatIndex(), { instant: true, keepCamera: true, hop: hi });
            },
          },
          h(
            'div',
            { class: 'story-hop-head' },
            h('span', { class: 'story-hop-n', style: { '--k': KIND_COLOR[hop.kind] } }, `Hop ${hi + 1}`),
            select(
              STORY_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
              hop.kind,
              (v) => edit((s) => (s.hops[hi].kind = v)),
              { ariaLabel: `Hop ${hi + 1} kind`, fidKey: `story-hop-${hi}-kind` },
            ),
            textInput({ value: hop.badge ?? '', placeholder: 'Badge', ariaLabel: `Hop ${hi + 1} badge`, fidKey: `story-hop-${hi}-badge`, commit: (v) => edit((s) => (v.trim() ? (s.hops[hi].badge = v.trim()) : delete s.hops[hi].badge)) }),
            iconButton('up', 'Move hop earlier', () => edit((s) => s.hops.splice(hi - 1, 0, ...s.hops.splice(hi, 1))), { disabled: hi === 0 }),
            iconButton('trash', `Delete hop ${hi + 1}`, () => edit((s) => s.hops.splice(hi, 1))),
          ),
          hop.wires.length
            ? h(
                'ul',
                { class: 'story-wires' },
                hop.wires.map((ref, wi) =>
                  h(
                    'li',
                    { class: missing.has(ref) && 'missing', title: missing.has(ref) ? 'This wire is not in the diagram' : ref },
                    missing.has(ref) ? icon('warn', 12) : null,
                    h('span', { class: 'mono' }, ref),
                    iconButton('close', `Remove ${ref}`, () => edit((s) => s.hops[hi].wires.splice(wi, 1)), { class: 'small' }),
                  ),
                ),
              )
            : h('p', { class: 'insp-hint story-empty' }, hi === this.hop ? 'Click a wire on the diagram.' : 'No wires.'),
        ),
      ),
      h('div', { class: 'insp-actions' }, button('Add hop', () => edit((s) => (s.hops.push(newHop(s.hops.at(-1)?.kind)), (this.hop = s.hops.length - 1))), { icon: 'plus', variant: 'ghost' })),
    );
  }

  notesSection(step, edit) {
    const modules = this.layout ? svgIndex(this.layout.svg).modules : {};
    const notes = step.notes ?? [];
    return h(
      'div',
      { class: 'insp-section' },
      h('div', { class: 'insp-section-head' }, h('h3', 'Notes'), h('span', { class: 'count' }, String(notes.length))),
      h('p', { class: 'insp-hint' }, 'Click a block on the diagram to add a note above it.'),
      ...notes.map((n, ni) =>
        h(
          'div',
          { class: ['story-note', this.layout && !modules[n.module] && 'missing'] },
          h('span', { class: 'story-note-block', title: n.module }, singleLine(modules[n.module]?.label ?? n.module).split(' / ')[0]),
          textInput({ value: n.text, placeholder: 'Note text', ariaLabel: `Note on ${n.module}`, fidKey: `story-note-${ni}`, commit: (v) => edit((s) => (s.notes[ni].text = v)) }),
          iconButton('trash', `Delete note on ${n.module}`, () => edit((s) => (s.notes.splice(ni, 1), s.notes.length || delete s.notes))),
        ),
      ),
    );
  }

  stepWaveSection(step, wave, edit) {
    const rows = step.wave?.rows ?? [];
    const total = wave.period * wave.bits.length;
    const setRows = (name, on) =>
      edit((s) => {
        const w = (s.wave ??= { rows: [], from: 0, to: total });
        w.rows = on ? [...new Set([...w.rows, name])] : w.rows.filter((r) => r !== name);
        if (!w.rows.length) delete s.wave;
      });
    const num = (key) =>
      textInput({
        type: 'number',
        value: String(step.wave?.[key] ?? (key === 'from' ? 0 : total)),
        ariaLabel: key === 'from' ? 'Highlight from clock' : 'Highlight to clock',
        fidKey: `story-wave-${key}`,
        min: 0,
        commit: (v) => {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) throw new Error('Enter a clock number of 0 or more.');
          edit((s) => ((s.wave ??= { rows: [], from: 0, to: total })[key] = n));
        },
      });
    return h(
      'div',
      { class: 'insp-section stack' },
      h('div', { class: 'insp-section-head' }, h('h3', 'Timing strip')),
      h('p', { class: 'insp-hint' }, 'Rows to emphasise while this step plays, and the clock range the cursor sweeps.'),
      h('div', { class: 'story-wave-rows' }, wave.rows.map((r) => checkbox(r.name, rows.includes(r.name), (on) => setRows(r.name, on)))),
      h('div', { class: 'grid2' }, field('From clock', num('from')), field('To clock', num('to'))),
    );
  }

  renderChapter(chapter) {
    const ci = this.sel.ci;
    fill(
      this.editHead,
      h('div', { class: 'insp-title' }, h('div', { class: 'insp-title-text' }, h('h2', chapter.title || `Chapter ${ci + 1}`), h('div', { class: 'insp-sub' }, `Chapter ${ci + 1} of ${this.story.chapters.length}`))),
      iconButton('more', 'Chapter actions', (e) =>
        showMenu(
          e.currentTarget,
          [
            { label: 'Move up', icon: 'up', disabled: ci === 0, action: () => this.moveChapter(-1) },
            { label: 'Move down', icon: 'down', disabled: ci === this.story.chapters.length - 1, action: () => this.moveChapter(1) },
            '-',
            { label: 'Delete chapter', icon: 'trash', danger: true, action: () => this.deleteChapter() },
          ],
          { label: 'Chapter actions', align: 'right' },
        ),
      ),
    );
    const waveText = chapter.wave ? JSON.stringify(chapter.wave, null, 2) : '';
    replaceKeepingFocus(
      this.editBody,
      h('div', { class: 'insp-section stack' }, field('Chapter title', textInput({ value: chapter.title, fidKey: 'story-chapter-title', commit: (v) => this.commit((st) => (st.chapters[ci].title = v)) }))),
      h(
        'div',
        { class: 'insp-section stack' },
        h('div', { class: 'insp-section-head' }, h('h3', 'Timing strip')),
        h('p', { class: 'insp-hint' }, 'Optional waveform under the diagram: { "period", "bits", "rows": [{ "name", "perBit": { "0": [[from, to]], "1": … } } or { "name", "tick", "showBit" }] }. Leave empty for none.'),
        textInput({
          value: waveText,
          multiline: true,
          mono: true,
          ariaLabel: 'Timing strip JSON',
          fidKey: 'story-chapter-wave',
          commit: (v) => {
            if (!v.trim()) return this.commit((st) => delete st.chapters[ci].wave);
            let parsed;
            try {
              parsed = JSON.parse(v);
            } catch (error) {
              throw new Error(`Not valid JSON: ${error.message}`);
            }
            const wave = parseWave(parsed);
            this.commit((st) => (st.chapters[ci].wave = wave));
          },
        }),
      ),
      h('div', { class: 'insp-actions' }, button('Add step to this chapter', () => this.addStep(ci), { icon: 'plus', variant: 'ghost' })),
    );
  }

  /* ---------------- structure edits ---------------- */
  addStep(ci = this.sel.ci) {
    if (!this.story.chapters.length) return this.addChapter();
    const chapter = Math.max(0, ci);
    const at = this.sel.ci === chapter && this.sel.si != null ? this.sel.si + 1 : this.story.chapters[chapter].steps.length;
    this.commit((st) => st.chapters[chapter].steps.splice(at, 0, newStep(`Step ${at + 1}`)));
    this.select({ ci: chapter, si: at });
    requestAnimationFrame(() => this.editBody.querySelector('[data-fid="story-step-title"]')?.select());
  }

  addChapter() {
    const at = this.story.chapters.length;
    this.commit((st) => st.chapters.push(newChapter(`Chapter ${at + 1}`)));
    this.select({ ci: at, si: null });
  }

  moveStep(delta) {
    const flat = flatSteps(this.story);
    const j = this.flatIndex() + delta;
    if (j < 0 || j >= flat.length) return;
    const { ci, si } = this.sel;
    const target = flat[j];
    this.commit((st) => {
      const [s] = st.chapters[ci].steps.splice(si, 1);
      // Across a chapter boundary the step joins the end or start of the neighbour chapter.
      if (target.ci === ci) st.chapters[ci].steps.splice(target.si, 0, s);
      else if (delta < 0) st.chapters[target.ci].steps.push(s);
      else st.chapters[target.ci].steps.unshift(s);
    });
    this.select(target.ci === ci ? { ci, si: target.si } : { ci: target.ci, si: delta < 0 ? this.story.chapters[target.ci].steps.length - 1 : 0 });
  }

  moveChapter(delta) {
    const ci = this.sel.ci;
    this.sel = { ci: ci + delta, si: null };
    this.commit((st) => st.chapters.splice(ci + delta, 0, ...st.chapters.splice(ci, 1)), { keepCamera: false });
  }

  duplicateStep() {
    const { ci, si } = this.sel;
    this.commit((st) => st.chapters[ci].steps.splice(si + 1, 0, { ...structuredClone(st.chapters[ci].steps[si]), title: `${st.chapters[ci].steps[si].title} (copy)` }));
    this.select({ ci, si: si + 1 });
  }

  deleteStep() {
    const { ci, si } = this.sel;
    const title = this.step()?.title || 'Untitled step';
    this.commit((st) => st.chapters[ci].steps.splice(si, 1));
    this.select({ ci, si: this.story.chapters[ci].steps.length ? Math.min(si, this.story.chapters[ci].steps.length - 1) : null });
    this.notify(`Deleted step “${title}”.`, 'info', { label: 'Undo', run: () => this.undo() });
  }

  deleteChapter() {
    const ci = this.sel.ci;
    const chapter = this.story.chapters[ci];
    const go = () => {
      this.commit((st) => st.chapters.splice(ci, 1));
      this.select({ ci: Math.min(ci, this.story.chapters.length - 1), si: null });
      this.notify(`Deleted chapter “${chapter.title || 'Untitled chapter'}”.`, 'info', { label: 'Undo', run: () => this.undo() });
    };
    if (!chapter.steps.length) return go();
    modal({
      title: 'Delete this chapter?',
      body: h('p', `“${chapter.title || 'Untitled chapter'}” and its ${plural(chapter.steps.length, 'step')} are removed. You can undo this.`),
      actions: [{ label: 'Cancel' }, { label: 'Delete chapter', variant: 'primary', run: () => (go(), true) }],
    });
  }
}
