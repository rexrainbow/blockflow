import { Store as BaseStore } from '../../core/store.js';
import { validateDocument, emptyDocument } from '../../../editor/blockchart/commands.js';
import { reconcileGrids } from '../../../lib/blockchart/grid.js';
import { syncGridMembership } from './grid-sync.js';

export const STORAGE_KEY = 'blockflow.editor.v1'; // shared with the previous editor: same JSON document
/** A stored draft the runtime rejects is moved here so autosave never overwrites it. */
export const REJECTED_KEY = 'blockflow.editor.v1.rejected';

const module = (doc, id) => doc.modules.find((m) => m.id === id);
const group = (doc, id) => doc.groups?.find((g) => g.id === id);

export const BLOCKCHART_STORE = {
  storageKey: STORAGE_KEY,
  rejectedKey: REJECTED_KEY,
  owns: (doc) => Array.isArray(doc.modules),
  validate: validateDocument,
  empty: emptyDocument,
  prepare(previous, next, { replace }) {
    // A whole-document replacement (open file, load example) is taken exactly as written.
    if (!replace) syncGridMembership(previous, next);
    reconcileGrids(next);
  },
  exists(doc, sel) {
    if (sel.type === 'block') return Boolean(module(doc, sel.id));
    if (sel.type === 'group') return Boolean(group(doc, sel.id));
    if (sel.type === 'terminal') return Boolean(doc.terminals?.some((t) => t.id === sel.id));
    if (sel.type === 'port') return Boolean((module(doc, sel.owner) ?? group(doc, sel.owner))?.ports?.some((p) => p.id === sel.port));
    if (sel.type === 'net') return Boolean(doc.connections?.[sel.index]);
    return true;
  },
};

/**
 * Selection shapes:
 *  { type: 'block', id } | { type: 'group', id } | { type: 'terminal', id }
 *  { type: 'port', owner, port } | { type: 'net', index, branch? }
 * multi: extra port selections (for Concat) as [{owner, port}]
 */
export class Store extends BaseStore {
  constructor(initial) {
    super(initial, BLOCKCHART_STORE);
  }

  select(selection, { additive = false } = {}) {
    if (additive && selection?.type === 'port') {
      const key = (item) => item.owner + '.' + item.port;
      const all = [...(this.selection?.type === 'port' ? [this.selection] : []), ...this.multi];
      const exists = all.findIndex((item) => key(item) === key(selection));
      if (exists >= 0) all.splice(exists, 1);
      else all.push({ owner: selection.owner, port: selection.port });
      this.selection = all.length ? { type: 'port', ...all[0] } : null;
      this.multi = all.slice(1);
      this.emit('selection');
    } else super.select(selection);
  }

  fixSelection() {
    super.fixSelection();
    if (this.root && !group(this.document, this.root)) this.root = '';
  }
}
