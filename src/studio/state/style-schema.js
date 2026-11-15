import { TEXT_STYLE, CONNECTION_LABEL_STYLE, BLOCK_STYLE, GROUP_STYLE, connectionStyle } from '../../lib/blockchart/styles.js';

const LINE = [
  { key: 'solid', label: 'Solid' },
  { key: 'dashed', label: 'Dashed' },
  { key: 'dotted', label: 'Dotted' },
];

const F = {
  color: (key, label) => ({ key, label, type: 'color' }),
  num: (key, label, min = 0, step = 0.5) => ({ key, label, type: 'number', min, step }),
  opacity: (key, label) => ({ key, label, type: 'number', min: 0, max: 1, step: 0.05 }),
  line: (key, label) => ({ key, label, type: 'enum', options: LINE }),
  arrow: (key, label) => ({ key, label, type: 'enum', options: [{ key: 'none', label: 'None' }, { key: 'triangle', label: 'Triangle' }] }),
  bool: (key, label) => ({ key, label, type: 'bool' }),
};

const TEXT_FIELDS = [
  F.color('color', 'Text color'),
  F.num('fontSize', 'Font size', 1, 1),
  F.opacity('opacity', 'Text opacity'),
  F.color('backgroundColor', 'Background'),
  F.opacity('backgroundOpacity', 'Background opacity'),
  F.num('padding', 'Padding', 0, 1),
  F.bool('hidden', 'Hidden'),
];

const LABEL_FRAME = [
  F.color('borderColor', 'Frame color'),
  F.num('borderWidth', 'Frame width', 0, 0.5),
  F.opacity('borderOpacity', 'Frame opacity'),
  F.num('borderRadius', 'Corner radius', 0, 1),
  { key: 'repeatAtEnd', label: 'Destination labels', type: 'enum', options: [{ key: 'auto', label: 'Auto (long branches)' }, { key: 'always', label: 'Always' }, { key: 'never', label: 'Never' }] },
  F.num('longThreshold', 'Long branch threshold', 1, 10),
];

const BOX = [
  F.color('fillColor', 'Fill'),
  F.opacity('fillOpacity', 'Fill opacity'),
  F.color('borderColor', 'Border'),
  F.num('borderWidth', 'Border width', 0.5, 0.25),
  F.line('borderStyle', 'Border style'),
  F.opacity('borderOpacity', 'Border opacity'),
];

const LINE_FIELDS = [
  F.color('strokeColor', 'Line color'),
  F.num('strokeWidth', 'Line width', 0.25, 0.25),
  F.line('lineStyle', 'Line style'),
  F.opacity('opacity', 'Opacity'),
  F.arrow('endArrow', 'End arrow'),
  F.arrow('startArrow', 'Start arrow'),
];

/** Sections: [{ id, title, path (sub-object key or null), fields }] */
export const STYLE_SCHEMA = {
  module: [
    { id: 'box', title: 'Body', path: null, fields: BOX },
    { id: 'label', title: 'Title', path: 'label', fields: TEXT_FIELDS },
    { id: 'portLabel', title: 'All port labels', path: 'portLabel', fields: TEXT_FIELDS },
    { id: 'inputPortLabel', title: 'Input labels', path: 'inputPortLabel', fields: TEXT_FIELDS },
    { id: 'outputPortLabel', title: 'Output labels', path: 'outputPortLabel', fields: TEXT_FIELDS },
  ],
  group: [
    { id: 'box', title: 'Frame', path: null, fields: [...BOX, F.num('borderRadius', 'Corner radius', 0, 1)] },
    { id: 'label', title: 'Title', path: 'label', fields: TEXT_FIELDS },
    { id: 'portLabel', title: 'Port labels', path: 'portLabel', fields: TEXT_FIELDS },
  ],
  connection: [
    { id: 'line', title: 'Line', path: null, fields: LINE_FIELDS },
    { id: 'label', title: 'Label', path: 'label', fields: [...TEXT_FIELDS, ...LABEL_FRAME] },
  ],
  branch: [{ id: 'line', title: 'Branch line', path: null, fields: LINE_FIELDS.filter((f) => f.key !== 'startArrow') }],
  text: [{ id: 'text', title: 'Text', path: null, fields: TEXT_FIELDS }],
};

