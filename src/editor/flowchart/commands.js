import { createFlowchartModel, FlowchartValidationError } from '../../lib/flowchart/model.js';

const fail = (message, path) => {
  throw new FlowchartValidationError(message, path);
};
function properties(props, path) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) fail('Expected an object', path);
}
export function validateDocument(document) {
  return createFlowchartModel(document);
}
// A valid starter document: the schema requires at least one node.
export function emptyDocument() {
  return {
    version: 1,
    diagram: { name: 'Untitled flowchart' },
    nodes: [{ id: 'Start', type: 'start', label: 'Start' }],
    edges: [],
  };
}
function edit(document, change) {
  const model = validateDocument(document),
    next = structuredClone(document);
  change(next, model);
  validateDocument(next);
  return next;
}
function node(document, id) {
  const found = document.nodes.find((n) => n.id === id);
  if (!found) fail('Unknown node', 'nodes.' + id);
  return found;
}
function group(document, id) {
  const found = document.groups?.find((g) => g.id === id);
  if (!found) fail('Unknown group', 'groups.' + id);
  return found;
}
const parent = (d, id) => d.groups?.find((g) => g.members.includes(id))?.id;
function fresh(document, prefix) {
  const used = new Set(
    [...document.nodes, ...(document.groups ?? []), ...validateDocument(document).edges].map((x) => x.id),
  );
  let i = 1;
  while (used.has(prefix + i)) i++;
  return prefix + i;
}
function pruneGroups(d) {
  for (;;) {
    const empty = new Set((d.groups ?? []).filter((g) => !g.members.length).map((g) => g.id));
    if (!empty.size) return;
    d.groups = d.groups.filter((g) => !empty.has(g.id));
    for (const g of d.groups) g.members = g.members.filter((id) => !empty.has(id));
  }
}
function move(d, ids, target) {
  if (target != null) group(d, target);
  for (const g of d.groups ?? []) g.members = g.members.filter((id) => !ids.includes(id));
  if (target != null) group(d, target).members.push(...ids);
}
function withNotes(model, ids) {
  return [
    ...new Set([
      ...ids,
      ...model.nodes.filter((n) => n.type === 'note' && ids.includes(n.attachTo)).map((n) => n.id),
    ]),
  ];
}
// Materialize existing implicit IDs before an edge-array mutation can shift indices.
function identifyEdges(d, model) {
  d.edges.forEach((e, i) => {
    e.id ??= model.edges[i].id;
  });
}
export function addNode(document, props = {}, groupId = null) {
  return edit(document, (d) => {
    properties(props, 'nodes');
    if (groupId != null) group(d, groupId);
    const id = fresh(d, 'Node');
    const n = { ...structuredClone(props), id, type: props.type ?? 'process', label: props.label ?? id };
    d.nodes.push(n);
    if (groupId != null) group(d, groupId).members.push(id);
  });
}
function rename(document, id, nextId, kind) {
  return edit(document, (d) => {
    const item = kind === 'node' ? node(d, id) : group(d, id);
    item.id = nextId;
    for (const g of d.groups ?? []) g.members = g.members.map((key) => (key === id ? nextId : key));
    if (kind === 'node') {
      for (const e of d.edges) for (const end of ['from', 'to']) if (e[end] === id) e[end] = nextId;
      for (const n of d.nodes) if (n.attachTo === id) n.attachTo = nextId;
    }
  });
}
export const renameNode = (d, id, nextId) => rename(d, id, nextId, 'node');
export const renameGroup = (d, id, nextId) => rename(d, id, nextId, 'group');
export function removeNode(document, id) {
  return edit(document, (d, model) => {
    node(d, id);
    const ids = new Set(withNotes(model, [id]));
    identifyEdges(d, model);
    d.nodes = d.nodes.filter((n) => !ids.has(n.id));
    d.edges = d.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
    for (const g of d.groups ?? []) g.members = g.members.filter((key) => !ids.has(key));
    pruneGroups(d);
  });
}
export function addEdge(document, from, to, props = {}) {
  return edit(document, (d, model) => {
    properties(props, 'edges');
    const id = fresh(d, 'edge_');
    identifyEdges(d, model);
    d.edges.push({ ...structuredClone(props), id, from, to });
  });
}
export function removeEdge(document, edgeId) {
  return edit(document, (d, model) => {
    identifyEdges(d, model);
    const i = d.edges.findIndex((e) => e.id === edgeId);
    if (i < 0) fail('Unknown edge', 'edges.' + edgeId);
    // Keep an inferred note attachment when removing its association.
    for (const n of d.nodes.filter((n) => n.type === 'note'))
      n.attachTo ??= model.nodes.find((m) => m.id === n.id).attachTo;
    d.edges.splice(i, 1);
  });
}
export function reconnectEdge(document, edgeId, end, nodeId) {
  return edit(document, (d, model) => {
    if (!['from', 'to'].includes(end)) fail('Expected from or to', 'edges.' + edgeId);
    node(d, nodeId);
    identifyEdges(d, model);
    const edge = d.edges.find((e) => e.id === edgeId);
    if (!edge) fail('Unknown edge', 'edges.' + edgeId);
    edge[end] = nodeId;
  });
}
export function addGroup(document, memberIds, parentId = null) {
  return edit(document, (d, model) => {
    if (!Array.isArray(memberIds) || !memberIds.length || new Set(memberIds).size !== memberIds.length)
      fail('Expected nonempty unique members', 'groups.members');
    if (parentId != null) group(d, parentId);
    for (const id of memberIds)
      if (!d.nodes.some((n) => n.id === id) && !d.groups?.some((g) => g.id === id))
        fail('Unknown member', 'groups.members');
    const ids = withNotes(model, memberIds),
      id = fresh(d, 'Group');
    d.groups ??= [];
    // A note cannot be separated from its owner by grouping it alone.
    for (const n of model.nodes.filter((n) => n.type === 'note' && ids.includes(n.id)))
      if (!ids.includes(n.attachTo)) fail('Include the note owner', 'nodes.' + n.id + '.attachTo');
    move(d, ids, null);
    d.groups.push({ id, label: id, members: ids });
    if (parentId != null) group(d, parentId).members.push(id);
    pruneGroups(d);
  });
}
export function ungroup(document, id) {
  return edit(document, (d) => {
    const g = group(d, id),
      owner = parent(d, id);
    if (owner) {
      const p = group(d, owner);
      p.members = p.members.flatMap((key) => (key === id ? g.members : [key]));
    }
    d.groups = d.groups.filter((item) => item.id !== id);
  });
}
export function placeGroup(document, groupId, parentId = null) {
  return edit(document, (d) => {
    group(d, groupId);
    if (parentId != null) group(d, parentId);
    for (let id = parentId; id != null; id = parent(d, id))
      if (id === groupId)
        fail('Cannot place a group inside itself or its descendants', 'groups.' + groupId + '.members');
    if (parent(d, groupId) === (parentId ?? undefined)) return;
    move(d, [groupId], parentId);
    pruneGroups(d);
  });
}
export function placeNode(document, id, groupId = null) {
  return edit(document, (d, model) => {
    const n = node(d, id);
    if (
      n.type === 'note' &&
      parent(d, model.nodes.find((n) => n.id === id).attachTo) !== (groupId ?? undefined)
    )
      fail('Move the note with its owner', 'nodes.' + id + '.attachTo');
    move(d, withNotes(model, [id]), groupId);
    pruneGroups(d);
  });
}
export function attachNote(document, noteId, ownerId, side) {
  return edit(document, (d) => {
    const note = node(d, noteId),
      owner = node(d, ownerId);
    if (note.type !== 'note' || owner.type === 'note')
      fail('Expected a note and a non-note owner', 'nodes.' + noteId + '.attachTo');
    note.attachTo = ownerId;
    if (side !== undefined) note.side = side;
    move(d, [noteId], parent(d, ownerId));
    pruneGroups(d);
  });
}
