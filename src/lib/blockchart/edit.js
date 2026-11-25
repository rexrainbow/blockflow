import { validateDiagram } from './model.js';
import { createConnectionContext, receivingFaceKey } from './connectivity.js';
import { ancestors, descendants } from './hierarchy.js';
import { endpointKey } from './endpoints.js';
import { pruneConnections, targetEndpoint } from './nets.js';
import { renameGridMember } from './grid.js';
import { documentDiff } from './edit-diff.js';
import { semanticDiff } from './edit-semantic-diff.js';
import { remapModules } from './edit-rename.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const ownerId = (ref) => (typeof ref === 'string' ? ref.split('.')[0] : ref.terminal);

function fields(value, allowed) {
  if (!object(value)) throw new Error('Expected an object');
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error('Unexpected field: ' + key);
}

function find(items, id, kind) {
  const match = items?.find((item) => item.id === id);
  if (!match) throw new Error('Unknown ' + kind + ' ID: ' + String(id));
  return match;
}

export function inspectDiagram(document, query) {
  fields(query, ['moduleId', 'groupId', 'recursive']);
  const group = Object.hasOwn(query, 'groupId');
  if (group === Object.hasOwn(query, 'moduleId')) throw new Error('Specify exactly one groupId or moduleId');
  if (Object.hasOwn(query, 'recursive') && (typeof query.recursive !== 'boolean' || !group))
    throw new Error('recursive requires a group query and a boolean');
  validateDiagram(document);
  const groups = document.groups ?? [];
  const selected = group
    ? find(groups, query.groupId, 'group')
    : find(document.modules, query.moduleId, 'module');
  const ids = new Set([selected.id]);
  if (group)
    for (const id of query.recursive ? descendants(document, selected.id) : selected.members) ids.add(id);
  const paths = new Map();
  function path(id) {
    if (!paths.has(id)) paths.set(id, ancestors(document, id));
    return paths.get(id);
  }
  const boundary = new Set(groups.filter((g) => g.type === 'boundary').map((g) => g.id));
  const branches = [];
  for (const { from, to, ...net } of document.connections ?? []) {
    for (const entry of to) {
      const end = targetEndpoint(entry);
      const sourceId = ownerId(from),
        targetId = ownerId(end);
      const outbound = ids.has(sourceId),
        inbound = ids.has(targetId);
      if (!outbound && !inbound) continue;
      // A boundary port is authored on the group itself.
      const fromPath = boundary.has(sourceId) ? [...path(sourceId), sourceId] : path(sourceId);
      const toPath = boundary.has(targetId) ? [...path(targetId), targetId] : path(targetId);
      const { endpoint, ...overrides } = Object.hasOwn(entry, 'endpoint') ? entry : {};
      branches.push({
        from,
        to: end,
        fromPath,
        toPath,
        relation: outbound && inbound ? 'internal' : outbound ? 'outgoing' : 'incoming',
        crossGroup: fromPath.length !== toPath.length || fromPath.some((id, i) => id !== toPath[i]),
        net,
        branch: overrides,
      });
    }
  }
  return structuredClone({
    id: selected.id,
    path: path(selected.id),
    modules: document.modules.filter((m) => ids.has(m.id)),
    groups: groups.filter((g) => g.id === selected.id || (query.recursive && ids.has(g.id))),
    branches,
  });
}

function mergeStyle(previous, patch) {
  if (!object(previous) || !object(patch)) return patch;
  return {
    ...previous,
    ...Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [
        key,
        mergeStyle(Object.hasOwn(previous, key) ? previous[key] : undefined, value),
      ]),
    ),
  };
}

function patchFields(item, patch, allowed) {
  fields(patch, allowed);
  for (const [key, value] of Object.entries(patch))
    item[key] = key === 'style' ? mergeStyle(item.style, value) : value;
}

function endpoint(value) {
  if (typeof value === 'string' && /^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(value)) return value;
  if (
    object(value) &&
    Object.keys(value).length === 1 &&
    typeof value.terminal === 'string' &&
    /^[A-Za-z_]\w*$/.test(value.terminal)
  )
    return value;
  throw new Error('Invalid endpoint: ' + JSON.stringify(value));
}

