import { h, fill, singleLine, replaceKeepingFocus } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button, iconButton, field, textInput, select, segmented, toggle, checkbox, combobox, showMenu } from '../../ui/controls.js';
import { styleEditor, quickStyles, overrideDot } from '../../ui/style-editor.js';
import { QUICK_STYLES, DEFAULT_CATEGORIES, STYLE_SCHEMA, BUILT_IN, documentColors } from '../state/style-schema.js';
import { renameModule, renamePort, movePort, setGroupType, setGroupCollapsed, convertToBoundaryGroup, saveTerminal, groupOf } from '../../../editor/blockchart/commands.js';
import { normalizeDisplayText } from '../../../lib/blockchart/model.js';
import { itemPath, ancestors } from '../../../lib/blockchart/hierarchy.js';
import { resolveLayoutSpacing } from '../../../lib/blockchart/layout-spacing.js';
import {
  findModule,
  findGroup,
  findOwner,
  displayName,
  sourceOptions,
  targetOptions,
  branchEntry,
  setBranch,
  setNetSource,
  netTitle,
  newPort,
  setFlowDirection,
  concatSide,
  renameGroup,
  renameNet,
  parseGridText,
  gridText,
  directMembers,
  endpointKey,
  endpointFromKey,
  groupType,
  moveTargets,
  PORT_RANK,
} from '../state/actions.js';
import { targetEndpoints } from '../../../lib/blockchart/nets.js';
import { createGridPlan } from '../../../lib/blockchart/grid.js';

