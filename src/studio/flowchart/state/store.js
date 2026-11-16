import { Store } from '../../core/store.js';
import { validateDocument, emptyDocument } from '../../../editor/flowchart/commands.js';
import { findNode, findGroup, edgeIndex } from './actions.js';

export const FLOWCHART_STORE = {
  storageKey: 'blockflow.flowchart.v1',
  rejectedKey: 'blockflow.flowchart.v1.rejected',
  owns: (doc) => Array.isArray(doc.nodes),
  validate: validateDocument,
  empty: emptyDocument,
  exists(doc, sel) {
    if (sel.type === 'node') return Boolean(findNode(doc, sel.id));
    if (sel.type === 'group') return Boolean(findGroup(doc, sel.id));
    if (sel.type === 'edge') return edgeIndex(doc, sel.key) >= 0;
    return true;
  },
};

export class FlowchartStore extends Store {
  constructor(initial) {
    super(initial, FLOWCHART_STORE);
  }
}
