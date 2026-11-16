import { h, fill, singleLine, replaceKeepingFocus } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button, field, textInput, select, segmented, toggle } from '../../ui/controls.js';
import { styleEditor, quickStyles, overrideDot } from '../../ui/style-editor.js';
import {
  renameNode,
  renameGroup,
  placeNode,
  reconnectEdge,
  attachNote,
  ungroup,
  validateDocument,
} from '../../../editor/flowchart/commands.js';
import {
  NODE_TYPES,
  EDGE_KINDS,
  SIDES,
  typeInfo,
  swap,
  edgeKey,
  edgeIndex,
  findEdge,
  findNode,
  findGroup,
  parentOf,
  displayName,
  edgeTitle,
  noteOf,
  moveTargets,
} from '../state/actions.js';
import {
  FLOW_STYLE_SCHEMA,
  DEFAULT_CATEGORIES,
  QUICK_STYLES,
  resolvedDefaults,
  documentColors,
} from '../state/style-schema.js';

const cap = (s) => s[0].toUpperCase() + s.slice(1);
/** Display text as the runtime accepts it: blank removes the label (the id is shown). */
const labelText = (value) => (value.trim() ? value.replace(/\r\n?/g, '\n').replace(/\s+$/, '') : undefined);
const setOrDelete = (obj, key, value) => {
  if (value === undefined) delete obj[key];
  else obj[key] = value;
};
const positive = (raw, name) => {
  const t = String(raw).trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`${name} must be a positive number, or blank for the default.`);
  return n;
};

function section(title, content, extra = {}) {
  return h(
    'section',
    { class: ['insp-section', extra.class] },
    h(
      'header',
      { class: 'insp-section-head' },
      h('h3', title),
      extra.badge ? h('span', { class: 'count' }, extra.badge) : null,
      h('div', { class: 'spacer' }),
      extra.actions ?? null,
    ),
    extra.hint ? h('p', { class: 'insp-hint' }, extra.hint) : null,
    content,
  );
}

/** Flowchart inspector: diagram, layout and defaults; steps, notes, edges and groups. */
export class FlowchartInspector {
  constructor(store, callbacks) {
    this.store = store;
    this.cb = callbacks;
    this.tab = 'properties';
    this.defaultsCategory = 'node';
    this.head = h('div', { class: 'insp-head' });
    this.tabs = h('div', { class: 'insp-tabs', role: 'tablist', 'aria-label': 'Inspector' });
    this.body = h('div', { class: 'insp-body', role: 'tabpanel' });
    this.el = h(
      'aside',
      { class: 'pane inspector', 'aria-label': 'Inspector' },
      this.head,
      this.tabs,
      this.body,
    );
  }

  commit(change) {
    return this.cb.commit(change);
  }
  tryCommit(change) {
    try {
      return this.commit(change);
    } catch (error) {
      this.cb.notify(error.message, 'error');
    }
  }
  /** Runs an action that commits on its own; a failure becomes an error toast. */
  attempt(action) {
    try {
      return action();
    } catch (error) {
      this.cb.notify(error.message, 'error');
    }
  }
  /** Runs a runtime command (returns a new document) as one undoable change. */
  command(fn) {
    return this.commit((d) => swap(d, fn(d)));
  }

  setTab(tab) {
    this.tab = tab;
    this.render();
  }

