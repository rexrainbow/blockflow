import { parseStyle, inheritedStyleValue } from '../../lib/blockchart/styles.js';
import { styleSections, styleValidationMessage } from '../components/style-dialog.js';

export const DEFAULT_CATEGORIES = [
  ['text', 'Text'],
  ['module', 'Blocks'],
  ['group', 'Groups'],
  ['connection', 'Connections'],
  ['terminal', 'Terminals'],
  ['caption', 'Caption'],
];
const kinds = new Set(DEFAULT_CATEGORIES.map(([kind]) => kind));
const keyParts = (key) => key.split('/');
const get = (object, parts) => parts.reduce((value, key) => value?.[key], object);
export function newDefaultsDraft(document, stored) {
  const draft = {
    base: structuredClone(document.diagram.style ?? {}),
    inputs: {},
    category: 'text',
    section: '',
  };
  if (!stored) return draft;
  if (kinds.has(stored.category)) draft.category = stored.category;
  if (styleSections(draft.category).some(([key]) => key === stored.section)) draft.section = stored.section;
  if (JSON.stringify(stored.base) !== JSON.stringify(draft.base)) return draft;
  for (const [key, entry] of Object.entries(stored.inputs ?? {})) {
    const [kind, section, property] = keyParts(key);
    if (
      kinds.has(kind) &&
      styleSections(kind).some(
        ([group, , fields]) => group === section && fields.some(([, p]) => p === property),
      ) &&
      typeof entry?.value === 'string'
    )
      draft.inputs[key] = { value: entry.value, badInput: Boolean(entry.badInput) };
  }
  return draft;
}
export function defaultsDirty(draft) {
  return Object.entries(draft.inputs).some(([key, entry]) => {
    const [kind, section, property] = keyParts(key),
      base = get(draft.base, [kind, ...(section ? [section] : []), property]);
    return entry.badInput || entry.value.trim() !== String(base ?? '');
  });
}
export function defaultsStyle(draft, validate = true) {
  const result = structuredClone(draft.base);
  for (const [key, entry] of Object.entries(draft.inputs)) {
    const [kind, section, property] = keyParts(key),
      path = [kind, ...(section ? [section] : [])];
    const definition = styleSections(kind)
      .find(([group]) => group === section)[2]
      .find(([, p]) => p === property);
    const target = path.reduce((value, key) => (value[key] ??= {}), result),
      value = entry.value.trim();
    if (validate && entry.badInput)
      throw defaultsError('Enter a valid number or clear the field to inherit.', key);
    if (!value) delete target[property];
    else
      target[property] =
        property === 'hidden'
          ? value === 'true'
          : ['positive', 'nonnegative', 'opacity'].includes(definition[2])
            ? Number(value)
            : value;
  }
  for (const [kind, value] of Object.entries(result)) {
    for (const [key, child] of Object.entries(value))
      if (child && typeof child === 'object' && !Object.keys(child).length) delete value[key];
    if (!Object.keys(value).length) delete result[kind];
  }
  if (validate)
    parseStyle(result, 'diagram', 'diagram.style', (message, path) => {
      const parts = path.split('.').slice(2),
        kind = parts.shift(),
        property = parts.pop();
      throw defaultsError(styleValidationMessage(message), [kind, parts.join('.'), property].join('/'));
    });
  return result;
}
function defaultsError(message, key) {
  const error = new Error(message);
  error.defaultsKey = key;
  return error;
}

/** Resolve a field's inherited fallback without accidentally inheriting itself. */
export function defaultFieldHint(draft, section, property) {
  const defaults = defaultsStyle(draft, false),
    kind = draft.category;
  const target = section ? defaults[kind]?.[section] : defaults[kind];
  if (target) delete target[property];
  // Category defaults are the last layer here; no per-object overrides are authored.
  const info = inheritedStyleValue(defaults, kind, section, {}, property);
  // Direction-specific Port defaults inherit their category's common Port settings.
  return info;
}
