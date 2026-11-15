import { History } from '../../editor/state/history.js';
import { validateDocument, emptyDocument } from '../../editor/state/commands.js';
import { storage, store as save } from '../ui/dom.js';
import { reconcileGrids } from '../../lib/blockchart/grid.js';
import { syncGridMembership } from './grid-sync.js';

export const STORAGE_KEY = 'blockflow.editor.v1'; // shared with the previous editor: same JSON document
const PREFS_KEY = 'blockflow.studio.prefs';
/** A stored draft the runtime rejects is moved here so autosave never overwrites it. */
export const REJECTED_KEY = 'blockflow.editor.v1.rejected';

/**
 * Selection shapes:
 *  { type: 'block', id } | { type: 'group', id } | { type: 'terminal', id }
 *  { type: 'port', owner, port } | { type: 'net', index, branch? }
 * multi: extra port selections (for Concat) as [{owner, port}]
 */
export class Store {
  /** The draft kept aside by an earlier rejection, or null. Reported once; offered in File. */
  static keptDraft() {
    const kept = storage(REJECTED_KEY, null);
    return kept?.document ? { document: kept.document, message: kept.error, path: kept.path } : null;
  }

  static clearKeptDraft() {
    try {
      localStorage.removeItem(REJECTED_KEY);
    } catch {
      /* storage unavailable: nothing to clear */
    }
  }

  constructor(initial) {
    let document = initial;
    let restored = false;
    const saved = storage(STORAGE_KEY, null);
    if (saved?.document && Array.isArray(saved.document.modules)) {
      try {
        validateDocument(structuredClone(saved.document));
        document = saved.document;
        restored = true;
      } catch (error) {
        // Invalid stored drafts never block startup, and are never migrated silently:
        // keep the original so the user can save it, fix the reported field and reopen it.
        if (save(REJECTED_KEY, { document: saved.document, error: error.message, path: error.path ?? null }))
          try {
            localStorage.removeItem(STORAGE_KEY); // the kept copy replaces it; do not reject it on every start
          } catch {
            /* storage unavailable */
          }
        this.rejected = { document: saved.document, message: error.message, path: error.path ?? null };
      }
    }
    this.restored = restored;
    this.history = new History(document ?? emptyDocument());
    this.selection = null;
    this.multi = [];
    this.root = '';
    this.layout = null; // { layout, svg, revision }
    this.layoutError = null;
    this.layoutPending = false;
    this.saveState = 'saved';
    this.prefs = { theme: 'system', pngScale: 2, outlineOpen: {}, ...storage(PREFS_KEY, {}) };
    this.listeners = new Set();
    this.clipboardStyle = null;
  }

  get document() {
    return this.history.present;
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(reason) {
    for (const listener of this.listeners) listener(reason);
  }

  setPref(key, value) {
    this.prefs[key] = value;
    save(PREFS_KEY, this.prefs);
  }

  /**
   * Apply a change to a clone of the document. Validation runs on the result;
   * on error nothing changes and the error is rethrown for inline display.
   */
  commit(change, { validate = true, replace = false } = {}) {
    const next = structuredClone(this.document);
    const result = change(next);
    // A whole-document replacement (open file, load example) is taken exactly as written.
    if (!replace) syncGridMembership(this.document, next);
    reconcileGrids(next);
    if (validate) validateDocument(structuredClone(next));
    if (this.history.commit(next)) {
      this.fixSelection();
      this.persist();
      this.emit('document');
    }
    return result;
  }

  replace(document) {
    validateDocument(structuredClone(document));
    this.history = new History(document);
    this.selection = null;
    this.multi = [];
    this.root = '';
    this.layout = null;
    this.persist();
    this.emit('replace');
  }

  undo() {
    if (this.history.undo()) {
      this.fixSelection();
      this.persist();
      this.emit('document');
      return true;
    }
    return false;
  }

  redo() {
    if (this.history.redo()) {
      this.fixSelection();
      this.persist();
      this.emit('document');
      return true;
    }
    return false;
  }

  persist() {
    const ok = save(STORAGE_KEY, { document: this.document });
    this.saveState = ok ? 'saved' : 'error';
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
    } else {
      this.selection = selection;
      this.multi = [];
    }
    this.emit('selection');
  }

  setRoot(root) {
    this.root = root || '';
    this.emit('root');
  }

  /** Drop selections that no longer exist after undo/edits. */
  fixSelection() {
    const doc = this.document,
      sel = this.selection;
    if (!sel) return;
    const module = (id) => doc.modules.find((m) => m.id === id);
    const group = (id) => doc.groups?.find((g) => g.id === id);
    let ok = true;
    if (sel.type === 'block') ok = Boolean(module(sel.id));
    else if (sel.type === 'group') ok = Boolean(group(sel.id));
    else if (sel.type === 'terminal') ok = Boolean(doc.terminals?.some((t) => t.id === sel.id));
    else if (sel.type === 'port')
      ok = Boolean((module(sel.owner) ?? group(sel.owner))?.ports?.some((p) => p.id === sel.port));
    else if (sel.type === 'net') ok = Boolean(doc.connections?.[sel.index]);
    if (!ok) {
      this.selection = null;
      this.multi = [];
    }
    if (this.root && !group(this.root)) this.root = '';
  }
}
