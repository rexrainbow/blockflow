import { Store } from '../../core/store.js';
import { validateDocument, emptyDocument } from '../../../editor/statechart/commands.js';
import { findState, transitionIndex, withoutRetiredLayout } from './actions.js';

export const STATECHART_STORE = {
  storageKey: 'blockflow.statechart.v1',
  rejectedKey: 'blockflow.statechart.v1.rejected',
  owns: (doc) => Array.isArray(doc.states),
  validate: validateDocument,
  empty: emptyDocument,
  migrate: withoutRetiredLayout,
  exists(doc, sel) {
    if (sel.type === 'node') return Boolean(findState(doc, sel.id));
    if (sel.type === 'edge') return transitionIndex(doc, sel.key) >= 0;
    return true;
  },
};

export class StatechartStore extends Store {
  constructor(initial) {
    super(initial, STATECHART_STORE);
  }
}
