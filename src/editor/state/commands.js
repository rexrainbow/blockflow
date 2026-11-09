import { groupType } from '../../lib/group-type.js';
import {
  portOwner,
  boundaryGroups,
  boundaryConnectionProblems,
  createConnectionContext,
} from '../../lib/connectivity.js';
export { portOwner } from '../../lib/connectivity.js';
import { parentOf, canPlace } from '../../lib/hierarchy.js';
import { createDiagramModel } from '../../lib/model.js';
import { endpointKey, endpointFromKey } from '../../lib/endpoints.js';

export function emptyDocument() {
  return {
    version: 1,
    diagram: { name: 'Untitled diagram' },
    modules: [],
    connections: [],
    layout: { direction: 'right' },
  };
}

export function connectionKey(connection) {
  return `${endpointKey(connection.from)}->${endpointKey(connection.to)}`;
}

export function saveTerminal(document, previous, terminal) {
  const candidate = structuredClone(document);
  const index = candidate.terminals?.findIndex((item) => item.id === previous) ?? -1;
  if (previous && index < 0) throw new Error('This terminal is no longer available.');
  if (index >= 0) candidate.terminals[index] = terminal;
  else {
    candidate.terminals ??= [];
    candidate.terminals.push(terminal);
  }
  if (previous && previous !== terminal.id)
    for (const edge of candidate.connections ?? [])
      for (const end of ['from', 'to'])
        if (edge[end]?.terminal === previous) edge[end] = { terminal: terminal.id };
  validateDocument(candidate);
  document.terminals = candidate.terminals;
  if (candidate.connections) document.connections = candidate.connections;
}

export function removeTerminal(document, id) {
  document.terminals = (document.terminals ?? []).filter((item) => item.id !== id);
  if (!document.terminals.length) delete document.terminals;
  document.connections = (document.connections ?? []).filter(
    (edge) => edge.from?.terminal !== id && edge.to?.terminal !== id,
  );
}

export function validateDocument(document) {
  // An empty editor document is supported without weakening the library schema.
  if (Array.isArray(document?.modules) && document.modules.length === 0 && !document.groups?.length) {
    return createDiagramModel({
      ...document,
      modules: [{ id: '_empty', ports: [{ id: 'in', direction: 'input' }] }],
    });
  }
  return createDiagramModel(document);
}

