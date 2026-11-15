// Document operations used by the Studio UI. All mutate a document clone inside Store.commit.
import {
  addModule,
  addPort,
  endpoints,
  findSourceNet,
  nextId,
  placeBlock,
  targetReason,
  removeModule,
  removeGroup,
  removeTerminal,
  removePort,
  groupOf,
  validateDocument,
} from '../../editor/state/commands.js';
import { targetEndpoint, targetEndpoints, pruneConnections } from '../../lib/blockchart/nets.js';
import { endpointKey, endpointFromKey } from '../../lib/blockchart/endpoints.js';
import { ancestors, descendants } from '../../lib/blockchart/hierarchy.js';
import { groupType } from '../../lib/blockchart/group-type.js';
import { singleLine } from '../ui/dom.js';

export const findModule = (doc, id) => doc.modules.find((m) => m.id === id);
export const findGroup = (doc, id) => doc.groups?.find((g) => g.id === id);
export const findOwner = (doc, id) => findModule(doc, id) ?? findGroup(doc, id);
export const allIds = (doc) => [...doc.modules, ...(doc.groups ?? []), ...(doc.terminals ?? [])];
export const displayName = (item) => singleLine(item?.label ?? item?.id ?? '');

/* ---------------- Endpoints ---------------- */
export function portRef(owner, port) {
  return owner + '.' + port;
}

export function endpointInfo(doc, key) {
  const value = endpointFromKey(key);
  if (typeof value !== 'string') {
    const terminal = doc.terminals?.find((t) => t.id === value.terminal);
    return { kind: 'terminal', id: value.terminal, item: terminal, label: terminal ? displayName(terminal) : value.terminal };
  }
  const [owner, port] = value.split('.');
  const item = findOwner(doc, owner);
  const p = item?.ports?.find((x) => x.id === port);
  return { kind: 'port', owner, port, item, portItem: p, label: `${owner}.${port}`, ownerLabel: displayName(item) };
}

/** Options for a net source picker. */
export function sourceOptions(doc) {
  return endpoints(doc, 'output').map((p) => ({
    value: p.ref,
    label: p.ref.startsWith('@terminal:') ? 'Terminal ' + p.ref.slice(10) : p.ref,
    hint: p.label.includes(' — ') ? p.label.split(' — ')[1] : p.ref.startsWith('@terminal:') ? 'External input' : '',
    group: p.ref.startsWith('@terminal:') ? 'External inputs' : 'Block outputs',
  }));
}

/** Options for a net target picker, with disabled reasons. */
export function targetOptions(doc, net, index, excludeBranch = -1) {
  const taken = new Set(targetEndpoints(net).map(endpointKey).filter((_, j) => j !== excludeBranch));
  return endpoints(doc, 'input').map((p) => {
    let reason = taken.has(p.ref) ? 'Already in this net' : '';
    // The net itself is excluded: its own receivers are covered by `taken`.
    if (!reason) reason = targetReason(doc, net.from, p.ref, index, net.direction ?? 'forward');
    return {
      value: p.ref,
      label: p.ref.startsWith('@terminal:') ? 'Terminal ' + p.ref.slice(10) : p.ref,
      hint: p.label.includes(' — ') ? p.label.split(' — ')[1] : p.ref.startsWith('@terminal:') ? 'External output' : '',
      reason,
      disabled: Boolean(reason),
      group: p.ref.startsWith('@terminal:') ? 'External outputs' : 'Block inputs',
    };
  });
}

/* ---------------- Connect (drag rules) ---------------- */
const isDriver = (doc, key) => endpoints(doc, 'output').some((p) => p.ref === key);
const isReceiver = (doc, key) => endpoints(doc, 'input').some((p) => p.ref === key);

/**
 * Resolve a drag from endpoint `a` to endpoint `b` into a net operation.
 * Rules: a driver already in a net gets a new branch; a new driver creates a net;
 * dragging from a receiver to a driver adds the receiver to that driver's net.
 * Returns { ok, from, to, net, message } without mutating the document.
 */
