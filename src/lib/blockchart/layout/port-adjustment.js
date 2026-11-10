import { routeFixed } from './fixed.js';
import { finishSignals } from './signals.js';
import { placeEdgeLabels } from './edge-labels.js';
import { applyConnectionArrows } from './arrows.js';
import { routeOuterFeedback } from './outer-feedback.js';
import { ancestors, parentOf } from '../hierarchy.js';
import { defaultSide, sideVector } from '../port-sides.js';

const EPS = 1e-6;
const key = (p) => (p.terminal !== undefined ? '@terminal:' + p.terminal : p.moduleId + '.' + p.portId);
const recordPoint = (result, record) =>
  record.terminal !== undefined
    ? result.terminals.find((t) => t.id === record.terminal).anchor
    : result.modules.find((n) => n.id === record.owner).ports.find((p) => p.id === record.port);
const overlap = (a, b, gap = 0) =>
  a.x < b.x + b.width + gap - EPS &&
  a.x + a.width + gap > b.x + EPS &&
  a.y < b.y + b.height + gap - EPS &&
  a.y + a.height + gap > b.y + EPS;
const contains = (box, item) =>
  item.x >= box.x - EPS &&
  item.y >= box.y - EPS &&
  item.x + item.width <= box.x + box.width + EPS &&
  item.y + item.height <= box.y + box.height + EPS;
const segments = (e) =>
  e.sections
    .flatMap((s) => s.points.slice(1).map((b, i) => [s.points[i], b]))
    .filter(([a, b]) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > EPS);
const strokeBox = (a, b, half) => ({
  x: Math.min(a.x, b.x) - half,
  y: Math.min(a.y, b.y) - half,
  width: Math.abs(a.x - b.x) + 2 * half,
  height: Math.abs(a.y - b.y) + 2 * half,
});
const samePoint = (a, b) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
const crossesBox = (a, b, r) =>
  Math.abs(a.y - b.y) < EPS
    ? a.y > r.y + EPS &&
      a.y < r.y + r.height - EPS &&
      Math.max(a.x, b.x) > r.x + EPS &&
      Math.min(a.x, b.x) < r.x + r.width - EPS
    : a.x > r.x + EPS &&
      a.x < r.x + r.width - EPS &&
      Math.max(a.y, b.y) > r.y + EPS &&
      Math.min(a.y, b.y) < r.y + r.height - EPS;

function quality(result, model, records) {
  let hits = 0,
    crossings = 0,
    bends = 0,
    length = 0,
    shift = 0;
  const refs = new Map(model.connections.map((e) => [e.id, e]));
  const paths = result.connections.map((e) => ({ edge: e, parts: segments(e) }));
  for (const { edge, parts } of paths) {
    const ref = refs.get(edge.id),
      exempt = new Set([
        ref.source.moduleId,
        ref.target.moduleId,
        ...ancestors(model, ref.source.moduleId),
        ...ancestors(model, ref.target.moduleId),
      ]);
    let previous;
    for (const [a, b] of parts) {
      const dir = Math.abs(a.y - b.y) < EPS ? (b.x > a.x ? 'R' : 'L') : b.y > a.y ? 'D' : 'U';
      if (previous && previous !== dir) bends++;
      previous = dir;
      length += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      for (const node of [...result.modules, ...result.groups]) {
        if (!exempt.has(node.id) && crossesBox(a, b, node)) hits++;
        if (node.members && !node.style.label.hidden && crossesBox(a, b, node.labelBounds)) hits++;
      }
      for (const terminal of result.terminals ?? [])
        if (
          ref.source.terminal !== terminal.id &&
          ref.target.terminal !== terminal.id &&
          !terminal.style.hidden &&
          crossesBox(a, b, terminal.labelBounds)
        )
          hits++;
    }
  }
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++) {
      if (paths[i].edge.netId === paths[j].edge.netId) continue;
      const ends = (p) => [p.edge.sections[0].points[0], p.edge.sections.at(-1).points.at(-1)];
      const shared = ends(paths[i]).filter((a) => ends(paths[j]).some((b) => samePoint(a, b)));
      for (const [a, b] of paths[i].parts)
        for (const [c, d] of paths[j].parts) {
          // Different boundary faces may legitimately join at the same fixed anchor.
          if (
            shared.some((p) => (samePoint(p, a) || samePoint(p, b)) && (samePoint(p, c) || samePoint(p, d)))
          )
            continue;
          if (
            overlap(
              strokeBox(a, b, paths[i].edge.style.strokeWidth / 2 + 1),
              strokeBox(c, d, paths[j].edge.style.strokeWidth / 2 + 1),
            )
          )
            crossings++;
        }
    }
  for (const record of records) {
    const p = recordPoint(result, record);
    shift += Math.abs(p[record.axis] - record.base);
  }
  return { hits, crossings, bends, length, shift };
}
const better = (a, b) =>
  a.hits <= b.hits &&
  a.crossings <= b.crossings &&
  (a.bends < b.bends ||
    (a.bends === b.bends &&
      (a.length < b.length - EPS || (Math.abs(a.length - b.length) < EPS && a.shift < b.shift - EPS))));

