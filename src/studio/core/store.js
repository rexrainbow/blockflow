import { History } from '../../editor/shared/history.js';
import { storage, store as save } from '../ui/dom.js';

/** Preferences are shared by every diagram kind (theme, panes, PNG scale, last kind). */
export const PREFS_KEY = 'blockflow.studio.prefs';

/**
 * Diagram-independent editor state: history, selection, layout status, browser draft and
 * preferences. A domain supplies its keys and rules:
 *   storageKey, rejectedKey      browser draft and the copy kept when the runtime rejects it
 *   owns(document)               whether a stored draft belongs to this domain
 *   validate(document)           runtime validation (throws with .path)
 *   empty()                      starter document
 *   prepare(previous, next, { replace })  domain bookkeeping before validation (optional)
 *   migrate(document)            { document, note } for a retired field the runtime now rejects,
 *                                or null (optional; only explicit, announced removals)
 *   exists(document, selection)  whether a selection still exists (optional)
 */
export class Store {
  constructor(initial, domain) {
    this.domain = domain;
    let document = initial;
    let restored = false;
    const saved = storage(domain.storageKey, null);
    const migrated = saved?.document && domain.owns(saved.document) ? domain.migrate?.(saved.document) : null;
    if (migrated) saved.document = migrated.document;
    this.migrated = migrated?.note ?? null;
    if (saved?.document && domain.owns(saved.document)) {
      try {
        domain.validate(structuredClone(saved.document));
        document = saved.document;
        restored = true;
      } catch (error) {
        // Invalid stored drafts never block startup, and are never migrated silently:
        // keep the original so the user can save it, fix the reported field and reopen it.
        if (
          save(domain.rejectedKey, {
            document: saved.document,
            error: error.message,
            path: error.path ?? null,
          })
        )
          try {
            localStorage.removeItem(domain.storageKey); // the kept copy replaces it; do not reject it on every start
          } catch {
            /* storage unavailable */
          }
        this.rejected = { document: saved.document, message: error.message, path: error.path ?? null };
      }
    }
    this.restored = restored;
    if (!restored) this.migrated = null;
    this.history = new History(document ?? domain.empty());
    this.selection = null;
    this.multi = [];
    this.root = '';
    this.layout = null; // { layout, svg }
    this.layoutError = null;
    this.layoutPending = false;
    this.saveState = 'saved';
    this.prefs = { theme: 'system', pngScale: 2, outlineOpen: {}, ...storage(PREFS_KEY, {}) };
    this.listeners = new Set();
    this.clipboardStyle = null;
    if (restored && this.migrated) this.persist(); // announce the removal once, not on every start
  }

  /** The draft kept aside by an earlier rejection, or null. Reported once; offered in File. */
  keptDraft() {
    const kept = storage(this.domain.rejectedKey, null);
    return kept?.document ? { document: kept.document, message: kept.error, path: kept.path } : null;
  }

  clearKeptDraft() {
    try {
      localStorage.removeItem(this.domain.rejectedKey);
    } catch {
      /* storage unavailable: nothing to clear */
    }
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
    this.domain.prepare?.(this.document, next, { replace });
    if (validate) this.domain.validate(structuredClone(next));
    if (this.history.commit(next)) {
      this.fixSelection();
      this.persist();
      this.emit('document');
    }
    return result;
  }

  replace(document) {
    this.domain.validate(structuredClone(document));
    this.history = new this.history.constructor(document);
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
    const ok = save(this.domain.storageKey, { document: this.document });
    this.saveState = ok ? 'saved' : 'error';
  }

  select(selection) {
    this.selection = selection;
    this.multi = [];
    this.emit('selection');
  }

  setRoot(root) {
    this.root = root || '';
    this.emit('root');
  }

  /** Drop selections that no longer exist after undo/edits. */
  fixSelection() {
    if (this.selection && this.domain.exists && !this.domain.exists(this.document, this.selection)) {
      this.selection = null;
      this.multi = [];
    }
  }
}
