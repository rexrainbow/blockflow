import { createFlowchartModel, FlowchartValidationError, parseFlowStyle } from '../flowchart/model.js';

export const STATECHART_LAYOUT_DEFAULTS = Object.freeze({ labelMaxWidth: 240 });

export class StatechartValidationError extends Error {
  constructor(message, path = '') {
    super(`${path ? path + ': ' : ''}${message}`);
    this.name = 'StatechartValidationError';
    this.path = path;
  }
}
export const fail = (message, path) => {
  throw new StatechartValidationError(message, path);
};
export function object(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected an object', path);
  for (const key of Object.keys(value))
    if (!keys.includes(key)) fail('Unsupported property: ' + key, path + '.' + key);
}
export function statePath(path) {
  return path
    ?.replace(/^document\.nodes/, 'document.states')
    .replace(/^document\.edges/, 'document.transitions')
    .replace(/^nodes/, 'states')
    .replace(/^edges/, 'transitions')
    .replace(/\.style\.node(?=\.|$)/g, '.style.state')
    .replace(/\.style\.edge(?=\.|$)/g, '.style.transition');
}
function graphStyle(style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return style;
  const { descriptionAlign, ...rest } = style;
  return rest;
}
function validateStateStyle(style, path) {
  if (
    style &&
    Object.hasOwn(style, 'descriptionAlign') &&
    !['left', 'center', 'right'].includes(style.descriptionAlign)
  )
    fail('Expected left, center or right', path + '.descriptionAlign');
  return parseFlowStyle(graphStyle(style), 'node', path);
}
/** Lower validated authoring data into graph data; never persist this representation. */
export function graphDocument(raw) {
  const style = raw.diagram.style;
  return {
    version: raw.version,
    diagram: {
      ...raw.diagram,
      style: {
        node: { borderRadius: 8, ...(graphStyle(style?.state) ?? {}) },
        edge: style?.transition ?? {},
      },
    },
    ...(raw.layout
      ? { layout: Object.fromEntries(Object.entries(raw.layout).filter(([key]) => key !== 'labelMaxWidth')) }
      : {}),
    nodes: raw.states.map((s) => ({
      id: s.id,
      type: 'process',
      label: s.kind && s.kind !== 'state' ? '.' : [s.label ?? s.id, s.description].filter(Boolean).join('\n'),
      ...Object.fromEntries(
        ['width', 'height', 'style']
          .filter((k) => Object.hasOwn(s, k))
          .map((k) => [k, k === 'style' ? graphStyle(s[k]) : s[k]]),
      ),
    })),
    edges: raw.transitions.map((t, i) => ({ ...t, id: t.id ?? `transition_${i + 1}` })),
  };
}
export function createStatechartModel(raw) {
  object(raw, ['version', 'diagram', 'layout', 'states', 'transitions'], 'document');
  object(raw.diagram, ['name', 'caption', 'style'], 'diagram');
  if (raw.diagram.style !== undefined) object(raw.diagram.style, ['state', 'transition'], 'diagram.style');
  if (Object.hasOwn(raw, 'layout')) {
    object(raw.layout, ['direction', 'nodeSpacing', 'layerSpacing', 'noteGap', 'labelMaxWidth'], 'layout');
    for (const [key, value] of Object.entries(raw.layout))
      if (value === null) fail('Expected a layout value', 'layout.' + key);
    if (
      Object.hasOwn(raw.layout, 'labelMaxWidth') &&
      (typeof raw.layout.labelMaxWidth !== 'number' ||
        !Number.isFinite(raw.layout.labelMaxWidth) ||
        raw.layout.labelMaxWidth <= 0)
    )
      fail('Expected a finite positive number', 'layout.labelMaxWidth');
  }
  if (!Array.isArray(raw.states) || !raw.states.length) fail('Expected nonempty states', 'states');
  if (!Array.isArray(raw.transitions)) fail('Expected transitions array', 'transitions');
  for (const [i, s] of raw.states.entries()) {
    const p = `states[${i}]`;
    object(s, ['id', 'kind', 'label', 'description', 'width', 'height', 'style'], p);
    if (Object.hasOwn(s, 'kind') && !['state', 'initial', 'final'].includes(s.kind))
      fail('Expected state, initial or final', p + '.kind');
    for (const k of ['label', 'description'])
      if (Object.hasOwn(s, k) && (typeof s[k] !== 'string' || !s[k].trim()))
        fail('Expected nonempty text', p + '.' + k);
    if (
      (s.kind ?? 'state') !== 'state' &&
      ['label', 'description', 'width', 'height'].some((k) => Object.hasOwn(s, k))
    )
      fail('Pseudostates have fixed size and no text', p);
  }
  // Reuse strict graph/style validation without exposing its normalized defaults.
  try {
    for (const [key, value] of Object.entries(raw.diagram.style ?? {}))
      key === 'state'
        ? validateStateStyle(value, 'diagram.style.state')
        : parseFlowStyle(value, 'edge', 'diagram.style.transition');
    for (const [i, state] of raw.states.entries())
      if (Object.hasOwn(state, 'style')) validateStateStyle(state.style, `states[${i}].style`);
    for (const [i, t] of raw.transitions.entries()) {
      object(t, ['id', 'from', 'to', 'label', 'kind', 'fromSide', 'toSide', 'style'], `transitions[${i}]`);
      if (Object.hasOwn(t, 'id') && (typeof t.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(t.id)))
        fail('Expected an identifier', `transitions[${i}].id`);
    }
    createFlowchartModel(graphDocument(raw));
  } catch (e) {
    if (e instanceof FlowchartValidationError)
      throw new StatechartValidationError(e.message.replace(/^.*?: /, ''), statePath(e.path));
    throw e;
  }
  const byId = new Map(raw.states.map((s) => [s.id, s]));
  const edgeIds = new Set();
  for (const [i, t] of raw.transitions.entries()) {
    object(t, ['id', 'from', 'to', 'label', 'kind', 'fromSide', 'toSide', 'style'], `transitions[${i}]`);
    if (Object.hasOwn(t, 'kind') && !['flow', 'loop'].includes(t.kind))
      fail('Expected flow or loop', `transitions[${i}].kind`);
    if (byId.get(t.from).kind === 'final')
      fail('Final state cannot have outgoing transitions', `transitions[${i}].from`);
    if (byId.get(t.to).kind === 'initial')
      fail('Initial state cannot have incoming transitions', `transitions[${i}].to`);
    const id = t.id ?? `transition_${i + 1}`;
    if (edgeIds.has(id)) fail('Duplicate transition ID', `transitions[${i}].id`);
    edgeIds.add(id);
  }
  // IDs are materialized in the normalized model only. Layout loop classification is not.
  return {
    ...structuredClone(raw),
    states: raw.states.map((s) => ({ ...structuredClone(s), kind: s.kind ?? 'state' })),
    transitions: raw.transitions.map((t, i) => ({
      ...structuredClone(t),
      id: t.id ?? `transition_${i + 1}`,
    })),
  };
}