// Terminal moves can affect reserved receiver nodes. Check on
// a disposable finalized layout; routing-only signal nodes must not reach label placement.
function labelWarnings(result, model) {
  const trial = structuredClone(result);
  if (model.layout.feedbackRouting === 'outer') routeOuterFeedback(trial, model);
  finishSignals(trial, model);
  applyConnectionArrows(trial.connections);
  return placeEdgeLabels(trial).length;
}

/** Bounded, deterministic post-placement search. Authoring geometry is never mutated. */
export function adjustPorts(result, model) {
  if (
    (model.layout.portAdjustment ?? 'reduce-bends') !== 'reduce-bends' ||
    (model.layout.maxPortShift ?? 40) === 0
  )
    return;
  const guardLabels =
    (result.terminals?.length ?? 0) > 0 &&
    model.connections.some((e) => e.label !== undefined && !e.style.label.hidden);
  const original = guardLabels ? structuredClone(result) : null;
  search(result, model, true);
  if (!original || result.terminals.every((t, i) => samePoint(t.anchor, original.terminals[i].anchor)))
    return;
  const warnings = labelWarnings(result, model);
  if (!warnings) return;
  // Compare the complete Terminal adjustment with the ordinary Block-only pass.
  // Check finalized labels here; keep the Block-only result if clearance worsens.
  search(original, model, false);
  if (warnings > labelWarnings(original, model)) Object.assign(result, original);
}

