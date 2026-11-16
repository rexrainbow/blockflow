import { validateDocument } from '../../../editor/flowchart/commands.js';
import { singleLine } from '../../ui/dom.js';

/**
 * Flowchart helpers for the GUI. Every structural edit goes through the runtime commands
 * in src/editor/flowchart/commands.js (they return a new validated document); these
 * helpers only read the authoring JSON or write simple properties that the store then
 * validates with the runtime.
 *
 * Selections: { type: 'node', id } | { type: 'group', id } | { type: 'edge', key }
 * where an edge key is the runtime id: its explicit id or edge_<index + 1>.
 */

export const NODE_TYPES = [
  { value: 'process', label: 'Process', icon: 'process', hint: 'A step that does something' },
  { value: 'decision', label: 'Decision', icon: 'decision', hint: 'A question with one edge per answer' },
  { value: 'start', label: 'Start', icon: 'startNode', hint: 'Where the flow begins' },
  { value: 'end', label: 'End', icon: 'endNode', hint: 'Where the flow ends' },
  { value: 'terminator', label: 'Terminator', icon: 'terminator', hint: 'Begin or end, as a rounded box' },
];
export const NOTE_TYPE = { value: 'note', label: 'Note', icon: 'note', hint: 'A comment attached to one step' };
export const typeInfo = (type) => [...NODE_TYPES, NOTE_TYPE].find((t) => t.value === (type ?? 'process')) ?? NODE_TYPES[0];

export const EDGE_KINDS = [
  { value: 'flow', label: 'Flow', hint: 'The normal path' },
  { value: 'loop', label: 'Loop', hint: 'Goes back to an earlier step; drawn around the side' },
  { value: 'association', label: 'Association', hint: 'Links a note; dotted, no arrow' },
];
export const SIDES = ['top', 'right', 'bottom', 'left'];

/** Replaces the contents of the store's working copy with a command result. */
export function swap(d, next) {
  for (const k of Object.keys(d)) delete d[k];
  Object.assign(d, next);
  return d;
}

export const edgeKey = (edge, index) => edge.id ?? 'edge_' + (index + 1);
export const edgeIndex = (doc, key) => doc.edges.findIndex((e, i) => edgeKey(e, i) === key);
export const findEdge = (doc, key) => doc.edges[edgeIndex(doc, key)] ?? null;
export const findNode = (doc, id) => doc.nodes.find((n) => n.id === id) ?? null;
export const findGroup = (doc, id) => doc.groups?.find((g) => g.id === id) ?? null;
export const parentOf = (doc, id) => doc.groups?.find((g) => g.members.includes(id))?.id ?? null;

export const displayName = (item) => singleLine(item?.label ?? item?.id ?? '');

export function edgeTitle(doc, edge) {
  const name = (id) => displayName(findNode(doc, id) ?? { id });
  return `${name(edge.from)} → ${name(edge.to)}`;
}

/** The note attached to `id` (explicit or inferred by the runtime), if any. */
export function noteOf(doc, id) {
  try {
    return validateDocument(doc).nodes.find((n) => n.type === 'note' && n.attachTo === id)?.id ?? null;
  } catch {
    return doc.nodes.find((n) => n.type === 'note' && n.attachTo === id)?.id ?? null;
  }
}

/** Groups in outline order, depth-first; `exclude` drops a group and its descendants. */
export function groupTree(doc, exclude = null) {
  const out = [];
  const visit = (parent, depth) => {
    const members = parent ? findGroup(doc, parent).members : (doc.groups ?? []).filter((g) => !parentOf(doc, g.id)).map((g) => g.id);
    for (const id of members) {
      const g = findGroup(doc, id);
      if (!g || id === exclude) continue;
      out.push({ id, label: displayName(g), depth });
      visit(id, depth + 1);
    }
  };
  visit(null, 1);
  return out;
}

/** Places a node can move to: Top level and every group, the current one marked. */
export function moveTargets(doc, id) {
  const current = parentOf(doc, id) ?? '';
  const exclude = findGroup(doc, id) ? id : null; // a group never moves into itself or its descendants
  return [{ id: '', label: 'Top level', depth: 0, current: current === '' }, ...groupTree(doc, exclude).map((g) => ({ ...g, current: g.id === current }))];
}

/** A group and every group inside it. */
export function groupAndDescendants(doc, id) {
  const out = [id];
  for (const m of findGroup(doc, id)?.members ?? []) if (findGroup(doc, m)) out.push(...groupAndDescendants(doc, m));
  return out;
}

/** Every group containing `id`, nearest first. */
export function ancestors(doc, id) {
  const out = [];
  for (let p = parentOf(doc, id); p; p = parentOf(doc, p)) out.push(p);
  return out;
}

/** Problems shown in the outline: the layout error and runtime warnings. */
export function problems(store) {
  const list = [];
  if (store.layoutError) list.push({ kind: 'error', message: store.layoutError.message, path: store.layoutError.path });
  for (const w of store.layout?.layout?.warnings ?? []) list.push({ kind: 'warn', message: w.message ?? String(w.code ?? w), path: w.path, edge: w.edgeId ?? w.edge, node: w.nodeId ?? w.node });
  return list;
}

/** A selection for the runtime path of an error (`nodes.X`, `edges.N` / `edges.edge_3`, `groups.G`). */
export function selectionForPath(doc, path = '') {
  // Runtime paths look like nodes[2].label, edges[0].to or (from commands) nodes.Step1.
  const m = /^(nodes|edges|groups)(?:\[(\d+)\]|\.([A-Za-z_][\w-]*))/.exec(String(path ?? ''));
  if (!m) return null;
  const head = m[1],
    key = m[2] ?? m[3];
  if (head === 'nodes' && key) {
    const node = findNode(doc, key) ?? doc.nodes[Number(key)];
    return node ? { type: 'node', id: node.id } : null;
  }
  if (head === 'groups' && key) {
    const g = findGroup(doc, key) ?? doc.groups?.[Number(key)];
    return g ? { type: 'group', id: g.id } : null;
  }
  if (head === 'edges' && key) {
    const index = /^\d+$/.test(key) ? Number(key) : edgeIndex(doc, key);
    return doc.edges[index] ? { type: 'edge', key: edgeKey(doc.edges[index], index) } : null;
  }
  return null;
}

/**
 * Sets the flow direction on a layout object. A global loop side must lie across the flow
 * (runtime rule), so a side that the new direction makes invalid is removed (Auto) in the
 * same change. Returns the removed side, if any. Shared by Flowchart and Statechart.
 */
export function setDirection(layout, direction) {
  layout.direction = direction;
  const across = direction === 'down' || direction === 'up' ? ['left', 'right'] : ['top', 'bottom'];
  const side = layout.loopSide;
  if (side && side !== 'auto' && !across.includes(side)) {
    delete layout.loopSide;
    return side;
  }
  return null;
}