  render() {
    const sel = this.store.selection;
    const doc = this.store.document;
    let view;
    if (sel?.type === 'node' && findNode(doc, sel.id)) view = this.nodeView(doc, sel.id);
    else if (sel?.type === 'group' && findGroup(doc, sel.id)) view = this.groupView(doc, sel.id);
    else if (sel?.type === 'edge' && findEdge(doc, sel.key)) view = this.edgeView(doc, sel.key);
    else view = this.documentView(doc);
    fill(
      this.head,
      h(
        'div',
        { class: 'insp-title' },
        view.icon,
        h(
          'div',
          { class: 'insp-title-text' },
          h('h2', view.title),
          h('div', { class: 'insp-sub' }, view.subtitle),
        ),
      ),
    );
    const tabs = view.tabs ?? [
      ['properties', 'Properties'],
      ['style', 'Style'],
    ];
    if (!tabs.some(([k]) => k === this.tab)) this.tab = tabs[0][0];
    this.tabs.replaceChildren(
      ...tabs.map(([key, text]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: ['tab', key === this.tab && 'on'],
            'aria-selected': String(key === this.tab),
            onclick: () => this.setTab(key),
          },
          text,
        ),
      ),
    );
    replaceKeepingFocus(this.body, (view[this.tab] ?? view.properties)());
  }

  /** The runtime's resolved model (styles, layout defaults); null while the document is invalid. */
  model() {
    try {
      return validateDocument(this.store.document);
    } catch {
      return null;
    }
  }

  /* ---------------- shared pieces ---------------- */
  /** Style editor for `locate(doc) → [container, key]`; `effective` is the style in use. */
  styleBlock(kind, locate, effective, fidPrefix, builtIn) {
    const doc = this.store.document;
    const [container, prop] = locate(doc) ?? [];
    if (!container) return h('p', { class: 'insp-hint' }, 'Not available.');
    const value = container[prop];
    const write = (fn) =>
      this.tryCommit((d) => {
        const [c, p] = locate(d, true);
        const st = structuredClone(c[p] ?? {});
        fn(st);
        if (Object.keys(st).length) c[p] = st;
        else delete c[p];
      });
    const set = (_path, key, v) => write((st) => setOrDelete(st, key, v));
    const reset = (_path, keys) => write((st) => keys.forEach((k) => delete st[k]));
    const clip = this.store.clipboardStyle;
    const clipKind = kind === 'edge' ? 'edge' : 'node';
    const presets = QUICK_STYLES[kind];
    return [
      presets
        ? section(
            'Quick styles',
            quickStyles(presets, (style) => write((st) => Object.assign(st, style)), value),
            { hint: 'Writes these values onto this item. Fine-tune them below.' },
          )
        : null,
      h(
        'div',
        { class: 'style-tools' },
        button(
          'Copy style',
          () => {
            this.store.clipboardStyle = { kind: clipKind, style: structuredClone(value ?? {}) };
            this.cb.notify('Style copied.');
            this.render();
          },
          { icon: 'copy', variant: 'ghost', disabled: !value },
        ),
        button(
          'Paste style',
          () =>
            write((st) => {
              for (const k of Object.keys(st)) delete st[k];
              Object.assign(st, structuredClone(clip.style));
            }),
          {
            icon: 'paste',
            variant: 'ghost',
            disabled: !clip || clip.kind !== clipKind,
            title:
              clip && clip.kind !== clipKind ? 'Copied style is for a different kind of item' : undefined,
          },
        ),
        button('Clear all', () => write((st) => Object.keys(st).forEach((k) => delete st[k])), {
          variant: 'ghost',
          disabled: !value,
        }),
      ),
      h(
        'p',
        { class: 'insp-hint legend' },
        h('span', { class: 'ovr on' }),
        'Set on this item. ',
        h('span', { class: 'ovr' }),
        'Inherited: the grey placeholder shows the value in use.',
      ),
      styleEditor({
        schema: FLOW_STYLE_SCHEMA[kind],
        builtIn,
        colors: documentColors(doc),
        value,
        effective,
        set,
        reset,
        fidPrefix,
      }),
    ];
  }

  labelField(item, fid, commit) {
    return field(
      'Label',
      textInput({
        value: item.label ?? '',
        placeholder: item.id,
        multiline: true,
        fidKey: fid,
        ariaLabel: 'Label',
        commit: (v) => commit(labelText(v)),
      }),
      { hint: 'Ctrl+Enter or leaving the field saves. Blank shows the ID.' },
    );
  }

  idField(item, fid, rename) {
    return field(
      'ID',
      textInput({
        value: item.id,
        mono: true,
        fidKey: fid,
        ariaLabel: 'ID',
        commit: (v) => this.command((d) => rename(d, item.id, v.trim())),
      }),
      { hint: 'Edges, groups and notes that refer to it are updated.' },
    );
  }

  insideField(
    doc,
    id,
    fid = 'n-inside',
    hint = 'Its note moves with it. The automatic layout decides where it goes.',
  ) {
    const targets = moveTargets(doc, id);
    return field(
      'Inside',
      select(
        targets.map((t) => ({ value: t.id, label: '  '.repeat(Math.max(0, t.depth - 1)) + t.label })),
        parentOf(doc, id) ?? '',
        (v) => this.cb.place(id, v),
        { fidKey: fid, ariaLabel: 'Inside group' },
      ),
      { hint },
    );
  }

  edgeList(doc, id) {
    const rows = doc.edges
      .map((e, i) => ({ e, key: edgeKey(e, i) }))
      .filter(({ e }) => e.from === id || e.to === id)
      .map(({ e, key }) =>
        h(
          'button',
          {
            type: 'button',
            class: 'link-row',
            onclick: () => this.cb.select({ type: 'edge', key }, { reveal: true }),
          },
          h(
            'span',
            { class: 'edge-dir', 'aria-label': e.from === id ? 'To' : 'From' },
            e.from === id ? '→' : '←',
          ),
          h('span', displayName(findNode(doc, e.from === id ? e.to : e.from))),
          e.label ? h('span', { class: 'muted' }, singleLine(e.label)) : null,
        ),
      );
    return rows.length
      ? h('div', { class: 'link-list' }, rows)
      : h('p', { class: 'insp-hint' }, 'Not connected yet.');
  }

  /* ---------------- views ---------------- */
  documentView(doc) {
    const model = this.model();
    return {
      icon: h('span', { class: 'node-ico lg doc' }, icon('flowchart', 14)),
      title: doc.diagram?.name || 'Flowchart',
      subtitle: `${doc.nodes?.length ?? 0} steps · ${doc.edges?.length ?? 0} edges`,
      tabs: [
        ['properties', 'Diagram'],
        ['layout', 'Layout'],
        ['defaults', 'Defaults'],
      ],
      properties: () => [
        section(
          'Diagram',
          h(
            'div',
            { class: 'stack' },
            field(
              'Name',
              textInput({
                value: doc.diagram.name,
                fidKey: 'd-name',
                ariaLabel: 'Diagram name',
                commit: (v) =>
                  this.commit((d) => {
                    if (!v.trim()) throw new Error('The name cannot be blank.');
                    d.diagram.name = v.trim();
                  }),
              }),
            ),
            field(
              'Caption',
              textInput({
                value: doc.diagram.caption ?? '',
                placeholder: 'None',
                multiline: true,
                fidKey: 'd-caption',
                ariaLabel: 'Caption',
                commit: (v) => this.commit((d) => setOrDelete(d.diagram, 'caption', labelText(v))),
              }),
              { hint: 'Explanatory text below the chart.' },
            ),
          ),
        ),
        section(
          'Get started',
          h(
            'ul',
            { class: 'tips' },
            h(
              'li',
              'Hover a step and drag one of its four handles onto another step to connect them, or onto empty space to add the next step.',
            ),
            h('li', 'Drag a step onto a group to move it there; drag a note onto a step to attach it.'),
            h('li', 'Select an edge and drag either end to reconnect it.'),
            h('li', 'The layout places everything; edit labels, types and sides here.'),
          ),
        ),
      ],
      layout: () => this.layoutTab(doc, model),
      defaults: () => this.defaultsTab(doc),
    };
  }

  layoutTab(doc, model) {
    const layout = doc.layout ?? {};
    const write = (fn) =>
      this.commit((d) => {
        const l = structuredClone(d.layout ?? {});
        fn(l);
        if (Object.keys(l).length) d.layout = l;
        else delete d.layout;
      });
    const number = (key, name, fid, fallback = model?.layout?.[key]) => {
      const isSet = layout[key] !== undefined;
      return field(
        h(
          'span',
          { class: 'label-with-dot' },
          name,
          overrideDot(isSet, () => this.attempt(() => write((l) => delete l[key])), name, {
            setTitle: 'Set on this diagram — click to use the default',
            unsetTitle: 'Default',
          }),
        ),
        textInput({
          value: layout[key] ?? '',
          placeholder: String(fallback ?? ''),
          type: 'number',
          min: 1,
          fidKey: fid,
          ariaLabel: name,
          commit: (v) => write((l) => setOrDelete(l, key, positive(v, name))),
        }),
      );
    };
    const dir = layout.direction ?? model?.layout?.direction ?? 'down';
    const vertical = dir === 'down' || dir === 'up';
    return [
      section(
        'Flow',
        h(
          'div',
          { class: 'stack' },
          segmented(
            [
              { value: 'down', label: '↓ Down' },
              { value: 'right', label: '→ Right' },
              { value: 'up', label: '↑ Up' },
              { value: 'left', label: '← Left' },
            ],
            dir,
            (v) => this.cb.run('set-direction', v),
            { fidKey: 'fl-dir', ariaLabel: 'Flow direction' },
          ),
          this.noLoopSide
            ? null
            : field(
                'Loops go',
                select(
                  [
                    { value: '', label: `Default (${model?.layout?.loopSide ?? 'auto'})` },
                    ...['auto', ...(vertical ? ['left', 'right'] : ['top', 'bottom'])].map((v) => ({
                      value: v,
                      label: cap(v),
                    })),
                  ],
                  layout.loopSide ?? '',
                  (v) => this.attempt(() => write((l) => setOrDelete(l, 'loopSide', v || undefined))),
                  { fidKey: 'fl-loop', ariaLabel: 'Loop side' },
                ),
                {
                  hint: 'Edges back to an earlier step go around a side across the flow. Auto picks the shorter route for each one; Left/Right (or Top/Bottom) sends all of them around that side. Sides set on an edge always win.',
                },
              ),
        ),
      ),
      section(
        'Spacing',
        h(
          'div',
          { class: 'grid2' },
          number('nodeSpacing', this.nodeSpacingName ?? 'Step spacing', 'fl-ns'),
          number('layerSpacing', 'Layer spacing', 'fl-ls'),
          this.noNotes ? null : number('noteGap', 'Note gap', 'fl-ng'),
        ),
        {
          hint: 'Blank uses the default shown in grey. Labels that collide are listed under Problems; more spacing or explicit edge sides help.',
        },
      ),
      ...(this.extraLayoutSections?.(number) ?? []),
    ];
  }

  defaultsTab(doc) {
    const cat = this.defaultsCategory;
    const builtIn = resolvedDefaults()[cat];
    return [
      section(
        'Diagram defaults',
        segmented(
          DEFAULT_CATEGORIES.map((c) => ({ value: c.key, label: c.label })),
          cat,
          (v) => ((this.defaultsCategory = v), this.render()),
          { fidKey: 'fd-cat', ariaLabel: 'Defaults for' },
        ),
        {
          hint: 'Every item of this kind uses these values unless it sets its own. Notes also use the step defaults.',
        },
      ),
      ...this.styleBlock(
        cat,
        (d, create) => {
          if (create) {
            d.diagram.style ??= {};
            return [d.diagram.style, cat];
          }
          return [d.diagram.style ?? {}, cat];
        },
        resolvedDefaults(doc.diagram.style)[cat],
        'fd-' + cat,
        builtIn,
      ).map((part) => part),
    ];
  }

  nodeView(doc, id) {
    const n = findNode(doc, id);
    const model = this.model();
    const resolved = model?.nodes.find((x) => x.id === id);
    const isNote = n.type === 'note';
    const info = typeInfo(n.type);
    const edit = (fn) => this.commit((d) => fn(findNode(d, id)));
    const ownerId = resolved?.attachTo ?? n.attachTo;
    const note = isNote ? null : noteOf(doc, id);
    return {
      icon: h('span', { class: ['node-ico', 'lg', 'flow', 'flow-' + info.value] }, icon(info.icon, 14)),
      title: displayName(n),
      subtitle: `${info.label} · ${id}`,
      properties: () => [
        section(
          'Identity',
          h(
            'div',
            { class: 'stack' },
            this.labelField(n, 'n-label', (v) => edit((x) => setOrDelete(x, 'label', v))),
            this.idField(n, 'n-id', renameNode),
            isNote
              ? null
              : field(
                  'Type',
                  segmented(
                    NODE_TYPES.map((t) => ({ value: t.value, label: t.label, icon: t.icon, title: t.hint })),
                    n.type ?? 'process',
                    (v) => this.attempt(() => edit((x) => (v === 'process' ? delete x.type : (x.type = v)))),
                  ),
                  { hint: info.hint },
                ),
            isNote ? null : this.insideField(doc, id),
          ),
        ),
        isNote
          ? section(
              'Attached to',
              h(
                'div',
                { class: 'stack' },
                field(
                  'Step',
                  select(
                    doc.nodes
                      .filter((x) => x.type !== 'note')
                      .map((x) => ({
                        value: x.id,
                        label: displayName(x),
                        disabled: x.id !== ownerId && Boolean(noteOf(doc, x.id)),
                      })),
                    ownerId ?? '',
                    (v) => this.attempt(() => this.command((d) => attachNote(d, id, v))),
                    { fidKey: 'note-owner', ariaLabel: 'Attached to step' },
                  ),
                  { hint: 'A step has at most one note. The note stays in its step’s group.' },
                ),
                field(
                  'Side',
                  segmented(
                    [{ value: '', label: 'Auto' }, ...SIDES.map((s) => ({ value: s, label: cap(s) }))],
                    n.side ?? '',
                    (v) => this.attempt(() => edit((x) => setOrDelete(x, 'side', v || undefined))),
                    { fidKey: 'note-side', ariaLabel: 'Note side' },
                  ),
                  { hint: resolved?.side ? `In use: ${resolved.side}.` : undefined },
                ),
              ),
            )
          : section(
              'Edges',
              h(
                'div',
                { class: 'stack' },
                this.edgeList(doc, id),
                h(
                  'div',
                  { class: 'row-actions' },
                  button('Add next step', () => this.cb.run('add-next', id), {
                    icon: 'nextStep',
                    variant: 'ghost',
                    title: 'Add a connected step after this one (N)',
                  }),
                  note
                    ? button(
                        'Go to note',
                        () => this.cb.select({ type: 'node', id: note }, { reveal: true }),
                        { icon: 'note', variant: 'ghost' },
                      )
                    : button('Add note', () => this.cb.run('add-note', id), {
                        icon: 'note',
                        variant: 'ghost',
                      }),
                ),
              ),
            ),
        section(
          'Size',
          h(
            'div',
            { class: 'grid2' },
            field(
              'Min width',
              textInput({
                value: n.width ?? '',
                placeholder: 'Auto',
                type: 'number',
                min: 1,
                fidKey: 'n-w',
                ariaLabel: 'Minimum width',
                commit: (v) => edit((x) => setOrDelete(x, 'width', positive(v, 'Width'))),
              }),
            ),
            field(
              'Min height',
              textInput({
                value: n.height ?? '',
                placeholder: 'Auto',
                type: 'number',
                min: 1,
                fidKey: 'n-h',
                ariaLabel: 'Minimum height',
                commit: (v) => edit((x) => setOrDelete(x, 'height', positive(v, 'Height'))),
              }),
            ),
          ),
          { hint: 'The shape grows to fit its text; these set a minimum.' },
        ),
      ],
      style: () =>
        this.styleBlock(
          isNote ? 'note' : 'node',
          (d) => [findNode(d, id), 'style'],
          resolved?.style,
          'ns',
          resolvedDefaults(doc.diagram.style)[isNote ? 'note' : 'node'],
        ),
    };
  }

  edgeView(doc, key) {
    const e = findEdge(doc, key);
    const model = this.model();
    const resolved = model?.edges[edgeIndex(doc, key)];
    const edit = (fn) => this.commit((d) => fn(findEdge(d, key)));
    const nodes = doc.nodes.map((x) => ({ value: x.id, label: displayName(x) }));
    const endSelect = (end) =>
      select(nodes, e[end], (v) => this.attempt(() => this.command((d) => reconnectEdge(d, key, end, v))), {
        fidKey: 'e-' + end,
        ariaLabel: end === 'from' ? 'From step' : 'To step',
      });
    const sideSelect = (prop, name) =>
      select(
        [
          { value: '', label: `Auto${resolved?.[prop] ? ' (' + resolved[prop] + ')' : ''}` },
          ...SIDES.map((s) => ({ value: s, label: cap(s) })),
        ],
        e[prop] ?? '',
        (v) => this.attempt(() => edit((x) => setOrDelete(x, prop, v || undefined))),
        { fidKey: 'e-' + prop, ariaLabel: name },
      );
    const kind = resolved?.kind ?? e.kind ?? 'flow';
    const arrowDefault = kind !== 'association'; // runtime: associations have no arrow unless set
    return {
      icon: h('span', { class: 'node-ico lg net' }, icon('edge', 14)),
      title: e.label ? singleLine(e.label) : edgeTitle(doc, e),
      subtitle: `${cap(kind)} edge · ${key}`,
      properties: () => [
        section(
          'Edge',
          h(
            'div',
            { class: 'stack' },
            field(
              'Label',
              textInput({
                value: e.label ?? '',
                placeholder: 'None',
                multiline: true,
                fidKey: 'e-label',
                ariaLabel: 'Edge label',
                commit: (v) => edit((x) => setOrDelete(x, 'label', labelText(v))),
              }),
              { hint: 'For a decision, the answer this path stands for (Yes, No…).' },
            ),
            h('div', { class: 'grid2' }, field('From', endSelect('from')), field('To', endSelect('to'))),
          ),
        ),
        section(
          'Kind',
          h(
            'div',
            { class: 'stack' },
            segmented(
              [
                {
                  value: '',
                  label: 'Auto',
                  title: 'The layout marks edges back to an earlier step as loops',
                },
                ...EDGE_KINDS.map((k) => ({ value: k.value, label: k.label, title: k.hint })),
              ],
              e.kind ?? '',
              (v) => this.attempt(() => edit((x) => setOrDelete(x, 'kind', v || undefined))),
              { fidKey: 'e-kind', ariaLabel: 'Edge kind' },
            ),
            h(
              'p',
              { class: 'insp-hint' },
              e.kind
                ? EDGE_KINDS.find((k) => k.value === e.kind)?.hint
                : `In use: ${kind}. ${EDGE_KINDS.find((k) => k.value === kind)?.hint ?? ''}`,
            ),
            toggle(
              `Arrow at the end${e.arrow === undefined ? ' (default)' : ''}`,
              e.arrow ?? arrowDefault,
              (v) => this.attempt(() => edit((x) => (v === arrowDefault ? delete x.arrow : (x.arrow = v)))),
              { fidKey: 'e-arrow' },
            ),
          ),
        ),
        section(
          'Sides',
          h(
            'div',
            { class: 'grid2' },
            field('Leaves from', sideSelect('fromSide', 'Leaves from side')),
            field('Enters at', sideSelect('toSide', 'Enters at side')),
          ),
          {
            hint: 'Auto lets the layout choose. Set a side when labels collide or a branch should leave sideways.',
          },
        ),
      ],
      style: () =>
        this.styleBlock(
          'edge',
          (d) => [findEdge(d, key), 'style'],
          resolved?.style,
          'es',
          resolvedDefaults(doc.diagram.style).edge,
        ),
    };
  }

  groupView(doc, id) {
    const g = findGroup(doc, id);
    const model = this.model();
    const resolved = model?.groups?.find((x) => x.id === id);
    const edit = (fn) => this.commit((d) => fn(findGroup(d, id)));
    return {
      icon: h('span', { class: 'node-ico lg grp' }),
      title: displayName(g),
      subtitle: `Group · ${g.members.length} member${g.members.length === 1 ? '' : 's'}`,
      properties: () => [
        section(
          'Identity',
          h(
            'div',
            { class: 'stack' },
            this.labelField(g, 'g-label', (v) => edit((x) => setOrDelete(x, 'label', v))),
            this.idField(g, 'g-id', renameGroup),
            this.insideField(doc, id, 'g-inside', 'Everything inside moves with it.'),
          ),
        ),
        section(
          'Members',
          h(
            'div',
            { class: 'stack' },
            h(
              'div',
              { class: 'link-list' },
              g.members.map((m) => {
                const item = findNode(doc, m) ?? findGroup(doc, m);
                const isGroup = Boolean(findGroup(doc, m));
                return h(
                  'button',
                  {
                    type: 'button',
                    class: 'link-row',
                    onclick: () =>
                      this.cb.select({ type: isGroup ? 'group' : 'node', id: m }, { reveal: true }),
                  },
                  icon(isGroup ? 'group' : typeInfo(item?.type).icon, 12),
                  h('span', displayName(item)),
                );
              }),
            ),
            h(
              'div',
              { class: 'row-actions' },
              button('Add step inside', () => this.cb.run('add-node-in', id), {
                icon: 'plus',
                variant: 'ghost',
              }),
              button('Ungroup', () => this.attempt(() => this.command((d) => ungroup(d, id))), {
                icon: 'ungroup',
                variant: 'ghost',
                title: 'Members move to the parent group',
              }),
            ),
          ),
          {
            hint: 'Drag a step (or a group by its title) onto the group, or use Inside. A group that loses its last member is removed.',
          },
        ),
      ],
      style: () =>
        this.styleBlock(
          'group',
          (d) => [findGroup(d, id), 'style'],
          resolved?.style,
          'gs',
          resolvedDefaults(doc.diagram.style).group,
        ),
    };
  }
}

export { placeNode };
