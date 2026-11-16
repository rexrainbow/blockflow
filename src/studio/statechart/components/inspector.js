import { h, fill, singleLine, replaceKeepingFocus } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { button, field, textInput, select, segmented } from '../../ui/controls.js';
import { FlowchartInspector } from '../../flowchart/components/inspector.js';
import { SIDES } from '../../flowchart/state/actions.js';
import { renameState, reconnectTransition } from '../../../editor/statechart/commands.js';
import { STATECHART_LAYOUT_DEFAULTS } from '../../../lib/statechart/model.js';
import {
  STATE_KINDS,
  TRANSITION_KINDS,
  kindInfo,
  findState,
  findTransition,
  transitionIndex,
  transitionKey,
  stateName,
  transitionTitle,
  resolvedModel,
} from '../state/actions.js';

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const text = (value) => (value.trim() ? value.replace(/\r\n?/g, '\n').replace(/\s+$/, '') : undefined);
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
/** The runtime's resolved styles for a plain state and transition, with or without diagram defaults. */
function probeDefaults(diagramStyle) {
  const probe = {
    version: 1,
    diagram: { name: 'probe', ...(diagramStyle ? { style: diagramStyle } : {}) },
    states: [{ id: 'a' }, { id: 'b' }],
    transitions: [{ from: 'a', to: 'b' }],
  };
  const m = resolvedModel(probe) ?? resolvedModel({ ...probe, diagram: { name: 'probe' } });
  return { state: m?.nodes[0].style, transition: m?.edges[0].style };
}

function section(title, content, extra = {}) {
  return h(
    'section',
    { class: ['insp-section', extra.class] },
    h('header', { class: 'insp-section-head' }, h('h3', title), h('div', { class: 'spacer' })),
    extra.hint ? h('p', { class: 'insp-hint' }, extra.hint) : null,
    content,
  );
}

/** Statechart inspector: diagram, layout and defaults; states and transitions. */
export class StatechartInspector extends FlowchartInspector {
  constructor(store, callbacks) {
    super(store, callbacks);
    this.defaultsCategory = 'state';
    this.nodeSpacingName = 'State spacing';
    this.noNotes = true;
    this.noLoopSide = true; // Statechart routes returns itself; only per-transition sides remain
  }

  /** Statechart-only layout: the display width transition labels wrap at. */
  extraLayoutSections(number) {
    return [
      section(
        'Labels',
        number('labelMaxWidth', 'Label width', 'sl-lw', STATECHART_LAYOUT_DEFAULTS.labelMaxWidth),
        {
          hint: 'Transition labels wrap at this width on the drawing only; the condition you type, and the saved file, keep their own lines. Blank uses the default shown in grey.',
        },
      ),
    ];
  }

  /** The lowered graph model: resolved styles (by state / transition id) and layout defaults. */
  model() {
    return resolvedModel(this.store.document);
  }

