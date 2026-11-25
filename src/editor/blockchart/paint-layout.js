import { mapConnectionEndpoints } from '../../lib/blockchart/nets.js';
import { TEXT_STYLE } from '../../lib/blockchart/styles.js';
import { scopeModel } from '../../lib/blockchart/layout/scope.js';
import { visibleModel } from '../../lib/blockchart/layout/visibility.js';
import { receiverLabels, signalModel } from '../../lib/blockchart/layout/signals.js';

const text = ['color', 'opacity', 'backgroundColor', 'backgroundOpacity', 'textAlign'];
const body = ['fillColor', 'borderColor', 'fillOpacity', 'borderOpacity', 'borderStyle'];
const wire = ['strokeColor', 'opacity', 'lineStyle'];
const bodyText = ['label', 'portLabel', 'inputPortLabel', 'outputPortLabel'];

function stripStyle(owner, key, fields, textSlots = []) {
  const style = owner?.[key];
  if (!style) return;
  for (const slot of textSlots) stripStyle(style, slot, text);
  for (const field of fields) delete style[field];
  if (!Object.keys(style).length) delete owner[key];
}

// Match references by authoring slot. Tokens cannot collide with legal user IDs.
// Retain literal keys wherever layout can use them as text or internal routing IDs.
export function geometryKey(document) {
  const copy = structuredClone(document);
  const nodes = [...copy.modules, ...(copy.groups ?? [])];
  const ids = new Map(),
    endpoints = new Map();
  const allowRename = ![...nodes, ...(copy.terminals ?? []), ...(copy.connections ?? [])].some((n) =>
    n.id?.startsWith('_signal_'),
  );
  const token = (item, index) =>
    allowRename && item.label !== undefined && !(item.id in Object.prototype) ? '#' + index : item.id;
  const defaults = copy.diagram.style;
  for (const slot of ['text', 'terminal', 'caption']) stripStyle(defaults, slot, text);
  for (const slot of ['module', 'group']) stripStyle(defaults, slot, body, bodyText);
  stripStyle(defaults, 'connection', wire, ['label']);
  stripStyle(copy.diagram, 'style', []);
  for (const [index, node] of nodes.entries()) {
    const owner = token(node, index);
    ids.set(node.id, owner);
    for (const [i, p] of (node.ports ?? []).entries()) {
      const port = token(p, i);
      endpoints.set(node.id + '.' + p.id, owner + '.' + port);
      p.id = port;
      stripStyle(p, 'style', text);
    }
    node.id = owner;
    stripStyle(node, 'style', body, bodyText);
  }
  const id = (value) => ids.get(value) ?? value;
  for (const g of copy.groups ?? []) g.members = g.members.map(id);
  for (const config of [copy.layout, ...(copy.groups ?? []).map((g) => g.layout)])
    if (config?.cells) config.cells = config.cells.map((row) => row.map(id));
  for (const terminal of copy.terminals ?? []) stripStyle(terminal, 'style', text);
  for (const net of copy.connections ?? []) {
    mapConnectionEndpoints(net, (value) => endpoints.get(value) ?? value);
    stripStyle(net, 'style', wire, ['label']);
    net.to = net.to.map((target) => {
      if (!Object.hasOwn(target, 'endpoint')) return target;
      stripStyle(target, 'style', wire);
      return Object.keys(target).length === 1 ? target.endpoint : target;
    });
  }
  return JSON.stringify(copy);
}

function corridorKey(key, rename) {
  const [owner, axis, kind, before, after] = JSON.parse(key);
  const face = (value) =>
    Array.isArray(value) ? value.map(rename).sort((a, b) => a.localeCompare(b, 'en')) : rename(value);
  return JSON.stringify([rename(owner), axis, kind, face(before), face(after)]);
}