export function planConnection(doc, a, b) {
  if (!a || !b || a === b) return { ok: false, message: 'Choose a different port' };
  let from = a,
    to = b;
  if (!isDriver(doc, a) || (!isReceiver(doc, b) && isDriver(doc, b) && isReceiver(doc, a))) {
    from = b;
    to = a;
  }
  if (!isDriver(doc, from) || !isReceiver(doc, to)) return { ok: false, message: 'Connect an output to an input' };
  const fromValue = endpointFromKey(from),
    toValue = endpointFromKey(to);
  const existingIndex = (doc.connections ?? []).findIndex((edge) => {
    if (endpointKey(edge.from) !== from) return false;
    return Boolean(findSourceNet(doc, fromValue, toValue, edge.direction ?? 'forward'));
  });
  const existing = existingIndex >= 0 ? doc.connections[existingIndex] : null;
  if (existing && targetEndpoints(existing).map(endpointKey).includes(to))
    return { ok: false, message: 'Already connected' };
  const reason = targetReason(doc, fromValue, toValue, -1, existing?.direction ?? 'forward');
  if (reason) return { ok: false, message: reason };
  const name = existing ? existing.label ? singleLine(existing.label) : existing.id ?? 'net' : null;
  return {
    ok: true,
    from,
    to,
    existingIndex,
    message: existing ? `Add to net ${name} (target ${existing.to.length + 1})` : `New net ${from} → ${to}`,
  };
}

export function applyConnection(doc, plan) {
  doc.connections ??= [];
  const toValue = endpointFromKey(plan.to);
  if (plan.existingIndex >= 0) {
    doc.connections[plan.existingIndex].to.push(toValue);
    return plan.existingIndex;
  }
  doc.connections.push({ id: nextId(doc.connections, 'net'), from: endpointFromKey(plan.from), to: [toValue] });
  return doc.connections.length - 1;
}

/** Concat from selected source ports: creates the element and its input nets. */
export function createConcat(doc, sourceKeys) {
  const sources = sourceKeys.filter((key) => isDriver(doc, key));
  if (sources.length < 2) throw new Error('Select at least two output ports to concatenate.');
  const id = addModule(doc, 'concat'),
    node = findModule(doc, id);
  const info = endpoints(doc, 'output');
  const widths = sources.map((key) => info.find((p) => p.ref === key)?.width ?? null);
  node.ports = sources.map((key, j) => ({ id: 'in_' + (j + 1), direction: 'input', ...(widths[j] !== null ? { width: widths[j] } : {}) }));
  node.ports.push({ id: 'out', direction: 'output', ...(widths.every((w) => w !== null) ? { width: widths.reduce((x, y) => x + y, 0) } : {}) });
  // Place the element in the deepest common container of its sources.
  const paths = sources.map((key) => {
    const ref = endpointFromKey(key);
    if (typeof ref !== 'string') return [];
    const owner = ref.split('.')[0];
    return doc.groups?.some((g) => g.id === owner) ? [...ancestors(doc, owner), owner] : ancestors(doc, owner);
  });
  let scope = '';
  for (let j = 0; j < Math.min(...paths.map((p) => p.length)); j++) {
    if (paths.every((p) => p[j] === paths[0][j])) scope = paths[0][j];
    else break;
  }
  if (scope) placeBlock(doc, id, scope);
  doc.connections ??= [];
  for (const [j, key] of sources.entries()) {
    const plan = planConnection(doc, key, id + '.in_' + (j + 1));
    if (!plan.ok) throw new Error(`${key}: ${plan.message}`);
    applyConnection(doc, plan);
  }
  return id;
}

/* ---------------- Create / delete / duplicate ---------------- */
export function addBlock(doc, kind = 'block', parent = '') {
  const id = addModule(doc, kind);
  const module = findModule(doc, id);
  if (kind === 'block') module.ports = [
    { id: 'in', direction: 'input' },
    { id: 'out', direction: 'output' },
  ];
  if (parent) placeBlock(doc, id, parent);
  return id;
}

export function addTerminal(doc, direction) {
  const id = nextId(allIds(doc), direction === 'input' ? 'ext_in' : 'ext_out');
  doc.terminals ??= [];
  doc.terminals.push({ id, direction });
  return id;
}

export function addNet(doc, from, to) {
  const plan = planConnection(doc, from, to);
  if (!plan.ok) throw new Error(plan.message);
  return applyConnection(doc, plan);
}

export function deleteSelection(doc, sel) {
  if (!sel) return '';
  if (sel.type === 'block') {
    removeModule(doc, sel.id);
    return 'Deleted block ' + sel.id;
  }
  if (sel.type === 'group') {
    removeGroup(doc, sel.id);
    return 'Ungrouped ' + sel.id;
  }
  if (sel.type === 'terminal') {
    removeTerminal(doc, sel.id);
    return 'Deleted terminal ' + sel.id;
  }
  if (sel.type === 'port') {
    removePort(doc, sel.owner, sel.port);
    return `Deleted port ${sel.owner}.${sel.port}`;
  }
  if (sel.type === 'net') {
    const net = doc.connections[sel.index];
    if (sel.branch !== undefined && net.to.length > 1) {
      net.to.splice(sel.branch, 1);
      return 'Removed branch from ' + (net.id ?? 'net');
    }
    doc.connections.splice(sel.index, 1);
    return 'Deleted net ' + (net.id ?? '');
  }
  return '';
}