const branchFields = ['style', 'feedback', 'constraint'];
function netsFrom(doc, from) {
  const key = endpointKey(endpoint(from));
  return (doc.connections ?? []).filter((net) => endpointKey(net.from) === key);
}

function branchIndex(net, to) {
  const key = endpointKey(to);
  return net.to.findIndex((entry) => endpointKey(targetEndpoint(entry)) === key);
}

function updateNet(doc, op) {
  fields(op, ['op', 'id', 'from', 'to', 'patch']);
  let net;
  if (Object.hasOwn(op, 'id')) {
    if (typeof op.id !== 'string' || Object.hasOwn(op, 'from') || Object.hasOwn(op, 'to'))
      throw new Error('Select a Net by its authored ID or by endpoints');
    net = find(doc.connections, op.id, 'Net');
  } else {
    let matches = netsFrom(doc, op.from);
    if (Object.hasOwn(op, 'to')) {
      const to = endpoint(op.to);
      matches = matches.filter((n) => branchIndex(n, to) >= 0);
    }
    if (!matches.length) throw new Error('Net not found');
    if (matches.length > 1) throw new Error('Ambiguous source: specify a destination or a Net ID');
    [net] = matches;
  }
  patchFields(net, op.patch, ['label', 'style']);
}

function editBranch(doc, op) {
  const add = op.op === 'addBranch',
    update = op.op === 'updateBranch';
  fields(op, ['op', 'from', 'to', ...(add ? ['branch', 'net'] : update ? ['patch'] : [])]);
  const from = op.from,
    to = endpoint(op.to);
  const sameSource = netsFrom(doc, from);
  for (const net of sameSource) {
    const index = branchIndex(net, to);
    if (index < 0) continue;
    if (add) throw new Error('Branch already exists');
    if (update) {
      const entry = net.to[index];
      const expanded = Object.hasOwn(entry, 'endpoint') ? entry : { endpoint: entry };
      patchFields(expanded, op.patch, branchFields);
      if (Object.keys(op.patch).length) net.to[index] = expanded;
      return;
    }
    net.to.splice(index, 1);
    if (!net.to.length) doc.connections.splice(doc.connections.indexOf(net), 1);
    return;
  }
  if (!add) throw new Error('Branch not found');
  if (Object.hasOwn(op, 'branch')) fields(op.branch, branchFields);
  if (Object.hasOwn(op, 'net'))
    fields(op.net, ['id', 'label', 'style', 'feedback', 'constraint', 'direction']);
  const ctx = createConnectionContext(doc);
  function face(target, direction) {
    const found = ctx.resolve(from, target, direction);
    if (found.error) throw new Error(found.error);
    return receivingFaceKey(found.source);
  }
  const wanted = face(to, op.net?.direction);
  const net = sameSource.find((n) => face(targetEndpoint(n.to[0]), n.direction) === wanted);
  const entry = op.branch ? { endpoint: to, ...op.branch } : to;
  if (net) {
    if (op.net) throw new Error('net fields apply only when creating a Net');
    net.to.push(entry);
  } else {
    (doc.connections ??= []).push({ ...op.net, from, to: [entry] });
  }
}