function renameRouting(info, rename) {
  if (!info) return;
  for (const key of ['sourceGroup', 'targetGroup', 'channelOwner'])
    if (info[key]) info[key] = rename(info[key]);
  if (info.containerExit) info.containerExit.groups = info.containerExit.groups.map(rename);
  if (info.channelCorridor) info.channelCorridor = corridorKey(info.channelCorridor, rename);
  for (const corridor of info.distributedCorridors ?? []) corridor.id = corridorKey(corridor.id, rename);
  info.distributedCorridors?.sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

// The outer router assigns lanes in lexical endpoint order. A rename can
// change that order even when every displayed label is identical. Check both
// signal graphs used by Auto receiver labels, without placing or routing them.
function outerOrder(model, receivers) {
  return signalModel(model, receivers)
    .connections.filter((e) => !e.source.terminal && !e.target.terminal && !e.boundaryScoped)
    .map((e) => ({
      id: e.id,
      key: e.source.moduleId + '.' + e.source.portId + '->' + e.target.moduleId + '.' + e.target.portId,
    }))
    .sort((a, b) => a.key.localeCompare(b.key, 'en'))
    .map((e) => e.id)
    .join('|');
}

/** Rehydrate derived paint and identity from this revision. Geometry is privately owned. */
export function repaintLayout(previous, model, oldModel = model, rootGroupId = previous.rootGroupId) {
  const renamed = new Map();
  let portsRenamed = false;
  for (const type of ['modules', 'groups'])
    for (const [i, node] of oldModel[type].entries()) {
      const current = model[type][i];
      if (node.id !== current.id) renamed.set(node.id, current.id);
      if (node.ports.some((p, j) => p.id !== current.ports[j].id)) {
        const slots = new Map(node.ports.map((p, j) => [p.id, j]));
        if (current.ports.some((p, j) => slots.has(p.id) && slots.get(p.id) !== j)) return null;
        portsRenamed = true;
      }
    }
  // With identical labels a reorder can look like two renames. An existing
  // identity that moved to a different slot needs a fresh placement.
  for (const id of renamed.values()) if (renamed.has(id)) return null;
  const rename = (id) => {
    if (id?.startsWith('_signal_owner_') && renamed.has(id.slice('_signal_owner_'.length)))
      return '_signal_owner_' + renamed.get(id.slice('_signal_owner_'.length));
    return renamed.get(id) ?? id;
  };
  const view = visibleModel(scopeModel(model, rootGroupId));
  if ((renamed.size || portsRenamed) && !rootGroupId && model.layout.feedbackRouting === 'outer') {
    const original = visibleModel(oldModel);
    const first = receiverLabels(view);
    const final = new Set(
      previous.connections.filter((e) => e.labelInstances?.some((l) => l.role === 'end')).map((e) => e.id),
    );
    for (const selected of [first, ...(final.size > first.size ? [final] : [])])
      if (outerOrder(original, selected) !== outerOrder(view, selected)) return null;
  }
  const layout = structuredClone(previous);
  if (layout.rootGroupId !== undefined) layout.rootGroupId = rootGroupId;
  for (const type of ['modules', 'groups']) {
    const refs = new Map(view[type].map((node) => [node.id, node]));
    for (const node of layout[type] ?? []) {
      node.id = rename(node.id);
      const ref = refs.get(node.id);
      node.style = structuredClone(ref.style);
      if (ref.portLabelStyle) node.portLabelStyle = structuredClone(ref.portLabelStyle);
      for (const [i, p] of node.ports.entries()) {
        p.id = ref.ports[i].id;
        p.style = structuredClone(ref.ports[i].style);
      }
      if (renamed.size && node.members) {
        node.members = node.members.map(rename);
        node.blockIds = node.blockIds.map(rename);
        if (node.layout?.cells) node.layout.cells = node.layout.cells.map((row) => row.map(rename));
      }
    }
  }
  const terminals = new Map((view.terminals ?? []).map((t) => [t.id, t]));
  for (const t of layout.terminals ?? []) t.style = structuredClone(terminals.get(t.id).style);
  if (layout.caption)
    layout.caption.style = { ...TEXT_STYLE, ...model.diagram.style.text, ...model.diagram.style.caption };
  const branches = new Map(view.connections.map((edge) => [edge.id, edge]));
  for (const edge of layout.connections) {
    const ref = branches.get(edge.id);
    edge.source = structuredClone(ref.originalSource ?? ref.source);
    edge.target = structuredClone(ref.originalTarget ?? ref.target);
    if (edge.routingSource) {
      edge.routingSource = structuredClone(ref.source);
      edge.routingTarget = structuredClone(ref.target);
    }
    edge.style = structuredClone(ref.style);
    edge.netStyle = structuredClone(ref.netStyle);
    if (renamed.size) {
      if (edge.scope) edge.scope = rename(edge.scope);
      renameRouting(edge.routingInfo, rename);
    }
    for (const label of edge.labelInstances ?? []) {
      if (label.role === 'end' && label.sharedKey) {
        const { moduleId, portId } = ref.target;
        label.sharedKey = `receiver_${edge.netId.length}_${edge.netId}_${moduleId.length}_${moduleId}_${portId}`;
      }
    }
  }
  for (const junction of layout.junctions ?? []) {
    const { strokeColor, opacity } = branches.get(junction.connectionIds[0]).netStyle;
    junction.style = { strokeColor, opacity };
  }
  return layout;
}
