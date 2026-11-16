import { h, replaceKeepingFocus, singleLine } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { FlowchartOutline } from '../../flowchart/components/outline.js';
import { kindInfo, stateName, transitionKey, transitionTitle, problems, selectionForPath, findState, findTransition } from '../state/actions.js';

/** Statechart outline: states, transitions (parallel ones listed separately), problems. */
export class StatechartOutline extends FlowchartOutline {
  constructor(store, callbacks) {
    super(store, callbacks);
    this.sectionsPref = 'stateOutlineSections';
    this.sections = { states: true, transitions: true, problems: true, ...(store.prefs.stateOutlineSections ?? {}) };
    this.search.placeholder = 'Filter states, transitions…';
    this.body.setAttribute('aria-label', 'Statechart outline');
  }

  render() {
    const doc = this.store.document;
    const out = [];
    const states = doc.states.filter((s) => this.match(s.id, s.label, s.description));
    out.push(
      this.section(
        'states',
        'States',
        doc.states.length,
        h(
          'div',
          { class: 'rows' },
          states.length
            ? states.map((s) => {
                const k = kindInfo(s.kind);
                return this.row({
                  sel: { type: 'node', id: s.id },
                  label: stateName(s),
                  key: s.kind && s.kind !== 'state' ? '' : s.description ? singleLine(s.description) : s.id,
                  title: s.id,
                  ico: h('span', { class: ['node-ico', 'flow', 'flow-' + (k.value === 'state' ? 'process' : k.value === 'initial' ? 'start' : 'end')], title: k.label }, icon(k.icon, 12)),
                });
              })
            : h('div', { class: 'empty-row' }, 'No matches'),
        ),
      ),
    );
    const rows = [];
    for (const [i, t] of doc.transitions.entries()) {
      const title = transitionTitle(doc, t);
      if (!this.match(t.id, t.label, title, t.from, t.to)) continue;
      rows.push(
        this.row({
          sel: { type: 'edge', key: transitionKey(t, i) },
          label: t.label ? singleLine(t.label) : title,
          key: t.label ? title : '',
          title: `${t.from} → ${t.to}`,
          ico: h('span', { class: ['node-ico', 'net', t.kind === 'loop' && 'fb'] }, icon('edge', 12)),
        }),
      );
    }
    out.push(this.section('transitions', 'Transitions', doc.transitions.length, h('div', { class: 'rows' }, rows.length ? rows : h('div', { class: 'empty-row' }, this.filter ? 'No matches' : 'Drag from a state’s handle to add a transition'))));
    const probs = problems(this.store).filter((p) => this.match(p.message));
    out.push(
      this.section(
        'problems',
        'Problems',
        probs.length,
        h(
          'div',
          { class: 'rows' },
          probs.length
            ? probs.map((p) => {
                const select = selectionForPath(doc, p.path) ?? (p.edge ? { type: 'edge', key: p.edge } : null);
                return h(
                  'div',
                  { class: ['row', 'problem', p.kind], role: 'treeitem', tabindex: '-1', onclick: () => select && this.cb.select(select, { reveal: true }) },
                  h('span', { class: 'chev-space' }),
                  icon(p.kind === 'error' ? 'error' : 'warn', 14),
                  this.problemText(doc, p, select),
                );
              })
            : h('div', { class: 'empty-row' }, 'No problems'),
        ),
      ),
    );
    replaceKeepingFocus(this.body, out);
  }

  revealSelection() {
    const sel = this.store.selection;
    if (!sel) return;
    const key = sel.type === 'edge' ? 'transitions' : 'states';
    if (!this.sections[key]) {
      this.sections[key] = true;
      this.render();
    }
    this.body.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
  }

  edgeOf(doc, key) {
    return findTransition(doc, key);
  }

  edgeName(doc, t) {
    return transitionTitle(doc, t);
  }

  nodeName(doc, id) {
    return stateName(findState(doc, id) ?? { id });
  }
}
