import { validateDocument } from '../../../editor/statechart/commands.js';
import { graphDocument } from '../../../lib/statechart/model.js';
import { validateDocument as validateGraph } from '../../../editor/flowchart/commands.js';
import { singleLine } from '../../ui/dom.js';

/**
 * Statechart helpers for the GUI. Structural edits use src/editor/statechart/commands.js
 * (each returns a new validated document); these helpers only read the authoring JSON.
 *
 * Selections reuse the graph editor's shapes: { type: 'node', id } is a state and
 * { type: 'edge', key } a transition, where key is the runtime id (explicit id or
 * transition_<index + 1>).
 */
export const STATE_KINDS = [
  {
    value: 'state',
    label: 'State',
    icon: 'process',
    hint: 'A named state; its description lists outputs or actions as text',
  },
  {
    value: 'initial',
    label: 'Initial',
    icon: 'startNode',
    hint: 'The solid dot where the machine starts; no text, no incoming transitions',
  },
  {
    value: 'final',
    label: 'Final',
    icon: 'endNode',
    hint: 'The bullseye where it ends; no text, no outgoing transitions',
  },
];
export const kindInfo = (kind) => STATE_KINDS.find((k) => k.value === (kind ?? 'state')) ?? STATE_KINDS[0];
export const TRANSITION_KINDS = [
  { value: 'flow', label: 'Forward', hint: 'Lays out as part of the main order' },
  { value: 'loop', label: 'Loop', hint: 'Goes back to an earlier state; routed against the flow' },
];

export const transitionKey = (t, index) => t.id ?? 'transition_' + (index + 1);
export const transitionIndex = (doc, key) => doc.transitions.findIndex((t, i) => transitionKey(t, i) === key);
export const findTransition = (doc, key) => doc.transitions[transitionIndex(doc, key)] ?? null;
export const findState = (doc, id) => doc.states.find((s) => s.id === id) ?? null;

export function stateName(state) {
  if (!state) return '';
  const kind = state.kind ?? 'state';
  if (kind !== 'state') return `${kindInfo(kind).label} (${state.id})`;
  return singleLine(state.label ?? state.id);
}

export function transitionTitle(doc, t) {
  const name = (id) => stateName(findState(doc, id) ?? { id });
  return t.from === t.to ? `${name(t.from)} ↻` : `${name(t.from)} → ${name(t.to)}`;
}

/**
 * Statechart no longer accepts a global layout.loopSide (the runtime rejects it).
 * Drafts and files written before that still carry it: returns a copy without it, or
 * null when there is nothing to remove. Per-transition fromSide/toSide are kept.
 */
export function withoutRetiredLayout(doc) {
  if (!doc?.layout || typeof doc.layout !== 'object' || !Object.hasOwn(doc.layout, 'loopSide')) return null;
  const next = structuredClone(doc);
  delete next.layout.loopSide;
  if (!Object.keys(next.layout).length) delete next.layout;
  return {
    document: next,
    note: 'Removed the retired loop side setting; transitions are routed without it.',
  };
}

/** The runtime's lowered graph model: resolved styles and layout defaults for placeholders. */
export function resolvedModel(doc) {
  try {
    validateDocument(doc);
    return validateGraph(graphDocument(doc));
  } catch {
    return null;
  }
}

export function problems(store) {
  const list = [];
  if (store.layoutError)
    list.push({ kind: 'error', message: store.layoutError.message, path: store.layoutError.path });
  for (const w of store.layout?.layout?.warnings ?? [])
    list.push({ kind: 'warn', message: w.message ?? String(w.code ?? w), edge: w.edgeId });
  return list;
}

/** A selection for runtime paths like states[2].label, transitions[0].to, states.IDLE. */
export function selectionForPath(doc, path = '') {
  const m = /^(states|transitions)(?:\[(\d+)\]|\.([A-Za-z_][\w-]*))/.exec(String(path ?? ''));
  if (!m) return null;
  const key = m[2] ?? m[3];
  if (m[1] === 'states') {
    const s = findState(doc, key) ?? doc.states[Number(key)];
    return s ? { type: 'node', id: s.id } : null;
  }
  const index = /^\d+$/.test(key) ? Number(key) : transitionIndex(doc, key);
  return doc.transitions[index] ? { type: 'edge', key: transitionKey(doc.transitions[index], index) } : null;
}