const label = (value) => (typeof value === 'string' && value.trim() ? normalizeDisplayText(value) : undefined);
/** Spacing the runtime uses when the field is omitted (formerly the Compact preset). */
const SPACING_DEFAULTS = Object.freeze({ module: 20, layer: 30 });
const posNumber = (raw, name) => {
  const t = String(raw).trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number or blank for Auto.`);
  return n;
};
const posInt = (raw) => {
  const t = String(raw).trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Width must be a positive whole number of bits.');
  return n;
};
const setOrDelete = (obj, key, value) => {
  if (value === undefined) delete obj[key];
  else obj[key] = value;
};

function section(title, content, extra = {}) {
  return h(
    'section',
    { class: ['insp-section', extra.class] },
    h('header', { class: 'insp-section-head' }, h('h3', title), extra.badge ? h('span', { class: 'count' }, extra.badge) : null, h('div', { class: 'spacer' }), extra.actions ?? null),
    extra.hint ? h('p', { class: 'insp-hint' }, extra.hint) : null,
    content,
  );
}

export class Inspector {
  constructor(store, callbacks) {
    this.store = store;
    this.cb = callbacks;
    this.tab = 'properties';
    this.defaultsCategory = 'module';
    this.head = h('div', { class: 'insp-head' });
    this.tabs = h('div', { class: 'insp-tabs', role: 'tablist', 'aria-label': 'Inspector' });
    this.body = h('div', { class: 'insp-body', role: 'tabpanel' });
    this.el = h('aside', { class: 'pane inspector', 'aria-label': 'Inspector' }, this.head, this.tabs, this.body);
  }

  /** Commit helper: errors surface inline (text fields) or as a toast. */
  commit(change, message) {
    return this.cb.commit(change, message);
  }
  tryCommit(change, message) {
    try {
      this.commit(change, message);
    } catch (error) {
      this.cb.notify(error.message, 'error');
    }
  }

  setTab(tab) {
    this.tab = tab;
    this.render();
  }

  render() {
    const sel = this.store.selection;
    const doc = this.store.document;
    let view;
    if (!sel) view = this.documentView(doc);
    else if (sel.type === 'block' || (sel.type === 'port' && findModule(doc, sel.owner))) view = this.blockView(doc, sel.type === 'port' ? sel.owner : sel.id, sel.type === 'port' ? sel.port : null);
    else if (sel.type === 'group' || sel.type === 'port') view = this.groupView(doc, sel.type === 'port' ? sel.owner : sel.id, sel.type === 'port' ? sel.port : null);
    else if (sel.type === 'net') view = this.netView(doc, sel.index, sel.branch);
    else if (sel.type === 'terminal') view = this.terminalView(doc, sel.id);
    if (!view) view = this.documentView(doc);
    fill(this.head, 
      h('div', { class: 'insp-title' }, view.icon, h('div', { class: 'insp-title-text' }, h('h2', view.title), h('div', { class: 'insp-sub' }, view.subtitle))),
      view.headActions ?? null,
    );
    const tabs = view.tabs ?? [
      ['properties', 'Properties'],
      ['style', 'Style'],
    ];
    if (!tabs.some(([k]) => k === this.tab)) this.tab = tabs[0][0];
    this.tabs.replaceChildren(
      ...tabs.map(([key, text]) =>
        h('button', { type: 'button', role: 'tab', class: ['tab', key === this.tab && 'on'], 'aria-selected': String(key === this.tab), onclick: () => this.setTab(key) }, text),
      ),
    );
    replaceKeepingFocus(this.body, (view[this.tab] ?? view.properties)());
  }

  /* ---------------- shared pieces ---------------- */
  effective(kind, id, extra) {
    const L = this.store.layout?.layout;
    if (!L) return undefined;
    if (kind === 'module') {
      const m = L.modules.find((x) => x.id === id);
      if (!m) return undefined;
      const port = (dir) => m.ports.find((p) => !dir || p.direction === dir)?.style;
      return { ...m.style, portLabel: port(), inputPortLabel: port('input'), outputPortLabel: port('output') };
    }
    if (kind === 'group') {
      const g = L.groups?.find((x) => x.id === id);
      return g ? { ...g.style, portLabel: g.ports?.[0]?.style } : undefined;
    }
    if (kind === 'connection') {
      const cs = L.connections.filter((c) => c.connectionIndex === id);
      if (!cs.length) return undefined;
      return { ...(cs[0].netStyle ?? cs[0].style), label: cs[0].style.label };
    }
    if (kind === 'branch') return L.connections.find((c) => c.connectionIndex === id && c.branchIndex === extra)?.style;
    if (kind === 'terminal') return L.terminals?.find((t) => t.id === id)?.style;
    if (kind === 'port') {
      const o = L.modules.find((m) => m.id === id) ?? L.groups?.find((g) => g.id === id);
      return o?.ports?.find((p) => p.id === extra)?.style;
    }
    return undefined;
  }

  /** Style editor bound to a getter returning [container, property]. */
  styleBlock(kind, locate, effective, fidPrefix, extra = {}) {
    const doc = this.store.document;
    const [container, prop] = locate(doc, false) ?? [];
    if (!container) return h('p', { class: 'insp-hint' }, 'Not available.');
    const value = container[prop];
    const write = (fn) =>
      this.tryCommit((d) => {
        const [c, p] = locate(d, true);
        const st = structuredClone(c[p] ?? {});
        fn(st);
        for (const k of Object.keys(st)) if (st[k] && typeof st[k] === 'object' && !Object.keys(st[k]).length) delete st[k];
        if (Object.keys(st).length) c[p] = st;
        else delete c[p];
      });
    const set = (path, key, v) =>
      write((st) => {
        const node = path ? (st[path] ??= {}) : st;
        if (v === undefined) delete node[key];
        else node[key] = v;
      });
    const reset = (path, keys) =>
      write((st) => {
        const node = path ? (st[path] ?? {}) : st;
        for (const k of keys) delete node[k];
      });
    const presets = QUICK_STYLES[extra.presetKind ?? kind];
    const clip = this.store.clipboardStyle;
    return [
      presets
        ? section('Quick styles', quickStyles(presets, (style) => write((st) => Object.assign(st, style)), value), {
            hint: 'Writes these values onto this item. Fine-tune them below.',
          })
        : null,
      h(
        'div',
        { class: 'style-tools' },
        button('Copy style', () => {
          this.store.clipboardStyle = { kind, style: structuredClone(value ?? {}) };
          this.cb.notify('Style copied.');
          this.render();
        }, { icon: 'copy', variant: 'ghost', disabled: !value }),
        button('Paste style', () => write((st) => {
          for (const k of Object.keys(st)) delete st[k];
          Object.assign(st, structuredClone(clip.style));
        }), { icon: 'paste', variant: 'ghost', disabled: !clip || clip.kind !== kind, title: clip && clip.kind !== kind ? 'Copied style is for a different kind of item' : undefined }),
        button('Clear all', () => write((st) => Object.keys(st).forEach((k) => delete st[k])), { variant: 'ghost', disabled: !value }),
      ),
      h('p', { class: 'insp-hint legend' }, h('span', { class: 'ovr on' }), 'Set on this item. ', h('span', { class: 'ovr' }), 'Inherited: the grey placeholder shows the value in use.'),
      styleEditor({ schema: STYLE_SCHEMA[kind], builtIn: BUILT_IN[kind], colors: documentColors(doc), value, effective, set, reset, fidPrefix, sections: extra.sections }),
    ];
  }

  portTable(doc, ownerId, focusPort) {
    const owner = findOwner(doc, ownerId);
    const isConcat = owner.type === 'concat';
    const ports = owner.ports ?? [];
    const vertical = doc.layout?.direction === 'down';
    const sideOptions = [
      { value: '', label: `Auto` },
      { value: 'left', label: 'Left' },
      { value: 'right', label: 'Right' },
      { value: 'top', label: 'Top' },
      { value: 'bottom', label: 'Bottom' },
    ];
    const edit = (portId, fn, message) =>
      this.commit((d) => {
        const o = findOwner(d, ownerId);
        fn(o.ports.find((p) => p.id === portId), o, d);
      }, message);
    const used = new Set();
    for (const edge of doc.connections ?? []) {
      used.add(endpointKey(edge.from));
      for (const t of targetEndpoints(edge)) used.add(endpointKey(t));
    }
    // Rows read inputs, then bidirectional, then outputs; each keeps its saved order.
    const listed = [...ports].sort((a, b) => (PORT_RANK[a.direction] ?? 3) - (PORT_RANK[b.direction] ?? 3));
    const rows = listed.map((port) => {
      const dir = port.direction;
      const sameDir = ports.filter((p) => p.direction === dir);
      const order = sameDir.indexOf(port);
      const connected = used.has(ownerId + '.' + port.id);
      return h(
        'div',
        { class: ['prow', focusPort === port.id && 'focus'], 'data-port': port.id },
        h('button', {
          type: 'button',
          class: ['dir', dir],
          title: `${dir} port — ${connected ? 'connected' : 'not connected'}. Click to select on canvas.`,
          onclick: () => this.cb.select({ type: 'port', owner: ownerId, port: port.id }, { reveal: true }),
        }, dir === 'input' ? 'IN' : dir === 'output' ? 'OUT' : 'IO', connected ? null : h('i', { class: 'unlinked', 'aria-label': 'not connected' })),
        textInput({ value: port.id, mono: true, fidKey: `pk-${ownerId}-${port.id}`, ariaLabel: `Port ${port.id} key`, commit: (v) => this.commit((d) => renamePort(d, ownerId, port.id, v)) }),
        textInput({ value: port.label ?? '', placeholder: port.id, fidKey: `pl-${ownerId}-${port.id}`, ariaLabel: `Port ${port.id} label`, commit: (v) => edit(port.id, (p) => setOrDelete(p, 'label', label(v))) }),
        textInput({ value: port.width ?? '', placeholder: '1', type: 'number', min: 1, fidKey: `pw-${ownerId}-${port.id}`, ariaLabel: `Port ${port.id} width in bits`, commit: (v) => edit(port.id, (p) => setOrDelete(p, 'width', posInt(v))) }),
        isConcat
          ? h('span', {
              class: 'side-fixed',
              'data-fid': `ps-${ownerId}-${port.id}`,
              title: 'Concat ports follow the Flow and cannot be moved.',
            }, ((side) => side[0].toUpperCase() + side.slice(1))(concatSide(doc, dir)))
          : select(sideOptions, port.side ?? '', (v) => {
          try {
            edit(port.id, (p) => setOrDelete(p, 'side', v || undefined));
          } catch (error) {
            this.cb.notify(error.message, 'error');
          }
        }, { ariaLabel: `Port ${port.id} side`, fidKey: `ps-${ownerId}-${port.id}` }),
        iconButton('more', `More for port ${port.id}`, (e) =>
          showMenu(e.currentTarget, [
            { label: 'Edit label style', icon: 'style', action: () => (this.cb.select({ type: 'port', owner: ownerId, port: port.id }), this.setTab('style')) },
            { label: 'Move up', icon: 'up', disabled: order === 0, action: () => this.tryCommit((d) => movePort(findOwner(d, ownerId), dir, order, order - 1)) },
            { label: 'Move down', icon: 'down', disabled: order === sameDir.length - 1, action: () => this.tryCommit((d) => movePort(findOwner(d, ownerId), dir, order, order + 1)) },
            '-',
            { label: 'Delete port', icon: 'trash', danger: true, action: () => this.cb.remove({ type: 'port', owner: ownerId, port: port.id }) },
          ], { align: 'right' }),
        ),
      );
    });
    return h(
      'div',
      { class: 'ports' },
      h('div', { class: 'prow head' }, h('span'), h('span', 'Key'), h('span', 'Label'), h('span', 'Bits'), h('span', `Side`), h('span')),
      rows.length ? rows : h('div', { class: 'empty-row' }, 'No ports yet.'),
      h(
        'div',
        { class: 'add-row' },
        button('Input', () => this.addPort(ownerId, 'input'), { icon: 'plus', variant: 'link' }),
        button('Output', () => this.addPort(ownerId, 'output'), { icon: 'plus', variant: 'link', disabled: isConcat && ports.some((p) => p.direction === 'output') }),
        isConcat ? null : button('Bidirectional', () => this.addPort(ownerId, 'inout'), { icon: 'plus', variant: 'link' }),
        h('span', { class: 'insp-hint inline', 'data-hint': isConcat ? 'concat-sides' : 'port-sides' }, isConcat
          ? vertical
            ? 'Concat is a thin bar across the flow: inputs on top in order, output at the bottom.'
            : 'Concat is a thin bar across the flow: inputs on the left in order, output on the right.'
          : vertical ? 'Auto side follows the top-to-bottom flow.' : 'Auto side follows the left-to-right flow.'),
      ),
    );
  }

  addPort(ownerId, direction) {
    try {
      const id = this.commit((d) => newPort(d, ownerId, direction));
      requestAnimationFrame(() => this.body.querySelector(`[data-fid="pk-${CSS.escape(ownerId)}-${CSS.escape(id)}"]`)?.focus());
    } catch (error) {
      this.cb.notify(error.message, 'error');
    }
  }

  netsFor(doc, ownerId, port) {
    const refs = (doc.connections ?? []).flatMap((edge, index) => {
      const keys = [endpointKey(edge.from), ...targetEndpoints(edge).map(endpointKey)];
      return keys.some((k) => (port ? k === ownerId + '.' + port : k.startsWith(ownerId + '.') || k === '@terminal:' + ownerId)) ? [{ edge, index }] : [];
    });
    if (!refs.length) return h('p', { class: 'insp-hint' }, 'Not connected. Drag from a port on the canvas to connect.');
    return h(
      'div',
      { class: 'link-list' },
      refs.map(({ edge, index }) =>
        h('button', { type: 'button', class: 'link-row', onclick: () => this.cb.select({ type: 'net', index }, { reveal: true }) }, icon('net', 14), h('span', { class: 'row-label' }, netTitle(edge)), h('span', { class: 'row-key' }, `${endpointKey(edge.from)} → ${edge.to.length}`)),
      ),
    );
  }

  sizeFields(doc, getter) {
    const item = getter(doc);
    const set = (key) => (v) =>
      this.commit((d) => setOrDelete(getter(d), key, posNumber(v, key === 'width' ? 'Width' : 'Height')));
    return h(
      'div',
      { class: 'grid2' },
      field('Min width', textInput({ value: item.width ?? '', placeholder: 'Auto', type: 'number', min: 1, fidKey: 'size-w', commit: set('width') })),
      field('Min height', textInput({ value: item.height ?? '', placeholder: 'Auto', type: 'number', min: 1, fidKey: 'size-h', commit: set('height') })),
    );
  }

  breadcrumb(doc, id) {
    const path = itemPath(doc, id).slice(0, -1);
    if (!path.length) return 'Top level';
    return path.map((p) => singleLine(p.label)).join(' › ');
  }

  /* ---------------- views ---------------- */
  blockView(doc, id, focusPort) {
    const m = findModule(doc, id);
    if (!m) return null;
    const isConcat = m.type === 'concat';
    return {
      icon: h('span', { class: ['node-ico', 'lg', isConcat ? 'concat' : 'blk'] }, isConcat ? icon('concat', 14) : (m.label ?? m.id).trim().charAt(0)),
      title: displayName(m),
      subtitle: `${isConcat ? 'Concat' : 'Block'} · ${m.id} · in ${this.breadcrumb(doc, id)}`,
      properties: () => [
        focusPort ? section(`Port ${focusPort}`, this.netsFor(doc, id, focusPort), { class: 'focus-section', actions: button('Label style', () => this.setTab('style'), { variant: 'link', icon: 'style' }) }) : null,
        section(
          'Identity',
          h('div', { class: 'stack' }, h(
            'div',
            { class: 'grid2' },
            field('Key', textInput({ value: m.id, mono: true, fidKey: 'b-key', commit: (v) => {
              const r = this.commit((d) => renameModule(d, id, v));
              this.cb.select({ type: 'block', id: r.id });
              if (r.adjusted) this.cb.notify(`Key in use — renamed to ${r.id}.`);
            } }), { hint: 'Used in JSON and port references.' }),
            field('Label', textInput({ value: m.label ?? '', placeholder: m.id, multiline: true, fidKey: 'b-label', commit: (v) => this.commit((d) => setOrDelete(findModule(d, id), 'label', label(v))) }), { hint: 'Ctrl+Enter saves. Blank shows the key.' }),
          ),
          this.insideField(doc, id, 'b-inside')),
        ),
        section('Ports', this.portTable(doc, id, focusPort), { badge: String(m.ports?.length ?? 0) }),
        isConcat
          ? null
          : section(
              'Shape',
              h(
                'div',
                { class: 'stack' },
                segmented(
                  [
                    { value: 'rectangle', label: 'Rectangle' },
                    { value: 'bar', label: 'Bar' },
                    { value: 'stacked', label: 'Stacked' },
                    { value: 'trapezoid', label: 'Trapezoid' },
                  ],
                  m.appearance?.type ?? 'rectangle',
                  (v) => this.tryCommit((d) => {
                    const b = findModule(d, id);
                    if (v === 'rectangle') delete b.appearance;
                    else b.appearance = { type: v };
                  }),
                  { ariaLabel: 'Block shape', fidKey: 'shape' },
                ),
                m.appearance?.type === 'stacked'
                  ? field('Stack layers', select([1, 2, 3].map((n) => ({ value: String(n), label: String(n) })), String(m.appearance.layers ?? 2), (v) => this.tryCommit((d) => (findModule(d, id).appearance.layers = Number(v)))))
                  : null,
                m.appearance?.type === 'trapezoid'
                  ? field('Right edge height', textInput({ value: m.appearance.rightHeightRatio ?? '', placeholder: '0.6', type: 'number', step: 0.05, min: 0.2, fidKey: 'trap', commit: (v) => this.commit((d) => setOrDelete(findModule(d, id).appearance, 'rightHeightRatio', v.trim() ? Number(v) : undefined)) }), { hint: 'Ratio from 0.2 to 1 of the left edge.' })
                  : null,
                this.sizeFields(doc, (d) => findModule(d, id)),
              ),
            ),
        section('Connections', this.netsFor(doc, id)),
        h(
          'div',
          { class: 'insp-actions' },
          isConcat ? null : button('Duplicate', () => this.cb.run('duplicate'), { icon: 'copy', variant: 'ghost' }),
          button('Group', () => this.cb.run('group'), { icon: 'group', variant: 'ghost' }),
          isConcat ? null : button('Convert to boundary group', () => this.tryCommit((d) => convertToBoundaryGroup(d, id), 'Converted to a boundary group.') , { icon: 'layers', variant: 'ghost', title: 'Keeps the key and ports; the block becomes a group you can fill.' }),
          button('Delete', () => this.cb.remove({ type: 'block', id }), { icon: 'trash', variant: 'danger-ghost' }),
        ),
      ],
      style: () =>
        focusPort
          ? [
              section(`Port ${focusPort} label`, styleEditor0(this, 'text', (d) => [findOwner(d, id).ports.find((p) => p.id === focusPort), 'style'], this.effective('port', id, focusPort), 'ps')),
              h('div', { class: 'insp-actions' }, button('Edit block style', () => this.cb.select({ type: 'block', id }), { variant: 'ghost' })),
            ]
          : this.styleBlock('module', (d) => [findModule(d, id), 'style'], this.effective('module', id), 'ms'),
    };
  }

  /** Which group holds this block or group. Same command as dragging it onto a group. */
  insideField(doc, id, fidKey) {
    const targets = moveTargets(doc, id);
    const current = targets.find((t) => t.current)?.id ?? '';
    return field(
      'Inside',
      select(
        targets.map((t) => ({ value: t.id, label: '  '.repeat(Math.max(0, t.depth - 1)) + t.label })),
        current,
        (v) => this.cb.place(id, v),
        { fidKey, ariaLabel: 'Inside group' },
      ),
      { hint: 'The automatic layout decides where it goes.' },
    );
  }

  groupView(doc, id, focusPort) {
    const g = findGroup(doc, id);
    if (!g) return null;
    const type = groupType(g);
    const members = g.members.map((mid) => findOwner(doc, mid)).filter(Boolean);
    return {
      icon: h('span', { class: ['node-ico', 'lg', 'grp', type] }, type === 'boundary' ? 'B' : type === 'collection' ? 'C' : ''),
      title: displayName(g),
      subtitle: `${type[0].toUpperCase() + type.slice(1)} group · ${g.id} · in ${this.breadcrumb(doc, id)}`,
      headActions: iconButton('enter', 'Open group view', () => this.cb.enterGroup(id)),
      tabs: [
        ['properties', 'Properties'],
        ['layout', 'Layout'],
        ['style', 'Style'],
      ],
      properties: () => [
        focusPort ? section(`Port ${focusPort}`, this.netsFor(doc, id, focusPort), { class: 'focus-section' }) : null,
        section(
          'Identity',
          h('div', { class: 'stack' }, h(
            'div',
            { class: 'grid2' },
            field('Key', textInput({ value: g.id, mono: true, fidKey: 'g-key', commit: (v) => {
              const nid = this.commit((d) => renameGroup(d, id, v)); // the view follows (Studio.requestLayout)
              this.cb.select({ type: 'group', id: nid });
            } })),
            field('Label', textInput({ value: g.label ?? '', placeholder: g.id, multiline: true, fidKey: 'g-label', commit: (v) => this.commit((d) => setOrDelete(findGroup(d, id), 'label', label(v))) })),
          ),
          this.insideField(doc, id, 'g-inside')),
        ),
        section(
          'Kind',
          h(
            'div',
            { class: 'stack' },
            segmented(
              [
                { value: 'container', label: 'Container', title: 'Visual frame; members connect directly.' },
                { value: 'boundary', label: 'Boundary', title: 'Has its own ports; can hide contents.' },
                { value: 'collection', label: 'Collection', title: 'Shows repeated instances as a stack.' },
              ],
              type,
              (v) => {
                try {
                  this.commit((d) => setGroupType(d, id, v));
                } catch (error) {
                  this.cb.notify(error.problems?.length ? `${error.message} ${error.problems[0]}${error.problems.length > 1 ? ` (+${error.problems.length - 1} more)` : ''}` : error.message, 'error');
                }
              },
              { ariaLabel: 'Group kind', fidKey: 'gtype' },
            ),
            type !== 'container'
              ? toggle('Hide contents', Boolean(g.collapsed), (v) => this.tryCommit((d) => setGroupCollapsed(d, id, v)), { fidKey: 'gcollapse', title: 'Show this group as a single block' })
              : null,
          ),
        ),
        type === 'boundary' ? section('Boundary ports', this.portTable(doc, id, focusPort), { badge: String(g.ports?.length ?? 0) }) : null,
        section(
          'Members',
          members.length
            ? h(
                'div',
                { class: 'link-list' },
                members.map((m) =>
                  h('button', { type: 'button', class: 'link-row', onclick: () => this.cb.select({ type: findGroup(doc, m.id) ? 'group' : 'block', id: m.id }, { reveal: true }) }, icon(findGroup(doc, m.id) ? 'group' : 'block', 14), h('span', { class: 'row-label' }, displayName(m)), h('span', { class: 'row-key' }, m.id)),
                ),
              )
            : h('p', { class: 'insp-hint' }, 'Empty. Drag blocks onto this group on the canvas or in the outline.'),
          { badge: String(members.length), actions: button('Add block', () => this.cb.run('add-block-in', id), { icon: 'plus', variant: 'link' }) },
        ),
        section('Size', this.sizeFields(doc, (d) => findGroup(d, id))),
        h(
          'div',
          { class: 'insp-actions' },
          button('Open view', () => this.cb.enterGroup(id), { icon: 'enter', variant: 'ghost' }),
          button('Ungroup', () => this.cb.remove({ type: 'group', id }), { icon: 'ungroup', variant: 'ghost', title: 'Keep the members, remove the frame' }),
          button('Delete with contents', () => this.cb.run('delete-group-deep', id), { icon: 'trash', variant: 'danger-ghost' }),
        ),
      ],
      layout: () => [this.groupSpacing(doc, id), this.gridEditor(doc, id)],
      style: () => this.styleBlock('group', (d) => [findGroup(d, id), 'style'], this.effective('group', id), 'gs'),
    };
  }

  /**
   * Block/Layer spacing set on a group. Omitted means inherited (nearest ancestor, then the
   * diagram, then the defaults); only explicit values are written, and clearing removes them.
   */
  groupSpacing(doc, id) {
    const g = findGroup(doc, id);
    const local = g.layout ?? {};
    const parent = groupOf(doc, id);
    const inherited = resolveLayoutSpacing(doc, parent);
    const sourceOf = (key) => {
      for (const a of [...ancestors(doc, id)].reverse()) {
        const ag = findGroup(doc, a);
        if (ag.layout && Object.hasOwn(ag.layout, key)) return 'group ' + ag.id;
      }
      return doc.layout && Object.hasOwn(doc.layout, key) ? 'the diagram' : 'the default';
    };
    const commit = (key, name) => (v) =>
      this.commit((d) => {
        const o = findGroup(d, id);
        const t = v.trim();
        if (t === '') {
          if (o.layout) delete o.layout[key];
        } else {
          const n = Number(t);
          if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number.`);
          o.layout ??= {};
          o.layout[key] = n;
        }
        if (o.layout && !Object.keys(o.layout).length) delete o.layout;
      });
    const fields = [
      ['moduleSpacing', 'Block spacing', 'g-ms'],
      ['layerSpacing', 'Layer spacing', 'g-ls'],
    ].map(([key, name, fidKey]) => {
      const set = Object.hasOwn(local, key);
      const from = `${sourceOf(key)} (${inherited[key]})`;
      const dot = overrideDot(set, () => commit(key, name)(''), name, {
        setTitle: `Set on this group — click to inherit from ${from}`,
        unsetTitle: `Inherited from ${from}`,
        setLabel: `Inherit ${name} from ${from}`,
        unsetLabel: `${name} is inherited from ${from}`,
      });
      dot.dataset.fid = `${fidKey}-dot`;
      return field(name, textInput({ value: local[key] ?? '', placeholder: String(inherited[key]), type: 'number', min: 0, step: 'any', fidKey, commit: commit(key, name) }), { badge: dot, class: 'with-dot' });
    });
    const notes = [];
    if (g.collapsed) notes.push(h('p', { class: 'insp-hint', 'data-hint': 'spacing-collapsed' }, 'Contents are hidden: these values are kept and apply when the contents are shown.'));
    if (local.type === 'grid')
      notes.push(h('p', { class: 'insp-hint', 'data-hint': 'spacing-grid' }, 'Grid places the members listed in Cells (Row/Column gap). Spacing still applies to members left automatic and to automatic groups inside.'));
    return section('Spacing inside', h('div', { class: 'stack' }, h('div', { class: 'grid2' }, fields), notes), {
      hint: 'Spacing between the blocks inside this group. Groups inside inherit it unless they set their own. Where this group sits among its siblings follows its parent. Values are minimums: a gap can grow to give crowded nets their own wire tracks; the saved value stays as typed.',
    });
  }

  gridEditor(doc, scope) {
    const owner = scope ? findGroup(doc, scope) : doc;
    const layout = owner.layout ?? {};
    const isGrid = layout.type === 'grid';
    const members = directMembers(doc, scope);
    const locate = (d) => (scope ? findGroup(d, scope) : d);
    const containers = members.filter((m) => {
      const g = findGroup(doc, m);
      return g && groupType(g) === 'container' && !g.collapsed && g.members.length;
    });
    let expanded = [];
    if (isGrid)
      try {
        expanded = createGridPlan(layout.cells, members, doc.groups ?? []).expandedContainers;
      } catch {
        /* The committed document is valid; a failing plan only hides the indicator. */
      }
    return section(
      scope ? 'Member arrangement' : 'Top-level arrangement',
      h(
        'div',
        { class: 'stack' },
        segmented(
          [
            { value: 'auto', label: 'Automatic (ELK)' },
            { value: 'grid', label: 'Grid' },
          ],
          isGrid ? 'grid' : 'auto',
          (v) =>
            this.tryCommit((d) => {
              const o = locate(d);
              if (v === 'auto') {
                // Grid fields only: local Block/Layer spacing stays (runtime contract).
                for (const k of ['type', 'cells', 'rowGap', 'columnGap', 'blockMinWidth', 'blockMinHeight', 'blockAlign']) delete o.layout?.[k];
                if (scope && o.layout && !Object.keys(o.layout).length) delete o.layout;
              } else {
                o.layout ??= {};
                o.layout.type = 'grid';
                const vertical = d.layout?.direction === 'down';
                o.layout.cells = vertical ? members.map((m) => [m]) : [members];
              }
            }),
          { ariaLabel: 'Arrangement', fidKey: 'grid-mode' },
        ),
        isGrid
          ? [
              field(
                'Cells',
                textInput({
                  value: gridText(layout.cells),
                  multiline: true,
                  mono: true,
                  fidKey: 'grid-cells',
                  commit: (v) => {
                    try {
                      this.commit((d) => (locate(d).layout.cells = parseGridText(v)));
                    } catch (error) {
                      const at = /cells\[(\d+)\](?:\[(\d+)\])?$/.exec(error.path ?? '');
                      if (!at) throw error;
                      const where = `Row ${+at[1] + 1}${at[2] === undefined ? '' : `, column ${+at[2] + 1}`}`;
                      throw new Error(`${where}: ${error.message}`);
                    }
                  },
                }),
                { hint: 'One row per line; separate keys with spaces; "." leaves a cell empty. Ctrl+Enter saves.' },
              ),
              h(
                'div',
                { class: 'grid2' },
                field('Row gap', textInput({ value: layout.rowGap ?? '', placeholder: '50', type: 'number', min: 0, fidKey: 'rg', commit: (v) => this.commit((d) => setOrDelete(locate(d).layout, 'rowGap', v.trim() === '' ? undefined : Number(v))) })),
                field('Column gap', textInput({ value: layout.columnGap ?? '', placeholder: '80', type: 'number', min: 0, fidKey: 'cg', commit: (v) => this.commit((d) => setOrDelete(locate(d).layout, 'columnGap', v.trim() === '' ? undefined : Number(v))) })),
              ),
              h('p', { class: 'insp-hint', 'data-hint': 'gap-minimum' }, 'Gaps are minimums. A crowded gap widens so each net gets its own wire track; the saved value stays as typed.'),
              h(
                'div',
                { class: 'grid2' },
                field('Block min width', textInput({ value: layout.blockMinWidth ?? '', placeholder: 'Auto', type: 'number', min: 0, step: 'any', fidKey: 'grid-bmw', commit: (v) => this.commit((d) => setOrDelete(locate(d).layout, 'blockMinWidth', posNumber(v, 'Block min width'))) })),
                field('Block min height', textInput({ value: layout.blockMinHeight ?? '', placeholder: 'Auto', type: 'number', min: 0, step: 'any', fidKey: 'grid-bmh', commit: (v) => this.commit((d) => setOrDelete(locate(d).layout, 'blockMinHeight', posNumber(v, 'Block min height'))) })),
              ),
              h('p', { class: 'insp-hint', 'data-hint': 'grid-block-min' }, 'Smallest size for the blocks written in Cells, in block units (width 1 = 140, height 1 = 84). Blocks can still grow for their content or their own size; blank is Auto.'),
              field(
                'Block alignment',
                segmented(
                  [
                    { value: 'left', label: 'Left', title: 'Align block left edges in each column' },
                    { value: 'center', label: 'Center', title: 'Center blocks in each column (default)' },
                    { value: 'right', label: 'Right', title: 'Align block right edges in each column' },
                  ],
                  layout.blockAlign ?? 'center',
                  (v) => this.tryCommit((d) => setOrDelete(locate(d).layout, 'blockAlign', v === 'center' ? undefined : v)),
                  { ariaLabel: 'Block alignment', fidKey: 'grid-align' },
                ),
                { hint: 'Moves the blocks written in Cells within their column; sizes and label text alignment do not change.' },
              ),
              h('p', { class: 'insp-hint' }, 'Members: ', h('span', { class: 'mono' }, members.join('  '))),
              containers.length
                ? h(
                    'p',
                    { class: 'insp-hint' },
                    'Container blocks: write a container’s blocks instead of its name to align them with the rest of this grid (all of them, as one rectangle). Blocks added to an expanded container are placed in its rectangle.',
                    containers.map((cid) =>
                      h(
                        'span',
                        { class: 'mono', style: 'display:block' },
                        `${cid}${expanded.includes(cid) ? ' (expanded)' : ''} → ${findGroup(doc, cid).members.join('  ')}`,
                      ),
                    ),
                  )
                : null,
            ]
          : h('p', { class: 'insp-hint' }, 'ELK places members automatically from their connections. Use Grid only when you need a fixed row/column order.'),
      ),
      { hint: 'Layout hints change how the automatic layout arranges items. Positions are never set by hand.' },
    );
  }

  netView(doc, index, branch) {
    const net = doc.connections?.[index];
    if (!net) return null;
    const targets = net.to.map((_, j) => branchEntry(net, j));
    const sources = sourceOptions(doc);
    const fromKey = endpointKey(net.from);
    const edit = (fn, message) => this.commit((d) => fn(d.connections[index], d), message);
    const tryEdit = (fn) => {
      try {
        edit(fn);
      } catch (error) {
        this.cb.notify(error.message, 'error');
      }
    };
    return {
      icon: h('span', { class: ['node-ico', 'lg', 'net'] }, icon('net', 14)),
      title: netTitle(net),
      subtitle: `Net · ${targets.length} target${targets.length === 1 ? '' : 's'}${net.direction === 'both' ? ' · bidirectional' : ''}`,
      properties: () => [
        section(
          'Signal',
          h(
            'div',
            { class: 'stack' },
            h(
              'div',
              { class: 'grid2' },
              field('Net ID', textInput({ value: net.id ?? '', placeholder: 'Optional', mono: true, fidKey: 'n-id', commit: (v) => this.commit((d) => renameNet(d, index, v)) })),
              field('Label', textInput({ value: net.label ?? '', placeholder: 'Signal name', multiline: true, fidKey: 'n-label', commit: (v) => edit((n) => setOrDelete(n, 'label', label(v))) })),
            ),
            field(
              'Source',
              combobox({
                options: sources,
                value: fromKey,
                fidKey: 'n-src',
                ariaLabel: 'Net source',
                onpick: (v) => tryEdit((n, d) => setNetSource(d, index, v)),
              }),
              { hint: 'One driver per net.' },
            ),
            toggle('Bidirectional', net.direction === 'both', (on) => tryEdit((n) => setOrDelete(n, 'direction', on ? 'both' : undefined)), { fidKey: 'n-both', title: 'All endpoints must be inout ports' }),
          ),
        ),
        section(
          'Targets',
          h(
            'div',
            { class: 'targets' },
            h('div', { class: 'trow head' }, h('span', 'Endpoint'), h('span', { title: 'Route as feedback' }, 'Feedback'), h('span', { title: 'Let this branch influence placement' }, 'Placement'), h('span')),
            targets.map((entry, j) => {
              const key = endpointKey(entry.endpoint);
              const fb = entry.feedback ?? net.feedback ?? false;
              const cons = (entry.constraint ?? net.constraint) !== false;
              return h(
                'div',
                { class: ['trow', branch === j && 'focus'] },
                combobox({
                  options: targetOptions(doc, net, index, j),
                  value: key,
                  compact: true,
                  fidKey: `n-t-${j}`,
                  ariaLabel: `Target ${j + 1}`,
                  onpick: (v) => tryEdit((n) => setBranch(n, j, { ...branchEntry(n, j), endpoint: endpointFromKey(v) })),
                }),
                checkbox('', fb, (on) => tryEdit((n) => setBranch(n, j, { ...branchEntry(n, j), feedback: on === Boolean(n.feedback) ? undefined : on })), { ariaLabel: `Target ${j + 1} feedback`, fidKey: `n-fb-${j}` }),
                checkbox('', cons, (on) => tryEdit((n) => setBranch(n, j, { ...branchEntry(n, j), constraint: on === (n.constraint !== false) ? undefined : on })), { ariaLabel: `Target ${j + 1} affects placement`, fidKey: `n-c-${j}` }),
                h(
                  'div',
                  { class: 'trow-actions' },
                  entry.style ? h('span', { class: 'ovr on', title: 'This branch has its own line style' }) : null,
                  iconButton('more', `More for target ${j + 1}`, (e) =>
                    showMenu(e.currentTarget, [
                      { label: 'Branch line style', icon: 'style', action: () => (this.cb.select({ type: 'net', index, branch: j }), this.setTab('style')) },
                      { label: 'Select on canvas', icon: 'target', action: () => this.cb.select({ type: 'net', index, branch: j }, { reveal: true, zoom: true }) },
                      '-',
                      { label: 'Remove target', icon: 'trash', danger: true, disabled: targets.length === 1, action: () => this.cb.remove({ type: 'net', index, branch: j }) },
                    ], { align: 'right' }),
                  ),
                ),
              );
            }),
            h(
              'div',
              { class: 'trow add' },
              combobox({
                options: targetOptions(doc, net, index),
                value: null,
                placeholder: '+ Add target…',
                compact: true,
                fidKey: 'n-add',
                ariaLabel: 'Add target',
                onpick: (v) => tryEdit((n) => n.to.push(endpointFromKey(v))),
              }),
            ),
          ),
          { badge: String(targets.length) },
        ),
        section(
          'Layout hints',
          h(
            'div',
            { class: 'stack' },
            toggle('Feedback (all targets)', Boolean(net.feedback), (on) => tryEdit((n) => setOrDelete(n, 'feedback', on || undefined)), { fidKey: 'n-fb' }),
            toggle('Affects placement (all targets)', net.constraint !== false, (on) => tryEdit((n) => setOrDelete(n, 'constraint', on ? undefined : false)), { fidKey: 'n-con' }),
          ),
          { hint: 'Feedback routes a branch back against the flow. Turning off placement lets ELK ignore a branch when ordering blocks. Per-target values override these.' },
        ),
        h(
          'div',
          { class: 'insp-actions' },
          button('Select source', () => {
            const k = endpointKey(net.from);
            this.cb.select(k.startsWith('@terminal:') ? { type: 'terminal', id: k.slice(10) } : { type: 'port', owner: k.split('.')[0], port: k.split('.')[1] }, { reveal: true });
          }, { icon: 'target', variant: 'ghost' }),
          button('Delete net', () => this.cb.remove({ type: 'net', index }), { icon: 'trash', variant: 'danger-ghost' }),
        ),
      ],
      style: () =>
        branch !== undefined && targets.length > 1
          ? [
              section(`Target ${branch + 1}: ${endpointKey(targets[branch].endpoint)}`, styleEditor0(this, 'branch', (d, writing) => {
                const n = d.connections[index];
                // Branch styles live on the expanded target entry.
                const expanded = n.to[branch] && typeof n.to[branch] === 'object' && Object.hasOwn(n.to[branch], 'endpoint');
                if (!expanded && !writing) return [{ endpoint: n.to[branch] }, 'style'];
                if (!expanded) n.to[branch] = { endpoint: n.to[branch] };
                return [n.to[branch], 'style'];
              }, this.effective('branch', index, branch), 'bs'), { hint: 'Overrides the net line for this branch only.' }),
              h('div', { class: 'insp-actions' }, button('Edit whole net style', () => this.cb.select({ type: 'net', index }), { variant: 'ghost' })),
            ]
          : this.styleBlock('connection', (d) => [d.connections[index], 'style'], this.effective('connection', index), 'ns'),
    };
  }

  terminalView(doc, id) {
    const t = doc.terminals?.find((x) => x.id === id);
    if (!t) return null;
    const save = (fn) =>
      this.commit((d) => {
        const current = structuredClone(d.terminals.find((x) => x.id === id));
        fn(current);
        saveTerminal(d, id, current);
        return current.id;
      });
    return {
      icon: h('span', { class: ['node-ico', 'lg', 'term', t.direction] }, t.direction === 'input' ? 'IN' : 'OUT'),
      title: displayName(t),
      subtitle: `External ${t.direction} · ${t.id}`,
      properties: () => [
        section(
          'Identity',
          h(
            'div',
            { class: 'stack' },
            h(
              'div',
              { class: 'grid2' },
              field('Key', textInput({ value: t.id, mono: true, fidKey: 't-key', commit: (v) => {
                const nid = save((x) => (x.id = v.trim()));
                this.cb.select({ type: 'terminal', id: nid });
              } })),
              field('Bits', textInput({ value: t.width ?? '', placeholder: '1', type: 'number', min: 1, fidKey: 't-w', commit: (v) => save((x) => setOrDelete(x, 'width', posInt(v))) })),
            ),
            field('Label', textInput({ value: t.label ?? '', placeholder: t.id, multiline: true, fidKey: 't-label', commit: (v) => save((x) => setOrDelete(x, 'label', label(v))) })),
            field('Direction', segmented([
              { value: 'input', label: 'External input' },
              { value: 'output', label: 'External output' },
            ], t.direction, (v) => this.tryCommit((d) => {
              const cur = structuredClone(d.terminals.find((x) => x.id === id));
              cur.direction = v;
              saveTerminal(d, id, cur);
            }), { fidKey: 't-dir' }), { hint: 'Inputs drive nets; outputs receive them.' }),
          ),
        ),
        section('Connections', this.netsFor(doc, id)),
        h('div', { class: 'insp-actions' }, button('Delete terminal', () => this.cb.remove({ type: 'terminal', id }), { icon: 'trash', variant: 'danger-ghost' })),
      ],
      style: () => styleEditor0(this, 'text', (d) => [d.terminals.find((x) => x.id === id), 'style'], this.effective('terminal', id), 'ts'),
    };
  }

  documentView(doc) {
    const L = doc.layout ?? {};
    const setLayout = (key) => (v) => this.tryCommit((d) => {
      d.layout ??= {};
      setOrDelete(d.layout, key, v);
    });
    const numLayout = (key, name) => (v) =>
      this.commit((d) => {
        d.layout ??= {};
        const t = v.trim();
        if (t === '') return void delete d.layout[key];
        const n = Number(t);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number.`);
        d.layout[key] = n;
      });
    const vertical = L.direction === 'down';
    // Runtime spacing defaults (docs/layout-defaults.md); explicit values always win.
    const preset = SPACING_DEFAULTS;
    const counts = `${doc.modules.length} blocks · ${doc.groups?.length ?? 0} groups · ${doc.connections?.length ?? 0} nets`;
    return {
      icon: h('span', { class: 'node-ico lg doc' }, icon('file', 14)),
      title: singleLine(doc.diagram?.name ?? 'Untitled diagram'),
      subtitle: this.store.root ? `Viewing group ${this.store.root} · ${counts}` : counts,
      tabs: [
        ['properties', 'Diagram'],
        ['layout', 'Layout'],
        ['style', 'Defaults'],
      ],
      properties: () => [
        section(
          'Diagram',
          h(
            'div',
            { class: 'stack' },
            field('Name', textInput({ value: doc.diagram?.name ?? '', fidKey: 'd-name', commit: (v) => this.commit((d) => {
              if (!v.trim()) throw new Error('Enter a diagram name.');
              d.diagram.name = v.trim();
            }) })),
            field('Caption', textInput({ value: doc.diagram?.caption ?? '', placeholder: 'Optional note under the diagram', multiline: true, fidKey: 'd-cap', commit: (v) => this.commit((d) => setOrDelete(d.diagram, 'caption', label(v))) })),
          ),
        ),
        section(
          'Get started',
          h(
            'ul',
            { class: 'tips' },
            h('li', h('b', 'Add'), ' blocks, groups and terminals with ', h('kbd', 'A'), ' or the + button.'),
            h('li', h('b', 'Connect'), ' by dragging from a port to another port. Dragging from a port that already drives a net adds a target to that net.'),
            h('li', h('b', 'Regroup'), ' by dragging a block, or a group by its title, onto a group. Or use Move to… or Inside. The automatic layout decides where it goes.'),
            h('li', h('b', 'Rename'), ' with a double-click or ', h('kbd', 'F2'), '. Press ', h('kbd', 'Ctrl K'), ' for every command.'),
          ),
        ),
      ],
      layout: () => [
        section(
          'Flow',
          h(
            'div',
            { class: 'stack' },
            field('Direction', segmented([
              { value: 'right', label: 'Left → right' },
              { value: 'down', label: 'Top → bottom' },
            ], L.direction ?? 'right', (v) => this.tryCommit((d) => setFlowDirection(d, v)), { fidKey: 'l-dir' })),
            field('Placement', select([
              { value: 'default', label: 'Balanced (default)' },
              { value: 'relaxed', label: 'Relaxed' },
              { value: 'simple', label: 'Simple' },
            ], L.placement ?? 'default', (v) => setLayout('placement')(v === 'default' ? undefined : v), { fidKey: 'l-place' })),
            h(
              'div',
              { class: 'grid2' },
              ...[
                ['moduleSpacing', 'Block spacing', preset.module, 'l-ms'],
                ['layerSpacing', 'Layer spacing', preset.layer, 'l-ls'],
              ].map(([key, name, value, fidKey]) => {
                const dot = overrideDot(L[key] !== undefined, () => setLayout(key)(undefined), name, {
                  setTitle: `Set on this diagram — click to use the default (${value})`,
                  unsetTitle: `Default (${value})`,
                  setLabel: `Use the default ${name} (${value})`,
                  unsetLabel: `${name} uses the default (${value})`,
                });
                dot.dataset.fid = `${fidKey}-dot`;
                return field(name, textInput({ value: L[key] ?? '', placeholder: String(value), type: 'number', min: 1, fidKey, commit: numLayout(key, name) }), { badge: dot, class: 'with-dot' });
              }),
            ),
          ),
        ),
        section(
          'Feedback routing',
          h(
            'div',
            { class: 'stack' },
            field('Route feedback', segmented([
              { value: 'elk', label: 'Inside (ELK)' },
              { value: 'outer', label: 'Around the outside' },
            ], L.feedbackRouting ?? 'elk', (v) => this.tryCommit((d) => {
              d.layout ??= {};
              if (v === 'elk') {
                delete d.layout.feedbackRouting;
                delete d.layout.feedbackSide;
              } else d.layout.feedbackRouting = v;
            }), { fidKey: 'l-fr' })),
            L.feedbackRouting === 'outer'
              ? [
                  field('Side', select([
                    { value: 'auto', label: 'Auto' },
                    ...(vertical ? ['left', 'right'] : ['top', 'bottom']).map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) })),
                  ], L.feedbackSide ?? 'auto', (v) => setLayout('feedbackSide')(v === 'auto' ? undefined : v), { fidKey: 'l-fs' })),
                  h(
                    'div',
                    { class: 'grid2' },
                    field('Margin', textInput({ value: L.feedbackMargin ?? '', placeholder: '20', type: 'number', min: 1, fidKey: 'l-fm', commit: numLayout('feedbackMargin', 'Margin') })),
                    field('Lane spacing', textInput({ value: L.feedbackLaneSpacing ?? '', placeholder: '12', type: 'number', min: 1, fidKey: 'l-fl', commit: numLayout('feedbackLaneSpacing', 'Lane spacing') })),
                  ),
                ]
              : null,
          ),
        ),
        section(
          'Port adjustment',
          h(
            'div',
            { class: 'stack' },
            segmented([
              { value: 'reduce-bends', label: 'Reduce bends' },
              { value: 'fixed', label: 'Fixed' },
            ], L.portAdjustment ?? 'reduce-bends', (v) => setLayout('portAdjustment')(v === 'reduce-bends' ? undefined : v), { fidKey: 'l-pa' }),
            (L.portAdjustment ?? 'reduce-bends') === 'reduce-bends'
              ? field('Maximum shift', textInput({ value: L.maxPortShift ?? '', placeholder: '40', type: 'number', min: 0, fidKey: 'l-mps', commit: numLayout('maxPortShift', 'Maximum shift') }))
              : null,
          ),
          { hint: 'Slides ports and terminals along their edge to straighten wires. Block placement is unchanged.' },
        ),
        this.gridEditor(doc, ''),
      ],
      style: () => {
        const cat = DEFAULT_CATEGORIES.find((c) => c.key === this.defaultsCategory) ?? DEFAULT_CATEGORIES[0];
        return [
          section(
            'Diagram defaults',
            segmented(DEFAULT_CATEGORIES.map((c) => ({ value: c.key, label: c.label })), cat.key, (v) => {
              this.defaultsCategory = v;
              this.render();
            }, { class: 'wrap', fidKey: 'dcat' }),
            { hint: 'Applies to every item of this kind unless the item sets its own value.' },
          ),
          ...this.styleBlock(cat.kind, (d, writing) => {
            if (writing) d.diagram.style ??= {};
            return [d.diagram.style ?? {}, cat.key];
          }, undefined, 'ds-' + cat.key, { presetKind: cat.kind === 'text' ? null : cat.kind }),
        ];
      },
    };
  }
}

function styleEditor0(inspector, kind, locate, effective, fidPrefix) {
  return inspector.styleBlock(kind, locate, effective, fidPrefix);
}
