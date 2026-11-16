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
  text: [...Object.keys(TEXT_STYLE), 'textAlign'],
  connectionLabel: [...Object.keys(CONNECTION_LABEL_STYLE), 'textAlign'],
  group: [...Object.keys(GROUP_STYLE), ...TEXT_GROUPS],
  connection: [...Object.keys(connectionStyle(1)), 'label'],
  module: [...Object.keys(BLOCK_STYLE), ...TEXT_GROUPS],
  diagram: ['text', 'module', 'group', 'connection', 'terminal', 'caption'],
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
          ? ['text', 'terminal', 'caption'].includes(key)
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
    } else if (key === 'textAlign') {
      if (!['left', 'center', 'right'].includes(item)) fail('Expected left, center or right', location);
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

/** Ordered property layers shared by model resolution and editor inheritance hints. */
export function styleLayers(defaults = {}, kind, section = '', local = {}, context = {}) {
  const layers = [],
    add = (value, source) => {
      if (value) layers.push({ value, source });
    };
  const text = ['text', 'terminal', 'caption', 'port'].includes(kind) || Boolean(section);
  const builtIn = text
    ? kind === 'connection'
      ? CONNECTION_LABEL_STYLE
      : TEXT_STYLE
    : kind === 'group'
      ? GROUP_STYLE
      : kind === 'module'
        ? BLOCK_STYLE
        : {
            ...connectionStyle(context.width),
            endArrow: 'triangle',
            ...(context.direction === 'both' ? { startArrow: 'triangle' } : {}),
          };
  add(builtIn, 'Built-in');
  if (text && kind !== 'text') add(defaults.text, 'Diagram > Text');
  const names = {
    module: 'Blocks',
    group: 'Groups',
    connection: 'Connections',
    terminal: 'Terminals',
    caption: 'Caption',
    text: 'Text',
  };
  const parts = {
    label: 'Label',
    portLabel: 'All ports',
    inputPortLabel: 'Input labels',
    outputPortLabel: 'Output labels',
  };
  if (kind === 'port') {
    const direction = context.direction ?? 'input',
      side = direction === 'inout' ? null : direction === 'input' ? 'inputPortLabel' : 'outputPortLabel';
    for (const [owner, base] of [
      [defaults.module, 'Diagram > Blocks'],
      ...(context.ownerKind === 'group' ? [[defaults.group, 'Diagram > Groups']] : []),
      [context.ownerStyle, context.ownerLabel ?? 'Owner'],
    ]) {
      add(owner?.portLabel, base + ' > All ports');
      if (side) add(owner?.[side], base + ' > ' + parts[side]);
    }
    add(local, 'This port');
    return layers;
  }
  if (['portLabel', 'inputPortLabel', 'outputPortLabel'].includes(section)) {
    if (kind === 'group') {
      add(defaults.module?.portLabel, 'Diagram > Blocks > All ports');
      if (section !== 'portLabel') add(defaults.module?.[section], 'Diagram > Blocks > ' + parts[section]);
    }
    add(defaults[kind]?.portLabel, 'Diagram > ' + names[kind] + ' > All ports');
    if (section !== 'portLabel')
      add(defaults[kind]?.[section], 'Diagram > ' + names[kind] + ' > ' + parts[section]);
    add(local.portLabel, 'This object > All ports');
    if (section !== 'portLabel') add(local[section], 'This object > ' + parts[section]);
    return layers;
  }
  add(
    section ? defaults[kind]?.[section] : defaults[kind],
    'Diagram > ' + names[kind] + (section ? ' > ' + parts[section] : ''),
  );
  if (context.netStyle) add(section ? context.netStyle[section] : context.netStyle, 'This Net');
  add(section ? local[section] : local, 'This object');
  return layers;
}

export const resolveStyleLayers = (layers) => Object.assign({}, ...layers.map((layer) => layer.value));
export function inheritedStyleValue(defaults, kind, section, local, property, context = {}) {
  const copy = structuredClone(local ?? {});
  const target = section ? copy[section] : copy;
  if (target) delete target[property];
  let info;
  for (const layer of styleLayers(defaults, kind, section, copy, context))
    if (Object.hasOwn(layer.value, property)) info = { value: layer.value[property], source: layer.source };
  return info;
}

export function resolveModuleStyle(global = {}, local = {}, text = {}) {
  const defaults = { module: global, text },
    resolved = resolveStyleLayers(styleLayers(defaults, 'module', '', local));
  return {
    ...Object.fromEntries(Object.keys(BLOCK_STYLE).map((key) => [key, resolved[key]])),
    label: resolveStyleLayers(styleLayers(defaults, 'module', 'label', local)),
  };
}

export function resolvePortStyle(global = {}, local = {}, port, text = {}, group = undefined) {
  return resolveStyleLayers(
    styleLayers({ module: global, text, group }, 'port', '', port.style, {
      direction: port.direction,
      ownerStyle: local,
      ownerKind: group ? 'group' : 'module',
    }),
  );
}

export function resolveGroupStyle(local = {}, global = {}, text = {}) {
  const defaults = { group: global, text },
    resolved = resolveStyleLayers(styleLayers(defaults, 'group', '', local));
  return {
    ...Object.fromEntries(Object.keys(GROUP_STYLE).map((key) => [key, resolved[key]])),
    label: resolveStyleLayers(styleLayers(defaults, 'group', 'label', local)),
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