const moduleFields = ['label', 'ports', 'style', 'width', 'height', 'appearance', 'type'];
function edit(doc, op) {
  switch (op?.op) {
    case 'renameModule': {
      fields(op, ['op', 'id', 'newId']);
      find(doc.modules, op.id, 'module');
      if (typeof op.newId !== 'string' || !/^[A-Za-z_]\w*$/.test(op.newId))
        throw new Error('Invalid new module ID: ' + String(op.newId));
      if ([...doc.modules, ...(doc.groups ?? [])].some((item) => item.id === op.newId))
        throw new Error('ID already exists: ' + op.newId);
      remapModules(doc, new Map([[op.id, op.newId]]));
      break;
    }
    case 'addModule': {
      fields(op, ['op', 'module']);
      fields(op.module, ['id', ...moduleFields]);
      if (!op.module.id) throw new Error('Expected a module ID');
      if (
        [...doc.modules, ...(doc.groups ?? []), ...(doc.terminals ?? [])].some((n) => n.id === op.module.id)
      )
        throw new Error('ID already exists: ' + op.module.id);
      doc.modules.push(op.module);
      break;
    }
    case 'updateModule': {
      fields(op, ['op', 'id', 'patch']);
      const item = find(doc.modules, op.id, 'module');
      patchFields(item, op.patch, moduleFields);
      break;
    }
    case 'removeModule': {
      fields(op, ['op', 'id']);
      const item = find(doc.modules, op.id, 'module');
      doc.modules.splice(doc.modules.indexOf(item), 1);
      for (const g of doc.groups ?? []) g.members = g.members.filter((id) => id !== op.id);
      renameGridMember(doc, op.id, null);
      if (doc.connections) pruneConnections(doc, (ref) => ownerId(ref) === op.id);
      break;
    }
    case 'setGroupMembers': {
      fields(op, ['op', 'id', 'members']);
      const g = find(doc.groups, op.id, 'group');
      if (!Array.isArray(op.members)) throw new Error('Expected members array');
      const ids = new Set([...doc.modules, ...doc.groups].map((n) => n.id));
      for (const id of op.members) if (!ids.has(id)) throw new Error('Unknown member ID: ' + id);
      g.members = op.members;
      break;
    }
    case 'setGridCells': {
      fields(op, ['op', 'id', 'cells']);
      const group = find(doc.groups, op.id, 'group');
      if (!Array.isArray(op.cells)) throw new Error('Expected a cells matrix');
      // Membership and Grid scope are validated together after the last operation.
      group.layout = { ...group.layout, type: 'grid', cells: op.cells };
      break;
    }
    case 'updateNet':
      updateNet(doc, op);
      break;
    case 'addBranch':
    case 'updateBranch':
    case 'removeBranch':
      editBranch(doc, op);
      break;
    default:
      throw new Error('Unknown operation: ' + String(op?.op));
  }
}

function describe(op, i) {
  const target =
    op?.from !== undefined || op?.to !== undefined
      ? endpointKey(op.from) + (op.to === undefined ? '' : ' -> ' + endpointKey(op.to))
      : (op?.id ?? op?.module?.id ?? '');
  return `ops[${i}] ${op?.op ?? '?'} ${target}`.trimEnd();
}

export function applyDiagramOps(document, operations, options = {}) {
  fields(options, ['diffFormat']);
  const { diffFormat = 'pointer' } = options;
  if (!['pointer', 'semantic'].includes(diffFormat))
    throw new Error('diffFormat must be pointer or semantic');
  if (!Array.isArray(operations)) throw new Error('Expected an array of operations');
  const result = structuredClone(document);
  const identities = result.modules.map((module) => ({ module, id: module.id }));
  for (const [i, op] of operations.entries()) {
    try {
      edit(result, structuredClone(op));
    } catch (cause) {
      throw new Error(describe(op, i) + ': ' + cause.message, { cause });
    }
  }
  if (!Object.hasOwn(document, 'connections') && result.connections?.length === 0) delete result.connections;
  try {
    validateDiagram(result);
  } catch (cause) {
    const context = operations.map(describe).join(', ');
    throw new Error(
      `Validation at ${cause.path || '/'}: ${cause.message}${context ? ' after ' + context : ''}`,
      { cause },
    );
  }
  if (diffFormat === 'pointer') return { document: result, diff: documentDiff(document, result) };
  const names = new Map(
    identities
      .filter(({ module, id }) => result.modules.includes(module) && module.id !== id)
      .map(({ module, id }) => [id, module.id]),
  );
  const baseline = structuredClone(document);
  const references = remapModules(baseline, names);
  const renames = [...names].map(([id, newId]) => ({
    kind: 'module',
    change: 'rename',
    id,
    newId,
    references: references.get(id),
  }));
  return { document: result, diff: [...renames, ...semanticDiff(baseline, result)] };
}
