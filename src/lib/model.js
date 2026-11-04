import { groupType } from './group-type.js';
import { createConnectionContext, boundaryGroups } from './connectivity.js';
import { parseStyle, resolveModuleStyle, resolvePortStyle, connectionStyle, TEXT_STYLE } from './styles.js';

const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
const own = (value, key) => Object.hasOwn(value, key);

export class DiagramValidationError extends Error {
  constructor(message, path) {
    super(message);
    this.name = 'DiagramValidationError';
    this.path = path;
  }
}

function fail(message, path) {
  throw new DiagramValidationError(message, path);
}

function object(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('Expected an object', path);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`Unsupported property: ${key}`, path ? `${path}.${key}` : key);
  }
}

function text(value, path, multiline = false) {
  if (typeof value !== 'string' || !value.trim()) fail('Expected a non-empty string', path);
  if (multiline) value = value.replace(/\r\n/g, '\n');
  for (const char of value) {
    const cp = char.codePointAt(0);
    if ((cp < 32 && !(multiline && cp === 10)) || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfffe || cp === 0xffff || cp === 0x2028 || cp === 0x2029) {
      fail(multiline ? 'Expected XML-compatible display text' : 'Expected single-line XML-compatible text', path);
    }
  }
  return value;
}

// Shared with editor draft validation; not an additional public package entry.
export function normalizeDisplayText(value, path = 'label') {
  return text(value, path, true);
}

function id(value, path) {
  if (typeof value !== 'string' || ID.exec(value)?.[0] !== value) fail('Invalid ID', path);
  return value;
}

function array(value, path, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum) fail(`Expected array with at least ${minimum} item(s)`, path);
}

function positive(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail('Expected a finite positive number', path);
  return value;
}

