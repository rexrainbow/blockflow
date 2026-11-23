import { allocateTracks, requiredTrackSpace } from './channel-allocation.js';
import { lineWidth, endpointEscape, obstacleClearance } from './routing-spacing.js';
import { defaultSide } from '../port-sides.js';
import { translateNode } from './translate.js';
import { groupGeometry } from './groups.js';

const eps = 1e-6;

/** Conservative geometric bands, not guessed ELK rank IDs. Different-height nodes
 * with overlapping flow envelopes belong together. Touching envelopes can separate. */
export function autoBands(children, axis) {
  const extent = axis === 'y' ? 'height' : 'width',
    bands = [];
  for (const node of [...children].sort((a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id, 'en'))) {
    const last = bands.at(-1),
      start = node[axis],
      end = start + node[extent];
    if (last && start < last.end - eps) {
      last.nodes.push(node);
      last.end = Math.max(last.end, end);
    } else bands.push({ nodes: [node], start, end });
  }
  return bands;
}

/** One bottom-up pass, outside Grid-controlled / protected subtrees. Private plans
 * retain live nodes; root movement of a Grid sibling carries its existing plans too. */
export function planAutoChannels(result, model) {
  result._autoChannels = [];
  const down = model.layout.direction === 'down',
    axis = down ? 'y' : 'x',
    cross = down ? 'x' : 'y';
  const extent = down ? 'height' : 'width',
    crossExtent = down ? 'width' : 'height';
  const nodes = new Map([...result.modules, ...result.groups].map((n) => [n.id, n]));
  const terminalSet = new Set(result.terminals ?? []);
  for (const t of terminalSet) nodes.set('@terminal:' + t.id, t);
  const refs = new Map(model.groups.map((g) => [g.id, g]));
  const snapshots = new Map();
  function capture(group) {
    const ref = refs.get(group.id);
    if (
      group.collapsed ||
      ref?.layout?.type === 'grid' ||
      (!ref?._signalWrapper && (ref?.type !== 'container' || group.portMode === 'boundary'))
    )
      return;
    const children = (group.members ?? []).map((id) => nodes.get(id)).filter(Boolean);
    snapshots.set(group.id, autoBands(children, axis));
    for (const child of children) if (child.members) capture(child);
  }
  const contained = new Set(result.groups.flatMap((g) => g.members ?? []));
  const roots = [...result.modules, ...result.groups, ...(result.terminals ?? [])].filter(
    (n) => !contained.has(terminalSet.has(n) ? '@terminal:' + n.id : n.id),
  );
  const rootBands = autoBands(roots, axis);
  // A root Grid controls every descendant's outer placement in this first phase.
  if (!model.rootGroupId && model.layout.type === 'grid') return false;
  for (const n of roots) if (n.members) capture(n);
  let changed = false;
  function shift(node, delta) {
    if (Math.abs(delta) < eps) return;
    translateNode(node, down ? 0 : delta, down ? delta : 0);
    for (const id of node.members ?? []) {
      const child = nodes.get(id);
      if (child) shift(child, delta);
    }
    changed = true;
  }
  function moveBands(bands, gaps) {
    let delta = 0;
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      for (const node of band.nodes) shift(node, delta);
      if (i + 1 < bands.length) {
        const end = Math.max(...band.nodes.map((n) => n[axis] + n[extent]));
        const nextStart = bands[i + 1].start + delta;
        const oldGap = Math.max(0, bands[i + 1].start - band.end);
        delta += Math.max(0, end + Math.max(oldGap, gaps.get(i) ?? 0) - nextStart);
      }
    }
  }
  function channelsFor(group, bands) {
    const slots = new Map(),
      atoms = new Map();
    function register(node, band, atom) {
      if (node.members) {
        if (!refs.get(node.id)?._signalWrapper) return;
        for (const id of node.members) {
          const child = nodes.get(id);
          if (child) register(child, band, atom);
        }
      } else if (!terminalSet.has(node)) {
        slots.set(node.id, band);
        atoms.set(node.id, atom);
      }
    }
    bands.forEach((band, i) => band.nodes.forEach((n) => register(n, i, n)));
    const channels = new Map();
    for (const edge of model.connections) {
      if (edge.feedback || edge.direction === 'both' || edge._signalTrunk || edge._signalTail) continue;
      const a = slots.get(edge.source.moduleId),
        b = slots.get(edge.target.moduleId);
      if (a === undefined || b !== a + 1 || (edge.scope && edge.scope !== group.id)) continue;
      const source = nodes.get(edge.source.moduleId),
        target = nodes.get(edge.target.moduleId);
      const sp = source.ports.find((p) => p.id === edge.source.portId),
        tp = target.ports.find((p) => p.id === edge.target.portId);
      if (
        (sp.side ?? defaultSide(sp, model.layout.direction)) !== (down ? 'bottom' : 'right') ||
        (tp.side ?? defaultSide(tp, model.layout.direction)) !== (down ? 'top' : 'left') ||
        Math.abs(sp[cross] - tp[cross]) < eps
      )
        continue;
      if (!channels.has(a))
        channels.set(a, {
          kind: 'auto',
          owner: group.id,
          axis,
          nodes: bands[a].nodes,
          targets: bands[b].nodes,
          branches: [],
          margin: 0,
          inset: 0,
        });
      const channel = channels.get(a),
        sa = atoms.get(source.id),
        ta = atoms.get(target.id);
      channel.branches.push({
        id: edge.id,
        net: edge.netId ?? edge.id,
        lo: Math.min(sa[cross], ta[cross]),
        hi: Math.max(sa[cross] + sa[crossExtent], ta[cross] + ta[crossExtent]),
        width: lineWidth(edge),
        sourceNode: sa,
        targetNode: ta,
      });
      channel.margin = Math.max(
        channel.margin,
        endpointEscape(edge, true) + obstacleClearance(edge) + 2,
        endpointEscape(edge, false) + obstacleClearance(edge) + 2,
      );
    }
    const gaps = new Map();
    for (const [index, channel] of channels) {
      channel.tracks = allocateTracks(channel.branches);
      // Leave isolated and disjoint traffic with ELK; only congestion needs a new budget.
      if (channel.tracks.length < 2) continue;
      channel.required = requiredTrackSpace(channel.tracks, channel.margin);
      gaps.set(index, channel.required);
      result._autoChannels.push(channel);
    }
    return gaps;
  }
  function visit(group) {
    const bands = snapshots.get(group.id);
    if (!bands) return;
    const ref = refs.get(group.id);
    for (const band of bands) for (const child of band.nodes) if (child.members) visit(child);
    if (ref._signalWrapper) return;
    const gaps = channelsFor(group, bands);
    const needsSpace = bands.some(
      (band, i) =>
        Math.max(...band.nodes.map((n) => n[axis] + n[extent])) > band.end + eps ||
        (i + 1 < bands.length && (gaps.get(i) ?? 0) > bands[i + 1].start - band.end + eps),
    );
    if (!needsSpace) return;
    moveBands(bands, gaps);
    const children = bands.flatMap((b) => b.nodes),
      pad = groupGeometry(ref, model.layout.direction, model);
    for (const [position, size, trailing] of [
      ['x', 'width', 'right'],
      ['y', 'height', 'bottom'],
    ]) {
      const required = Math.max(
        group[size],
        ...children.map((n) => n[position] + n[size] - group[position] + pad[trailing]),
      );
      if (required > group[size] + eps) {
        group[size] = required;
        changed = true;
      }
    }
  }
  for (const n of roots) if (n.members) visit(n);
  moveBands(rootBands, new Map());
  return changed;
}
