import { validateDocument } from '../../../editor/flowchart/commands.js';
import { ALIGN } from '../../blockchart/state/style-schema.js';

const LINE = [
  { key: 'solid', label: 'Solid' },
  { key: 'dashed', label: 'Dashed' },
  { key: 'dotted', label: 'Dotted' },
];
const color = (key, label) => ({ key, label, type: 'color' });
const num = (key, label, min = 0, step = 0.5) => ({ key, label, type: 'number', min, step });

const NODE_SECTIONS = [
  {
    id: 'shape',
    title: 'Shape',
    path: null,
    fields: [
      color('fillColor', 'Fill'),
      color('borderColor', 'Border'),
      num('borderWidth', 'Border width', 0.25, 0.25),
      { key: 'borderStyle', label: 'Border style', type: 'enum', options: LINE },
      num('borderRadius', 'Corner radius', 0, 1),
      { key: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.05 },
    ],
  },
  { id: 'text', title: 'Text', path: null, fields: [color('color', 'Text color'), num('fontSize', 'Font size', 1, 1), ALIGN(), num('padding', 'Padding', 0, 1)] },
];
/** Statechart states: the description (body) can align separately from the name. */
const STATE_SECTIONS = [
  NODE_SECTIONS[0],
  { ...NODE_SECTIONS[1], fields: [...NODE_SECTIONS[1].fields.slice(0, 3), { ...ALIGN('descriptionAlign', 'Description alignment'), inheritLabel: 'follows line alignment' }, ...NODE_SECTIONS[1].fields.slice(3)] },
];

const EDGE_SECTIONS = [
  {
    id: 'line',
    title: 'Line',
    path: null,
    fields: [
      color('strokeColor', 'Line color'),
      num('strokeWidth', 'Line width', 0.25, 0.25),
      { key: 'lineStyle', label: 'Line style', type: 'enum', options: LINE },
      { key: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.05 },
    ],
  },
  { id: 'label', title: 'Label', path: null, fields: [color('color', 'Text color'), num('fontSize', 'Font size', 1, 1), ALIGN(), color('labelBackgroundColor', 'Background')] },
];

/** Style editor sections per item kind (Flowchart schema: nodeStyle / edgeStyle). */
export const FLOW_STYLE_SCHEMA = { node: NODE_SECTIONS, note: NODE_SECTIONS, group: NODE_SECTIONS, edge: EDGE_SECTIONS, state: STATE_SECTIONS };

export const DEFAULT_CATEGORIES = [
  { key: 'node', label: 'Steps' },
  { key: 'note', label: 'Notes' },
  { key: 'group', label: 'Groups' },
  { key: 'edge', label: 'Edges' },
];

/**
 * Styles the runtime resolves for a plain step, note, group and edge, with or without the
 * diagram's defaults. Read from the runtime model of a small probe document, so the GUI
 * never restates the runtime's default values.
 */
export function resolvedDefaults(diagramStyle) {
  const probe = {
    version: 1,
    diagram: { name: 'probe', ...(diagramStyle ? { style: diagramStyle } : {}) },
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'n', type: 'note', attachTo: 'a' }],
    edges: [{ from: 'a', to: 'b' }],
    groups: [{ id: 'g', members: ['b'] }],
  };
  try {
    const m = validateDocument(probe);
    return { node: m.nodes[0].style, note: m.nodes[2].style, group: m.groups[0].style, edge: m.edges[0].style };
  } catch {
    return diagramStyle ? resolvedDefaults() : {};
  }
}

export const QUICK_STYLES = {
  node: [
    { name: 'Blue', style: { fillColor: '#dcebfa', borderColor: '#385a7c' } },
    { name: 'Green', style: { fillColor: '#eaf7ee', borderColor: '#3b7a57' } },
    { name: 'Amber', style: { fillColor: '#fff4d6', borderColor: '#d48a00' } },
    { name: 'Purple', style: { fillColor: '#e8d9f5', borderColor: '#7b1fa2' } },
    { name: 'Red', style: { fillColor: '#fde8e8', borderColor: '#b42318' } },
    { name: 'Outline', style: { fillColor: '#ffffff', borderColor: '#52606d', borderStyle: 'dashed' } },
  ],
  edge: [
    { name: 'Dashed', style: { lineStyle: 'dashed' } },
    { name: 'Emphasis', style: { strokeColor: '#b42318', strokeWidth: 2 } },
    { name: 'Muted', style: { strokeColor: '#9aa5b1' } },
  ],
};
QUICK_STYLES.group = QUICK_STYLES.node;
QUICK_STYLES.state = QUICK_STYLES.node;

/** Colors already used in the document first, then a small neutral palette. */
export function documentColors(doc, limit = 14) {
  const seen = new Set();
  const visit = (style) => {
    for (const [k, v] of Object.entries(style ?? {})) if ((k.endsWith('Color') || k === 'color') && typeof v === 'string' && v !== 'transparent') seen.add(v.toLowerCase());
  };
  for (const s of Object.values(doc.diagram?.style ?? {})) visit(s);
  for (const key of ['nodes', 'edges', 'groups', 'states', 'transitions']) for (const item of doc[key] ?? []) visit(item.style);
  for (const c of ['#243b53', '#52606d', '#eaf2ff', '#dcebfa', '#eaf7ee', '#fff4d6', '#e8d9f5', '#fde8e8', '#ffffff']) seen.add(c);
  return [...seen].slice(0, limit);
}
