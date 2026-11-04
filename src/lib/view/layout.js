import { parseStyle } from '../styles.js';
import { normalizeDisplayText } from '../model.js';

const fail = (message) => {
  throw new TypeError('Invalid DOM layout: ' + message);
};
const number = (value, name, positive = false) => {
  if (!Number.isFinite(value) || (positive && value <= 0)) fail(name);
};
const identifier = (value) => {
  if (typeof value !== 'string' || /^[A-Za-z_][A-Za-z0-9_]*$/.exec(value)?.[0] !== value) fail('ID');
};
function box(value, name) {
  if (!value) fail(name);
  for (const axis of ['x', 'y', 'width', 'height']) number(value[axis], name + '.' + axis);
  if (value.width < 0 || value.height < 0) fail(name + ' dimensions');
}
function label(value, position, bounds) {
  normalizeDisplayText(value);
  if (!position || !['start', 'middle', 'end'].includes(position.anchor)) fail('text position');
  number(position.x, 'text x');
  number(position.y, 'text y');
  box(bounds, 'text bounds');
}
const style = (value, kind) => parseStyle(value ?? {}, kind, 'style', fail);

/** Validate before converting SVG strings to live DOM; arbitrary SVG/HTML is not accepted. */
export function copyLayout(input) {
  const layout = structuredClone(input);
  if (!layout || typeof layout !== 'object') fail('object required');
  number(layout.width, 'width', true);
  number(layout.height, 'height', true);
  if (!Array.isArray(layout.modules) || !Array.isArray(layout.connections)) fail('modules/connections');
  const blocks = new Set(),
    ports = new Set(),
    connections = new Set();
  for (const node of [...layout.modules, ...(layout.groups ?? [])]) {
    identifier(node.id);
    if (blocks.has(node.id)) fail('duplicate block/group ID');
    blocks.add(node.id);
    box(node, 'block');
    label(node.label, node.labelPosition, node.labelBounds);
    style(node.style, layout.modules.includes(node) ? 'module' : 'group');
    if (node.stackLayers !== undefined) {
      if (!Number.isInteger(node.stackLayers) || node.stackLayers < 0 || node.stackLayers > 2)
        fail('stack layers');
      number(node.faceHeight, 'face height', true);
      if (node.faceHeight > node.height || node.stackLayers * 6 + node.faceHeight > node.height + 1e-6)
        fail('stack bounds');
    }
  }
  for (const node of [...layout.modules, ...(layout.groups ?? [])]) {
    if (node.ports === undefined && !layout.modules.includes(node)) continue;
    if (!Array.isArray(node.ports)) fail('ports');
    for (const port of node.ports) {
      identifier(port.id);
      const key = node.id + '.' + port.id;
      if (ports.has(key)) fail('duplicate port');
      ports.add(key);
      if (!['input', 'output'].includes(port.direction)) fail('port direction');
      number(port.x, 'port x');
      number(port.y, 'port y');
      label(port.displayName, port.labelPosition, port.labelBounds);
      style(port.style, 'text');
    }
  }
  const edgeKeys = new Set();
  for (const edge of layout.connections) {
    identifier(edge.id);
    if (connections.has(edge.id)) fail('duplicate connection ID');
    connections.add(edge.id);
    const key = connectionKey(edge);
    if (edgeKeys.has(key)) fail('duplicate connection key');
    edgeKeys.add(key);
    style(edge.style, 'connection');
    if (!Array.isArray(edge.sections) || !edge.sections.length) fail('edge sections');
    for (const section of edge.sections) {
      if (!Array.isArray(section.points) || section.points.length < 2) fail('route points');
      for (const point of section.points) {
        number(point.x, 'route x');
        number(point.y, 'route y');
      }
    }
    if (edge.label !== undefined) label(edge.label, edge.labelPosition, edge.labelBounds);
    if (edge.source || edge.target)
      for (const endpoint of [edge.source, edge.target]) {
        if (!endpoint) fail('edge endpoint');
        identifier(endpoint.moduleId);
        identifier(endpoint.portId);
      }
    if (edge.source || edge.target || edge.routingSource || edge.routingTarget)
      for (const endpoint of [edge.routingSource ?? edge.source, edge.routingTarget ?? edge.target]) {
        if (!endpoint || !ports.has(endpoint.moduleId + '.' + endpoint.portId)) fail('edge endpoint');
      }
  }
  return layout;
}

export const connectionKey = (edge) =>
  edge.source && edge.target
    ? `${edge.source.moduleId}.${edge.source.portId}->${edge.target.moduleId}.${edge.target.portId}`
    : edge.id;
export const routePath = (edge) =>
  edge.sections
    .map((section) => section.points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '))
    .join(' ');
export function routeBounds(edge) {
  const points = edge.sections.flatMap((section) => section.points);
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}
