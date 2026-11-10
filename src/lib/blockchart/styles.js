// Portable static styles. No CSS strings or renderer-specific properties.
import { TEXT_STYLE } from '../shared/text.js';
export { TEXT_STYLE } from '../shared/text.js';
export const CONNECTION_LABEL_STYLE = Object.freeze({
  ...TEXT_STYLE,
  borderColor: '#00000000',
  borderWidth: 1,
  borderOpacity: 1,
  borderRadius: 0,
  repeatAtEnd: 'auto',
  longThreshold: 600,
});
export const BLOCK_STYLE = Object.freeze({
  borderColor: '#000000',
  borderWidth: 1,
  borderStyle: 'solid',
  borderOpacity: 1,
  fillColor: '#ffffff',
  fillOpacity: 1,
});
export const GROUP_STYLE = Object.freeze({
  ...BLOCK_STYLE,
  borderColor: '#8793a5',
  borderStyle: 'dashed',
  fillColor: '#f7f9fc',
  borderRadius: 0,
});
export const connectionStyle = (width) => ({
  strokeColor: '#000000',
  strokeWidth: width > 1 ? 2.5 : 1.5,
  lineStyle: 'solid',
  opacity: 1,
  endArrow: 'none',
  startArrow: 'none',
});

const TEXT_GROUPS = ['label', 'portLabel', 'inputPortLabel', 'outputPortLabel'];
const KEYS = {
  text: Object.keys(TEXT_STYLE),
  connectionLabel: Object.keys(CONNECTION_LABEL_STYLE),
  group: [...Object.keys(GROUP_STYLE), ...TEXT_GROUPS],
  connection: [...Object.keys(connectionStyle(1)), 'label'],
  module: [...Object.keys(BLOCK_STYLE), ...TEXT_GROUPS],
  diagram: ['module', 'connection', 'caption'],
};

/** Parse a partial style; inheritance is resolved only after all layers validate. */
export function parseStyle(value, kind, path, fail) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected a style object', path);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const location = `${path}.${key}`;
    if (!KEYS[kind].includes(key)) fail(`Unsupported style property: ${key}`, location);
    if (
      kind === 'diagram' ||
      (['module', 'group'].includes(kind) && TEXT_GROUPS.includes(key)) ||
      (['group', 'connection'].includes(kind) && key === 'label')
    ) {
      result[key] = parseStyle(
        item,
        kind === 'diagram'
          ? key === 'caption'
            ? 'text'
            : key
          : kind === 'connection'
            ? 'connectionLabel'
            : 'text',
        location,
        fail,
      );
    } else if (kind === 'connectionLabel' && key === 'repeatAtEnd') {
      const choices = ['auto', 'always', 'never'];
      if (!choices.includes(item)) fail(`Expected ${choices.join(', ')}`, location);
      result[key] = item;
    } else if (key === 'hidden') {
      if (typeof item !== 'boolean') fail('Expected a boolean', location);
      result[key] = item;
    } else if (key === 'endArrow' || key === 'startArrow') {
      if (!['none', 'triangle'].includes(item)) fail('Expected none or triangle arrow', location);
      result[key] = item;
    } else if (key.toLowerCase().endsWith('color')) {
      if (item === 'transparent') result[key] = '#00000000';
      else {
        if (
          typeof item !== 'string' ||
          /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(item)?.[0] !== item
        )
          fail('Expected hex color or transparent', location);
        result[key] = (
          item.length <= 5 ? '#' + [...item.slice(1)].map((c) => c + c).join('') : item
        ).toLowerCase();
      }
    } else if (key === 'lineStyle' || key === 'borderStyle') {
      if (!['solid', 'dashed', 'dotted'].includes(item)) fail('Expected solid, dashed or dotted', location);
      result[key] = item;
    } else {
      const unit = key.toLowerCase().endsWith('opacity');
      const zeroAllowed =
        unit ||
        key === 'padding' ||
        key === 'borderRadius' ||
        (kind === 'connectionLabel' && key === 'borderWidth');
      if (
        typeof item !== 'number' ||
        !Number.isFinite(item) ||
        (zeroAllowed ? item < 0 : item <= 0) ||
        (unit && item > 1)
      ) {
        fail(
          unit
            ? 'Expected opacity between 0 and 1'
            : `Expected finite ${zeroAllowed ? 'non-negative' : 'positive'} number`,
          location,
        );
      }
      result[key] = item;
    }
  }
  return result;
}

export function resolveModuleStyle(global = {}, local = {}) {
  const block = { ...BLOCK_STYLE };
  for (const layer of [global, local])
    for (const key of Object.keys(BLOCK_STYLE)) {
      if (Object.hasOwn(layer, key)) block[key] = layer[key];
    }
  return { ...block, label: { ...TEXT_STYLE, ...global.label, ...local.label } };
}

export function resolvePortStyle(global = {}, local = {}, port) {
  if (port.direction === 'inout')
    return { ...TEXT_STYLE, ...global.portLabel, ...local.portLabel, ...port.style };
  const side = port.direction === 'input' ? 'inputPortLabel' : 'outputPortLabel';
  return {
    ...TEXT_STYLE,
    ...global.portLabel,
    ...global[side],
    ...local.portLabel,
    ...local[side],
    ...port.style,
  };
}

export function resolveGroupStyle(local = {}) {
  return {
    ...resolveModuleStyle({}, { ...GROUP_STYLE, ...local }),
    borderRadius: local.borderRadius ?? GROUP_STYLE.borderRadius,
  };
}

/** SVG radii are logical lengths, clamped to the inset rectangle's half extents. */
export function groupCornerRadius(group, width = group.width, height = group.faceHeight ?? group.height) {
  return Math.min(
    group.style.borderRadius ?? 0,
    Math.max(0, (width - group.style.borderWidth) / 2),
    Math.max(0, (height - group.style.borderWidth) / 2),
  );
}

export { paint, linePattern } from '../shared/paint.js';
