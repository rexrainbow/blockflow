import { edgeLabelSize } from '../edge-labels.js';
import { descendants, ancestors } from '../../hierarchy.js';

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
      const receiver = info.receivers?.find((r) => r.branchId === edge.id);
      if (receiver) {
        const node = result.modules.find((n) => n.id === receiver.signalId),
          tail = result.connections.find((e) => e.id === receiver.tailId);
        const inlet = edge.sections.at(-1).points.at(-1),
          outlet = tail.sections[0].points[0],
          size = edgeLabelSize(ref);
        edge.sections.push({ points: [{ ...inlet }, { ...outlet }] }, ...structuredClone(tail.sections));
        edge.signalEndLabel = {
          position: { x: node.x + node.width / 2, y: node.y + node.height / 2, anchor: 'middle' },
          bounds: {
            x: node.x + (node.width - size.width) / 2,
            y: node.y + (node.height - size.height) / 2,
            ...size,
          },
          placement: 'inline',
          role: 'end',
        };
        const shared = info.receivers.filter((r) => r.signalId === receiver.signalId);
        if (shared.length > 1)
          Object.assign(edge.signalEndLabel, {
            sharedKey: `receiver_${info.netId.length}_${info.netId}_${tail.target.moduleId.length}_${tail.target.moduleId}_${tail.target.portId}`,
            connectionIds: shared.map((r) => r.branchId),
          });
      }
      edge.netSource = true;
    }
  }
  const signalIds = new Set(
      model._signals.flatMap((s) => [s.signalId, ...(s.receivers ?? []).map((r) => r.signalId)]),
    ),
    trunks = new Set(model._signals.flatMap((s) => [s.trunkId, ...(s.receivers ?? []).map((r) => r.tailId)]));
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
