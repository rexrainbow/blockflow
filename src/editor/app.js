import { validViewRoot, viewScopeOptions } from './state/view-scope.js';
import { groupType } from '../lib/group-type.js';
import { migrateLegacyLayout } from './state/legacy-layout.js';
import { normalizeDisplayText } from '../lib/model.js';
import { ancestors, descendants, itemPath, canPlace } from '../lib/hierarchy.js';
import example from '../../examples/nested-groups.json';
import { downloadBlob, svgToPngBlob } from '../lib/export/browser.js';
import { renderBlockList } from './components/block-list.js';
import { History } from './state/history.js';
import {
  emptyDocument,
  portOwner,
  setGroupType,
  setGroupCollapsed,
  addGroup,
  removeGroup,
  groupOf,
  placeBlock,
  moveBlock,
  validateDocument,
  addModule,
  convertToBoundaryGroup,
  removeModule,
  addPort,
  removePort,
  renamePort,
  renameModule,
  moveItem,
  movePort,
  endpoints,
  targetReason,
  connectionKey,
} from './state/commands.js';
import { LayoutService } from './services/layout.js';
import { Preview } from './components/preview.js';
import { previewActions } from './components/preview-actions.js';
import { renderLabelDialog } from './components/label-dialog.js';
import {
  renderStyleDialog,
  readStyleDialog,
  selectStyleTab,
  styleErrorField,
} from './components/style-dialog.js';
import {
  singleLine,
  escape as e,
  icon,
  button,
  field,
  input,
  textarea,
  resizeTextareas,
  select,
  sortActions,
  feedbackControl,
  positionDisclosureMenu,
  hideContentsControl,
  setFieldError,
  clearFieldError,
  bindDisclosureMenus,
} from './components/ui.js';

const STORAGE = 'blockflow.editor.v1';
const VIEW_STORAGE = 'blockflow.editor.view';
const VIEWS = ['split', 'editor', 'preview'];
const defaultExample = () => {
  const doc = structuredClone(example);
  doc.diagram.name = 'Pipeline / Feedback';
  for (const module of doc.modules) for (const port of module.ports) delete port.width;
  return doc;
};
const json = (value) => JSON.stringify(value);

export function startEditor(root) {
  return new Editor(root);
}