  render() {
    const sel = this.store.selection;
    const doc = this.store.document;
    let view;
    if (sel?.type === 'node' && findState(doc, sel.id)) view = this.stateView(doc, sel.id);
    else if (sel?.type === 'edge' && findTransition(doc, sel.key)) view = this.transitionView(doc, sel.key);
    else view = this.chartView(doc);
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
      ...tabs.map(([key, label]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: ['tab', key === this.tab && 'on'],
            'aria-selected': String(key === this.tab),
            onclick: () => this.setTab(key),
          },
          label,
        ),
      ),
    );
    replaceKeepingFocus(this.body, (view[this.tab] ?? view.properties)());
  }

  chartView(doc) {
    const base = this.documentView(doc);
    return {
      ...base,
      icon: h('span', { class: 'node-ico lg doc' }, icon('statechart', 14)),
      title: doc.diagram?.name || 'Statechart',
      subtitle: `${doc.states.length} states · ${doc.transitions.length} transitions`,
      properties: () => [
        base.properties()[0],
        section(
          'Get started',
          h(
            'ul',
            { class: 'tips' },
            h(
              'li',
              'Hover a state and drag one of its handles onto another state to add a transition, back onto the same state for a self transition, or onto empty space to add the next state.',
            ),
            h('li', 'Select a transition and drag either end to reconnect it.'),
            h(
              'li',
              'Conditions, outputs and actions are plain text: the chart is a drawing, not an executable machine.',
            ),
          ),
        ),
      ],
    };
  }

  defaultsTab(doc) {
    const cat = this.defaultsCategory;
    return [
      section(
        'Diagram defaults',
        segmented(
          [
            { value: 'state', label: 'States' },
            { value: 'transition', label: 'Transitions' },
          ],
          cat,
          (v) => ((this.defaultsCategory = v), this.render()),
          { fidKey: 'fd-cat', ariaLabel: 'Defaults for' },
        ),
        { hint: 'Every state or transition uses these values unless it sets its own.' },
      ),
      ...this.styleBlock(
        cat === 'state' ? 'state' : 'edge',
        (d, create) => {
          if (create) {
            d.diagram.style ??= {};
            return [d.diagram.style, cat];
          }
          return [d.diagram.style ?? {}, cat];
        },
        probeDefaults(doc.diagram.style)[cat],
        'fd-' + cat,
        probeDefaults()[cat],
      ),
    ];
  }

  stateView(doc, id) {
    const st = findState(doc, id);
    const kind = st.kind ?? 'state';
    const info = kindInfo(kind);
    const resolved = this.model()?.nodes.find((n) => n.id === id);
    const edit = (fn) => this.commit((d) => fn(findState(d, id)));
    const pseudo = kind !== 'state';
    const setKind = (v) =>
      this.attempt(() => {
        const dropped =
          v !== 'state' && ['label', 'description', 'width', 'height'].filter((k) => st[k] !== undefined);
        edit((s) => {
          if (v === 'state') delete s.kind;
          else {
            s.kind = v;
            for (const k of ['label', 'description', 'width', 'height']) delete s[k];
          }
        });
        if (dropped?.length)
          this.cb.notify(
            `${cap(v)} states have no text or size; removed its ${dropped.join(', ')}. Undo brings them back.`,
            'info',
          );
      });
    const transitions = doc.transitions
      .map((t, i) => ({ t, key: transitionKey(t, i) }))
      .filter(({ t }) => t.from === id || t.to === id)
      .map(({ t, key }) =>
        h(
          'button',
          {
            type: 'button',
            class: 'link-row',
            onclick: () => this.cb.select({ type: 'edge', key }, { reveal: true }),
          },
          h('span', { class: 'edge-dir' }, t.from === t.to ? '↻' : t.from === id ? '→' : '←'),
          h('span', t.from === t.to ? 'itself' : stateName(findState(doc, t.from === id ? t.to : t.from))),
          t.label ? h('span', { class: 'muted' }, singleLine(t.label)) : null,
        ),
      );
    return {
      icon: h(
        'span',
        {
          class: [
            'node-ico',
            'lg',
            'flow',
            'flow-' + (kind === 'state' ? 'process' : kind === 'initial' ? 'start' : 'end'),
          ],
        },
        icon(info.icon, 14),
      ),
      title: stateName(st),
      subtitle: `${info.label} · ${id}`,
      properties: () => [
        section(
          'Identity',
          h(
            'div',
            { class: 'stack' },
            pseudo
              ? null
              : field(
                  'Name',
                  textInput({
                    value: st.label ?? '',
                    placeholder: id,
                    multiline: true,
                    fidKey: 's-label',
                    ariaLabel: 'State name',
                    commit: (v) => edit((s) => setOrDelete(s, 'label', text(v))),
                  }),
                  { hint: 'Blank shows the ID.' },
                ),
            pseudo
              ? null
              : field(
                  'Description',
                  textInput({
                    value: st.description ?? '',
                    placeholder: 'None',
                    multiline: true,
                    fidKey: 's-desc',
                    ariaLabel: 'Description',
                    commit: (v) => edit((s) => setOrDelete(s, 'description', text(v))),
                  }),
                  {
                    hint: 'Outputs or actions, shown below a line. Plain text; Ctrl+Enter saves.',
                  },
                ),
            field(
              'ID',
              textInput({
                value: id,
                mono: true,
                fidKey: 's-id',
                ariaLabel: 'State ID',
                commit: (v) => this.command((d) => renameState(d, id, v.trim())),
              }),
              { hint: 'Transitions that refer to it are updated.' },
            ),
            field(
              'Kind',
              segmented(
                STATE_KINDS.map((k) => ({ value: k.value, label: k.label, icon: k.icon, title: k.hint })),
                kind,
                setKind,
                { fidKey: 's-kind', ariaLabel: 'State kind' },
              ),
              { hint: info.hint },
            ),
          ),
        ),
        section(
          'Transitions',
          h(
            'div',
            { class: 'stack' },
            transitions.length
              ? h('div', { class: 'link-list' }, transitions)
              : h('p', { class: 'insp-hint' }, 'No transitions yet.'),
            h(
              'div',
              { class: 'row-actions' },
              button('Add next state', () => this.cb.run('add-next', id), {
                icon: 'nextStep',
                variant: 'ghost',
                disabled: kind === 'final',
                title: 'Add a state reached from this one (N)',
              }),
              button('Add self transition', () => this.cb.run('add-self', id), {
                icon: 'redo',
                variant: 'ghost',
                disabled: pseudo,
              }),
            ),
          ),
        ),
        pseudo
          ? null
          : section(
              'Size',
              h(
                'div',
                { class: 'grid2' },
                field(
                  'Min width',
                  textInput({
                    value: st.width ?? '',
                    placeholder: 'Auto',
                    type: 'number',
                    min: 1,
                    fidKey: 's-w',
                    ariaLabel: 'Minimum width',
                    commit: (v) => edit((s) => setOrDelete(s, 'width', positive(v, 'Width'))),
                  }),
                ),
                field(
                  'Min height',
                  textInput({
                    value: st.height ?? '',
                    placeholder: 'Auto',
                    type: 'number',
                    min: 1,
                    fidKey: 's-h',
                    ariaLabel: 'Minimum height',
                    commit: (v) => edit((s) => setOrDelete(s, 'height', positive(v, 'Height'))),
                  }),
                ),
              ),
            ),
      ],
      style: () => {
        const layoutStyle = this.store.layout?.layout?.states?.find((x) => x.id === id)?.style;
        const effective = resolved?.style && {
          ...resolved.style,
          ...(layoutStyle?.descriptionAlign ? { descriptionAlign: layoutStyle.descriptionAlign } : {}),
        };
        return this.styleBlock(
          pseudo ? 'node' : 'state',
          (d) => [findState(d, id), 'style'],
          effective,
          'ss',
          probeDefaults(doc.diagram.style).state,
        );
      },
    };
  }

  transitionView(doc, key) {
    const t = findTransition(doc, key);
    const layoutT = this.store.layout?.layout?.transitions?.find((x) => x.editorKey === key);
    const resolved = this.model()?.edges[transitionIndex(doc, key)];
    const edit = (fn) => this.commit((d) => fn(findTransition(d, key)));
    const states = doc.states.map((s) => ({ value: s.id, label: stateName(s) }));
    const endSelect = (end) =>
      select(
        states,
        t[end],
        (v) => this.attempt(() => this.command((d) => reconnectTransition(d, key, end, v))),
        { fidKey: 't-' + end, ariaLabel: end === 'from' ? 'From state' : 'To state' },
      );
    const sideSelect = (prop, name) =>
      select(
        [
          { value: '', label: `Auto${layoutT?.[prop] ? ' (' + layoutT[prop] + ')' : ''}` },
          ...SIDES.map((s) => ({ value: s, label: cap(s) })),
        ],
        t[prop] ?? '',
        (v) => this.attempt(() => edit((x) => setOrDelete(x, prop, v || undefined))),
        { fidKey: 't-' + prop, ariaLabel: name },
      );
    const inUse = layoutT?.kind ?? t.kind ?? 'flow';
    const parallel = doc.transitions.filter((x) => x.from === t.from && x.to === t.to).length;
    return {
      icon: h('span', { class: 'node-ico lg net' }, icon('edge', 14)),
      title: t.label ? singleLine(t.label) : transitionTitle(doc, t),
      subtitle: `Transition · ${key}`,
      properties: () => [
        section(
          'Transition',
          h(
            'div',
            { class: 'stack' },
            field(
              'Condition',
              textInput({
                value: t.label ?? '',
                placeholder: 'None',
                multiline: true,
                fidKey: 't-label',
                ariaLabel: 'Condition',
                commit: (v) => edit((x) => setOrDelete(x, 'label', text(v))),
              }),
              {
                hint: 'Plain text, e.g. "button / start timer". Ctrl+Enter saves; long conditions can use several lines.',
              },
            ),
            h('div', { class: 'grid2' }, field('From', endSelect('from')), field('To', endSelect('to'))),
            parallel > 1
              ? h(
                  'p',
                  { class: 'insp-hint' },
                  `One of ${parallel} transitions between these states; each keeps its own identity and label.`,
                )
              : null,
          ),
        ),
        section(
          'Routing',
          h(
            'div',
            { class: 'stack' },
            segmented(
              [
                {
                  value: '',
                  label: 'Auto',
                  title: 'The layout routes transitions back to an earlier state as loops',
                },
                ...TRANSITION_KINDS.map((k) => ({ value: k.value, label: k.label, title: k.hint })),
              ],
              t.kind ?? '',
              (v) => this.attempt(() => edit((x) => setOrDelete(x, 'kind', v || undefined))),
              { fidKey: 't-kind', ariaLabel: 'Transition routing' },
            ),
            h(
              'p',
              { class: 'insp-hint' },
              t.kind
                ? TRANSITION_KINDS.find((k) => k.value === t.kind)?.hint
                : `In use: ${inUse === 'loop' ? 'loop' : 'forward'}. Set Forward on the transition that defines the main order.`,
            ),
            h(
              'div',
              { class: 'grid2' },
              field('Leaves from', sideSelect('fromSide', 'Leaves from side')),
              field('Enters at', sideSelect('toSide', 'Enters at side')),
            ),
          ),
        ),
      ],
      style: () =>
        this.styleBlock(
          'edge',
          (d) => [findTransition(d, key), 'style'],
          resolved?.style,
          'ts',
          probeDefaults(doc.diagram.style).transition,
        ),
    };
  }
}
