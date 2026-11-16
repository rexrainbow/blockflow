import { createStatechartModel, StatechartValidationError } from '../../lib/statechart/index.js';
const fail = (message, path) => {
  throw new StatechartValidationError(message, path);
};
export const validateDocument = createStatechartModel;
export const emptyDocument = () => ({
  version: 1,
  diagram: { name: 'Untitled statechart' },
  states: [{ id: 'Idle', label: 'Idle' }],
  transitions: [],
});
function edit(doc, fn) {
  const model = validateDocument(doc),
    next = structuredClone(doc);
  fn(next, model);
  validateDocument(next);
  return next;
}
function fresh(doc, prefix) {
  const ids = new Set([...doc.states, ...validateDocument(doc).transitions].map((x) => x.id));
  let n = 1;
  while (ids.has(prefix + n)) n++;
  return prefix + n;
}
function props(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected an object', path);
}
function state(doc, id) {
  const s = doc.states.find((s) => s.id === id);
  if (!s) fail('Unknown state', 'states.' + id);
  return s;
}
function identify(doc, model) {
  doc.transitions.forEach((t, i) => {
    t.id ??= model.transitions[i].id;
  });
}
export function addState(doc, properties = {}) {
  return edit(doc, (d) => {
    props(properties, 'states');
    d.states.push({ ...structuredClone(properties), id: fresh(d, 'State') });
  });
}
export function renameState(doc, id, nextId) {
  return edit(doc, (d) => {
    state(d, id).id = nextId;
    for (const t of d.transitions) for (const end of ['from', 'to']) if (t[end] === id) t[end] = nextId;
  });
}
export function removeState(doc, id) {
  return edit(doc, (d, m) => {
    state(d, id);
    identify(d, m);
    d.states = d.states.filter((s) => s.id !== id);
    d.transitions = d.transitions.filter((t) => t.from !== id && t.to !== id);
  });
}
export function addTransition(doc, from, to, properties = {}) {
  return edit(doc, (d, m) => {
    props(properties, 'transitions');
    const id = fresh(d, 'transition_');
    identify(d, m);
    d.transitions.push({ ...structuredClone(properties), id, from, to });
  });
}
export function removeTransition(doc, id) {
  return edit(doc, (d, m) => {
    identify(d, m);
    const i = d.transitions.findIndex((t) => t.id === id);
    if (i < 0) fail('Unknown transition', 'transitions.' + id);
    d.transitions.splice(i, 1);
  });
}
export function reconnectTransition(doc, id, end, stateId) {
  return edit(doc, (d, m) => {
    if (!['from', 'to'].includes(end)) fail('Expected from or to', 'transitions.' + id);
    state(d, stateId);
    identify(d, m);
    const t = d.transitions.find((t) => t.id === id);
    if (!t) fail('Unknown transition', 'transitions.' + id);
    t[end] = stateId;
  });
}
