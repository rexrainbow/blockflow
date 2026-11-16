import { storage } from './ui/dom.js';
import { PREFS_KEY } from './core/store.js';
import { DIAGRAM_KINDS } from './core/kinds.js';
import { BlockchartStudio } from './blockchart/studio.js';
import { FlowchartStudio } from './flowchart/studio.js';
import { StatechartStudio } from './statechart/studio.js';

/** Editor session class per diagram kind (metadata lives in core/kinds.js). */
const SESSIONS = { blockchart: BlockchartStudio, flowchart: FlowchartStudio, statechart: StatechartStudio };

/**
 * The Studio host runs one editor session at a time in `root`. Opening a file, loading an
 * example or starting a new diagram of another kind disposes the current session (its
 * layout Worker and listeners) and starts the other kind's session. Each kind keeps its
 * own browser draft, so switching back restores where you were.
 *
 * The returned object forwards to the current session (tests and debugging use it as
 * `window.__studio`), plus `switchTo(kind)` and `session`.
 */
export function startStudio(root) {
  const host = new StudioHost(root);
  return new Proxy(host, {
    get(target, key) {
      const owner = key in target ? target : target.session;
      const value = owner[key];
      return typeof value === 'function' ? value.bind(owner) : value;
    },
    set(target, key, value) {
      (key in target ? target : target.session)[key] = value;
      return true;
    },
  });
}

class StudioHost {
  constructor(root) {
    this.root = root;
    const last = storage(PREFS_KEY, {}).kind;
    this.start(SESSIONS[last] ? last : 'blockchart');
  }

  start(kind, switching = false) {
    this.switching = switching;
    try {
      this.session = new SESSIONS[kind](this.root, this);
    } finally {
      this.switching = false;
    }
    this.session.store.setPref('kind', kind);
  }

  /**
   * Ends the current session and starts `kind`. With a document, it replaces that kind's
   * restored draft as one undoable change; the toast offers a way back to the previous kind.
   */
  switchTo(kind, { document, message, from } = {}) {
    if (!SESSIONS[kind]) throw new Error(`Unknown diagram kind: ${kind}`);
    const previous = this.session;
    const back = from ?? previous?.kind;
    previous?.dispose();
    this.start(kind, true);
    if (document) {
      const action = back && back !== kind ? { label: `Back to ${DIAGRAM_KINDS[back].noun}`, run: () => this.switchTo(back) } : undefined;
      this.session.replaceKeepingUndo(document, message, action);
    } else this.session.notify(message ?? `Back to your ${DIAGRAM_KINDS[kind].noun}.`);
  }
}