/** Built-in values shown as the inheritance floor. */
export const BUILT_IN = {
  module: { ...BLOCK_STYLE, label: TEXT_STYLE, portLabel: TEXT_STYLE, inputPortLabel: TEXT_STYLE, outputPortLabel: TEXT_STYLE },
  group: { ...GROUP_STYLE, label: TEXT_STYLE, portLabel: TEXT_STYLE },
  connection: { ...connectionStyle(1), label: CONNECTION_LABEL_STYLE },
  branch: connectionStyle(1),
  text: TEXT_STYLE,
};

/** Diagram defaults categories (diagram.style.*) */
export const DEFAULT_CATEGORIES = [
  { key: 'module', label: 'Blocks', kind: 'module' },
  { key: 'group', label: 'Groups', kind: 'group' },
  { key: 'connection', label: 'Nets', kind: 'connection' },
  { key: 'text', label: 'All text', kind: 'text' },
  { key: 'terminal', label: 'Terminals', kind: 'text' },
  { key: 'caption', label: 'Caption', kind: 'text' },
];

/** Quick styles write explicit values; the schema has no named-style storage. */
export const QUICK_STYLES = {
  connection: [
    { name: 'Signal', style: { strokeColor: '#2457d6', strokeWidth: 1.5, lineStyle: 'solid', endArrow: 'triangle' } },
    { name: 'Bus', style: { strokeColor: '#1565c0', strokeWidth: 4, lineStyle: 'solid', endArrow: 'triangle' } },
    { name: 'Control', style: { strokeColor: '#7b1fa2', strokeWidth: 1.5, lineStyle: 'dashed', endArrow: 'triangle' } },
    { name: 'Feedback', style: { strokeColor: '#c62828', strokeWidth: 2, lineStyle: 'dashed', endArrow: 'triangle' } },
    { name: 'Bypass', style: { strokeColor: '#b26a00', strokeWidth: 1.5, lineStyle: 'dashed', endArrow: 'triangle' } },
    { name: 'Clock', style: { strokeColor: '#2e7d32', strokeWidth: 1.5, lineStyle: 'dotted', endArrow: 'triangle' } },
  ],
  module: [
    { name: 'Plain', style: { fillColor: '#ffffff', borderColor: '#33415a', borderWidth: 1, borderStyle: 'solid' } },
    { name: 'Primary', style: { fillColor: '#e6edfc', borderColor: '#2457d6', borderWidth: 1.5, borderStyle: 'solid' } },
    { name: 'Control', style: { fillColor: '#f3e5f5', borderColor: '#7b1fa2', borderWidth: 1, borderStyle: 'solid' } },
    { name: 'Storage', style: { fillColor: '#e3f3ea', borderColor: '#26704a', borderWidth: 1, borderStyle: 'solid' } },
    { name: 'Optional', style: { fillColor: '#fffaf0', borderColor: '#946016', borderWidth: 1.5, borderStyle: 'dashed' } },
    { name: 'Muted', style: { fillColor: '#f3f6fa', borderColor: '#8296ad', borderWidth: 1, borderStyle: 'dotted' } },
  ],
  group: [
    { name: 'Region', style: { fillColor: '#f3f6fa', borderColor: '#8296ad', borderStyle: 'solid', borderRadius: 12, borderWidth: 1.25 } },
    { name: 'Dashed', style: { fillColor: '#f7f9fc', borderColor: '#8793a5', borderStyle: 'dashed', borderRadius: 0, borderWidth: 1 } },
    { name: 'Highlight', style: { fillColor: '#eef3fd', borderColor: '#2457d6', borderStyle: 'dashed', borderRadius: 6, borderWidth: 1.25 } },
    { name: 'Clear', style: { fillColor: '#ffffff', fillOpacity: 0, borderColor: '#b3bfcc', borderStyle: 'solid', borderRadius: 8, borderWidth: 1 } },
  ],
};

/** Colors already used in a document, most frequent first (for swatches). */
export function documentColors(doc, limit = 14) {
  const counts = new Map();
  const visit = (value, key) => {
    if (typeof value === 'string' && /color$/i.test(key ?? '') && /^#[0-9a-f]{3,8}$/i.test(value)) {
      const c = value.toLowerCase();
      counts.set(c, (counts.get(c) ?? 0) + 1);
    } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) visit(v, k);
  };
  visit(doc);
  for (const c of ['#000000', '#ffffff', '#2457d6', '#c62828', '#26704a', '#b26a00', '#7b1fa2']) if (!counts.has(c)) counts.set(c, 0);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, limit);
}