/** Delete a group together with everything inside it. */
export function deleteGroupDeep(doc, id) {
  const inner = descendants(doc, id);
  const removedIds = new Set([id, ...inner]);
  pruneConnections(doc, (value) => removedIds.has(endpointKey(value).split('.')[0]));
  doc.modules = doc.modules.filter((m) => !removedIds.has(m.id));
  doc.groups = (doc.groups ?? []).filter((g) => !removedIds.has(g.id));
  for (const g of doc.groups) g.members = g.members.filter((m) => !removedIds.has(m));
  if (!doc.groups.length) delete doc.groups;
  // Remove the group from any grid layout that referenced it.
  const scrub = (layout) => {
    if (!layout?.cells) return;
    layout.cells = layout.cells.map((row) => row.map((cell) => (removedIds.has(cell) ? null : cell)));
  };
  scrub(doc.layout);
  for (const g of doc.groups ?? []) scrub(g.layout);
}

export function duplicateBlock(doc, id) {
  const source = findModule(doc, id);
  if (!source) throw new Error('Only blocks can be duplicated.');
  const copy = structuredClone(source);
  copy.id = nextId(allIds(doc), source.id.replace(/_\d+$/, ''));
  doc.modules.push(copy);
  const parent = groupOf(doc, id);
  if (parent) placeBlock(doc, copy.id, parent, id, false);
  return copy.id;
}

export function groupItems(doc, ids) {
  if (!ids.length) throw new Error('Select a block or group first.');
  const parent = groupOf(doc, ids[0]);
  if (ids.some((id) => groupOf(doc, id) !== parent)) throw new Error('Grouped items must share the same parent.');
  const id = nextId(allIds(doc), 'group');
  doc.groups ??= [];
  doc.groups.push({ id, members: [] });
  if (parent) placeBlock(doc, id, parent, ids[0], true);
  for (const item of ids) placeBlock(doc, item, id);
  return id;
}

/**
 * Changes the diagram Flow in one transaction. Settings whose valid values depend on the
 * Flow go back to Auto: the outer feedback side and explicit Concat port sides (Concat
 * ports must sit on the Flow sides, so Auto is the only value valid in both Flows).
 */
export function setFlowDirection(doc, direction) {
  doc.layout ??= {};
  if (direction === 'right') delete doc.layout.direction;
  else doc.layout.direction = direction;
  if (doc.layout.feedbackSide && doc.layout.feedbackSide !== 'auto') delete doc.layout.feedbackSide;
  if (!Object.keys(doc.layout).length) delete doc.layout;
  for (const module of doc.modules ?? [])
    if (module.type === 'concat') for (const port of module.ports ?? []) delete port.side;
}

/** The side a Concat port takes in the current Flow. */
export function concatSide(doc, direction) {
  const down = doc.layout?.direction === 'down';
  if (direction === 'input') return down ? 'top' : 'left';
  return down ? 'bottom' : 'right';
}

export function newPort(doc, ownerId, direction) {
  const owner = findOwner(doc, ownerId);
  if (!owner) throw new Error('This item is no longer available.');
  if (findGroup(doc, ownerId) && groupType(owner) !== 'boundary') throw new Error('Only boundary groups have ports.');
  owner.ports ??= [];
  return addPort(owner, direction);
}

/* ---------------- Problems ---------------- */
export function problems(doc, layoutError, warnings = []) {
  const list = [];
  if (layoutError) list.push({ level: 'error', message: layoutError.message, path: layoutError.path });
  for (const warning of warnings) list.push({ level: 'warn', message: warning.message ?? String(warning), code: warning.code });
  const used = new Set();
  for (const edge of doc.connections ?? []) {
    used.add(endpointKey(edge.from));
    for (const t of targetEndpoints(edge)) used.add(endpointKey(t));
  }
  for (const owner of [...doc.modules, ...(doc.groups ?? []).filter((g) => groupType(g) === 'boundary')])
    for (const port of owner.ports ?? [])
      if (!used.has(owner.id + '.' + port.id))
        list.push({
          level: 'info',
          message: `${owner.id}.${port.id} is not connected`,
          select: findGroup(doc, owner.id) ? { type: 'group', id: owner.id } : { type: 'port', owner: owner.id, port: port.id },
        });
  for (const terminal of doc.terminals ?? [])
    if (!used.has('@terminal:' + terminal.id))
      list.push({ level: 'info', message: `Terminal ${terminal.id} is not connected`, select: { type: 'terminal', id: terminal.id } });
  return list;
}