function search(result, model, includeTerminals) {
  const maximum = model.layout.maxPortShift ?? 40,
    originals = new Map(model.modules.map((n) => [n.id, n]));
  const records = [],
    aliases = new Map();
  const ink = new Map();
  for (const edge of model.connections)
    for (const [ref, arrow, style] of [
      [
        edge.originalSource ?? edge.source,
        (edge.netStyle ?? edge.style).startArrow,
        edge.netStyle ?? edge.style,
      ],
      [edge.originalTarget ?? edge.target, edge.style.endArrow, edge.style],
    ])
      ink.set(
        key(ref),
        Math.max(
          ink.get(key(ref)) ?? 4,
          style.strokeWidth / 2,
          arrow === 'triangle' ? Math.max(8, style.strokeWidth * 3) / 2 : 0,
        ),
      );
  for (const node of result.modules) {
    const original = originals.get(node.id);
    if (
      original._signalSize ||
      original.type === 'concat' ||
      !['rectangle', 'stacked'].includes(original.appearance?.type ?? 'rectangle')
    )
      continue;
    for (const p of node.ports) {
      const side = p.side ?? defaultSide(p, model.layout.direction),
        axis = ['left', 'right'].includes(side) ? 'y' : 'x';
      const record = {
        key: node.id + '.' + p.id,
        owner: node.id,
        port: p.id,
        side,
        axis,
        base: p[axis],
        helpers: [],
      };
      for (const signal of model._signals ?? []) {
        const trunk = model.connections.find((e) => e.id === signal.trunkId);
        if (key(trunk.source) === node.id + '.' + p.id) record.helpers.push(signal.signalId);
        for (const receiver of signal.receivers ?? []) {
          const tail = model.connections.find((e) => e.id === receiver.tailId);
          if (key(tail.target) === record.key) record.helpers.push(receiver.signalId);
        }
      }
      records.push(record);
      aliases.set(node.id + '.' + p.id, record);
      for (const id of record.helpers)
        for (const port of result.modules.find((n) => n.id === id).ports)
          aliases.set(id + '.' + port.id, record);
    }
  }
  const terminalOrder = new Map();
  for (const terminal of includeTerminals ? (result.terminals ?? []) : []) {
    const axis = model.layout.direction === 'down' ? 'x' : 'y';
    const record = {
      key: key({ terminal: terminal.id }),
      terminal: terminal.id,
      axis,
      base: terminal.anchor[axis],
      helpers: [],
      wrapper: model.groups.find((g) => g._signalTerminal === terminal.id)?.id,
    };
    for (const signal of model._signals ?? [])
      for (const receiver of signal.receivers ?? []) {
        const tail = model.connections.find((e) => e.id === receiver.tailId);
        if (tail.target.terminal === terminal.id) record.helpers.push(receiver.signalId);
      }
    records.push(record);
    aliases.set(record.key, record);
    for (const id of record.helpers)
      for (const p of result.modules.find((n) => n.id === id).ports) aliases.set(id + '.' + p.id, record);
    if (!terminalOrder.has(terminal.direction)) terminalOrder.set(terminal.direction, []);
    terminalOrder.get(terminal.direction).push(record);
  }
  for (const list of terminalOrder.values()) list.sort((a, b) => a.base - b.base);
  // A feedback route keeps its anchors. Other ports on the same block remain eligible.
  const locked = new Set();
  for (const edge of model.connections)
    if (edge.feedback)
      for (const p of [edge.source, edge.target, edge.originalSource, edge.originalTarget].filter(Boolean))
        if (aliases.has(key(p))) locked.add(aliases.get(key(p)));
  const point = (r, ref) =>
    ref.terminal !== undefined
      ? r.terminals?.find((t) => t.id === ref.terminal)?.anchor
      : [...r.modules, ...r.groups]
          .find((n) => n.id === ref.moduleId)
          ?.ports.find((p) => p.id === ref.portId);
  const getPort = recordPoint;
  function interval(r, g) {
    if (g.terminal !== undefined) {
      const node = r.terminals.find((t) => t.id === g.terminal),
        axis = g.axis,
        extent = axis === 'y' ? 'height' : 'width',
        list = terminalOrder.get(node.direction),
        index = list.indexOf(g);
      let low = g.base - maximum,
        high = g.base + maximum;
      if (index > 0) {
        const previous = r.terminals.find((t) => t.id === list[index - 1].terminal);
        low = Math.max(low, previous[axis] + previous[extent] + 6 + node.anchor[axis] - node[axis]);
      }
      if (index < list.length - 1) {
        const next = r.terminals.find((t) => t.id === list[index + 1].terminal);
        high = Math.min(high, next[axis] - 6 - node[extent] + node.anchor[axis] - node[axis]);
      }
      return [low, high];
    }
    const node = r.modules.find((n) => n.id === g.owner),
      p = getPort(r, g),
      axis = g.axis,
      extent = axis === 'y' ? 'height' : 'width';
    const face =
      node.body?.type === 'stacked'
        ? node.body.shapes.at(-1)
        : { x: 0, y: 0, width: node.width, height: node.height };
    const corner = Math.max(8, (ink.get(g.owner + '.' + g.port) ?? 4) + 2);
    let low = Math.max(g.base - maximum, node[axis] + face[axis] + corner),
      high = Math.min(g.base + maximum, node[axis] + face[axis] + face[extent] - corner);
    const ports = node.ports.filter((t) => (t.side ?? defaultSide(t, model.layout.direction)) === g.side),
      i = ports.findIndex((t) => t.id === p.id);
    const half = (t) =>
      Math.max(t.style.hidden ? 0 : t.labelBounds[extent] / 2, ink.get(g.owner + '.' + t.id) ?? 4);
    if (i) low = Math.max(low, ports[i - 1][axis] + Math.max(24, half(ports[i - 1]) + half(p) + 6));
    if (i < ports.length - 1)
      high = Math.min(high, ports[i + 1][axis] - Math.max(24, half(ports[i + 1]) + half(p) + 6));
    if (!p.style.hidden) {
      low = Math.max(low, node[axis] + face[axis] + 2 - (p.labelBounds[axis] - p[axis]));
      high = Math.min(
        high,
        node[axis] + face[axis] + face[extent] - 2 - (p.labelBounds[axis] - p[axis]) - p.labelBounds[extent],
      );
    }
    return [low, high];
  }
  function slide(r, g, value) {
    const p = getPort(r, g),
      delta = value - p[g.axis];
    if (g.terminal !== undefined) {
      const terminal = r.terminals.find((t) => t.id === g.terminal);
      for (const item of [terminal, terminal.anchor, terminal.labelPosition, terminal.labelBounds])
        item[g.axis] += delta;
      if (g.wrapper) {
        const wrapper = r.groups.find((n) => n.id === g.wrapper);
        for (const item of [wrapper, wrapper.labelPosition, wrapper.labelBounds]) item[g.axis] += delta;
      }
    } else for (const item of [p, p.labelPosition, p.labelBounds]) item[g.axis] += delta;
    for (const id of g.helpers) {
      const n = r.modules.find((n) => n.id === id);
      for (const item of [
        n,
        n.labelPosition,
        n.labelBounds,
        ...n.ports.flatMap((p) => [p, p.labelPosition, p.labelBounds]),
      ])
        item[g.axis] += delta;
    }
  }
  function valid(r, groups) {
    for (const g of groups) {
      if (g.terminal !== undefined) {
        const terminal = r.terminals.find((t) => t.id === g.terminal),
          [low, high] = interval(r, g);
        if (terminal.anchor[g.axis] < low - EPS || terminal.anchor[g.axis] > high + EPS) return false;
        const ownAncestors = new Set(ancestors(model, '@terminal:' + terminal.id));
        for (const other of [...r.modules, ...r.groups, ...r.terminals])
          if (
            other !== terminal &&
            !ownAncestors.has(other.id) &&
            !g.helpers.includes(other.id) &&
            overlap(terminal, other, 3)
          )
            return false;
        for (const id of g.helpers) {
          const helper = r.modules.find((n) => n.id === id),
            parent = r.groups.find((n) => n.id === parentOf(model, id)),
            exempt = new Set(ancestors(model, id));
          if (parent && !contains(parent, helper)) return false;
          for (const other of [...r.modules, ...r.groups, ...r.terminals])
            if (other !== helper && !exempt.has(other.id) && overlap(helper, other, 3)) return false;
        }
        continue;
      }
      const node = r.modules.find((n) => n.id === g.owner),
        p = getPort(r, g),
        [low, high] = interval(r, g);
      if (p[g.axis] < low - EPS || p[g.axis] > high + EPS) return false;
      if (!p.style.hidden) {
        if (!node.style.label.hidden && overlap(p.labelBounds, node.labelBounds, 3)) return false;
        for (const q of node.ports)
          if (q !== p && !q.style.hidden && overlap(p.labelBounds, q.labelBounds, 3)) return false;
      }
      for (const id of g.helpers) {
        const n = r.modules.find((n) => n.id === id),
          parent = r.groups.find((n) => n.id === parentOf(model, id));
        if (parent && !contains(parent, n)) return false;
        for (const other of r.modules) if (other !== n && overlap(n, other, 3)) return false;
      }
    }
    return true;
  }
  const end = (r, ref, peer) => {
    const p = point(r, ref);
    if (!p) return null;
    let side;
    if (ref.terminal !== undefined) {
      const t = r.terminals.find((t) => t.id === ref.terminal);
      side =
        model.layout.direction === 'down'
          ? t.direction === 'input'
            ? 'bottom'
            : 'top'
          : t.direction === 'input'
            ? 'right'
            : 'left';
    } else {
      side = p.side ?? defaultSide(p, model.layout.direction);
      if (
        r.groups.some((g) => g.id === ref.moduleId) &&
        ancestors(model, peer.moduleId).includes(ref.moduleId)
      )
        side = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[side];
    }
    const group = aliases.get(key(ref));
    const axis = ['left', 'right'].includes(side) ? 'y' : 'x';
    return {
      p,
      side,
      axis,
      group: group && group.axis === axis && !locked.has(group) ? group : null,
    };
  };
  let score = quality(result, model, records),
    trials = 0;
  for (let pass = 0; pass < 4 && trials < 128; pass++) {
    let changed = false;
    for (const edge of model.connections) {
      if (edge.feedback || (edge._signalTrunk && edge.source.terminal === undefined)) continue;
      const a = end(result, edge.source, edge.target),
        b = end(result, edge.target, edge.source);
      if (!a || !b || a.axis !== b.axis || a.group === b.group || (!a.group && !b.group)) continue;
      const av = sideVector(a.side),
        bv = sideVector(b.side),
        dx = b.p.x - a.p.x,
        dy = b.p.y - a.p.y;
      if (av.x !== -bv.x || av.y !== -bv.y || dx * av.x + dy * av.y <= EPS) continue;
      const axis = a.axis;
      const range = (e) => {
        if (!e.group) return [e.p[axis], e.p[axis]];
        const p = getPort(result, e.group),
          [lo, hi] = interval(result, e.group),
          offset = e.p[axis] - p[axis];
        return [lo + offset, hi + offset];
      };
      const ar = range(a),
        br = range(b),
        low = Math.max(ar[0], br[0]),
        high = Math.min(ar[1], br[1]),
        candidates = [];
      if (low <= high + EPS) {
        for (const x of [b.p[axis], a.p[axis], (a.p[axis] + b.p[axis]) / 2, low, high])
          if (x >= low - EPS && x <= high + EPS) candidates.push([x, x]);
      } else
        candidates.push([
          Math.max(ar[0], Math.min(ar[1], b.p[axis])),
          Math.max(br[0], Math.min(br[1], a.p[axis])),
        ]);
      const seen = new Set();
      for (const [x, y] of candidates) {
        const signature = x + ':' + y;
        if (seen.has(signature)) continue;
        seen.add(signature);
        const moves = [
          [a, x],
          [b, y],
        ].filter(([e, v]) => e.group && Math.abs(v - e.p[axis]) > EPS);
        if (!moves.length) continue;
        if (++trials > 128) break;
        const trial = structuredClone(result),
          groups = moves.map(([e]) => e.group);
        for (const [e, value] of moves)
          slide(trial, e.group, getPort(result, e.group)[axis] + value - e.p[axis]);
        if (!valid(trial, groups)) continue;
        const moved = new Set(
          groups.flatMap((g) => [
            g.key,
            ...g.helpers.flatMap((id) =>
              result.modules.find((n) => n.id === id).ports.map((p) => id + '.' + p.id),
            ),
          ]),
        );
        const affected = new Set(
          model.connections
            .filter((e) => moved.has(key(e.source)) || moved.has(key(e.target)))
            .map((e) => e.id),
        );
        try {
          routeFixed(trial, model, false, affected);
        } catch {
          continue;
        }
        const next = quality(trial, model, records);
        if (better(next, score)) {
          Object.assign(result, trial);
          score = next;
          changed = true;
          break;
        }
      }
      if (trials >= 128) break;
    }
    if (!changed) break;
  }
}
