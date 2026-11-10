import { groupType } from './group-type.js';
import { createConnectionContext, boundaryGroups, receivingFaceKey } from './connectivity.js';
import {
  parseStyle,
  resolveModuleStyle,
  resolveGroupStyle,
  resolvePortStyle,
  connectionStyle,
  TEXT_STYLE,
  CONNECTION_LABEL_STYLE,
} from './styles.js';
import { endpointKey } from './endpoints.js';
import { targetEntries, targetEndpoint } from './nets.js';
import { parseAppearance } from './appearances.js';
import { parseGrid } from './grid.js';

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
    if (
      (cp < 32 && !(multiline && cp === 10)) ||
      (cp >= 0xd800 && cp <= 0xdfff) ||
      cp === 0xfffe ||
      cp === 0xffff ||
      cp === 0x2028 ||
      cp === 0x2029
    ) {
      fail(
        multiline ? 'Expected XML-compatible display text' : 'Expected single-line XML-compatible text',
        path,
      );
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
  if (!Array.isArray(value) || value.length < minimum)
    fail(`Expected array with at least ${minimum} item(s)`, path);
}

function positive(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    fail('Expected a finite positive number', path);
  return value;
}

/** Validate parsed JSON and return independently owned, normalized data. */
export function createDiagramModel(input) {
  object(input, ['version', 'diagram', 'modules', 'connections', 'groups', 'terminals', 'layout'], '');
  if (input.version !== 1) fail('Only version 1 is supported', 'version');
  object(input.diagram, ['name', 'style', 'caption'], 'diagram');
  const diagram = {
    name: text(input.diagram.name, 'diagram.name'),
    ...(own(input.diagram, 'caption')
      ? { caption: text(input.diagram.caption, 'diagram.caption', true) }
      : {}),
    style: own(input.diagram, 'style')
      ? parseStyle(input.diagram.style, 'diagram', 'diagram.style', fail)
      : {},
  };
  array(input.modules, 'modules', Array.isArray(input.groups) && input.groups.length ? 0 : 1);
  const moduleIds = new Set();
  function parsePorts(rawPorts, path, style) {
    const portIds = new Set();
    const counts = { input: 0, output: 0, inout: 0 };
    return rawPorts.map((port, j) => {
      const pp = `${path}[${j}]`;
      object(port, ['id', 'label', 'direction', 'width', 'style', 'side'], pp);
      const portId = id(port.id, `${pp}.id`);
      if (portIds.has(portId)) fail('Duplicate port ID', `${pp}.id`);
      portIds.add(portId);
      if (!['input', 'output', 'inout'].includes(port.direction))
        fail('Unsupported port direction', `${pp}.direction`);
      if (own(port, 'side') && !['left', 'right', 'top', 'bottom'].includes(port.side))
        fail('Expected left, right, top or bottom', pp + '.side');
      const portStyle = own(port, 'style') ? parseStyle(port.style, 'text', `${pp}.style`, fail) : {};
      const width = own(port, 'width') ? port.width : null;
      if (own(port, 'width') && (!Number.isSafeInteger(width) || width <= 0))
        fail('Expected a positive safe integer', `${pp}.width`);
      const label = own(port, 'label') ? text(port.label, `${pp}.label`, true) : portId;
      const result = {
        id: portId,
        direction: port.direction,
        width,
        displayName: width > 1 ? `${label}[${width - 1}:0]` : label,
        side: own(port, 'side')
          ? port.side
          : input.layout?.direction === 'down'
            ? port.direction === 'input'
              ? 'top'
              : 'bottom'
            : port.direction === 'input'
              ? 'left'
              : 'right',
        order: counts[port.direction]++,
        style: resolvePortStyle(diagram.style.module, style, { direction: port.direction, style: portStyle }),
      };
      return result;
    });
  }
  const modules = input.modules.map((module, i) => {
    const path = `modules[${i}]`;
    object(module, ['id', 'label', 'ports', 'style', 'width', 'height', 'appearance', 'type'], path);
    const type = module.type ?? 'block';
    if (own(module, 'type') && !['block', 'concat'].includes(module.type))
      fail('Expected block or concat', `${path}.type`);
    const style = own(module, 'style') ? parseStyle(module.style, 'module', `${path}.style`, fail) : {};
    const moduleId = id(module.id, `${path}.id`);
    if (moduleIds.has(moduleId)) fail('Duplicate module ID', `${path}.id`);
    moduleIds.add(moduleId);
    const label = own(module, 'label') ? text(module.label, `${path}.label`, true) : moduleId;
    if (own(module, 'ports')) array(module.ports, `${path}.ports`);
    const ports = parsePorts(module.ports ?? [], `${path}.ports`, style);
    if (type === 'concat') {
      const inputs = ports.filter((p) => p.direction === 'input'),
        outputs = ports.filter((p) => p.direction === 'output');
      if (ports.some((p) => p.direction === 'inout'))
        fail('Concat cannot have bidirectional ports', path + '.ports');
      if (!inputs.length || outputs.length !== 1)
        fail('Concat requires at least one input and exactly one output', `${path}.ports`);
      if (ports.every((p) => p.width !== null)) {
        const sum = inputs.reduce((total, p) => total + BigInt(p.width), 0n);
        if (sum !== BigInt(outputs[0].width))
          fail('Concat output width must equal the sum of all input widths', `${path}.ports`);
      }
    }
    return {
      id: moduleId,
      label,
      ports,
      ...(own(module, 'type') ? { type } : {}),
      ...(own(module, 'appearance')
        ? { appearance: parseAppearance(module.appearance, `${path}.appearance`, fail) }
        : {}),
      ...(own(module, 'width') ? { width: positive(module.width, `${path}.width`) } : {}),
      ...(own(module, 'height') ? { height: positive(module.height, `${path}.height`) } : {}),
      style: resolveModuleStyle(diagram.style.module, style),
    };
  });

  const rawGroups = own(input, 'groups') ? input.groups : [];
  array(rawGroups, 'groups');
  const groupIds = new Set();
  for (const [i, group] of rawGroups.entries()) {
    object(
      group,
      ['id', 'label', 'members', 'style', 'type', 'ports', 'collapsed', 'width', 'height', 'layout'],
      `groups[${i}]`,
    );
    const key = id(group.id, `groups[${i}].id`);
    if (moduleIds.has(key) || groupIds.has(key))
      fail('Group ID must be unique across blocks and groups', `groups[${i}].id`);
    groupIds.add(key);
  }
  const grouped = new Set();
  const groups = rawGroups.map((group, i) => {
    const path = `groups[${i}]`;
    object(
      group,
      ['id', 'label', 'members', 'style', 'type', 'ports', 'collapsed', 'width', 'height', 'layout'],
      path,
    );
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
    const type = own(group, 'type') ? group.type : 'container';
    if (!['container', 'boundary', 'collection'].includes(type))
      fail('Expected container, boundary or collection group type', `${path}.type`);
    const collapsed = own(group, 'collapsed') ? group.collapsed : false;
    if (typeof collapsed !== 'boolean') fail('Expected a boolean', `${path}.collapsed`);
    if (collapsed && type === 'container')
      fail('Only boundary or collection groups may hide contents', `${path}.collapsed`);
    const rawPorts = own(group, 'ports') ? group.ports : [];
    array(rawPorts, `${path}.ports`);
    const ports = parsePorts(rawPorts, `${path}.ports`, style);
    return {
      id: groupId,
      label: own(group, 'label') ? text(group.label, `${path}.label`, true) : groupId,
      members,
      type,
      portMode: type === 'boundary' ? 'boundary' : 'direct',
      ports,
      collapsed,
      ...(type === 'collection' ? { portLabelStyle: style } : {}),
      ...(own(group, 'width') ? { width: positive(group.width, `${path}.width`) } : {}),
      ...(own(group, 'height') ? { height: positive(group.height, `${path}.height`) } : {}),
      style: resolveGroupStyle(style),
    };
  });

  const parents = new Map(groups.flatMap((group) => group.members.map((member) => [member, group.id])));
  for (const [i, group] of groups.entries()) {
    const seen = new Set();
    for (let key = group.id; key; key = parents.get(key)) {
      if (seen.has(key)) fail('Group hierarchy contains a cycle', `groups[${i}].members`);
      seen.add(key);
    }
  }
  const rawTerminals = own(input, 'terminals') ? input.terminals : [];
  array(rawTerminals, 'terminals');
  const terminalIds = new Set();
  const terminalOrders = { input: 0, output: 0 };
  const terminals = rawTerminals.map((item, i) => {
    const path = `terminals[${i}]`;
    object(item, ['id', 'direction', 'label', 'width', 'style'], path);
    const key = id(item.id, `${path}.id`);
    if (moduleIds.has(key) || groupIds.has(key) || terminalIds.has(key))
      fail('Terminal ID must be unique across blocks, groups and terminals', `${path}.id`);
    terminalIds.add(key);
    if (!['input', 'output'].includes(item.direction))
      fail('Unsupported terminal direction', `${path}.direction`);
    const width = own(item, 'width') ? item.width : null;
    if (own(item, 'width') && (!Number.isSafeInteger(width) || width <= 0))
      fail('Expected a positive safe integer', `${path}.width`);
    const label = own(item, 'label') ? text(item.label, `${path}.label`, true) : key;
    const style = own(item, 'style') ? parseStyle(item.style, 'text', `${path}.style`, fail) : {};
    return {
      id: key,
      direction: item.direction,
      label,
      displayName: width > 1 ? `${label}[${width - 1}:0]` : label,
      width,
      order: terminalOrders[item.direction]++,
      style: { ...TEXT_STYLE, ...style },
    };
  });
  const rawConnections = own(input, 'connections') ? input.connections : [];
  array(rawConnections, 'connections');
  const pairs = new Set(),
    drivers = new Map(),
    sources = new Map(),
    netIds = new Set(),
    bidirectionalPorts = new Map();
  const context = createConnectionContext({ modules, groups, terminals });
  const hasBoundary = boundaryGroups({ groups }).length > 0;
  const connections = rawConnections.flatMap((connection, i) => {
    const path = `connections[${i}]`;
    object(connection, ['id', 'from', 'to', 'feedback', 'label', 'style', 'direction', 'constraint'], path);
    array(connection.to, path + '.to', 1);
    const netId = own(connection, 'id') ? id(connection.id, path + '.id') : `connection_${i}`;
    if (netIds.has(netId)) fail('Duplicate connection ID', path + '.id');
    netIds.add(netId);
    const entries = targetEntries(connection);
    if (!entries.length) fail('Net requires at least one target', path + '.to');
    const style = own(connection, 'style')
      ? parseStyle(connection.style, 'connection', path + '.style', fail)
      : {};
    const direction = connection.direction ?? 'forward';
    if (own(connection, 'direction') && !['forward', 'both'].includes(connection.direction))
      fail('Expected forward or both', path + '.direction');
    const label = own(connection, 'label') ? text(connection.label, path + '.label', true) : undefined;
    const occupied = new Set(),
      knownWidths = new Set();
    let mainFace;
    const branches = entries.map((entry, j) => {
      const bp = `${path}.to[${j}]`;
      const expanded = entry && typeof entry === 'object' && own(entry, 'endpoint');
      if (expanded) object(entry, ['endpoint', 'constraint', 'feedback', 'style'], bp);
      const target = targetEndpoint(entry),
        key = endpointKey(target);
      if (key === endpointKey(connection.from)) fail('Target must differ from the main endpoint', bp);
      if (occupied.has(key)) fail('Duplicate net target', bp);
      occupied.add(key);
      const resolved = context.resolve(connection.from, target, direction);
      if (resolved.error) fail(resolved.error, resolved.field === 'from' ? path + '.from' : bp);
      const { source, target: destination } = resolved;
      for (const end of [source, destination])
        if (end.port.width !== null && end.port.width !== undefined) knownWidths.add(end.port.width);
      const pair = endpointKey(connection.from) + '->' + key;
      if (pairs.has(pair)) fail('Duplicate connection', bp);
      pairs.add(pair);
      const sourceFace = receivingFaceKey(source),
        targetFace = receivingFaceKey(destination);
      if (mainFace !== undefined && mainFace !== sourceFace)
        fail('Use separate Nets for inside and outside boundary-port faces', bp);
      mainFace = sourceFace;
      for (const face of [sourceFace, targetFace])
        if (bidirectionalPorts.has(face) && bidirectionalPorts.get(face) !== netId)
          fail('Port already has a driver or belongs to another net', bp);
      if (direction === 'both') {
        if (sources.has(targetFace) && sources.get(targetFace).id !== netId)
          fail('Port already has a driver or belongs to another net', bp);
        bidirectionalPorts.set(sourceFace, netId);
        bidirectionalPorts.set(targetFace, netId);
      }
      const previous = sources.get(sourceFace);
      if (previous && previous.id !== netId)
        fail('Source already belongs to another net; add its target to that net', path + '.from');
      sources.set(sourceFace, { id: netId });
      if (drivers.has(targetFace) && drivers.get(targetFace) !== netId)
        fail('Input already has a driver', bp);
      if (direction === 'both' && drivers.has(sourceFace) && drivers.get(sourceFace) !== netId)
        fail('Port already has a driver or belongs to another net', path + '.from');
      if (source.port.direction === 'inout' && drivers.has(sourceFace) && drivers.get(sourceFace) !== netId)
        fail('Port already has a driver or belongs to another net', path + '.from');
      drivers.set(targetFace, netId);
      if (direction === 'both') drivers.set(sourceFace, netId);
      const branchStyle =
        expanded && own(entry, 'style') ? parseStyle(entry.style, 'connection', bp + '.style', fail) : {};
      if (own(branchStyle, 'label'))
        fail('Net label styles belong to the whole connection', bp + '.style.label');
      if (own(branchStyle, 'startArrow'))
        fail('Net source arrow belongs to the whole connection', bp + '.style.startArrow');
      const feedback =
        expanded && own(entry, 'feedback')
          ? entry.feedback
          : own(connection, 'feedback')
            ? connection.feedback
            : false;
      const constraint =
        expanded && own(entry, 'constraint')
          ? entry.constraint
          : own(connection, 'constraint')
            ? connection.constraint
            : true;
      if (typeof feedback !== 'boolean') fail('Expected a boolean', path + '.feedback');
      if (typeof constraint !== 'boolean') fail('Expected a boolean', path + '.constraint');
      const width = source.port.width ?? destination.port.width;
      const sharedStyle = {
        ...connectionStyle(width),
        endArrow: 'triangle',
        ...(direction === 'both' ? { startArrow: 'triangle', endArrow: 'triangle' } : {}),
        ...diagram.style.connection,
        ...style,
        ...(label !== undefined || diagram.style.connection?.label || style.label
          ? { label: { ...CONNECTION_LABEL_STYLE, ...diagram.style.connection?.label, ...style.label } }
          : {}),
      };
      return {
        ...(label !== undefined ? { label } : {}),
        id: entries.length === 1 ? `connection_${i}` : `connection_${i}_branch_${j}`,
        source: source.ref,
        target: destination.ref,
        width,
        feedback,
        netId,
        connectionIndex: i,
        branchIndex: j,
        netStyle: sharedStyle,
        ...(own(connection, 'direction') ? { direction } : {}),
        ...(own(connection, 'constraint') || (expanded && own(entry, 'constraint')) ? { constraint } : {}),
        ...(hasBoundary
          ? {
              scope: resolved.scope,
              boundaryScoped: resolved.boundaryScoped,
              insideSelfLoop: resolved.insideSelfLoop,
            }
          : {}),
        style: { ...sharedStyle, ...branchStyle },
      };
    });
    if (knownWidths.size > 1) fail('Connection width mismatch', path + '.to');
    if (knownWidths.size)
      for (const [j, branch] of branches.entries()) {
        branch.width = [...knownWidths][0];
        if (diagram.style.connection?.strokeWidth === undefined && style.strokeWidth === undefined) {
          branch.netStyle.strokeWidth = connectionStyle(branch.width).strokeWidth;
          if (entries[j]?.style?.strokeWidth === undefined)
            branch.style.strokeWidth = branch.netStyle.strokeWidth;
        }
      }
    return branches;
  });

  const rawLayout = own(input, 'layout') ? input.layout : {};
  object(
    rawLayout,
    [
      'direction',
      'routing',
      'placement',
      'feedbackRouting',
      'feedbackSide',
      'feedbackMargin',
      'feedbackLaneSpacing',
      'moduleSpacing',
      'layerSpacing',
      'portAdjustment',
      'maxPortShift',
      'type',
      'cells',
      'rowGap',
      'columnGap',
      'expandGroups',
    ],
    'layout',
  );
  const option = (key, fallback) => (own(rawLayout, key) ? rawLayout[key] : fallback);
  const direction = option('direction', 'right');
  const routing = option('routing', 'orthogonal');
  const placement = option('placement', 'default');
  if (!['fixed', 'reduce-bends'].includes(option('portAdjustment', 'reduce-bends')))
    fail('Expected fixed or reduce-bends', 'layout.portAdjustment');
  const maxPortShift = option('maxPortShift', 40);
  if (typeof maxPortShift !== 'number' || !Number.isFinite(maxPortShift) || maxPortShift < 0)
    fail('Expected a finite non-negative shift', 'layout.maxPortShift');
  const feedbackRouting = option('feedbackRouting', 'elk');
  const feedbackSide = option('feedbackSide', 'auto');
  if (!['auto', 'top', 'bottom', 'left', 'right'].includes(feedbackSide))
    fail('Expected auto, top, bottom, left or right feedback side', 'layout.feedbackSide');
  if (!['right', 'down'].includes(direction)) fail('Unsupported layout direction', 'layout.direction');
  if (routing !== 'orthogonal') fail('Unsupported routing', 'layout.routing');
  if (!['default', 'relaxed', 'simple'].includes(placement))
    fail('Unsupported placement strategy', 'layout.placement');
  if (!['elk', 'outer'].includes(feedbackRouting))
    fail('Unsupported feedback routing', 'layout.feedbackRouting');
  if (feedbackRouting === 'outer' && !['right', 'down'].includes(direction))
    fail('Outer feedback routing requires right or down direction', 'layout.direction');
  if (
    feedbackSide !== 'auto' &&
    !(direction === 'down' ? ['left', 'right'] : ['top', 'bottom']).includes(feedbackSide)
  )
    fail('Feedback side does not match flow direction', 'layout.feedbackSide');
  const members = new Set(groups.flatMap((g) => g.members));
  const rootGrid = parseGrid(
    rawLayout,
    [...modules, ...groups].filter((n) => !members.has(n.id)).map((n) => n.id),
    'layout',
    fail,
    true,
    groups,
  );
  for (const [i, group] of groups.entries())
    if (own(input.groups[i], 'layout'))
      group.layout = parseGrid(
        input.groups[i].layout,
        group.members,
        `groups[${i}].layout`,
        fail,
        false,
        groups,
      );
  return {
    version: 1,
    diagram,
    modules,
    connections,
    groups,
    ...(terminals.length ? { terminals } : {}),
    layout: {
      direction,
      routing,
      placement,
      feedbackRouting,
      feedbackSide,
      ...(rootGrid.type === 'grid' ? rootGrid : own(rawLayout, 'type') ? { type: 'auto' } : {}),
      feedbackMargin: positive(option('feedbackMargin', 20), 'layout.feedbackMargin'),
      feedbackLaneSpacing: positive(option('feedbackLaneSpacing', 12), 'layout.feedbackLaneSpacing'),
      moduleSpacing: positive(option('moduleSpacing', 50), 'layout.moduleSpacing'),
      layerSpacing: positive(option('layerSpacing', 80), 'layout.layerSpacing'),
      ...(own(rawLayout, 'portAdjustment') ? { portAdjustment: rawLayout.portAdjustment } : {}),
      ...(own(rawLayout, 'maxPortShift') ? { maxPortShift } : {}),
    },
  };
}
