// Stable identities shared by raw JSON, normalized models, editors and DOM views.
export const endpointKey = (value) =>
  typeof value === 'string'
    ? value
    : value?.terminal !== undefined
      ? `@terminal:${value.terminal}`
      : value?.moduleId !== undefined
        ? `${value.moduleId}.${value.portId}`
        : String(value);
export const endpointValue = (value) =>
  value?.terminal !== undefined
    ? { terminal: value.terminal }
    : typeof value === 'string'
      ? value
      : `${value.moduleId}.${value.portId}`;
export const endpointFromKey = (value) =>
  value.startsWith('@terminal:') ? { terminal: value.slice(10) } : value;
export const endpointLabel = (value) =>
  Array.isArray(value) ? value.map(item=>endpointLabel(item?.endpoint??item)).join(', ') : value?.terminal !== undefined ? `Terminal ${value.terminal}` : endpointKey(value);
