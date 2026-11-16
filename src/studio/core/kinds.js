import { EXAMPLES as BLOCKCHART_EXAMPLES } from '../blockchart/examples.js';
import { EXAMPLES as FLOWCHART_EXAMPLES } from '../flowchart/examples.js';
import { EXAMPLES as STATECHART_EXAMPLES } from '../statechart/examples.js';
import { withoutRetiredLayout } from '../statechart/state/actions.js';
import * as blockchart from '../../editor/blockchart/commands.js';
import * as flowchart from '../../editor/flowchart/commands.js';
import * as statechart from '../../editor/statechart/commands.js';
import { parseMermaid } from '../../lib/flowchart/parser/mermaid.js';
import { parseMermaid as parseStateMermaid } from '../../lib/statechart/parser/mermaid.js';

/**
 * Diagram kinds the Studio edits. Metadata only (no editor classes), so the shell, the host
 * and the kinds can import it without cycles. A new kind adds one entry, its root key in
 * ROOT_KEYS and a Studio subclass registered in app.js.
 */
export const DIAGRAM_KINDS = {
  blockchart: {
    label: 'Block diagram',
    noun: 'block diagram',
    icon: 'blockchart',
    addLabel: 'Add block',
    addCommand: 'add-block',
    startHint: 'Add a block to begin.',
    examples: () => BLOCKCHART_EXAMPLES,
    empty: blockchart.emptyDocument,
    validate: blockchart.validateDocument,
  },
  flowchart: {
    label: 'Flowchart',
    noun: 'flowchart',
    icon: 'flowchart',
    addLabel: 'Add step',
    addCommand: 'add-node',
    startHint: 'Drag from a step’s handle to add the next one.',
    examples: () => FLOWCHART_EXAMPLES,
    empty: flowchart.emptyDocument,
    validate: flowchart.validateDocument,
  },
  statechart: {
    label: 'Statechart',
    noun: 'statechart',
    icon: 'statechart',
    addLabel: 'Add state',
    addCommand: 'add-state',
    startHint: 'Drag from a state’s handle to add a transition.',
    examples: () => STATECHART_EXAMPLES,
    empty: statechart.emptyDocument,
    validate: statechart.validateDocument,
    migrate: withoutRetiredLayout,
  },
};

/** Each kind's own root collection (runtime contract: exactly one per document). */
const ROOT_KEYS = { modules: 'blockchart', nodes: 'flowchart', states: 'statechart' };

/**
 * Dispatch by the runtime's mutually exclusive root keys (docs/editor-runtime.md): own
 * `modules` → Blockchart, `nodes` → Flowchart, `states` → Statechart. More than one, or
 * none, is rejected, never guessed. This is routing only; the kind's validator checks
 * the whole document.
 */
export function diagramKind(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document))
    throw new Error('Expected a diagram JSON object.');
  const found = Object.keys(ROOT_KEYS).filter((key) => Object.prototype.hasOwnProperty.call(document, key));
  const describe = (key) => `"${key}" (${DIAGRAM_KINDS[ROOT_KEYS[key]].noun})`;
  if (found.length > 1)
    throw new Error(`The file has ${found.map(describe).join(' and ')}; a diagram is one kind.`);
  if (found.length) return ROOT_KEYS[found[0]];
  throw new Error(
    `Not a blockflow diagram: expected ${Object.keys(ROOT_KEYS).map(describe).join(', ')} at the top level.`,
  );
}

/**
 * File text → authoring JSON. Mermaid text is converted by the runtime parser of the
 * diagram type its first statement names: `stateDiagram(-v2)` → Statechart, otherwise
 * `flowchart` / `graph` → Flowchart (which reports unsupported text with line/column).
 */
export function parseDiagramFile(name, text) {
  const body = text.replace(/^﻿/, '');
  const header =
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('%%')) ?? '';
  const mermaid = /\.(mmd|mermaid)$/i.test(name) || /^(flowchart|graph|stateDiagram(-v2)?)\b/.test(header);
  if (!mermaid) return { document: JSON.parse(body) };
  const parse = /^stateDiagram(-v2)?\b/.test(header) ? parseStateMermaid : parseMermaid;
  return { document: parse(body), note: 'Imported from Mermaid; Save writes JSON.' };
}