class Editor {
  constructor(root) {
    this.root = root;
    let document = defaultExample();
    let restored = false;
    let drafts = [];
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
      if (stored?.document && Array.isArray(stored.document.modules)) {
        stored.document = migrateLegacyLayout(stored.document);
        // Restore unfinished zero-port blocks, but reject malformed schema/identifiers.
        const check = structuredClone(stored.document);
        check.modules.forEach((module) => {
          if (module.ports?.length === 0) module.ports.push({ id: '_draft', direction: 'input' });
        });
        try {
          validateDocument(check);
        } catch (error) {
          if (error.message !== 'Connection width mismatch') throw error;
        }
        document = stored.document;
        drafts = Array.isArray(stored.formDrafts)
          ? stored.formDrafts
              .filter(
                (item) =>
                  Array.isArray(item) &&
                  typeof item[0] === 'string' &&
                  !/^(?:order|alignment|connection-order|connection-alignment)-\d+$/.test(item[0]) &&
                  !['order-mode', 'layout-order-mode'].includes(item[0]) &&
                  typeof item[1]?.value === 'string' &&
                  typeof item[1]?.message === 'string',
              )
              .slice(0, 200)
          : [];
        restored = true;
      }
    } catch {
      /* Corrupt/unavailable storage never blocks a new document. */
    }
    this.history = new History(document);
    this.viewMode = 'split';
    try {
      const savedView = localStorage.getItem(VIEW_STORAGE);
      if (VIEWS.includes(savedView)) this.viewMode = savedView;
    } catch {
      /* View preferences are optional. */
    }
    this.formDrafts = new Map(drafts);
    for (const draft of this.formDrafts.values()) {
      if (/\p{Script=Han}/u.test(draft.message)) draft.message = 'This value is invalid. Please correct it.';
    }
    this.selectedGroup = null;
    this.collapsedGroups = new Set();
    this.blockListWidth = 260;
    this.editorListWidth = 360;
    this.groupSearch = '';
    try {
      const prefs = JSON.parse(localStorage.getItem('blockflow.editor.groups') ?? 'null');
      if (Array.isArray(prefs?.collapsed))
        this.collapsedGroups = new Set(prefs.collapsed.filter((id) => typeof id === 'string'));
      if (Number.isFinite(prefs?.width)) this.blockListWidth = Math.max(200, Math.min(560, prefs.width));
      if (Number.isFinite(prefs?.editorWidth))
        this.editorListWidth = Math.max(200, Math.min(560, prefs.editorWidth));
    } catch {
      /* Optional UI preferences. */
    }
    this.selected = document.modules[0]?.id ?? null;
    this.selectedConnection = null;
    this.saved = restored ? '' : json(document);
    this.pending = false;
    this.valid = false;
    this.pngScale = 2;
    this.resetView = true;
    this.rootGroupId = null;
    this.shell();
    this.preview = new Preview(
      root.querySelector('#preview-host'),
      (id) => this.selectModule(id),
      (zoom) => {
        root.querySelector('#zoom-value').textContent = `${zoom}%`;
      },
      (key) => this.selectConnection(key, true),
      {
        onStyle: (target) => this.openPreviewStyle(target),
        onToggleGroup: (id) => this.togglePreviewGroup(id),
        onContextMenu: (target, point) => this.openPreviewMenu(target, point),
      },
    );
    this.service = new LayoutService((data) => this.acceptLayout(data));
    this.events();
    this.applyViewMode();
    this.renderForms();
    if (restored) this.persist();
    this.scheduleLayout();
    if (restored && !this.storageError)
      this.announce('Local draft restored. Download JSON to keep a file copy.');
  }

  get document() {
    return this.history.present;
  }
  get dirty() {
    return this.formDrafts.size > 0 || json(this.document) !== this.saved;
  }

  shell() {
    this.root.innerHTML = `
      <header class="app-header">
        <a class="brand" href="./index.html" aria-label="blockflow Diagram Studio home"><span class="brand-mark">${icon('grid')}</span><span>blockflow</span></a>
        <div class="document-heading"><label class="document-name-label"><span class="sr-only">Diagram name</span><input id="diagram-name" data-field="diagram-name" data-focus-key="diagram-name" value="${e(this.document.diagram.name)}"/></label><button type="button" id="save-state" class="save-indicator" data-action="draft-status" aria-label="Document saved" title="Document saved"><span class="save-dot" aria-hidden="true"></span></button></div>
        <div class="toolbar" aria-label="Document tools">
          <div class="toolbar-group">${button('undo', 'Undo', { glyph: 'undo', iconOnly: true })}${button('redo', 'Redo', { glyph: 'redo', iconOnly: true })}</div>
          <details class="command-menu" id="file-menu"><summary class="button quiet" aria-label="File" title="File">File ${icon('down')}</summary><div class="command-popover">
            ${button('new', 'New document', { glyph: 'plus', className: 'quiet' })}${button('open', 'Open JSON', { glyph: 'open', className: 'quiet' })}${button('save', 'Save JSON', { glyph: 'save', className: 'quiet' })}<hr/>${button('example', 'Load example', { glyph: 'grid', className: 'quiet' })}
          </div></details>
          <details class="command-menu" id="export-menu"><summary class="button primary" aria-label="Export" title="Export">${icon('download')} Export ${icon('down')}</summary><div class="command-popover">
            ${button('export-svg', 'Export SVG', { glyph: 'download', className: 'quiet' })}${button('export-png', 'Export PNG', { glyph: 'download', className: 'quiet' })}<hr/>
            ${field(
              'PNG scale',
              select(
                [1, 2, 3].map((n) => ({ value: n, label: n + '×' })),
                2,
                'id="png-scale" data-field="png-scale"',
              ),
            )}
          </div></details>
          ${button('cycle-view', 'Split view', { glyph: 'split', iconOnly: true })}
          ${button('settings', 'Layout settings', { glyph: 'settings', iconOnly: true })}
        </div>
      </header>
      <main class="studio">
        <div class="workbench">
        <form id="workspace" class="workspace" novalidate aria-label="Diagram editor">
          <div class="editor-tabs" role="tablist" aria-label="Diagram settings">
            <button type="button" id="blocks-tab" role="tab" aria-controls="blocks-settings" aria-selected="true" tabindex="0" data-action="editor-tab" data-editor-tab="blocks">Blocks</button>
            <button type="button" id="connections-tab" role="tab" aria-controls="connections-settings" aria-selected="false" tabindex="-1" data-action="editor-tab" data-editor-tab="connections">Connections</button>
          </div>
          <div id="blocks-settings" class="blocks-settings" style="--block-list-width:${this.blockListWidth}px;--editor-list-width:${this.editorListWidth}px" role="tabpanel" aria-labelledby="blocks-tab">
          <section class="panel block-panel" aria-labelledby="blocks-heading"><header class="panel-header"><h2 id="blocks-heading">Blocks </h2><span id="block-count" class="count"></span></header><div class="group-list-tools"><label class="group-search"><span class="sr-only">Search blocks and groups</span><input type="search" data-field="group-search" data-focus-key="group-search" aria-label="Search blocks and groups" placeholder="Find block or group"/></label>${button('collapse-all', 'Collapse all', { glyph: 'minus', iconOnly: true })}${button('expand-all', 'Expand all', { glyph: 'plus', iconOnly: true })}</div><div id="block-list" class="panel-scroll block-list" data-scroll="blocks" role="group" aria-label="Block list" tabindex="0"></div><footer class="panel-footer">${button('add-block', 'Add block', { glyph: 'plus', className: 'add-button' })}${button('add-group', 'Add group', { glyph: 'plus', className: 'add-button' })}</footer></section>
          <div id="block-list-splitter" class="splitter block-list-splitter" role="separator" tabindex="0" aria-label="Resize block list" aria-orientation="vertical" aria-valuemin="200" aria-valuemax="560" aria-valuenow="${this.blockListWidth}"><span></span></div><section class="panel detail-panel" aria-labelledby="detail-heading"><header class="panel-header"><h2 id="detail-heading">Block details </h2><div class="panel-header-tools"><span id="selected-id" class="code-tag"></span>${button('block-help', '[?]', { className: 'help-button', ariaLabel: 'Block editing help' })}</div></header><div id="block-detail" class="panel-scroll" data-scroll="detail"></div></section>
          </div>
          <div id="connections-settings" class="connections-settings" role="tabpanel" aria-labelledby="connections-tab" hidden><section class="panel connections-panel" aria-labelledby="connections-heading"><header class="panel-header"><h2 id="connections-heading">Connections </h2><span id="connection-count" class="count"></span></header><div id="connection-list" class="panel-scroll connection-list" data-scroll="connections"></div><footer class="panel-footer">${button('add-connection', 'Add connection', { glyph: 'plus', className: 'add-button' })}</footer></section></div>
        </form>
        <div id="splitter" class="splitter" role="separator" tabindex="0" aria-label="Resize editor area" aria-orientation="vertical" aria-valuemin="30" aria-valuemax="70" aria-valuenow="50" aria-valuetext="50% settings"><span></span></div>
        <section class="preview-panel" aria-labelledby="preview-heading"><header class="preview-header"><div class="preview-title"><span class="preview-glyph">${icon('grid')}</span><h2 id="preview-heading">Preview </h2><label class="preview-view-control"><span>View</span><select id="view-scope" data-field="view-scope" aria-label="View target"><option value="">Top</option></select></label><span id="layout-state" class="layout-status" role="status" aria-live="polite">Preparing layout</span></div><div class="preview-tools">${button('preview-style', 'Style', { className: 'quiet', ariaLabel: 'Preview style', disabled: true })}<details class="command-menu" id="preview-actions-menu"><summary class="button icon-button" aria-label="Preview actions" title="Preview actions">${icon('more')}</summary><div class="command-popover">${previewActions()
          .map((item) =>
            button(item.action, item.label, { disabled: true, attrs: item.hidden ? 'hidden' : '' }),
          )
          .join(
            '',
          )}</div></details>${button('retry', 'Re-layout', { glyph: 'refresh', iconOnly: true })}<span class="tool-divider"></span>${button('zoom-out', 'Zoom out', { glyph: 'minus', iconOnly: true })}<span id="zoom-value" class="zoom-value">100%</span>${button('zoom-in', 'Zoom in', { glyph: 'plus', iconOnly: true })}${button('fit', 'Fit to view', { glyph: 'fit', className: 'quiet' })}</div></header>
          <nav id="preview-path" class="preview-path" aria-label="Diagram view path" hidden></nav><div id="preview-error" class="preview-error" role="alert" hidden></div>
          <div id="preview-host" class="preview-host"><div id="preview-empty" class="preview-empty" hidden><span class="empty-symbol">${icon('grid')}</span><h3>Start with a block</h3><p>Add input and output ports, then connect them.</p>${button('add-block', 'Add block', { glyph: 'plus', className: 'primary' })}${button('example', 'Load example', { className: 'quiet' })}</div></div>
          <footer class="preview-footer"><span id="diagram-info">Preparing diagram</span><span class="preview-hint">Scroll to zoom · Drag to pan · Double-click to style</span></footer>
        </section>
        </div>
      </main>
      <div class="app-notice" id="notice-shell" hidden><span id="message" role="status" aria-live="polite"></span>${button('dismiss-notice', 'Dismiss notification', { glyph: 'close', iconOnly: true })}</div>
      <input id="file-input" type="file" accept="application/json,.json" hidden/>
      <dialog id="editor-dialog" aria-labelledby="dialog-title"></dialog>`;
    this.dialog = this.root.querySelector('#editor-dialog');
  }

  renderForms() {
    this.rootGroupId = validViewRoot(this.document, this.rootGroupId);
    this.renderScopeControls();
    this.renderingForms = true;
    const active = document.activeElement;
    const focusKey = active?.dataset.focusKey;
    const caret =
      (active instanceof HTMLInputElement && active.type === 'text') || active instanceof HTMLTextAreaElement
        ? [active.selectionStart, active.selectionEnd]
        : null;
    this.rememberPanelScrolls();
    const opens = new Map(
      [...this.root.querySelectorAll('details[data-keep]')].map((el) => [el.dataset.keep, el.open]),
    );
    const modules = this.document.modules;
    if (this.selected !== null && !modules.some((m) => m.id === this.selected))
      this.selected = modules[0]?.id ?? null;
    this.root.querySelector('#block-count').textContent = modules.length;
    this.root.querySelector('#connection-count').textContent = (this.document.connections ?? []).length;
    this.root.querySelector('#diagram-name').value = this.document.diagram.name;
    if (this.selectedGroup && !this.document.groups?.some((group) => group.id === this.selectedGroup))
      this.selectedGroup = null;
    this.root.querySelector('#block-list').innerHTML = renderBlockList(
      this.document,
      this.selected,
      this.selectedGroup,
      this.collapsedGroups,
      this.groupSearch,
    );
    this.renderBlockDetail();
    this.root.querySelector('#connection-list').innerHTML = this.connections();
    this.root.querySelectorAll('details[data-keep]').forEach((el) => {
      if (opens.has(el.dataset.keep)) el.open = opens.get(el.dataset.keep);
    });
    this.restorePanelScrolls();
    for (const [key, draft] of this.formDrafts) {
      const el = this.root.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
      if (!el) continue;
      el.value = draft.value;
      setFieldError(el, draft.message, false);
    }
    if (focusKey) {
      const next = this.root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
      next?.focus({ preventScroll: true });
      if (
        caret &&
        ((next instanceof HTMLInputElement && next.type === 'text') || next instanceof HTMLTextAreaElement)
      )
        next.setSelectionRange(...caret);
    }
    resizeTextareas(this.root);
    this.syncConnectionSelection();
    this.renderingForms = false;
    this.updateControls();
  }

  renderBlockDetail() {
    const group = this.document.groups?.find((group) => group.id === this.selectedGroup);
    this.root.querySelector('#detail-heading').textContent = group ? 'Group details' : 'Block details';
    this.root.querySelector('[data-action="block-help"]').hidden = Boolean(group);
    if (group) {
      this.root.querySelector('#selected-id').textContent = group.id;
      this.root.querySelector('#block-detail').innerHTML =
        `${this.pathMarkup(group.id)}<div class="group-fields">${field('Group name', textarea(group.label ?? group.id, `data-field="group-label" data-focus-key="group-label-${e(group.id)}"`))}${this.sizeFields(group, 'Group')}</div><div class="group-port-mode">${field(
          'Group type',
          select(
            ['container', 'boundary', 'collection'].map((value) => ({
              value,
              label: value[0].toUpperCase() + value.slice(1),
            })),
            groupType(group),
            `data-field="group-type" data-focus-key="group-type-${e(group.id)}"`,
          ),
        )}${groupType(group) !== 'container' ? hideContentsControl(Boolean(group.collapsed), `data-field="group-collapsed" data-focus-key="group-collapsed-${e(group.id)}"`) : ''}</div>${groupType(group) === 'boundary' ? this.portColumns(group) : ''}<p class="group-detail-help">Direct items: ${group.members.length}. Drag blocks or groups into this group or use Move to group.</p><div class="block-style-entry">${button('edit-style', 'Style', { className: 'outline', ariaLabel: 'Group style', attrs: `data-style-kind="group" data-group="${e(group.id)}"` })}<span>Border, background and title</span></div>${button('ungroup', 'Ungroup (keep contents)', { className: 'danger-quiet', attrs: `data-id="${e(group.id)}"` })}`;
      return;
    }
    const selected = this.document.modules.find((module) => module.id === this.selected);
    this.root.querySelector('#selected-id').textContent = selected?.id ?? '—';
    this.root.querySelector('#block-detail').innerHTML = selected
      ? this.pathMarkup(selected.id) + this.blockDetail(selected)
      : '<div class="detail-empty">Select a block to edit its name and ports.</div>';
  }

  portColumns(module) {
    const ports = (direction) => {
      const list = (module.ports ?? []).filter((p) => p.direction === direction);
      return `<section class="port-column ${direction}"><header><span class="port-dot"></span><h3>${direction === 'input' ? 'Input' : 'Output'}</h3><span class="count">${list.length}</span></header><div class="port-items">${
        list.length
          ? list
              .map(
                (
                  port,
                  i,
                ) => `<div class="port-row" data-drop-kind="port" data-direction="${direction}" data-index="${i}">
        <div class="port-fields">${field('Key (ID)', input(port.id, `data-field="port-name" data-port="${e(port.id)}" data-focus-key="port-${e(module.id)}-${e(port.id)}" aria-label="${e(direction)} ${e(port.id)} Key (ID)" spellcheck="false"`))}
        ${field('Width', input(port.width ?? '', `data-field="port-width" data-port="${e(port.id)}" data-focus-key="width-${e(module.id)}-${e(port.id)}" aria-label="${e(port.id)} Width" min="1" step="1" placeholder="Unspecified"`, 'number'))}
        <div class="port-display-name">${field('Display name', textarea(port.label ?? port.id, `data-field="port-label" data-port="${e(port.id)}" data-focus-key="port-label-${e(module.id)}-${e(port.id)}" aria-label="${e(direction)} ${e(port.id)} Display name"`))}</div></div>
        <div class="port-row-tools">${button('edit-style', 'Style', { className: 'text-button', ariaLabel: `${direction === 'input' ? 'Input' : 'Output'} ${port.id} text style`, attrs: `data-style-kind="port" data-module="${e(module.id)}" data-port="${e(port.id)}"` })}${sortActions('port', i, list.length, `data-direction="${direction}"`)}</div>
      </div>`,
              )
              .join('')
          : '<p class="port-empty">No ports yet</p>'
      }</div><footer>${button('add-port', direction === 'input' ? 'Add input' : 'Add output', { glyph: 'plus', className: 'add-button', attrs: `data-direction="${direction}"` })}</footer></section>`;
    };
    return `<div class="port-columns">${ports('input')}${ports('output')}</div>`;
  }

  sizeFields(owner, kind = 'Block') {
    const prefix = kind === 'Block' ? 'module' : 'group';
    return (
      '<div class="module-size">' +
      ['width', 'height']
        .map((axis) =>
          field(
            axis === 'width' ? 'Width' : 'Height',
            input(
              owner[axis] ?? '',
              `data-field="module-size" data-property="${axis}" data-focus-key="${prefix}-${axis}-${e(owner.id)}" aria-label="${kind} ${axis}" min="0" step="0.1" placeholder="Auto"`,
              'number',
            ),
          ),
        )
        .join('') +
      '</div>'
    );
  }

  blockDetail(module) {
    return `<div class="module-name"><div class="module-identity">${field('Key (ID)', input(module.id, `data-field="module-key" data-focus-key="module-key-${e(module.id)}" aria-label="Block key" spellcheck="false" autocapitalize="off"`))}${field('Display name', textarea(module.label ?? module.id, `data-field="module-label" data-focus-key="module-label-${e(module.id)}" aria-label="Block display name"`))}</div>${this.sizeFields(module)}</div>${this.portColumns(module)}
      <div class="block-style-entry">${button('edit-style', 'Style', { className: 'outline', ariaLabel: 'Block style', attrs: `data-style-kind="module" data-module="${e(module.id)}"` })}<span>Border, label and port defaults</span></div>`;
  }

  connections() {
    const connections = this.document.connections ?? [];
    return connections.length
      ? connections
          .map((connection, index) => this.connectionRow(connection, index, index, connections.length))
          .join('')
      : '<p class="connection-empty">No connections yet. Add an output-to-input connection below.</p>';
  }

  connectionRow(connection, index, position, count) {
    const sources = endpoints(this.document, 'output').map((p) => ({ value: p.ref, label: p.ref }));
    const targets = endpoints(this.document, 'input').map((p) => {
      const reason = targetReason(this.document, connection.from, p.ref, index);
      return { value: p.ref, label: `${p.ref}${reason ? `（${reason}）` : ''}`, disabled: !!reason };
    });
    return `<div class="connection-row" data-drop-kind="connection" data-index="${index}" data-edge-key="${e(connectionKey(connection))}" role="group" aria-label="Connection ${e(connection.from)} to ${e(connection.to)}" tabindex="0">
      <div class="connection-endpoints"><label><span class="sr-only">Connection ${index + 1} source ${this.document.groups?.some((g) => groupType(g) === 'boundary') ? 'port' : 'Output'}</span>${select(sources, connection.from, `data-field="connection-from" data-index="${index}" data-focus-key="from-${index}"`)}</label><span class="edge-arrow">${icon('arrow')}</span><label><span class="sr-only">Connection ${index + 1} target ${this.document.groups?.some((g) => groupType(g) === 'boundary') ? 'port' : 'Input'}</span>${select(targets, connection.to, `data-field="connection-to" data-index="${index}" data-focus-key="to-${index}"`)}</label></div>
      ${field('Label', textarea(connection.label ?? '', `data-field="connection-label" data-index="${index}" data-focus-key="connection-label-${index}" aria-label="Connection ${index + 1} label" placeholder="Optional"`))}
      <div class="connection-row-bottom">
      ${sortActions('connection', position, count, `data-connection="${index}"`)}${feedbackControl(connection.feedback, `data-field="connection-feedback" data-index="${index}" data-focus-key="feedback-${index}"`)}</div>
      ${button('edit-style', 'Style', { className: 'text-button connection-style-button', ariaLabel: `Connection style: ${connection.from} to ${connection.to}`, attrs: `data-style-kind="connection" data-connection="${index}"` })}
    </div>`;
  }

  announce(message, error = false) {
    // Selection already has a visible indicator and accessible pressed/current state.
    if (/^(Block selected|Connection selected|Selection cleared)\.$/.test(message)) return;
    clearTimeout(this.noticeTimer);
    if (this.storageError) {
      message = 'Local storage is full or disabled. Download JSON to save your work.';
      error = true;
    }
    const notice = this.root.querySelector('#notice-shell');
    if (!notice.contains(document.activeElement)) this.noticeReturnFocus = document.activeElement;
    notice.hidden = false;
    const status = this.root.querySelector('#message');
    status.textContent = message;
    notice.classList.toggle('status-error', error);
    if (!error)
      this.noticeTimer = setTimeout(() => {
        if (!notice.contains(document.activeElement)) this.hideNotice();
      }, 4000);
  }

  hideNotice() {
    clearTimeout(this.noticeTimer);
    const notice = this.root.querySelector('#notice-shell');
    if (notice.contains(document.activeElement)) {
      const previous = this.noticeReturnFocus;
      (previous?.isConnected && previous.getClientRects().length
        ? previous
        : this.root.querySelector('#diagram-name')
      ).focus({ preventScroll: true });
    }
    notice.hidden = true;
  }

  updateControls() {
    this.root
      .querySelectorAll('[data-action="undo"]')
      .forEach((el) => (el.disabled = !this.history.past.length && !this.formDrafts.size));
    this.root
      .querySelectorAll('[data-action="redo"]')
      .forEach((el) => (el.disabled = !this.history.future.length || this.formDrafts.size > 0));
    this.root
      .querySelectorAll('[data-action^="export-"]')
      .forEach(
        (el) =>
          (el.disabled =
            !this.valid || this.pending || this.exporting || !this.currentSvg || this.formDrafts.size > 0),
      );
    this.root.querySelector('[data-action="save"]').disabled =
      this.formDrafts.size > 0 || (!this.documentValid && this.document.modules.length !== 0);
    this.updatePreviewActions();
    const state = this.root.querySelector('#save-state');
    state.title = this.storageError
      ? 'Draft storage unavailable. Download JSON.'
      : this.dirty
        ? 'Unsaved changes. Draft stored locally; download JSON to keep a file copy.'
        : 'Document saved';
    state.setAttribute('aria-label', state.title);
    state.classList.toggle('unsaved', this.dirty);
    state.classList.toggle('storage-error', Boolean(this.storageError));
  }

  persist() {
    try {
      localStorage.setItem(STORAGE, json({ document: this.document, formDrafts: [...this.formDrafts] }));
      this.storageError = false;
    } catch {
      this.storageError = true;
      this.announce('Local storage is full or disabled. Download JSON to save your work.', true);
    }
  }

  commit(change, message = 'Diagram updated.') {
    const previousConnection = this.selectedConnection;
    try {
      if (
        !this.history.update((doc) => {
          const selected = doc.connections?.find(
            (connection) => connectionKey(connection) === previousConnection,
          );
          change(doc);
          this.selectedConnection =
            this.selected === null && selected && doc.connections.includes(selected)
              ? connectionKey(selected)
              : null;
        })
      ) {
        this.persist();
        this.updateControls();
        return;
      }
    } catch (error) {
      this.selectedConnection = previousConnection;
      throw error;
    }
    this.afterEdit(message);
  }

  afterEdit(message) {
    this.persist();
    this.renderForms();
    this.scheduleLayout();
    this.announce(message);
  }

  scheduleLayout() {
    this.rootGroupId = validViewRoot(this.document, this.rootGroupId);
    this.renderScopeControls();
    this.service.invalidate();
    this.valid = false;
    this.documentValid = false;
    this.pending = false;
    const errorBox = this.root.querySelector('#preview-error');
    errorBox.hidden = true;
    errorBox.removeAttribute('data-tone');
    const state = this.root.querySelector('#layout-state');
    this.root.querySelector('#preview-empty').hidden =
      this.document.modules.length !== 0 || Boolean(this.document.groups?.length);
    if (!this.document.modules.length && !this.document.groups?.length) {
      this.preview.clear();
      this.currentSvg = null;
      this.valid = true;
      this.documentValid = true;
      state.textContent = 'No diagram';
      state.classList.remove('busy');
      this.root.querySelector('#diagram-info').textContent = '0 Blocks · 0 Connections';
      this.updateControls();
      return;
    }
    try {
      validateDocument(this.document);
    } catch (error) {
      state.textContent = 'Needs attention · Last valid preview';
      state.classList.remove('busy');
      errorBox.textContent = this.explain(error);
      errorBox.hidden = false;
      this.updateControls();
      return;
    }
    this.pending = true;
    this.documentValid = true;
    state.textContent = 'Laying out';
    state.classList.add('busy');
    this.updateControls();
    this.service.request(structuredClone(this.document), { rootGroupId: this.rootGroupId });
  }

  explain(error) {
    const empty = this.document.modules.find((m) => !m.ports.length);
    if (empty)
      return `"${empty.label ?? empty.id}" needs at least one input or output port. Preview updates when it is ready.`;
    const messages = [
      [/width mismatch/, 'Explicit port widths do not match. Change a width or leave one side unspecified.'],
      [/already has a driver/, 'An input can have only one driver. Choose another target.'],
      [/hex color/, 'Use a hex color (#RGB, #RRGGBB, with optional alpha) or transparent.'],
      [/opacity/, 'Opacity must be a number between 0 and 1.'],
      [
        /positive|non-negative|safe integer/,
        'Use a positive integer for width. Font size and line width must be greater than zero.',
      ],
      [
        /single-line|non-empty/,
        'Use non-blank text without unsupported control characters. Only display names and connection labels support line breaks.',
      ],
    ];
    return (
      messages.find(([pattern]) => pattern.test(error.message))?.[1] ??
      `Cannot update diagram: ${error.message}${error.path ? ` (${error.path})` : ''}`
    );
  }

  acceptLayout(data) {
    this.pending = false;
    this.root.querySelector('#layout-state').classList.remove('busy');
    if (data.error) {
      this.valid = false;
      this.root.querySelector('#layout-state').textContent = 'Layout failed';
      const error = this.root.querySelector('#preview-error');
      error.textContent =
        'Layout could not complete. Adjust connections or spacing, or select Re-layout to retry.';
      error.hidden = false;
      this.updateControls();
      return;
    }
    this.valid = true;
    this.currentSvg = data.svg;
    this.currentLayout = data.layout;
    this.preview.setResult(data.layout, data.svg, this.resetView);
    this.syncConnectionSelection();
    this.resetView = false;
    this.root.querySelector('#layout-state').textContent = 'Updated';
    const warning = this.root.querySelector('#preview-error');
    warning.hidden = !data.layout.warnings?.length;
    warning.dataset.tone = 'warning';
    warning.textContent = data.layout.warnings?.length
      ? 'Some connection labels need more space. Increase spacing or shorten their text.'
      : '';
    this.root.querySelector('#diagram-info').textContent =
      `${data.layout.modules.length + (data.layout.groups ?? []).filter((group) => group.collapsed).length} Blocks · ${data.layout.connections.length} Connections · ${Math.ceil(data.layout.width + 40)} × ${Math.ceil(data.layout.height + 40)} px`;
    this.updateControls();
  }

  selectModule(id) {
    if (this.document.groups?.some((group) => group.id === id)) return this.selectGroup(id);
    if (id === null) return this.clearSelection();
    if (!this.document.modules.some((module) => module.id === id)) return;
    const changed = this.selected !== id || this.selectedConnection !== null;
    this.selectedGroup = null;
    for (const parent of ancestors(this.document, id)) this.collapsedGroups.delete(parent);
    this.groupSearch = '';
    this.root.querySelector('[data-field="group-search"]').value = '';
    this.saveGroupPreferences();
    this.selected = id;
    this.selectedConnection = null;
    this.setEditorTab('blocks');
    this.renderForms();
    if (changed) this.announce('Block selected.');
    if (!this.root.querySelector('#workspace').hidden) {
      this.root
        .querySelector(`[data-action="select-block"][data-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }

  clearSelection(announce = true) {
    if (
      (this.selected === null && this.selectedGroup === null && this.selectedConnection === null) ||
      this.dialog.open
    )
      return;
    const active = document.activeElement;
    const inDetails = active?.closest('#block-detail');
    const focusList = active?.closest('#block-list') || inDetails;
    const focusPreview = active?.closest(
      '.block-hit, .group-hit, .group-port-hit, .connection-hit, .connection-label-hit',
    );
    // Finish pending field edits before removing their controls; invalid drafts are
    // already retained by the shared change handler and reappear on selection.
    if (inDetails && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement))
      active.blur();
    if (this.dialog.open) return;
    this.selected = null;
    this.selectedGroup = null;
    this.selectedConnection = null;
    for (const row of this.root.querySelectorAll('.block-row, .group-row')) row.classList.remove('selected');
    for (const button of this.root.querySelectorAll(
      '[data-action="select-block"], [data-action="select-group"]',
    ))
      button.setAttribute('aria-pressed', 'false');
    this.renderBlockDetail();
    this.syncConnectionSelection();
    if (focusPreview) this.preview.svg.focus({ preventScroll: true });
    else if (focusList) this.root.querySelector('#block-list').focus({ preventScroll: true });
    if (announce) this.announce('Selection cleared.');
  }

  selectConnection(key, reveal = false) {
    if (
      this.dialog.open ||
      !this.document.connections?.some((connection) => connectionKey(connection) === key)
    )
      return;
    const changed = this.selectedConnection !== key || this.selected !== null;
    const focusedHit = document.activeElement?.closest('.connection-hit, .connection-label-hit');
    if (this.selected !== null || this.selectedGroup !== null) this.clearSelection(false);
    if (this.dialog.open) return;
    focusedHit?.focus({ preventScroll: true });
    this.selectedConnection = key;
    this.syncConnectionSelection();
    if (changed) this.announce('Connection selected.');
    if (reveal) {
      this.setEditorTab('connections');
      this.revealSelectedConnection();
    }
  }

  syncConnectionSelection() {
    if (this.selected !== null) this.selectedConnection = null;
    if (
      !this.document.connections?.some((connection) => connectionKey(connection) === this.selectedConnection)
    )
      this.selectedConnection = null;
    for (const row of this.root.querySelectorAll('.connection-row')) {
      const selected = row.dataset.edgeKey === this.selectedConnection;
      row.classList.toggle('selected', selected);
      if (selected) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    }
    if (this.selectedConnection !== null) this.preview?.selectConnection(this.selectedConnection);
    else this.preview?.select(this.selectedGroup ?? this.selected);
    this.updatePreviewActions();
  }

  revealSelectedConnection() {
    const row = [...this.root.querySelectorAll('.connection-row')].find(
      (row) => row.dataset.edgeKey === this.selectedConnection,
    );
    if (!row) return;
    if (!this.root.querySelector('#workspace').hidden)
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  applyViewMode() {
    this.rememberPanelScrolls();
    this.root.querySelector('.studio').dataset.view = this.viewMode;
    this.root
      .querySelector('#block-list-splitter')
      .setAttribute('aria-valuenow', this.viewMode === 'editor' ? this.editorListWidth : this.blockListWidth);
    this.root.querySelector('#workspace').hidden = this.viewMode === 'preview';
    this.root.querySelector('.preview-panel').hidden = this.viewMode === 'editor';
    this.root.querySelector('#splitter').hidden = this.viewMode !== 'split';
    this.restorePanelScrolls();
    const names = { split: 'Split view', editor: 'Editor view', preview: 'Preview view' };
    if (
      this.selectedConnection !== null &&
      this.viewMode !== 'preview' &&
      this.activeEditorTab === 'connections'
    )
      this.revealSelectedConnection();
    const next = VIEWS[(VIEWS.indexOf(this.viewMode) + 1) % VIEWS.length];
    const control = this.root.querySelector('[data-action="cycle-view"]');
    control.innerHTML = icon(this.viewMode);
    control.setAttribute('aria-label', `${names[this.viewMode]}. Switch to ${names[next].toLowerCase()}`);
    control.title = `Switch to ${names[next].toLowerCase()}`;
    try {
      localStorage.setItem(VIEW_STORAGE, this.viewMode);
    } catch {
      /* Nonessential preference. */
    }
    requestAnimationFrame(() => this.preview.refreshSize());
  }

  rememberPanelScrolls() {
    this.panelScrolls ??= new Map();
    for (const el of this.root.querySelectorAll('[data-scroll]')) {
      if (el.getClientRects().length) this.panelScrolls.set(el.dataset.scroll, el.scrollTop);
    }
  }

  restorePanelScrolls() {
    for (const el of this.root.querySelectorAll('[data-scroll]')) {
      if (el.getClientRects().length) el.scrollTop = this.panelScrolls?.get(el.dataset.scroll) ?? 0;
    }
  }

  setEditorTab(tab, focus = false) {
    if (!['blocks', 'connections'].includes(tab)) return;
    this.rememberPanelScrolls();
    this.activeEditorTab = tab;
    for (const button of this.root.querySelectorAll('[data-editor-tab]')) {
      const selected = button.dataset.editorTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus({ preventScroll: true });
    }
    for (const name of ['blocks', 'connections'])
      this.root.querySelector(`#${name}-settings`).hidden = name !== tab;
    this.restorePanelScrolls();
    try {
      localStorage.setItem('blockflow.editor.tab', tab);
    } catch {
      /* Nonessential preference. */
    }
  }

  events() {
    this.root.querySelector('.editor-tabs').addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tab =
        event.key === 'Home'
          ? 'blocks'
          : event.key === 'End'
            ? 'connections'
            : this.activeEditorTab === 'connections'
              ? 'blocks'
              : 'connections';
      this.setEditorTab(tab, true);
    });
    let savedTab;
    try {
      savedTab = localStorage.getItem('blockflow.editor.tab');
    } catch {
      /* Optional preference. */
    }
    this.setEditorTab(savedTab === 'connections' ? 'connections' : 'blocks');
    bindDisclosureMenus(this.root);
    this.root.addEventListener('focusin', (event) => {
      const row = event.target.closest('.connection-row');
      if (row && !this.renderingForms) this.selectConnection(row.dataset.edgeKey);
    });
    this.root.addEventListener('input', (event) => {
      if (event.target instanceof HTMLTextAreaElement) resizeTextareas(event.target.parentElement);
      if (event.target.dataset.field === 'group-search') {
        this.groupSearch = event.target.value;
        this.root.querySelector('#block-list').innerHTML = renderBlockList(
          this.document,
          this.selected,
          this.selectedGroup,
          this.collapsedGroups,
          this.groupSearch,
        );
      }
      const row = event.target.closest('.connection-row');
      if (row && !this.renderingForms) this.selectConnection(row.dataset.edgeKey);
    });
    this.root.querySelector('#block-list').addEventListener('click', (event) => {
      if (event.target !== event.currentTarget || event.button !== 0) return;
      // Scrollbar interactions are outside the list's client area.
      const box = event.currentTarget.getBoundingClientRect();
      if (
        event.clientX >= box.left + event.currentTarget.clientWidth ||
        event.clientY >= box.top + event.currentTarget.clientHeight
      )
        return;
      this.clearSelection();
      event.currentTarget.focus({ preventScroll: true });
    });
    this.root.querySelector('#connection-list').addEventListener('click', (event) => {
      if (event.target !== event.currentTarget || event.button !== 0) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (
        event.clientX >= box.left + event.currentTarget.clientWidth ||
        event.clientY >= box.top + event.currentTarget.clientHeight
      )
        return;
      this.clearSelection();
    });
    this.root.addEventListener('submit', (event) => event.preventDefault());
    this.root.addEventListener('click', (event) => {
      const row = event.target.closest('.connection-row');
      if (row) this.selectConnection(row.dataset.edgeKey);
      const target = event.target.closest('[data-action]');
      if (!target || target.disabled) return;
      try {
        const menu = target.closest('.command-menu');
        if (menu) {
          menu.open = false;
          menu.querySelector('summary').focus({ preventScroll: true });
        }
        this.action(target.dataset.action, target);
      } catch (error) {
        this.announce(error.message, true);
      }
    });
    this.root.addEventListener('compositionstart', () => {
      this.composing = true;
      this.compositionChanged = null;
    });
    this.root.addEventListener('compositionend', () => {
      this.composing = false;
      if (this.compositionChanged?.isConnected)
        this.compositionChanged.dispatchEvent(new Event('change', { bubbles: true }));
      this.compositionChanged = null;
    });
    this.root.addEventListener('change', (event) => {
      const el = event.target;
      if (!el.dataset.field) return;
      if (this.composing) {
        this.compositionChanged = el;
        return;
      }
      try {
        this.changeField(el);
      } catch (error) {
        if (el.dataset.focusKey)
          this.formDrafts.set(el.dataset.focusKey, { value: el.value, message: error.message });
        setFieldError(el, error.message);
        this.persist();
        this.updateControls();
        this.announce(error.message, true);
      }
    });
    this.root.addEventListener('keydown', (event) => {
      if (event.isComposing || this.composing) return;
      if (
        event.key === 'Enter' &&
        event.target instanceof HTMLInputElement &&
        event.target.type !== 'checkbox'
      ) {
        event.preventDefault();
        event.target.blur();
      }
      const handle = event.target.closest('[data-action="drag"]');
      if (handle && event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        this.move(handle, event.key === 'ArrowUp' ? -1 : 1);
      }
    });
    window.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        !event.isComposing &&
        !this.composing &&
        !this.dialog.open &&
        !event.defaultPrevented
      ) {
        if (event.target.closest('select')) return;
        const menu = this.root.querySelector('.sort-menu[open], .command-menu[open]');
        if (menu) {
          event.preventDefault();
          menu.open = false;
          menu.querySelector('summary').focus();
          return;
        }
        if (this.selected !== null || this.selectedGroup !== null || this.selectedConnection !== null) {
          event.preventDefault();
          this.clearSelection();
        }
        return;
      }
      if (
        event.isComposing ||
        this.composing ||
        event.target.closest('input,textarea,select,[contenteditable]') ||
        this.dialog.open
      )
        return;
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        this.action(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo');
      }
    });
    window.addEventListener('beforeunload', (event) => {
      if (this.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    this.root
      .querySelector('#file-input')
      .addEventListener('change', (event) => this.openFile(event.target.files[0]));
    this.dialog.addEventListener('close', () => {
      this.dialog.removeAttribute('role');
      this.styleSession = null;
      this.labelSession = null;
      this.dialog.classList.remove('style-dialog');
      this.dialog.removeAttribute('aria-describedby');
      if (this.dialogPreviewTarget) {
        this.preview.focusTarget(this.dialogPreviewTarget);
        this.preview.focusAfterLayout = this.pending ? this.dialogPreviewTarget : null;
        this.dialogPreviewTarget = null;
        return;
      }
      if (this.dialogTrigger?.isConnected) this.dialogTrigger.focus();
      else if (this.dialogFocusAction) this.root.querySelector(this.dialogFocusAction)?.focus();
    });
    this.dragEvents();
    this.splitterEvents();
    this.dialog.addEventListener('input', (event) => {
      if (this.labelSession && event.target.id === 'preview-label-text') {
        clearFieldError(event.target);
        event.target.setAttribute('aria-describedby', 'label-dialog-help');
        this.dialog.querySelector('#label-dialog-error').textContent = '';
      }
      if (!this.styleSession || !event.target.matches('[data-style-property]')) return;
      clearFieldError(event.target);
      this.dialog.querySelector('#style-dialog-error').textContent = '';
    });
    this.dialog.addEventListener('keydown', (event) => {
      if (this.labelSession && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (!event.isComposing && !this.composing) this.confirmPreviewLabel();
        return;
      }
      if (!this.styleSession || event.isComposing || !event.target.matches('[role="tab"]')) return;
      const tabs = [...this.dialog.querySelectorAll('[role="tab"]')];
      const index = tabs.indexOf(event.target);
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        selectStyleTab(this.dialog, tabs[next].dataset.styleSection);
      }
    });
  }

  showKeyAdjustment(kind, result) {
    this.showDialog(
      `<div class="dialog-heading"><h2 id="dialog-title">${kind} key adjusted</h2><p id="dialog-description">The key <code>${e(result.requested)}</code> is already in use. This ${kind.toLowerCase()} uses <code>${e(result.id)}</code> instead. Existing connections were updated. Use Undo to restore the previous key.</p></div><footer class="dialog-actions">${button('cancel-dialog', 'OK', { className: 'primary', attrs: 'autofocus' })}</footer>`,
    );
    this.dialog.setAttribute('role', 'alertdialog');
    this.dialog.setAttribute('aria-describedby', 'dialog-description');
  }

  changeField(el) {
    clearFieldError(el);
    if (el.dataset.focusKey) this.formDrafts.delete(el.dataset.focusKey);
    const field = el.dataset.field;
    if (field === 'module-key') {
      const previous = this.selected;
      let result;
      this.commit((doc) => {
        result = renameModule(doc, previous, el.value);
        this.selected = result.id;
        this.preview.renameBlock(previous, result.id);
        for (const [key, draft] of [...this.formDrafts]) {
          const mapping = [
            [`module-label-${previous}`, `module-label-${result.id}`, false],
            [`module-key-${previous}`, `module-key-${result.id}`, false],
            [`module-width-${previous}`, `module-width-${result.id}`, false],
            [`module-height-${previous}`, `module-height-${result.id}`, false],
            [`port-label-${previous}-`, `port-label-${result.id}-`, true],
            [`port-${previous}-`, `port-${result.id}-`, true],
            [`width-${previous}-`, `width-${result.id}-`, true],
          ].find(([prefix, , partial]) => (partial ? key.startsWith(prefix) : key === prefix));
          if (mapping) {
            this.formDrafts.delete(key);
            this.formDrafts.set(mapping[1] + key.slice(mapping[0].length), draft);
          }
        }
      }, 'Block key updated. Existing connections were updated.');
      const keyInput = this.root.querySelector('[data-field="module-key"]');
      if (keyInput) {
        keyInput.value = result.id;
        keyInput.focus({ preventScroll: true });
      }
      if (result.adjusted) this.showKeyAdjustment('Block', result);
      return;
    }
    if (field === 'port-name') {
      const moduleId = this.selectedGroup ?? this.selected,
        previous = el.dataset.port;
      let result;
      this.commit((doc) => {
        result = renamePort(doc, moduleId, previous, el.value);
        for (const prefix of ['port-', 'port-label-', 'width-']) {
          const oldKey = prefix + moduleId + '-' + previous;
          if (this.formDrafts.has(oldKey)) {
            this.formDrafts.set(prefix + moduleId + '-' + result.id, this.formDrafts.get(oldKey));
            this.formDrafts.delete(oldKey);
          }
        }
      }, 'Port key updated. Existing connections were updated.');
      this.root
        .querySelector(`[data-field="port-name"][data-port="${CSS.escape(result.id)}"]`)
        ?.focus({ preventScroll: true });
      if (result.adjusted) this.showKeyAdjustment('Port', result);
      return;
    }
    if (field === 'group-collapsed') {
      this.commit(
        (doc) => setGroupCollapsed(doc, this.selectedGroup, el.checked),
        'Group visibility updated.',
      );
      return;
    }
    if (field === 'group-type') {
      try {
        this.commit((doc) => setGroupType(doc, this.selectedGroup, el.value), 'Group type updated.');
      } catch (error) {
        this.renderForms();
        this.showDialog(
          `<div class="dialog-heading"><h2 id="dialog-title">${error.problems ? 'Connections need attention' : 'Group mode needs attention'}</h2><p>Resolve the issues below before changing Group type. Your diagram has not changed.</p></div><ul class="boundary-problems">${(error.problems ?? [error.message]).map((problem) => `<li>${e(problem)}</li>`).join('')}</ul><footer class="dialog-actions">${button('cancel-dialog', 'Done', { className: 'primary', attrs: 'autofocus' })}</footer>`,
        );
        this.dialogTrigger = null;
        this.dialogFocusAction = '[data-field="group-type"]';
      }
      return;
    }
    if (field === 'view-scope') return this.changeViewScope(el.value || null);
    if (field === 'group-search') return;
    if (field === 'group-label') {
      if (!el.value.trim()) throw new Error('Enter a group name.');
      this.commit((doc) => {
        doc.groups.find((group) => group.id === this.selectedGroup).label = normalizeDisplayText(el.value);
      }, 'Group name updated.');
      return;
    }
    if (field === 'png-scale') {
      this.pngScale = Number(el.value);
      return;
    }
    if (field.startsWith('dialog-')) {
      this.updateConnectionDialog();
      return;
    }
    if (field === 'setting') {
      this.commit((doc) => {
        doc.layout ??= {};
        doc.layout[el.dataset.property] = el.type === 'number' ? Number(el.value) : el.value;
        validateDocument(doc);
      }, 'Layout settings updated.');
      return;
    }
    this.commit((doc) => {
      const module = portOwner(doc, this.selectedGroup ?? this.selected);
      const connection = doc.connections?.[Number(el.dataset.index)];
      if (field === 'diagram-name') {
        if (!el.value.trim()) throw new Error('Enter a diagram name.');
        doc.diagram.name = el.value;
      }
      if (field === 'module-label') {
        if (el.value.trim()) module.label = normalizeDisplayText(el.value);
        else delete module.label;
      }
      if (field === 'port-label') {
        const port = module.ports.find((p) => p.id === el.dataset.port);
        if (el.value.trim()) port.label = normalizeDisplayText(el.value);
        else delete port.label;
      }
      if (field === 'module-size') {
        const property = el.dataset.property;
        if (!['width', 'height'].includes(property)) return;
        if (el.validity.badInput) throw new Error('Enter a positive size, or leave it blank for Auto.');
        if (el.value === '') delete module[property];
        else {
          const value = Number(el.value);
          if (!Number.isFinite(value) || value <= 0)
            throw new Error('Enter a positive size, or leave it blank for Auto.');
          module[property] = value;
        }
      }
      if (field === 'port-width') {
        const port = module.ports.find((p) => p.id === el.dataset.port);
        if (el.value === '') delete port.width;
        else {
          const value = Number(el.value);
          if (!Number.isSafeInteger(value) || value <= 0)
            throw new Error('Enter a positive integer width, or leave it unspecified.');
          port.width = value;
        }
      }
      if (field === 'connection-label') {
        if (el.value.trim()) connection.label = normalizeDisplayText(el.value);
        else delete connection.label;
      }
      if (field === 'connection-from') connection.from = el.value;
      if (field === 'connection-to') connection.to = el.value;
      if (field === 'connection-feedback') {
        if (el.checked) connection.feedback = true;
        else delete connection.feedback;
      }
    });
  }

  action(action, target) {
    if (action === 'dismiss-notice') return this.hideNotice();
    if (action === 'draft-status')
      return this.announce(this.root.querySelector('#save-state').title, Boolean(this.storageError));
    if (action === 'collapse-all' || action === 'expand-all') {
      this.groupSearch = '';
      this.root.querySelector('[data-field="group-search"]').value = '';
      this.collapsedGroups = new Set(
        action === 'collapse-all' ? (this.document.groups ?? []).map((group) => group.id) : [],
      );
      this.saveGroupPreferences();
      this.renderForms();
      return;
    }
    if (action === 'add-group' || action === 'group-block' || action === 'add-subgroup') {
      this.setEditorTab('blocks');
      this.commit((doc) => {
        const member = action === 'group-block' ? target.dataset.id : null;
        const parent =
          action === 'add-subgroup'
            ? target.dataset.id
            : member
              ? groupOf(doc, member)
              : (this.selectedGroup ?? '');
        this.selectedGroup = addGroup(doc, member, parent);
        for (const key of ancestors(doc, this.selectedGroup)) this.collapsedGroups.delete(key);
        this.collapsedGroups.delete(this.selectedGroup);
        this.selected = null;
        this.selectedConnection = null;
      }, 'Group added. Drag blocks or groups into it.');
      return this.root.querySelector('[data-field="group-label"]')?.focus();
    }
    if (action === 'convert-boundary') {
      const id = target.dataset.id;
      const block = this.document.modules.find((module) => module.id === id);
      const draftKeys = new Set([
        ...['module-key-', 'module-label-', 'module-width-', 'module-height-'].map((prefix) => prefix + id),
        ...(block?.ports ?? []).flatMap((port) =>
          ['port-', 'port-label-', 'width-'].map((prefix) => prefix + id + '-' + port.id),
        ),
      ]);
      const pending = [...this.formDrafts.keys()].some((key) => draftKeys.has(key));
      if (pending) throw new Error('Resolve this block’s unfinished field edits before converting.');
      this.commit((doc) => {
        convertToBoundaryGroup(doc, id);
        this.selected = null;
        this.selectedGroup = id;
        this.selectedConnection = null;
      }, 'Converted to boundary group. Contents are hidden; use Hide contents to expand.');
      this.setEditorTab('blocks');
      this.root.querySelector(`.group-select[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (action === 'select-group') return this.selectGroup(target.dataset.id);
    if (action === 'toggle-group') {
      const id = target.dataset.id;
      if (this.collapsedGroups.has(id)) this.collapsedGroups.delete(id);
      else this.collapsedGroups.add(id);
      this.saveGroupPreferences();
      this.renderForms();
      return;
    }
    if (action === 'ungroup') {
      this.commit((doc) => {
        this.formDrafts.delete('group-label-' + target.dataset.id);
        removeGroup(doc, target.dataset.id);
        if (this.selectedGroup === target.dataset.id) this.selectedGroup = null;
      }, 'Group removed. Contents and connections were kept.');
      this.root.querySelector('#block-list').focus({ preventScroll: true });
      return;
    }
    if (action === 'move-to-group') return this.moveToGroupDialog(target.dataset.id);
    if (action === 'confirm-group-move') {
      const id = this.movingBlock;
      const groupId = this.dialog.querySelector('#move-group').value;
      this.commit((doc) => placeBlock(doc, id, groupId), 'Block group updated.');
      this.collapsedGroups.delete(groupId);
      this.saveGroupPreferences();
      this.dialog.close();
      this.selectModule(id);
      const kind = this.document.groups?.some((group) => group.id === id) ? 'select-group' : 'select-block';
      this.dialogFocusAction = `[data-action="${kind}"][data-id="${CSS.escape(id)}"]`;
      this.root.querySelector(this.dialogFocusAction)?.focus({ preventScroll: true });
      return;
    }
    if (action === 'block-help') {
      this.showDialog(
        `<div class="dialog-heading"><h2 id="dialog-title">Block editing help</h2></div><div class="block-help-content"><h3>Key (ID)</h3><p>Use the key in connections. Renaming updates existing links. Duplicate keys receive a suffix.</p><h3>Display names</h3><p>Block and port display names support line breaks. Press Enter for a new line and leave the field to apply changes. Leave blank to use the key. Port keys are unique within each block; renaming updates existing connections.</p><h3>Block size</h3><p>Width and Height are relative minimum sizes. Leave blank for Auto; 1 is the shared basic block size. Increase Height (for example, 3.5) to spread port rows. Text and line sizes stay the same. Extra space helps routing but does not guarantee straight connections.</p><h3>Port width</h3><p>Width is optional; only two explicit widths must match.</p></div><footer class="dialog-actions">${button('cancel-dialog', 'Done', { className: 'primary', attrs: 'autofocus' })}</footer>`,
      );
      return;
    }
    if (action === 'editor-tab') return this.setEditorTab(target.dataset.editorTab);
    if (action === 'add-block') this.setEditorTab('blocks');
    if (action === 'edit-style') return this.openStyleDialog(target);
    if (action === 'view-scope') return this.changeViewScope(target.dataset.id || null);
    if (action === 'view-contents') return this.changeViewScope(target.dataset.id);
    const previewAction = this.previewActionItems().find((item) => item.action === action);
    if (previewAction) {
      const selected = this.previewSelection();
      if (
        !selected ||
        previewAction.hidden ||
        !this.previewActionsReady() ||
        !this.previewTargetVisible(selected)
      )
        return;
      return this[previewAction.handler](previewAction.useId ? selected.id : selected);
    }
    if (action === 'confirm-label') return this.confirmPreviewLabel();
    if (action === 'style-tab') return selectStyleTab(this.dialog, target.dataset.styleSection);
    if (action === 'confirm-style') return this.confirmStyle();
    if (action === 'select-block') return this.selectModule(target.dataset.id);
    if (action === 'cycle-view') {
      this.viewMode = VIEWS[(VIEWS.indexOf(this.viewMode) + 1) % VIEWS.length];
      this.applyViewMode();
      return;
    }
    if (action === 'add-block') {
      this.commit((doc) => {
        const parent = this.selectedGroup;
        this.selected = addModule(doc);
        if (parent) placeBlock(doc, this.selected, parent);
        this.selectedGroup = null;
      }, 'Block added. Add at least one port.');
      return this.root.querySelector('[data-field="module-label"]')?.focus();
    }
    if (action === 'add-port') {
      let portId;
      this.commit((doc) => {
        portId = addPort(portOwner(doc, this.selectedGroup ?? this.selected), target.dataset.direction);
      }, 'Port added.');
      return this.root.querySelector(`[data-field="port-name"][data-port="${CSS.escape(portId)}"]`)?.focus();
    }
    if (action === 'delete') return this.deleteRow(target);
    if (action === 'move-up' || action === 'move-down')
      return this.move(target, action === 'move-up' ? -1 : 1);
    if (action === 'undo' || action === 'redo') {
      if (action === 'undo' && this.formDrafts.size) {
        this.formDrafts.clear();
        this.afterEdit('Unapplied field edits discarded.');
        return;
      }
      const selectedIndex = this.document.modules.findIndex((module) => module.id === this.selected);
      const previousModule = this.document.modules[selectedIndex];
      const selectedEdgeIndex =
        this.document.connections?.findIndex(
          (connection) => connectionKey(connection) === this.selectedConnection,
        ) ?? -1;
      const edgeCount = this.document.connections?.length;
      if (this.history[action]()) {
        if (this.selectedGroup && this.document.modules.some((module) => module.id === this.selectedGroup)) {
          this.selected = this.selectedGroup;
          this.selectedGroup = null;
        } else if (this.selected && this.document.groups?.some((group) => group.id === this.selected)) {
          this.selectedGroup = this.selected;
          this.selected = null;
        }
        if (
          this.selectedConnection !== null &&
          !this.document.connections?.some(
            (connection) => connectionKey(connection) === this.selectedConnection,
          )
        ) {
          const edge =
            this.document.connections?.length === edgeCount
              ? this.document.connections[selectedEdgeIndex]
              : null;
          this.selectedConnection = edge ? connectionKey(edge) : null;
        }
        if (this.selected !== null && !this.document.modules.some((module) => module.id === this.selected)) {
          const nextModule =
            this.document.modules[Math.max(0, Math.min(selectedIndex, this.document.modules.length - 1))];
          if (
            previousModule &&
            nextModule &&
            (previousModule.label ?? previousModule.id) === (nextModule.label ?? nextModule.id)
          )
            this.preview.renameBlock(previousModule.id, nextModule.id);
          this.selected = nextModule?.id ?? null;
        }
        this.afterEdit(action === 'undo' ? 'Undo complete.' : 'Redo complete.');
      }
      return;
    }
    if (action === 'zoom-in') return this.preview.zoom(1.25);
    if (action === 'zoom-out') return this.preview.zoom(0.8);
    if (action === 'fit') return this.preview.fit();
    if (action === 'retry') return this.scheduleLayout();
    if (action === 'open') {
      this.root.querySelector('#file-input').click();
      return;
    }
    if (action === 'save') {
      downloadBlob(
        new Blob([JSON.stringify(this.document, null, 2) + '\n'], { type: 'application/json' }),
        `${this.filename()}.json`,
      );
      this.saved = json(this.document);
      this.updateControls();
      this.announce('JSON downloaded.');
      return;
    }
    if (action === 'export-svg') {
      downloadBlob(
        new Blob([this.currentSvg], { type: 'image/svg+xml;charset=utf-8' }),
        `${this.filename()}.svg`,
      );
      this.announce('SVG exported.');
      return;
    }
    if (action === 'export-png') return this.exportPng();
    if (action === 'new') return this.replaceDocument(emptyDocument(), 'New document created.');
    if (action === 'example') return this.replaceDocument(defaultExample(), 'Example loaded.');
    if (action === 'add-connection') return this.connectionDialog();
    if (action === 'settings') return this.settingsDialog();
    if (action === 'cancel-dialog') return this.dialog.close();
    if (action === 'confirm-replace') {
      this.dialog.close();
      return this.performReplace(this.replacement.document, this.replacement.message);
    }
    if (action === 'confirm-connection') return this.confirmConnection();
  }

  deleteRow(target) {
    const kind = target.dataset.kind;
    // Deleting an object explicitly discards its unfinished field draft.
    if (kind === 'module' || kind === 'port') {
      const id =
        kind === 'module'
          ? (target.dataset.blockId ?? this.document.modules[Number(target.dataset.index)].id)
          : (this.selectedGroup ?? this.selected);
      for (const key of this.formDrafts.keys())
        if (
          key.includes(`-${id}-`) ||
          key === `module-label-${id}` ||
          (kind === 'module' && ['width', 'height'].some((property) => key === `module-${property}-${id}`))
        )
          this.formDrafts.delete(key);
    }
    this.commit((doc) => {
      if (kind === 'module')
        removeModule(doc, target.dataset.blockId ?? doc.modules[Number(target.dataset.index)].id);
      if (kind === 'port') {
        const module = portOwner(doc, this.selectedGroup ?? this.selected);
        const port = module.ports.filter((p) => p.direction === target.dataset.direction)[
          Number(target.dataset.index)
        ];
        removePort(doc, module.id, port.id);
      }
      if (kind === 'connection') doc.connections.splice(Number(target.dataset.connection), 1);
    }, 'Item and dependent connections deleted. Use Undo to restore them.');
  }

  move(target, offset) {
    const { kind, direction } = target.dataset;
    const index = Number(target.dataset.index);
    this.commit((doc) => {
      if (kind === 'module') moveBlock(doc, target.dataset.blockId ?? doc.modules[index].id, offset);
      if (kind === 'port')
        movePort(portOwner(doc, this.selectedGroup ?? this.selected), direction, index, index + offset);
      if (kind === 'connection') {
        moveItem(doc.connections, index, index + offset);
      }
    }, 'List order updated.');
    if (kind === 'module' && target.dataset.blockId) {
      this.root
        .querySelector(`[data-action="drag"][data-block-id="${CSS.escape(target.dataset.blockId)}"]`)
        ?.focus();
      return;
    }
    let query = `[data-action="drag"][data-kind="${kind}"][data-index="${index + offset}"]`;
    if (direction) query += `[data-direction="${direction}"]`;
    this.root.querySelector(query)?.focus();
  }

  showDialog(content) {
    this.dialog.removeAttribute('role');
    this.styleSession = null;
    this.labelSession = null;
    this.dialogPreviewTarget = null;
    this.dialog.classList.remove('style-dialog');
    this.dialog.removeAttribute('aria-describedby');
    this.dialogTrigger = document.activeElement;
    const data = this.dialogTrigger?.dataset;
    this.dialogFocusAction = data?.action ? `[data-action="${CSS.escape(data.action)}"]` : null;
    this.dialog.innerHTML = content;
    this.dialog.showModal();
    resizeTextareas(this.dialog);
  }

  renderScopeControls() {
    const control = this.root.querySelector('#view-scope');
    const markup = select(viewScopeOptions(this.document), this.rootGroupId ?? '');
    const options = new DOMParser().parseFromString(markup, 'text/html').querySelector('select').innerHTML;
    if (control.innerHTML !== options) control.innerHTML = options;
    control.value = this.rootGroupId ?? '';
    control.title = this.rootGroupId
      ? itemPath(this.document, this.rootGroupId)
          .map((item) => singleLine(item.label) + ' [' + item.id + ']')
          .join(' / ')
      : 'Top — Entire diagram';
    const path = this.root.querySelector('#preview-path');
    path.hidden = this.rootGroupId === null;
    if (this.rootGroupId) {
      const items = [{ id: '', label: 'Top' }, ...itemPath(this.document, this.rootGroupId)];
      path.innerHTML = items
        .map(
          (item, index) =>
            (index ? '<span aria-hidden="true">/</span>' : '') +
            (index === items.length - 1
              ? '<span aria-current="location">' + e(singleLine(item.label)) + '</span>'
              : button('view-scope', singleLine(item.label), {
                  className: 'text-button',
                  ariaLabel: 'View ' + singleLine(item.label),
                  attrs: 'data-id="' + e(item.id) + '"',
                })),
        )
        .join('');
    } else path.replaceChildren();
  }

  changeViewScope(id) {
    if (this.dialog.open) return;
    const next = validViewRoot(this.document, id);
    if (next === this.rootGroupId) return;
    const restoreSelector =
      this.root.querySelector('#preview-path').contains(document.activeElement) ||
      this.root.querySelector('#preview-actions-menu').contains(document.activeElement);
    this.root.querySelector('#preview-actions-menu').open = false;
    this.clearSelection(false);
    this.rootGroupId = next;
    this.renderScopeControls();
    if (restoreSelector) this.root.querySelector('#view-scope').focus({ preventScroll: true });
    this.scheduleLayout();
  }

  previewSelection() {
    if (this.selectedConnection) return { kind: 'connection', id: this.selectedConnection };
    if (this.selectedGroup) return { kind: 'group', id: this.selectedGroup };
    return this.selected ? { kind: 'module', id: this.selected } : null;
  }

  previewActionsReady() {
    return this.valid && !this.pending && this.formDrafts.size === 0;
  }

  previewTargetVisible(target) {
    if (!target) return false;
    return target.kind === 'connection'
      ? this.preview?.layout?.connections.some((edge) => edge.editorKey === target.id)
      : [...(this.preview?.layout?.modules ?? []), ...(this.preview?.layout?.groups ?? [])].some(
          (item) => item.id === target.id,
        );
  }

  previewActionItems() {
    const target = this.previewSelection();
    const group =
      target?.kind === 'group' ? this.document.groups?.find((group) => group.id === target.id) : null;
    return previewActions(group, this.rootGroupId);
  }

  updatePreviewActions() {
    const target = this.previewSelection(),
      enabled = this.previewActionsReady();
    const available = enabled && this.previewTargetVisible(target);
    for (const item of this.previewActionItems()) {
      this.root.querySelectorAll(`[data-action="${item.action}"]`).forEach((control) => {
        control.hidden = Boolean(item.hidden);
        control.disabled = !available;
        control.title = available
          ? item.label
          : 'Select a visible item in an updated preview. Finish any invalid fields first.';
        if (control.closest('#preview-actions-menu')) {
          control.querySelector('span').textContent = item.label;
          control.setAttribute('aria-label', item.label);
        }
      });
    }
    this.preview?.setActionsEnabled(enabled);
    if (!available) {
      const menu = this.root.querySelector('#preview-actions-menu');
      if (menu) menu.open = false;
    }
  }

  openPreviewStyle(target) {
    if (this.dialog.open || !this.previewActionsReady() || !this.previewTargetVisible(target)) return;
    this.root.querySelector('#preview-actions-menu').open = false;
    if (target.kind === 'connection') this.selectConnection(target.id);
    else this.selectModule(target.id);
    this.editStyle(
      {
        kind: target.kind,
        ...(target.kind === 'connection'
          ? { connectionKey: target.id }
          : target.kind === 'group'
            ? { groupId: target.id }
            : { moduleId: target.id }),
      },
      target,
    );
  }

  previewLabelTarget(document, target) {
    if (target.kind === 'connection')
      return document.connections?.find((edge) => connectionKey(edge) === target.id);
    return (target.kind === 'group' ? document.groups : document.modules)?.find(
      (item) => item.id === target.id,
    );
  }

  openPreviewLabel(target) {
    if (this.dialog.open || !this.previewActionsReady() || !this.previewTargetVisible(target)) return;
    const item = this.previewLabelTarget(this.document, target);
    if (!item) return;
    this.root.querySelector('#preview-actions-menu').open = false;
    if (target.kind === 'connection') this.selectConnection(target.id);
    else this.selectModule(target.id);
    this.showDialog(renderLabelDialog(item, target.kind));
    this.labelSession = { ...target };
    this.dialogPreviewTarget = { ...target };
    this.dialog.setAttribute('aria-describedby', 'label-dialog-help');
  }

  confirmPreviewLabel() {
    if (!this.labelSession || this.composing) return;
    const target = this.labelSession;
    const field = this.dialog.querySelector('#preview-label-text');
    clearFieldError(field);
    field.setAttribute('aria-describedby', 'label-dialog-help');
    try {
      const label = field.value.trim() ? normalizeDisplayText(field.value) : undefined;
      this.commit((doc) => {
        const item = this.previewLabelTarget(doc, target);
        if (!item) throw new Error('This item is no longer available. Cancel and select it again.');
        if (label !== undefined) item.label = label;
        else delete item.label;
        validateDocument(doc);
      }, 'Label updated.');
      this.dialog.close();
    } catch (error) {
      this.dialog.querySelector('#label-dialog-error').textContent = error.message;
      setFieldError(field, error.message);
      field.setAttribute('aria-describedby', 'label-dialog-help ' + field.getAttribute('aria-describedby'));
    }
  }

  togglePreviewGroup(id) {
    if (this.dialog.open || !this.previewActionsReady()) return;
    const group = this.document.groups?.find((group) => group.id === id);
    if (
      !group ||
      id === this.rootGroupId ||
      groupType(group) === 'container' ||
      !this.previewTargetVisible({ kind: 'group', id })
    )
      return;
    const disclosure = document.activeElement?.dataset.previewGroup === id;
    this.selectGroup(id);
    this.commit((doc) => setGroupCollapsed(doc, id, !group.collapsed), 'Group visibility updated.');
    const target = { kind: 'group', id, disclosure };
    this.preview.focusTarget(target);
    this.preview.focusAfterLayout = target;
  }

  openPreviewMenu(target, point) {
    if (this.dialog.open || !this.previewActionsReady() || !this.previewTargetVisible(target)) return;
    if (target.kind === 'connection') this.selectConnection(target.id);
    else this.selectModule(target.id);
    const menu = this.root.querySelector('#preview-actions-menu');
    menu.contextPoint = point;
    menu.open = true;
    positionDisclosureMenu(menu);
    menu.querySelector('summary').focus({ preventScroll: true });
  }

  openStyleDialog(trigger) {
    const kind = trigger.dataset.styleKind;
    const session = {
      kind,
      moduleId: trigger.dataset.module,
      groupId: trigger.dataset.group,
      portId: trigger.dataset.port,
      connectionIndex: Number(trigger.dataset.connection),
    };
    this.editStyle(session);
  }

  editStyle(session, previewTarget = null) {
    const kind = session.kind;
    const target = this.styleTarget(this.document, session);
    if (!target) return;
    const module = portOwner(this.document, session.moduleId);
    session.style = structuredClone(target.style ?? {});
    session.label =
      kind === 'connection'
        ? `${target.from} → ${target.to}`
        : kind === 'port'
          ? `${module.label ?? module.id} · ${target.id}`
          : (target.label ?? target.id);
    session.direction = target.direction;
    this.showDialog(renderStyleDialog(session));
    this.styleSession = session;
    this.dialog.classList.add('style-dialog');
    this.dialog.setAttribute('aria-describedby', 'style-dialog-help');
    this.dialogPreviewTarget = previewTarget;
    this.dialogFocusAction =
      kind === 'group'
        ? `[data-action="edit-style"][data-style-kind="group"][data-group="${CSS.escape(session.groupId)}"]`
        : `[data-action="edit-style"][data-style-kind="${kind}"]${kind === 'connection' ? `[data-connection="${session.connectionIndex}"]` : `[data-module="${CSS.escape(session.moduleId)}"]${kind === 'port' ? `[data-port="${CSS.escape(session.portId)}"]` : ''}`}`;
  }

  styleTarget(document, session) {
    if (session.kind === 'group') return document.groups?.find((group) => group.id === session.groupId);
    if (session.kind === 'connection')
      return session.connectionKey
        ? document.connections?.find((connection) => connectionKey(connection) === session.connectionKey)
        : document.connections?.[session.connectionIndex];
    const module = portOwner(document, session.moduleId);
    return session.kind === 'port' ? module?.ports.find((p) => p.id === session.portId) : module;
  }

  confirmStyle() {
    const session = this.styleSession;
    if (!session) return;
    this.dialog.querySelectorAll('[data-style-property]').forEach((element) => clearFieldError(element));
    try {
      const style = readStyleDialog(this.dialog, session);
      this.commit((doc) => {
        const target = this.styleTarget(doc, session);
        if (!target) throw new Error('This item is no longer available. Cancel and select it again.');
        if (Object.keys(style).length) target.style = style;
        else delete target.style;
      }, 'Style updated.');
      this.dialog.close();
    } catch (error) {
      this.dialog.querySelector('#style-dialog-error').textContent = error.message;
      const field = styleErrorField(this.dialog, error.path);
      if (field) setFieldError(field, error.message);
    }
  }

  connectionDialog() {
    const sources = endpoints(this.document, 'output');
    if (!sources.length || !endpoints(this.document, 'input').length) {
      this.announce('Add at least one output and input port before creating a connection.', true);
      return;
    }
    this
      .showDialog(`<form novalidate><div class="dialog-heading"><h2 id="dialog-title">Add connection</h2><p>Choose compatible ports. Group inputs can feed internal blocks; group outputs can receive internal connections. Unspecified widths do not restrict connections.</p></div>
      ${field(
        this.document.groups?.some((g) => groupType(g) === 'boundary') ? 'Source port' : 'Source Output',
        select(
          sources.map((p) => ({ value: p.ref, label: p.label })),
          sources[0].ref,
          'id="dialog-source" data-field="dialog-source" autofocus',
        ),
      )}
      ${field(this.document.groups?.some((g) => groupType(g) === 'boundary') ? 'Target port' : 'Target Input', '<select id="dialog-target" data-field="dialog-target"></select>')}
      ${field('Label', textarea('', 'id="dialog-label" placeholder="Optional"'))}
      ${feedbackControl(false, 'id="dialog-feedback" data-field="dialog-feedback" aria-describedby="dialog-feedback-help"')}<p class="field-help" id="dialog-feedback-help">Prefer this connection as feedback when a cycle exists. Block positions may still change.</p>
      <p id="dialog-error" class="field-error" role="status"></p><footer class="dialog-actions">${button('cancel-dialog', 'Cancel', { className: 'outline' })}${button('confirm-connection', 'Add connection', { className: 'primary' })}</footer></form>`);
    this.updateConnectionDialog();
  }

  updateConnectionDialog() {
    const source = this.dialog.querySelector('#dialog-source');
    if (!source) return;
    const target = this.dialog.querySelector('#dialog-target');
    const previous = target.value;
    const options = endpoints(this.document, 'input').map((p) => {
      const reason = targetReason(this.document, source.value, p.ref);
      return { value: p.ref, label: `${p.label}${reason ? `（${reason}）` : ''}`, disabled: !!reason };
    });
    const selected =
      options.find((o) => o.value === previous && !o.disabled)?.value ??
      options.find((o) => !o.disabled)?.value ??
      '';
    target.innerHTML = options
      .map(
        (o) =>
          `<option value="${e(o.value)}" ${o.disabled ? 'disabled' : ''} ${o.value === selected ? 'selected' : ''}>${e(o.label)}</option>`,
      )
      .join('');
    target.value = selected;
    const noTarget = !selected;
    this.dialog.querySelector('[data-action="confirm-connection"]').disabled = noTarget;
    this.dialog.querySelector('#dialog-error').textContent = noTarget
      ? 'No compatible target port is available. Check boundaries, existing drivers and widths.'
      : '';
  }

  confirmConnection() {
    const from = this.dialog.querySelector('#dialog-source').value;
    const to = this.dialog.querySelector('#dialog-target').value;
    const feedback = this.dialog.querySelector('#dialog-feedback').checked;
    const label = this.dialog.querySelector('#dialog-label').value;
    const reason = targetReason(this.document, from, to);
    if (reason) {
      this.dialog.querySelector('#dialog-error').textContent = reason;
      return;
    }
    this.commit((doc) => {
      doc.connections ??= [];
      doc.connections.push({
        from,
        to,
        ...(feedback ? { feedback: true } : {}),
        ...(label.trim() ? { label } : {}),
      });
      validateDocument(doc);
    }, 'Connection added.');
    this.dialog.close();
  }

  replaceDocument(document, message) {
    if (!this.dirty) return this.performReplace(document, message);
    this.replacement = { document, message };
    this.showDialog(
      `<div class="dialog-heading"><h2 id="dialog-title">Switch documents?</h2><p>Your changes have not been downloaded as JSON. You can still use Undo after switching documents.</p></div><footer class="dialog-actions">${button('cancel-dialog', 'Cancel', { className: 'outline', attrs: 'autofocus' })}${button('confirm-replace', 'Switch document', { className: 'primary' })}</footer>`,
    );
  }

  performReplace(document, message) {
    this.rootGroupId = null;
    this.groupSearch = '';
    this.root.querySelector('[data-field="group-search"]').value = '';
    this.selectedGroup = null;
    this.selectedConnection = null;
    this.formDrafts.clear();
    this.history.commit(document);
    this.selected = document.modules[0]?.id ?? null;
    this.resetView = true;
    this.afterEdit(message);
  }

  async openFile(file) {
    if (!file || this.openingFile) return;
    this.openingFile = true;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('This JSON file exceeds 5 MB. Choose a smaller file.');
      const original = JSON.parse(await file.text());
      const document = migrateLegacyLayout(original);
      validateDocument(document);
      this.replaceDocument(
        document,
        `Opened ${file.name}.${JSON.stringify(original) !== JSON.stringify(document) ? ' Legacy layout settings removed.' : ''}`,
      );
    } catch (error) {
      this.announce(
        error instanceof SyntaxError
          ? 'Invalid JSON. Your current document is unchanged.'
          : `Cannot open file: ${error.message}`,
        true,
      );
    } finally {
      this.openingFile = false;
      this.root.querySelector('#file-input').value = '';
    }
  }

  settingsDialog() {
    const layout = this.document.layout ?? {};
    this
      .showDialog(`<form novalidate><div class="dialog-heading"><h2 id="dialog-title">Layout settings</h2><p>Changes update the preview automatically and can be undone.</p></div><div class="settings-grid">
      ${field(
        'Direction',
        select(
          [
            { value: 'right', label: 'Right' },
            { value: 'left', label: 'Left' },
          ],
          layout.direction ?? 'right',
          'data-field="setting" data-property="direction"',
        ),
      )}
      ${field(
        'Feedback routing',
        select(
          [
            { value: 'elk', label: 'ELK' },
            { value: 'outer', label: 'Outer' },
          ],
          layout.feedbackRouting ?? 'elk',
          'data-field="setting" data-property="feedbackRouting"',
        ),
      )}
      ${field(
        'Placement',
        select(
          [
            { value: 'default', label: 'Default' },
            { value: 'relaxed', label: 'Relaxed' },
          ],
          layout.placement ?? 'default',
          'data-field="setting" data-property="placement"',
        ),
      )}
      ${field('Block spacing', input(layout.moduleSpacing ?? 50, 'data-field="setting" data-property="moduleSpacing" min="1"', 'number'))}
      ${field('Layer spacing', input(layout.layerSpacing ?? 80, 'data-field="setting" data-property="layerSpacing" min="1"', 'number'))}
      ${field('Outer margin', input(layout.feedbackMargin ?? 20, 'data-field="setting" data-property="feedbackMargin" min="1"', 'number'))}
      ${field('Outer lane spacing', input(layout.feedbackLaneSpacing ?? 12, 'data-field="setting" data-property="feedbackLaneSpacing" min="1"', 'number'))}
      </div><p class="field-help">Outer feedback routing requires Right direction.</p><footer class="dialog-actions">${button('cancel-dialog', 'Done', { className: 'primary' })}</footer></form>`);
  }

  filename() {
    return this.document.diagram.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'diagram';
  }

  async exportPng() {
    if (this.exporting || !this.valid || this.pending || !this.currentSvg) return;
    this.exporting = true;
    this.updateControls();
    this.announce('Generating PNG…');
    try {
      const blob = await svgToPngBlob(this.currentSvg, this.pngScale);
      downloadBlob(blob, `${this.filename()}.png`);
      this.announce(`Exported ${this.pngScale}× PNG.`);
    } catch (error) {
      this.announce(error.message, true);
    } finally {
      this.exporting = false;
      this.updateControls();
    }
  }

  isFileDrag(event) {
    return (
      Array.from(event.dataTransfer?.types ?? []).includes('Files') ||
      Boolean(event.dataTransfer?.files.length)
    );
  }

  openDroppedFile(transfer) {
    if (this.dialog.open) {
      this.announce('Close the current dialog before opening a file.', true);
      return;
    }
    if (this.openingFile) {
      this.announce('A file is already being opened. Try again when it finishes.', true);
      return;
    }
    const files = Array.from(transfer.files);
    if (files.length !== 1) {
      this.announce('Drop one JSON file at a time. Your current document is unchanged.', true);
      return;
    }
    const file = files[0];
    if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
      this.announce('Drop a JSON file (.json). Your current document is unchanged.', true);
      return;
    }
    this.openFile(file);
  }

  dragEvents() {
    this.root.addEventListener('dragstart', (event) => {
      const handle = event.target.closest('[data-action="drag"]');
      if (!handle) return;
      this.dragData = {
        ...handle.dataset,
        module: this.selectedGroup ?? this.selected,
        blockId: handle.dataset.blockId,
      };
      event.dataTransfer.setData('text/plain', json(this.dragData));
      event.dataTransfer.effectAllowed = 'move';
      handle.closest('[data-drop-kind]').classList.add('dragging');
    });
    this.root.addEventListener('dragover', (event) => {
      if (this.isFileDrag(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = this.dialog.open || this.openingFile ? 'none' : 'copy';
        return;
      }
      if (!this.dragData) return;
      const row = event.target.closest('[data-drop-kind]');
      if (!row) return;
      const kind = this.dragData.kind;
      if (
        !(['module', 'group'].includes(kind) && ['module', 'group', 'root'].includes(row.dataset.dropKind)) &&
        !(
          kind === 'port' &&
          row.dataset.dropKind === 'port' &&
          row.dataset.direction === this.dragData.direction
        ) &&
        !(kind === 'connection' && row.dataset.dropKind === 'connection')
      )
        return;
      const moving = this.dragData.blockId;
      const parent = row.dataset.dropKind === 'group' ? row.dataset.groupId : row.dataset.parentGroup;
      if (moving && !canPlace(this.document, moving, parent ?? '')) {
        event.dataTransfer.dropEffect = 'none';
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      this.root.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
      row.classList.add('drop-target');
      if (['module', 'group'].includes(this.dragData.kind) && row.dataset.dropKind === 'module') {
        this.root
          .querySelectorAll('.drop-before,.drop-after')
          .forEach((el) => el.classList.remove('drop-before', 'drop-after'));
        row.classList.add(
          event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 3
            ? 'drop-before'
            : 'drop-after',
        );
      }
      if (
        ['module', 'group'].includes(this.dragData.kind) &&
        row.dataset.dropKind === 'group' &&
        this.collapsedGroups.has(row.dataset.groupId)
      ) {
        if (this.hoverGroup !== row.dataset.groupId) {
          clearTimeout(this.groupHoverTimer);
          this.hoverGroup = row.dataset.groupId;
          this.groupHoverTimer = setTimeout(() => {
            this.collapsedGroups.delete(this.hoverGroup);
            this.saveGroupPreferences();
            const members = row.querySelector('.group-members');
            if (members) members.hidden = false;
            const toggle = row.querySelector('[data-action="toggle-group"]');
            if (toggle) {
              toggle.setAttribute('aria-expanded', 'true');
              toggle.innerHTML = icon('down');
              toggle.setAttribute(
                'aria-label',
                'Collapse ' +
                  (this.document.groups.find((group) => group.id === this.hoverGroup)?.label ??
                    this.hoverGroup),
              );
            }
          }, 500);
        }
      } else {
        clearTimeout(this.groupHoverTimer);
        this.hoverGroup = null;
      }
    });
    this.root.addEventListener('drop', (event) => {
      event.preventDefault();
      if (this.isFileDrag(event)) {
        this.clearDrag();
        this.openDroppedFile(event.dataTransfer);
        return;
      }
      const data = this.dragData;
      if (!data) return;
      const row = event.target.closest('[data-drop-kind]');
      try {
        this.commit((doc) => {
          if (['module', 'group'].includes(data.kind) && row) {
            const id = data.blockId ?? doc.modules[Number(data.index)]?.id;
            if (row.dataset.dropKind === 'group') placeBlock(doc, id, row.dataset.groupId);
            if (row.dataset.dropKind === 'root') placeBlock(doc, id);
            if (row.dataset.dropKind === 'module')
              placeBlock(
                doc,
                id,
                row.dataset.parentGroup,
                row.dataset.id,
                event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 3,
              );
            this.collapsedGroups.delete(row.dataset.groupId ?? row.dataset.parentGroup);
          }
          if (
            data.kind === 'port' &&
            row?.dataset.dropKind === 'port' &&
            row.dataset.direction === data.direction
          )
            movePort(
              portOwner(doc, data.module),
              data.direction,
              Number(data.index),
              Number(row.dataset.index),
            );
          if (data.kind === 'connection') {
            const from = Number(data.connection);
            if (row?.dataset.dropKind === 'connection')
              moveItem(doc.connections, from, Number(row.dataset.index));
          }
        }, 'List order updated.');
      } catch (error) {
        this.announce(error.message, true);
      }
      this.clearDrag();
    });
    this.root.addEventListener('dragend', () => this.clearDrag());
    this.root.querySelector('#block-list').addEventListener('contextmenu', (event) => {
      const row = event.target.closest('.block-row, .group-row');
      if (!row) return;
      event.preventDefault();
      const menu = row.querySelector('.block-menu, .group-menu');
      menu.open = true;
      menu.querySelector('summary').focus();
    });
    this.groupSplitterEvents();
  }

  clearDrag() {
    if (this.dragData) this.saveGroupPreferences();
    this.dragData = null;
    clearTimeout(this.groupHoverTimer);
    this.hoverGroup = null;
    this.root
      .querySelectorAll('.dragging,.drop-target,.drop-before,.drop-after')
      .forEach((el) => el.classList.remove('dragging', 'drop-target', 'drop-before', 'drop-after'));
  }

  selectGroup(id) {
    if (!this.document.groups?.some((group) => group.id === id)) return;
    this.selected = null;
    this.selectedConnection = null;
    this.selectedGroup = id;
    for (const parent of ancestors(this.document, id)) this.collapsedGroups.delete(parent);
    this.groupSearch = '';
    this.root.querySelector('[data-field="group-search"]').value = '';
    this.saveGroupPreferences();
    this.setEditorTab('blocks');
    this.renderForms();
    if (!this.root.querySelector('#workspace').hidden)
      this.root
        .querySelector(`.group-select[data-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
  }

  saveGroupPreferences() {
    try {
      localStorage.setItem(
        'blockflow.editor.groups',
        json({
          collapsed: [...this.collapsedGroups],
          width: this.blockListWidth,
          editorWidth: this.editorListWidth,
        }),
      );
    } catch {
      /* Optional preferences. */
    }
  }

  pathMarkup(id) {
    const path = itemPath(this.document, id);
    return `<nav class="item-path" aria-label="Selected item path"><span>Root</span>${path.map((part, i) => `<span aria-hidden="true">/</span>${i === path.length - 1 ? `<span aria-current="location">${e(singleLine(part.label))}</span>` : button('select-group', singleLine(part.label), { className: 'text-button', ariaLabel: 'Open group ' + singleLine(part.label), attrs: `data-id="${e(part.id)}"` })}`).join('')}</nav>`;
  }

  moveToGroupDialog(id) {
    this.movingBlock = id;
    const isGroup = this.document.groups?.some((group) => group.id === id);
    const label = isGroup ? 'Move group' : 'Move block';
    const options = (this.document.groups ?? [])
      .filter((group) => canPlace(this.document, id, group.id))
      .map((group) => ({
        value: group.id,
        label:
          itemPath(this.document, group.id)
            .map((item) => singleLine(item.label))
            .join(' / ') +
          ' [' +
          group.id +
          ']',
      }));
    this.showDialog(
      `<form novalidate><div class="dialog-heading"><h2 id="dialog-title">${label}</h2><p>Choose a parent for ${e(id)}, or move it to root.</p></div>${field('Group', select([{ value: '', label: 'No group (root)' }, ...options], groupOf(this.document, id), 'id="move-group" autofocus'))}<footer class="dialog-actions">${button('cancel-dialog', 'Cancel', { className: 'outline' })}${button('confirm-group-move', label, { className: 'primary' })}</footer></form>`,
    );
  }

  groupSplitterEvents() {
    const splitter = this.root.querySelector('#block-list-splitter');
    const update = (width) => {
      const full = this.viewMode === 'editor';
      const value = Math.max(200, Math.min(560, width));
      if (full) this.editorListWidth = value;
      else this.blockListWidth = value;
      this.root
        .querySelector('#blocks-settings')
        .style.setProperty(full ? '--editor-list-width' : '--block-list-width', value + 'px');
      splitter.setAttribute('aria-valuenow', value);
      this.saveGroupPreferences();
    };
    splitter.addEventListener('keydown', (event) => {
      const deltas = { ArrowLeft: -10, ArrowRight: 10 };
      if (event.key in deltas || ['Home', 'End'].includes(event.key)) {
        event.preventDefault();
        update(
          event.key === 'Home'
            ? 200
            : event.key === 'End'
              ? 560
              : (this.viewMode === 'editor' ? this.editorListWidth : this.blockListWidth) + deltas[event.key],
        );
      }
    });
    splitter.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      splitter.setPointerCapture(event.pointerId);
    });
    splitter.addEventListener('pointermove', (event) => {
      if (splitter.hasPointerCapture(event.pointerId))
        update(event.clientX - this.root.querySelector('#blocks-settings').getBoundingClientRect().left);
    });
    splitter.addEventListener('pointerup', (event) => {
      if (splitter.hasPointerCapture(event.pointerId)) splitter.releasePointerCapture(event.pointerId);
    });
  }

  splitterEvents() {
    const splitter = this.root.querySelector('#splitter');
    const adjust = (share) => {
      const value = Math.max(30, Math.min(70, share));
      this.root.querySelector('.studio').style.setProperty('--editor-share', `${value}%`);
      splitter.setAttribute('aria-valuenow', Math.round(value));
      splitter.setAttribute('aria-valuetext', `${Math.round(value)}% settings`);
    };
    splitter.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      splitter.focus({ preventScroll: true });
      splitter.setPointerCapture(event.pointerId);
      this.splitDrag = { x: event.clientX, share: Number(splitter.getAttribute('aria-valuenow')) };
    });
    splitter.addEventListener('pointermove', (event) => {
      if (this.splitDrag)
        adjust(
          this.splitDrag.share +
            ((event.clientX - this.splitDrag.x) / this.root.querySelector('.workbench').clientWidth) * 100,
        );
    });
    splitter.addEventListener('pointerup', () => (this.splitDrag = null));
    splitter.addEventListener('pointercancel', () => (this.splitDrag = null));
    splitter.addEventListener('keydown', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        adjust(
          event.key === 'Home'
            ? 30
            : event.key === 'End'
              ? 70
              : Number(splitter.getAttribute('aria-valuenow')) + (event.key === 'ArrowLeft' ? -2 : 2),
        );
      }
    });
  }
}
