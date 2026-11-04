// Portable static styles. No CSS strings or renderer-specific properties.
export const TEXT_STYLE = Object.freeze({
  color: '#000000', fontSize: 12, backgroundColor: '#00000000',
  padding: 0, opacity: 1, backgroundOpacity: 1,
});
export const BLOCK_STYLE = Object.freeze({
  borderColor: '#000000', borderWidth: 1, borderStyle: 'solid',
  borderOpacity: 1, fillColor: '#ffffff', fillOpacity: 1,
});
export const connectionStyle = width => ({
  strokeColor: '#000000', strokeWidth: width > 1 ? 2.5 : 1.5,
  lineStyle: 'solid', opacity: 1,
});

const TEXT_GROUPS = ['label', 'portLabel', 'inputPortLabel', 'outputPortLabel'];
const KEYS = {
  text: Object.keys(TEXT_STYLE),
  group: [...Object.keys(BLOCK_STYLE), ...TEXT_GROUPS],
  connection: [...Object.keys(connectionStyle(1)), 'label'],
  module: [...Object.keys(BLOCK_STYLE), ...TEXT_GROUPS],
  diagram: ['module', 'connection'],
};

/** Parse a partial style; inheritance is resolved only after all layers validate. */
export function parseStyle(value, kind, path, fail) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected a style object', path);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const location = `${path}.${key}`;
    if (!KEYS[kind].includes(key)) fail(`Unsupported style property: ${key}`, location);
    if (kind === 'diagram' || ((['module', 'group'].includes(kind) && TEXT_GROUPS.includes(key)) || (['group', 'connection'].includes(kind) && key === 'label'))) {
      result[key] = parseStyle(item, kind === 'diagram' ? key : 'text', location, fail);
    } else if (key.toLowerCase().endsWith('color')) {
      if (item === 'transparent') result[key] = '#00000000';
      else {
        if (typeof item !== 'string' || /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(item)?.[0] !== item) fail('Expected hex color or transparent', location);
        result[key] = (item.length <= 5 ? '#' + [...item.slice(1)].map(c => c + c).join('') : item).toLowerCase();
      }
    } else if (key === 'lineStyle' || key === 'borderStyle') {
      if (!['solid', 'dashed', 'dotted'].includes(item)) fail('Expected solid, dashed or dotted', location);
      result[key] = item;
    } else {
      const unit = key.toLowerCase().endsWith('opacity');
      const zeroAllowed = unit || key === 'padding';
      if (typeof item !== 'number' || !Number.isFinite(item) || (zeroAllowed ? item < 0 : item <= 0) || (unit && item > 1)) {
        fail(unit ? 'Expected opacity between 0 and 1' : `Expected finite ${zeroAllowed ? 'non-negative' : 'positive'} number`, location);
      }
      result[key] = item;
    }
  }
  return result;
}

export function resolveModuleStyle(global = {}, local = {}) {
  const block = { ...BLOCK_STYLE };
  for (const layer of [global, local]) for (const key of Object.keys(BLOCK_STYLE)) {
    if (Object.hasOwn(layer, key)) block[key] = layer[key];
  }
  return { ...block, label: { ...TEXT_STYLE, ...global.label, ...local.label } };
}

export function resolvePortStyle(global = {}, local = {}, port) {
  const side = port.direction === 'input' ? 'inputPortLabel' : 'outputPortLabel';
  return { ...TEXT_STYLE, ...global.portLabel, ...global[side], ...local.portLabel, ...local[side], ...port.style };
}

// Split alpha from hex to avoid depending on CSS Color 4 parsing in exporters.
export function paint(color, opacity = 1) {
  return { color: color.slice(0, 7), opacity: opacity * (color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1) };
}

export function linePattern(style, width) {
  if (style === 'dashed') return { dash: `${4 * width} ${2 * width}`, cap: 'butt' };
  if (style === 'dotted') return { dash: `0 ${3 * width}`, cap: 'round' };
  return { cap: 'butt' };
}
