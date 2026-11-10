import { edgeLabelSize } from '../edge-labels.js';
import { parentOf } from '../../hierarchy.js';
import { resolveGroupStyle, resolveModuleStyle, TEXT_STYLE } from '../../styles.js';
import { createConnectionContext } from '../../connectivity.js';
import { endpointValue } from '../../endpoints.js';
import { defaultSide } from '../../port-sides.js';

/** Compile authored Nets into a routing-only graph. No synthetic object enters saved JSON. */
export function signalModel(input, receivers = new Set()) {
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
  const used = new Set(
    [...model.modules, ...model.groups, ...(model.terminals ?? []), ...model.connections].map((n) => n.id),
  );
  const unique = (base) => {
    let id = base;
    while (used.has(id)) id += '_';
    used.add(id);
    return id;
  };
  const wrappers = new Map(),
    context = createConnectionContext(input);
  const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
  const wrap = (ownerId) => {
    let wrapper = wrappers.get(ownerId);
    if (wrapper) return wrapper;
    const parent = parentOf(model, ownerId),
      id = unique('_signal_owner_' + ownerId);
    wrapper = {
      id,
      label: id,
      type: 'container',
      portMode: 'direct',
      ports: [],
      members: [ownerId],
      collapsed: false,
      style: resolveGroupStyle({ borderOpacity: 0, fillOpacity: 0, label: { hidden: true } }),
      _signalWrapper: true,
    };
    const owner = model.groups.find((g) => g.id === parent);
    if (owner) owner.members = owner.members.map((value) => (value === ownerId ? id : value));
    for (const config of [model.layout, ...model.groups.map((g) => g.layout)].filter(Boolean))
      if (config.cells)
        config.cells = config.cells.map((row) => row.map((value) => (value === ownerId ? id : value)));
    model.groups.push(wrapper);
    wrappers.set(ownerId, wrapper);
    return wrapper;
  };
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
    if (resolved.source) {
      let side = resolved.source.port.side ?? defaultSide(resolved.source.port, model.layout.direction);
      if (resolved.source.inside) side = opposite[side];
      signal.ports[0].side = opposite[side];
      signal.ports[1].side = side;
    }
    let parent = sourceId ? parentOf(model, sourceId) : '';
    if (sourceGroup && resolved.source?.inside) parent = sourceId;
    if (sourceId && !(sourceGroup && resolved.source?.inside)) {
      const wrapper = wrap(sourceId);
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
    model._signals.push({ netId, signalId, trunkId, branches: branches.map((e) => e.id), receivers: [] });
  }
  const receiverNodes = new Map();
  for (const originalEdge of input.connections.filter((e) => receivers.has(e.id))) {
    const edge = model.connections.find((e) => e.id === originalEdge.id),
      info = model._signals.find((s) => s.netId === edge.netId);
    const receiverKey = JSON.stringify([edge.netId, originalEdge.target]),
      existing = receiverNodes.get(receiverKey);
    // A collapsed Collection can project many semantic branches onto one visible Port.
    if (existing) {
      edge.target = { moduleId: existing.signalId, portId: 'in' };
      info.receivers.push({ ...existing, branchId: edge.id });
      continue;
    }
    const owner = [...model.modules, ...model.groups].find((n) => n.id === originalEdge.target.moduleId);
    const targetPort = owner?.ports.find((p) => p.id === originalEdge.target.portId);
    const resolved = context.resolve(
      endpointValue(originalEdge.source),
      endpointValue(originalEdge.target),
      originalEdge.direction,
    );
    let side = targetPort?.side ?? defaultSide({ direction: 'input' }, model.layout.direction);
    if (resolved.target?.inside) side = opposite[side];
    const signalId = unique('_signal_end_' + edge.id),
      tailId = unique('_signal_tail_' + edge.id);
    const size = edgeLabelSize(originalEdge);
    const node = {
      id: signalId,
      label: edge.label,
      ports: ['in', 'out'].map((id, i) => ({
        id,
        direction: i ? 'output' : 'input',
        width: edge.width,
        displayName: id,
        order: 0,
        side: i ? opposite[side] : side,
        style: { ...TEXT_STYLE, hidden: true },
      })),
      style: resolveModuleStyle(
        {},
        { borderOpacity: 0, fillOpacity: 0, label: { ...edge.style.label, hidden: true } },
      ),
      _signalSize: { width: Math.max(1, size.width), height: Math.max(1, size.height) },
    };
    model.modules.push(node);
    let parent = '';
    if (owner) {
      if (owner.members && !owner.collapsed && resolved.target?.inside) {
        parent = owner.id;
        owner.members.push(signalId);
      } else {
        const wrapper = wrap(owner.id);
        wrapper.members.push(signalId);
        parent = wrapper.id;
        wrapper._signalSides ??= [];
        if (!wrapper._signalSides.includes(side)) wrapper._signalSides.push(side);
        if (wrapper._signalSides.length === 1)
          wrapper._signalDirection = { left: 'right', right: 'left', top: 'down', bottom: 'up' }[side];
        else delete wrapper._signalDirection;
      }
    } else if (originalEdge.target.terminal !== undefined) {
      const wrapper = wrap('@terminal:' + originalEdge.target.terminal);
      wrapper._signalTerminal = originalEdge.target.terminal;
      wrapper.members.push(signalId);
      parent = wrapper.id;
    }
    const tail = {
      ...structuredClone(edge),
      id: tailId,
      _signalTail: true,
      source: { moduleId: signalId, portId: 'out' },
      target: structuredClone(originalEdge.target),
      scope: parent,
      insideSelfLoop: false,
      feedback: false,
      constraint: true,
      style: {
        ...edge.style,
        startArrow: 'none',
        endArrow: 'none',
        label: { ...edge.style.label, hidden: true },
      },
    };
    delete tail.label;
    delete tail.originalSource;
    delete tail.originalTarget;
    edge.target = { moduleId: signalId, portId: 'in' };
    model.connections.push(tail);
    info.receivers.push({ branchId: edge.id, signalId, tailId });
    receiverNodes.set(receiverKey, { signalId, tailId });
  }
  // Reserve a cross-axis slot per Port, including Ports without a repeated name.
  // This keeps a receiving label out of neighbouring Port access corridors.
  for (const owner of [
    ...model.modules.filter((n) => !n._signalSize),
    ...model.groups.filter((g) => !g._signalWrapper),
  ]) {
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const ports = owner.ports.filter((p) => (p.side ?? defaultSide(p, model.layout.direction)) === side);
      const labels = model._signals
        .flatMap((s) => s.receivers)
        .filter((r) => {
          const tail = model.connections.find((e) => e.id === r.tailId);
          return tail.target.moduleId === owner.id && ports.some((p) => p.id === tail.target.portId);
        })
        .map((r) => model.modules.find((n) => n.id === r.signalId));
      if (!labels.length || ports.length < 2) continue;
      const horizontal = side === 'top' || side === 'bottom',
        axis = horizontal ? 'width' : 'height',
        unit = horizontal ? 140 : 84;
      const slot = Math.max(...labels.map((n) => n._signalSize[axis])) + 24;
      owner[axis] = Math.max(owner[axis] ?? 0, (slot * (ports.length + 1)) / unit);
    }
  }
  return model;
}
