import { ancestors } from './hierarchy.js';
import { LAYOUT_DEFAULTS } from './layout-defaults.js';

/** Resolve a validated authoring/normalized document without materializing inherited
 * settings on groups. Scope '' denotes the root; each property inherits separately. */
export function resolveLayoutSpacing(document, scope = '') {
  if (typeof scope !== 'string' || (scope && !document.groups?.some((group) => group.id === scope)))
    throw new RangeError('Unknown layout scope: ' + String(scope));
  const result = {
    moduleSpacing: document.layout?.moduleSpacing ?? LAYOUT_DEFAULTS.moduleSpacing,
    layerSpacing: document.layout?.layerSpacing ?? LAYOUT_DEFAULTS.layerSpacing,
  };
  const groups = new Map((document.groups ?? []).map((group) => [group.id, group]));
  for (const id of scope ? [...ancestors(document, scope), scope] : [])
    for (const key of ['moduleSpacing', 'layerSpacing'])
      if (Object.hasOwn(groups.get(id).layout ?? {}, key)) result[key] = groups.get(id).layout[key];
  return result;
}