/* ---------------- Misc ---------------- */
export function netTitle(net) {
  return net.label ? singleLine(net.label) : net.id ?? endpointKey(net.from);
}

export function netSummary(net) {
  const targets = targetEndpoints(net).map(endpointKey);
  const short = (k) => (k.startsWith('@terminal:') ? k.slice(10) : k);
  return `${short(endpointKey(net.from))} → ${targets.length === 1 ? short(targets[0]) : targets.length + ' targets'}`;
}

export function branchEntry(net, j) {
  const entry = net.to[j];
  return entry && typeof entry === 'object' && Object.hasOwn(entry, 'endpoint') ? entry : { endpoint: entry };
}

/** Write a branch entry back in its most compact authoring form. */
export function setBranch(net, j, entry) {
  const keys = Object.keys(entry).filter((k) => k !== 'endpoint' && entry[k] !== undefined);
  net.to[j] = keys.length ? Object.fromEntries([['endpoint', entry.endpoint], ...keys.map((k) => [k, entry[k]])]) : entry.endpoint;
}

export function setNetSource(doc, index, key) {
  const net = doc.connections[index];
  net.from = endpointFromKey(key);
}

export { validateDocument, targetEndpoint, endpointKey, endpointFromKey, groupType };

/* ---------------- Renames not covered by the shared command layer ---------------- */
import { renameGridMember } from '../../lib/blockchart/grid.js';
import { mapConnectionEndpoints } from '../../lib/blockchart/nets.js';
import { assertId } from '../../editor/state/commands.js';

export function renameGroup(doc, previous, value) {
  const id = typeof value === 'string' ? value.trim() : value;
  assertId(id, allIds(doc), previous);
  const group = findGroup(doc, previous);
  if (!group) throw new Error('This group is no longer available.');
  if (id === previous) return id;
  group.id = id;
  for (const g of doc.groups) g.members = g.members.map((m) => (m === previous ? id : m));
  renameGridMember(doc, previous, id);
  const prefix = previous + '.';
  for (const edge of doc.connections ?? [])
    mapConnectionEndpoints(edge, (v) => (typeof v === 'string' && v.startsWith(prefix) ? id + v.slice(previous.length) : v));
  return id;
}

export function renameNet(doc, index, value) {
  const net = doc.connections[index];
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) {
    delete net.id;
    return;
  }
  assertId(id, doc.connections.filter((c) => c !== net && c.id).map((c) => ({ id: c.id })), net.id);
  net.id = id;
}

/** Parse the grid textarea: one row per line, cells split by spaces/commas, '.' = empty. */
export function parseGridText(text) {
  const rows = String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[\s,]+/).map((cell) => (cell === '.' || cell === '-' ? null : cell)));
  if (!rows.length) throw new Error('Enter at least one row.');
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(width - r.length).fill(null)]);
}

export const gridText = (cells) => (cells ?? []).map((row) => row.map((c) => c ?? '.').join('  ')).join('\n');

export function directMembers(doc, scope) {
  if (scope) return findGroup(doc, scope)?.members ?? [];
  const nested = new Set((doc.groups ?? []).flatMap((g) => g.members));
  return [...doc.modules, ...(doc.groups ?? [])].filter((n) => !nested.has(n.id)).map((n) => n.id);
}

/**
 * Groups an item may move into, in outline order: Top level, then every group except the
 * item itself and its descendants. `current` marks the item's present parent.
 */
export function moveTargets(doc, id) {
  const excluded = new Set([id, ...descendants(doc, id)]);
  const parent = groupOf(doc, id);
  const groups = new Map((doc.groups ?? []).map((g) => [g.id, g]));
  const out = [{ id: '', label: 'Top level', depth: 0, current: !parent }];
  const visit = (gid, depth) => {
    const g = groups.get(gid);
    if (!g || excluded.has(gid)) return;
    out.push({ id: gid, label: displayName(g), depth, current: parent === gid });
    for (const member of g.members) if (groups.has(member)) visit(member, depth + 1);
  };
  for (const gid of directMembers(doc, '')) if (groups.has(gid)) visit(gid, 1);
  return out;
}
