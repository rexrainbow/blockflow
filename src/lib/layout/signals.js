import { edgeLabelSize } from './edge-labels.js';
import { parentOf, descendants, ancestors } from '../hierarchy.js';
import { resolveGroupStyle, resolveModuleStyle, TEXT_STYLE } from '../styles.js';
import { createConnectionContext } from '../connectivity.js';
import { endpointValue } from '../endpoints.js';

/** Compile authored Nets into a routing-only graph. No synthetic object enters saved JSON. */
export function signalModel(input) {
  const active = new Map();
  for (const edge of input.connections)
    if (edge.netId && edge.label !== undefined && !edge.style.label.hidden) {
      if (!active.has(edge.netId)) active.set(edge.netId, []);
      active.get(edge.netId).push(edge);
    }
  if (!active.size) return input;
  const model = structuredClone(input),
    original = structuredClone(input);
  model._signalOriginal = original;
  model._signals = [];
  const used = new Set([...model.modules, ...model.groups, ...(model.terminals ?? [])].map((n) => n.id));
  const unique = (base) => {
    let id = base;
    while (used.has(id)) id += '_';
    used.add(id);
    return id;
  };
  const wrappers = new Map(),
    context = createConnectionContext(input);
  for (const [netId, branches] of active) {
    const first = branches[0],
      size = edgeLabelSize(first),
      signalId = unique('_signal_' + netId);
    const down = model.layout.direction === 'down',
      left = model.layout.direction === 'left';
    const ports = ['in', 'out'].map((id, index) => ({
      id,
      direction: index ? 'output' : 'input',
      width: first.width,
      displayName: id,
      order: 0,
      side: down ? (index ? 'bottom' : 'top') : left ? (index ? 'left' : 'right') : index ? 'right' : 'left',
      style: { ...TEXT_STYLE, hidden: true },
    }));
    const signal = {
      id: signalId,
      label: first.label,
      ports,
      style: resolveModuleStyle(
        {},
        { borderOpacity: 0, fillOpacity: 0, label: { ...first.style.label, hidden: true } },
      ),
      _signalSize: { width: Math.max(1, size.width), height: Math.max(1, size.height) },
    };
    model.modules.push(signal);
    const sourceId = first.source.moduleId;
    const sourceGroup = model.groups.find((g) => g.id === sourceId);
    const resolved = context.resolve(
      endpointValue(first.source),
      endpointValue(first.target),
      first.direction,
    );
    let parent = sourceId ? parentOf(model, sourceId) : '';
    if (sourceGroup && resolved.source?.inside) parent = sourceId;
    if (sourceId && !(sourceGroup && resolved.source?.inside)) {
      let wrapper = wrappers.get(sourceId);
      if (!wrapper) {
        const id = unique('_signal_owner_' + sourceId);
        wrapper = {
          id,
          label: id,
          type: 'container',
          portMode: 'direct',
          ports: [],
          members: [sourceId],
          collapsed: false,
          style: resolveGroupStyle({ borderOpacity: 0, fillOpacity: 0, label: { hidden: true } }),
          _signalWrapper: true,
        };
        const owner = model.groups.find((g) => g.id === parent);
        if (owner) owner.members = owner.members.map((value) => (value === sourceId ? id : value));
        for (const config of [model.layout, ...model.groups.map((g) => g.layout)].filter(Boolean))
          if (config.cells)
            config.cells = config.cells.map((row) => row.map((value) => (value === sourceId ? id : value)));
        model.groups.push(wrapper);
        wrappers.set(sourceId, wrapper);
      }
      wrapper.members.push(signalId);
      parent = wrapper.id;
    } else if (parent) model.groups.find((g) => g.id === parent).members.push(signalId);
    const trunkId = unique('_signal_trunk_' + netId),
      scope = parent || '';
    const trunk = {
      ...structuredClone(first),
      id: trunkId,
      source: first.source,
      target: { moduleId: signalId, portId: 'in' },
      scope,
      insideSelfLoop: false,
      feedback: false,
      constraint: true,
      style: {
        ...(first.netStyle ?? first.style),
        startArrow: 'none',
        endArrow: 'none',
        label: { ...first.style.label, hidden: true },
      },
      _signalTrunk: netId,
    };
    delete trunk.label;
    delete trunk.originalSource;
    delete trunk.originalTarget;
    model.connections.push(trunk);
    for (const edge of model.connections.filter((e) => e.netId === netId && e.id !== trunkId)) {
      edge.originalSource = edge.originalSource ?? edge.source;
      edge.originalTarget = edge.originalTarget ?? edge.target;
      edge.source = { moduleId: signalId, portId: 'out' };
      edge.insideSelfLoop = false;
    }
    model._signals.push({ netId, signalId, trunkId, branches: branches.map((e) => e.id) });
  }
  return model;
}

/** Collapse routing-only nodes back into semantic branches and pin the common source label. */
export function finishSignals(result, model) {
  if (!model._signals) return;
  const original = model._signalOriginal,
    originalEdges = new Map(original.connections.map((e) => [e.id, e]));
  for (const info of model._signals) {
    const node = result.modules.find((n) => n.id === info.signalId),
      trunk = result.connections.find((e) => e.id === info.trunkId);
    if (!node || !trunk) continue;
    const branches = result.connections.filter((e) => info.branches.includes(e.id)),
      ids = branches.map((e) => e.id);
    const first = originalEdges.get(branches[0].id),
      size = edgeLabelSize(first);
    const label = {
      position: { x: node.x + node.width / 2, y: node.y + node.height / 2, anchor: 'middle' },
      bounds: {
        x: node.x + (node.width - size.width) / 2,
        y: node.y + (node.height - size.height) / 2,
        ...size,
      },
      placement: 'inline',
      role: 'start',
      sharedKey: 'signal_' + info.netId,
      connectionIds: ids,
    };
    for (const edge of branches) {
      const ref = originalEdges.get(edge.id);
      const inlet = trunk.sections.at(-1).points.at(-1),
        outlet = edge.sections[0].points[0];
      edge.sections = [
        ...structuredClone(trunk.sections),
        { points: [{ ...inlet }, { ...outlet }] },
        ...edge.sections,
      ];
      edge.source = structuredClone(ref.originalSource ?? ref.source);
      edge.target = structuredClone(ref.originalTarget ?? ref.target);
      if (ref.originalSource) {
        edge.routingSource = structuredClone(ref.source);
        edge.routingTarget = structuredClone(ref.target);
      } else {
        delete edge.routingSource;
        delete edge.routingTarget;
      }
      edge.style = structuredClone(ref.style);
      edge.label = ref.label;
      edge.netId = ref.netId;
      edge.netStyle = structuredClone(ref.netStyle);
      edge.netTrunkSections = trunk.sections.length + 1;
      edge.connectionIndex = ref.connectionIndex;
      edge.branchIndex = ref.branchIndex;
      edge.signalLabel = structuredClone(label);
      edge.netSource = true;
    }
  }
  const signalIds = new Set(model._signals.map((s) => s.signalId)),
    trunks = new Set(model._signals.map((s) => s.trunkId));
  result.modules = result.modules.filter((n) => !signalIds.has(n.id));
  result.connections = result.connections.filter((e) => !trunks.has(e.id));
  result.groups = result.groups.filter((g) => !g._signalWrapper);
  for (const group of result.groups) {
    const ref = original.groups.find((g) => g.id === group.id);
    group.members = structuredClone(ref.members);
    group.depth = ancestors(original, group.id).length;
    group.blockIds = [...descendants(original, group.id)].filter((id) =>
      original.modules.some((n) => n.id === id),
    );
  }
}