/** Validate parsed JSON and return independently owned, normalized data. */
export function createDiagramModel(input) {
  object(input, ['version', 'diagram', 'modules', 'connections', 'groups', 'layout'], '');
  if (input.version !== 1) fail('Only version 1 is supported', 'version');
  object(input.diagram, ['name', 'style'], 'diagram');
  const diagram = {
    name: text(input.diagram.name, 'diagram.name'),
    style: own(input.diagram, 'style') ? parseStyle(input.diagram.style, 'diagram', 'diagram.style', fail) : {},
  };
  array(input.modules, 'modules', Array.isArray(input.groups) && input.groups.length ? 0 : 1);
  const moduleIds = new Set();
  function parsePorts(rawPorts, path, style) {
    const portIds = new Set();
    const counts = { input: 0, output: 0 };
    return rawPorts.map((port, j) => {
      const pp = `${path}[${j}]`;
      object(port, ['id', 'label', 'direction', 'width', 'style'], pp);
      const portId = id(port.id, `${pp}.id`);
      if (portIds.has(portId)) fail('Duplicate port ID', `${pp}.id`);
      portIds.add(portId);
      if (!['input', 'output'].includes(port.direction)) fail('Unsupported port direction', `${pp}.direction`);
      const portStyle = own(port, 'style') ? parseStyle(port.style, 'text', `${pp}.style`, fail) : {};
      const width = own(port, 'width') ? port.width : null;
      if (own(port, 'width') && (!Number.isSafeInteger(width) || width <= 0)) fail('Expected a positive safe integer', `${pp}.width`);
      const label = own(port, 'label') ? text(port.label, `${pp}.label`, true) : portId;
      const result = {
        id: portId, direction: port.direction, width,
        displayName: width > 1 ? `${label}[${width - 1}:0]` : label,
        side: port.direction === 'input' ? 'left' : 'right',
        order: counts[port.direction]++,
        style: resolvePortStyle(diagram.style.module, style, { direction: port.direction, style: portStyle }),
      };
      return result;
    });
  }
  const modules = input.modules.map((module, i) => {
    const path = `modules[${i}]`;
    object(module, ['id', 'label', 'ports', 'style', 'width', 'height'], path);
    const style = own(module, 'style') ? parseStyle(module.style, 'module', `${path}.style`, fail) : {};
    const moduleId = id(module.id, `${path}.id`);
    if (moduleIds.has(moduleId)) fail('Duplicate module ID', `${path}.id`);
    moduleIds.add(moduleId);
    const label = own(module, 'label') ? text(module.label, `${path}.label`, true) : moduleId;
    array(module.ports, `${path}.ports`, 1);
    const ports = parsePorts(module.ports, `${path}.ports`, style);
    return { id: moduleId, label, ports,
      ...(own(module, 'width') ? { width: positive(module.width, `${path}.width`) } : {}),
      ...(own(module, 'height') ? { height: positive(module.height, `${path}.height`) } : {}),
      style: resolveModuleStyle(diagram.style.module, style) };
  });

  const rawGroups = own(input, 'groups') ? input.groups : [];
  array(rawGroups, 'groups');
  const groupIds = new Set();
  for (const [i, group] of rawGroups.entries()) {
    object(group, ['id', 'label', 'members', 'style', 'portMode', 'type', 'ports', 'collapsed', 'width', 'height'], `groups[${i}]`);
    const key = id(group.id, `groups[${i}].id`);
    if (moduleIds.has(key) || groupIds.has(key)) fail('Group ID must be unique across blocks and groups', `groups[${i}].id`);
    groupIds.add(key);
  }
  const grouped = new Set();
  const groups = rawGroups.map((group, i) => {
    const path = `groups[${i}]`;
    object(group, ['id', 'label', 'members', 'style', 'portMode', 'type', 'ports', 'collapsed', 'width', 'height'], path);
    const groupId = id(group.id, `${path}.id`);

    array(group.members, `${path}.members`);
    const members = group.members.map((member, j) => {
      const mp = `${path}.members[${j}]`;
      if (!moduleIds.has(member) && !groupIds.has(member)) fail('Unknown group member: ' + member, mp);
      if (grouped.has(member)) fail('An item may belong to only one group', mp);
      grouped.add(member);
      return member;
    });
    const style = own(group, 'style') ? parseStyle(group.style, 'group', `${path}.style`, fail) : {};
    const portMode=own(group,'portMode')?group.portMode:'direct';
    if (!['direct','boundary'].includes(portMode)) fail('Expected direct or boundary port mode',`${path}.portMode`);
    const type=own(group,'type')?group.type:groupType(group);
    if(!['container','boundary','collection'].includes(type)) fail('Expected container, boundary or collection group type',`${path}.type`);
    if(own(group,'type')&&own(group,'portMode')&&((type==='boundary')!==(portMode==='boundary'))) fail('Conflicting group type and portMode',`${path}.type`);
    const collapsed=own(group,'collapsed')?group.collapsed:false;
    if(typeof collapsed!=='boolean') fail('Expected a boolean',`${path}.collapsed`);
    if(collapsed&&type==='container') fail('Only boundary or collection groups may hide contents',`${path}.collapsed`);
    const rawPorts=own(group,'ports')?group.ports:[];array(rawPorts,`${path}.ports`);
    const ports=parsePorts(rawPorts,`${path}.ports`,style);
    return { id: groupId, label: own(group, 'label') ? text(group.label, `${path}.label`, true) : groupId,
      members, type, portMode:type==='boundary'?'boundary':'direct', ports, collapsed,
      ...(type==='collection'?{portLabelStyle:style}:{}),
      ...(own(group,'width')?{width:positive(group.width,`${path}.width`)}:{}),
      ...(own(group,'height')?{height:positive(group.height,`${path}.height`)}:{}),
      style: resolveModuleStyle({}, { borderColor: '#8793a5', borderStyle: 'dashed', fillColor: '#f7f9fc', ...style }) };
  });

  const parents = new Map(groups.flatMap(group => group.members.map(member => [member, group.id])));
  for (const [i, group] of groups.entries()) {
    const seen = new Set();
    for (let key = group.id; key; key = parents.get(key)) {
      if (seen.has(key)) fail('Group hierarchy contains a cycle', `groups[${i}].members`);
      seen.add(key);
    }
  }
  const rawConnections = own(input, 'connections') ? input.connections : [];
  array(rawConnections, 'connections');
  const pairs = new Set();
  const drivers = new Set();
  const context=createConnectionContext({modules,groups});
  const hasBoundary=boundaryGroups({groups}).length>0;
  const connections = rawConnections.map((connection, i) => {
    const path = `connections[${i}]`;
    object(connection, ['from', 'to', 'feedback', 'label', 'style'], path);
    const style = own(connection, 'style') ? parseStyle(connection.style, 'connection', `${path}.style`, fail) : {};
    const resolved=context.resolve(connection.from,connection.to);
    if(resolved.error) fail(resolved.error, `${path}.${resolved.field}`);
    const {source,target}=resolved;
    if (source.port.width !== null && target.port.width !== null && source.port.width !== target.port.width) fail('Connection width mismatch', `${path}.to`);
    const width = source.port.width ?? target.port.width;
    const pair = `${connection.from}->${connection.to}`;
    if (pairs.has(pair)) fail('Duplicate connection', path);
    if (drivers.has(connection.to)) fail('Input already has a driver', `${path}.to`);
    pairs.add(pair);
    drivers.add(connection.to);
    const feedback = own(connection, 'feedback') ? connection.feedback : false;
    if (typeof feedback !== 'boolean') fail('Expected a boolean', `${path}.feedback`);
    return {
      ...(own(connection, 'label') ? { label: text(connection.label, `${path}.label`, true) } : {}),
      id: `connection_${i}`, source: source.ref, target: target.ref, width, feedback,
      ...(hasBoundary ? {scope:resolved.scope,boundaryScoped:resolved.boundaryScoped,insideSelfLoop:resolved.insideSelfLoop} : {}),
      style: { ...connectionStyle(width), ...diagram.style.connection, ...style,
        ...(own(connection, 'label') || diagram.style.connection?.label || style.label ? { label: { ...TEXT_STYLE, ...diagram.style.connection?.label, ...style.label } } : {}),
      },
    };
  });

  const rawLayout = own(input, 'layout') ? input.layout : {};
  object(rawLayout, ['direction', 'routing', 'placement', 'feedbackRouting', 'feedbackMargin', 'feedbackLaneSpacing', 'moduleSpacing', 'layerSpacing'], 'layout');
  const option = (key, fallback) => own(rawLayout, key) ? rawLayout[key] : fallback;
  const direction = option('direction', 'right');
  const routing = option('routing', 'orthogonal');
  const placement = option('placement', 'default');
  const feedbackRouting = option('feedbackRouting', 'elk');
  if (!['right', 'left'].includes(direction)) fail('Unsupported layout direction', 'layout.direction');
  if (routing !== 'orthogonal') fail('Unsupported routing', 'layout.routing');
  if (!['default', 'relaxed', 'simple'].includes(placement)) fail('Unsupported placement strategy', 'layout.placement');
  if (!['elk', 'outer'].includes(feedbackRouting)) fail('Unsupported feedback routing', 'layout.feedbackRouting');
  if (feedbackRouting === 'outer' && direction !== 'right') fail('Outer feedback routing requires right direction', 'layout.direction');
  return {
    version: 1, diagram, modules, connections, groups,
    layout: {
      direction, routing, placement, feedbackRouting,
      feedbackMargin: positive(option('feedbackMargin', 20), 'layout.feedbackMargin'),
      feedbackLaneSpacing: positive(option('feedbackLaneSpacing', 12), 'layout.feedbackLaneSpacing'),
      moduleSpacing: positive(option('moduleSpacing', 50), 'layout.moduleSpacing'),
      layerSpacing: positive(option('layerSpacing', 80), 'layout.layerSpacing'),
    },
  };
}