export function nextId(existing, prefix) {
  let n = 1;
  while (existing.some((item) => item.id === `${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

export function assertId(id, existing, previous) {
  if (typeof id !== 'string' || /^[A-Za-z_][A-Za-z0-9_]*$/.exec(id)?.[0] !== id)
    throw new Error('Use letters, digits or underscores; start with a letter or underscore.');
  if (existing.some((item) => item.id === id && item.id !== previous))
    throw new Error('This name already exists. Choose another name.');
}

export function addModule(document, type = 'block') {
  const id = nextId(
    [...document.modules, ...(document.groups ?? []), ...(document.terminals ?? [])],
    type === 'concat' ? 'concat' : 'block',
  );
  document.modules.push(
    type === 'concat'
      ? {
          id,
          type,
          label: 'Concat',
          ports: [
            { id: 'a', direction: 'input' },
            { id: 'b', direction: 'input' },
            { id: 'out', direction: 'output' },
          ],
          style: { label: { hidden: true }, portLabel: { hidden: true } },
        }
      : { id, ports: [] },
  );
  return id;
}

/** Preserve endpoint keys and materialize the current block appearance before changing kind. */
export function convertToBoundaryGroup(document, id) {
  const block = document.modules.find((module) => module.id === id);
  if (!block) throw new Error('This block is no longer available.');
  if (block.type === 'concat') throw new Error('Concat cannot be converted to a boundary group.');
  if (block.appearance && block.appearance.type !== 'rectangle')
    throw new Error('Choose Rectangle appearance before converting this block to a boundary group.');
  if ((document.groups ?? []).some((group) => group.id === id))
    throw new Error('This key is already used by a group.');
  if (!block.ports?.length) throw new Error('Add at least one port before converting this block.');
  const normalized = createDiagramModel({
    version: document.version,
    diagram: document.diagram,
    modules: [block],
  }).modules[0];
  const group = {
    ...structuredClone(block),
    members: [],
    type: 'boundary',
    collapsed: true,
    style: { ...structuredClone(block.style ?? {}), ...normalized.style },
  };
  delete group.appearance;
  const modules = document.modules.filter((module) => module !== block),
    groups = [...(document.groups ?? []), group];
  const problems = boundaryConnectionProblems({ ...document, modules, groups });
  if (problems.length) throw new Error(problems.join('\n'));
  document.modules = modules;
  document.groups = groups;
  return id;
}

export function renameModule(document, previous, value) {
  const requested = typeof value === 'string' ? value.trim() : value;
  assertId(requested, [], previous);
  const module = document.modules.find((item) => item.id === previous);
  if (!module) throw new Error('This block is no longer available.');
  const used = new Set(
    [
      ...document.modules.filter((item) => item.id !== previous),
      ...(document.groups ?? []),
      ...(document.terminals ?? []),
    ].map((item) => item.id),
  );
  let id = requested;
  let suffix = 2;
  while (used.has(id)) id = `${requested}_${suffix++}`;
  if (id !== previous) {
    module.id = id;
    for (const group of document.groups ?? [])
      group.members = group.members.map((member) => (member === previous ? id : member));
    const prefix = `${previous}.`;
    for (const connection of document.connections ?? []) {
      for (const end of ['from', 'to']) {
        if (typeof connection[end] === 'string' && connection[end].startsWith(prefix))
          connection[end] = id + connection[end].slice(previous.length);
      }
    }
  }
  return { id, requested, adjusted: id !== requested };
}

export function removeModule(document, id) {
  document.modules = document.modules.filter((module) => module.id !== id);
  for (const group of document.groups ?? []) group.members = group.members.filter((member) => member !== id);
  document.connections = (document.connections ?? []).filter(
    (c) => !endpointKey(c.from).startsWith(`${id}.`) && !endpointKey(c.to).startsWith(`${id}.`),
  );
}

export function addPort(module, direction) {
  if (
    module.type === 'concat' &&
    direction === 'output' &&
    module.ports.some((p) => p.direction === 'output')
  )
    throw new Error('Concat has exactly one output.');
  module.ports ??= [];
  const id = nextId(module.ports, direction === 'input' ? 'in' : 'out');
  module.ports.push({ id, direction });
  return id;
}

export function removePort(document, moduleId, portId) {
  const module = portOwner(document, moduleId);
  const port = module.ports.find((p) => p.id === portId);
  if (
    module.type === 'concat' &&
    port &&
    (port.direction === 'output' || module.ports.filter((p) => p.direction === 'input').length === 1)
  )
    throw new Error('Concat requires at least one input and exactly one output.');
  module.ports = module.ports.filter((port) => port.id !== portId);
  const ref = `${moduleId}.${portId}`;
  document.connections = (document.connections ?? []).filter((c) => c.from !== ref && c.to !== ref);
}

export function renamePort(document, moduleId, oldId, newId) {
  const module = portOwner(document, moduleId);
  const requested = typeof newId === 'string' ? newId.trim() : newId;
  assertId(requested, [], oldId);
  const port = module?.ports.find((port) => port.id === oldId);
  if (!port) throw new Error('This port is no longer available.');
  const used = new Set(module.ports.filter((port) => port.id !== oldId).map((port) => port.id));
  newId = requested;
  let suffix = 2;
  while (used.has(newId)) newId = `${requested}_${suffix++}`;
  port.id = newId;
  for (const connection of document.connections ?? []) {
    if (connection.from === `${moduleId}.${oldId}`) connection.from = `${moduleId}.${newId}`;
    if (connection.to === `${moduleId}.${oldId}`) connection.to = `${moduleId}.${newId}`;
  }
  return { id: newId, requested, adjusted: newId !== requested };
}

export function moveItem(array, from, to) {
  if (from < 0 || to < 0 || from >= array.length || to >= array.length || from === to) return;
  array.splice(to, 0, array.splice(from, 1)[0]);
}

export function movePort(module, direction, from, to) {
  const ports = module.ports.filter((port) => port.direction === direction);
  moveItem(ports, from, to);
  let index = 0;
  module.ports = module.ports.map((port) => (port.direction === direction ? ports[index++] : port));
}

export function endpoints(document, direction) {
  const ports = [...document.modules, ...boundaryGroups(document)].flatMap((owner) =>
    (owner.ports ?? [])
      .filter((port) => groupType(owner) === 'boundary' || port.direction === direction)
      .map((port) => ({
        ref: owner.id + '.' + port.id,
        label:
          owner.id +
          '.' +
          port.id +
          (groupType(owner) === 'boundary' ? ' [Group ' + port.direction + ']' : '') +
          (owner.label && owner.label !== owner.id ? ' — ' + owner.label.replace(/\s*\n\s*/g, ' / ') : ''),
        width: port.width ?? null,
      })),
  );
  return [
    ...ports,
    ...(document.terminals ?? [])
      .filter((item) => item.direction === (direction === 'output' ? 'input' : 'output'))
      .map((item) => ({
        ref: endpointKey({ terminal: item.id }),
        label: `External ${item.direction}: ${item.label ?? item.id} [${item.id}]`.replace(
          /\s*\r?\n\s*/g,
          ' / ',
        ),
        width: item.width ?? null,
      })),
  ];
}

export function targetReason(document, sourceRef, targetRef, excluding = -1) {
  sourceRef = typeof sourceRef === 'string' ? endpointFromKey(sourceRef) : sourceRef;
  targetRef = typeof targetRef === 'string' ? endpointFromKey(targetRef) : targetRef;
  const pair = createConnectionContext(document).resolve(sourceRef, targetRef);
  if (pair.error)
    return pair.error.startsWith('Unknown port') ? 'Select a valid source and target.' : pair.error;
  if (
    (document.connections ?? []).some(
      (edge, i) => i !== excluding && endpointKey(edge.to) === endpointKey(targetRef),
    )
  )
    return 'Input already connected';
  const a = pair.source.port.width ?? null,
    b = pair.target.port.width ?? null;
  if (a !== null && b !== null && a !== b) return 'Width mismatch';
  return '';
}

export function setGroupType(document, id, type) {
  if (!['container', 'boundary', 'collection'].includes(type))
    throw new Error('Choose Container, Boundary or Collection.');
  const group = document.groups?.find((group) => group.id === id);
  if (!group) throw new Error('This group is no longer available.');
  const candidate = { ...group, type, collapsed: type === 'container' ? false : Boolean(group.collapsed) };
  delete candidate.portMode;
  if (type === 'boundary') candidate.ports ??= [];
  const problems = boundaryConnectionProblems({
    ...document,
    groups: document.groups.map((item) => (item === group ? candidate : item)),
  });
  if (problems.length) {
    const error = new Error('Reconnect these connections before changing Group type.');
    error.problems = problems;
    throw error;
  }
  Object.assign(group, candidate);
  delete group.portMode;
}

// Compatibility for existing editor integrations; the GUI uses Group type.
export function setGroupPortMode(document, id, enabled) {
  const group = document.groups?.find((group) => group.id === id);
  if (!group) throw new Error('This group is no longer available.');
  if (!enabled && group.collapsed) throw new Error('Show contents before turning off Boundary ports.');
  setGroupType(document, id, enabled ? 'boundary' : 'container');
  delete group.type;
  group.portMode = enabled ? 'boundary' : 'direct';
}

export function setGroupCollapsed(document, id, collapsed) {
  const group = document.groups?.find((group) => group.id === id);
  if (!group) throw new Error('This group is no longer available.');
  if (typeof collapsed !== 'boolean') throw new Error('Hide contents must be a boolean.');
  if (collapsed && groupType(group) === 'container')
    throw new Error('Choose Boundary or Collection before hiding contents.');
  group.collapsed = collapsed;
}

function hierarchyEdit(document, change) {
  const modules = [...document.modules],
    groups = document.groups ? [...document.groups] : undefined;
  const members = new Map((groups ?? []).map((group) => [group, [...group.members]]));
  try {
    change();
    if (boundaryGroups(document).length) {
      const problems = boundaryConnectionProblems(document);
      if (problems.length) {
        const error = new Error(problems.join('\n'));
        error.problems = problems;
        throw error;
      }
    }
  } catch (error) {
    document.modules = modules;
    if (groups) document.groups = groups;
    else delete document.groups;
    for (const [group, items] of members) group.members = items;
    throw error;
  }
}

export function groupOf(document, id) {
  return parentOf(document, id);
}

export function addGroup(document, member, parent = member ? groupOf(document, member) : '') {
  const id = nextId(
    [...document.modules, ...(document.groups ?? []), ...(document.terminals ?? [])],
    'group',
  );
  document.groups ??= [];
  document.groups.push({ id, members: [] });
  if (parent) placeBlock(document, id, parent);
  if (member) placeBlock(document, member, id);
  return id;
}

export function removeGroup(document, id) {
  const removed = document.groups?.find((group) => group.id === id);
  if (!removed) return;
  if (
    (document.connections ?? []).some(
      (edge) => endpointKey(edge.from).startsWith(id + '.') || endpointKey(edge.to).startsWith(id + '.'),
    )
  )
    throw new Error('Disconnect group ' + id + ' ports before ungrouping.');
  hierarchyEdit(document, () => {
    const parent = document.groups.find((group) => group.members.includes(id));
    if (parent) parent.members.splice(parent.members.indexOf(id), 1, ...removed.members);
    document.groups = document.groups.filter((group) => group.id !== id);
    if (!document.groups.length) delete document.groups;
  });
}

export function placeBlock(document, id, groupId = '', targetId = null, before = true) {
  if (![...document.modules, ...(document.groups ?? [])].some((module) => module.id === id))
    throw new Error('This block is no longer available.');
  const group = groupId ? document.groups?.find((group) => group.id === groupId) : null;
  if (groupId && !group) throw new Error('This group is no longer available.');
  if (!canPlace(document, id, groupId)) throw new Error('A group cannot move into itself or a descendant.');
  if (targetId === id || (!targetId && groupOf(document, id) === groupId)) return;
  hierarchyEdit(document, () => {
    for (const item of document.groups ?? []) item.members = item.members.filter((member) => member !== id);
    if (group) {
      const target = targetId ? group.members.indexOf(targetId) : -1;
      group.members.splice(target < 0 ? group.members.length : target + (before ? 0 : 1), 0, id);
    } else if (targetId) {
      const list = document.modules.some((item) => item.id === id) ? document.modules : document.groups;
      const index = list.findIndex((item) => item.id === id);
      const [item] = list.splice(index, 1);
      const target = list.findIndex((item) => item.id === targetId);
      list.splice(target < 0 ? list.length : target + (before ? 0 : 1), 0, item);
    }
  });
}

export function moveBlock(document, id, offset) {
  const group = document.groups?.find((group) => group.members.includes(id));
  const siblings = group
    ? group.members
    : (document.modules.some((item) => item.id === id) ? document.modules : (document.groups ?? []))
        .filter((module) => !groupOf(document, module.id))
        .map((module) => module.id);
  const index = siblings.indexOf(id),
    target = siblings[index + offset];
  if (target) placeBlock(document, id, group?.id ?? '', target, offset < 0);
}
