import { parseWaveform, waveformProblems, edgeIndex, tick, signalValue, fail } from './model.js';
import { documentDiff } from '../blockchart/edit-diff.js';

function signal(document, id) {
  const result = document.signals.find((s) => s.id === id);
  if (!result) throw new Error('Unknown signal: ' + id);
  return result;
}
function selectedEdge(document, op) {
  if (op.edgeId !== undefined) {
    if (op.signalId !== undefined || op.t !== undefined) throw new Error('Choose edgeId or signalId/t');
    const edge = edgeIndex(document).get(op.edgeId);
    if (!edge) throw new Error('Unknown edge: ' + op.edgeId);
    return edge.change;
  }
  tick(op.t, 't');
  const change = signal(document, op.signalId).changes.find((c) => c[0] === op.t);
  if (!change) throw new Error(`Unknown change: ${op.signalId} at ${op.t}`);
  return change;
}

function lockedOutgoing(document) {
  const result = new Map();
  for (const link of document.links ?? [])
    if (link.locked) {
      if (!result.has(link.from)) result.set(link.from, []);
      result.get(link.from).push(link);
    }
  return result;
}

// Plan first, then move together. Converging constraints must request the same time.
function follow(document, baseline, seeds) {
  if (!seeds.size) return;
  const outgoing = lockedOutgoing(document);
  const old = edgeIndex(baseline),
    current = edgeIndex(document),
    planned = new Map(seeds),
    queue = [...seeds.keys()];
  for (let i = 0; i < queue.length; i++) {
    const source = queue[i];
    for (const link of outgoing.get(source) ?? []) {
      if (!old.has(link.from) || !old.has(link.to) || !current.has(link.to))
        throw new Error('Locked link has a missing edge');
      const delta = link.delay ?? old.get(link.to).change[0] - old.get(link.from).change[0];
      const t = planned.get(source) + delta;
      if (planned.has(link.to) && planned.get(link.to) !== t)
        throw new Error('Conflicting locked targets: ' + link.to);
      if (!planned.has(link.to)) {
        planned.set(link.to, t);
        queue.push(link.to);
      }
    }
  }
  for (const [id, t] of planned) {
    tick(t, `edge ${id}`);
    current.get(id).change[0] = t;
  }
}

function coalesce(changes) {
  return changes.filter((c, i) => i === 0 || c[2] !== undefined || c[1] !== changes[i - 1][1]);
}
function valueAt(changes, t) {
  return changes.findLast((c) => c[0] <= t)[1];
}
function preserveNames(before, after) {
  const named = new Map(after.map((c) => [c[2], c]));
  for (const c of before)
    if (c[2] !== undefined && !named.has(c[2])) throw new Error('Would remove named edge: ' + c[2]);
  after.forEach((c, i) => {
    if (i && c[2] !== undefined && c[1] === after[i - 1][1])
      throw new Error('Would erase named transition: ' + c[2]);
  });
}
function range(op, length) {
  tick(op.from, 'from');
  tick(op.to, 'to');
  if (op.from >= op.to || op.to > length) throw new Error('Expected 0 <= from < to <= length');
}
function edit(document, op) {
  const fields = {
    moveEdge: ['edgeId', 'signalId', 't', 'to', 'followLocked'],
    shiftRange: ['signalIds', 'from', 'to', 'delta', 'includeMarkers', 'followLocked'],
    insertTicks: ['at', 'count'],
    deleteTicks: ['from', 'to'],
    setValue: ['signalId', 'from', 'to', 'value'],
    encodeBits: ['signalId', 'bits', 'zeroHigh', 'oneHigh'],
    nameEdge: ['edgeId', 'signalId', 't', 'name'],
    followLocked: ['edgeId'],
    setSignal: ['signal'],
    setLinks: ['links'],
    setMarkers: ['markers'],
    updateDocument: ['patch'],
  };
  if (!op || !Object.hasOwn(fields, op.op)) throw new Error('Unknown operation: ' + op?.op);
  if (Object.keys(op).some((key) => key !== 'op' && !fields[op.op].includes(key)))
    throw new Error('Unknown operation field');
  if (op.followLocked !== undefined && typeof op.followLocked !== 'boolean')
    throw new Error('followLocked must be a boolean');
  if (op.includeMarkers !== undefined && typeof op.includeMarkers !== 'boolean')
    throw new Error('includeMarkers must be a boolean');
  const baseline = structuredClone(document),
    seeds = new Map();
  switch (op.op) {
    case 'moveEdge': {
      const change = selectedEdge(document, op);
      if (!change[0]) throw new Error('Initial value at 0 cannot be moved');
      change[0] = tick(op.to, 'to', 1);
      if (change[2] !== undefined) seeds.set(change[2], change[0]);
      break;
    }
    case 'shiftRange': {
      range(op, document.length);
      if (!Number.isSafeInteger(op.delta)) throw new Error('delta must be an integer');
      const selected = op.signalIds ?? document.signals.map((s) => s.id);
      if (!Array.isArray(selected) || new Set(selected).size !== selected.length)
        throw new Error('signalIds must be a list of distinct ids');
      for (const id of selected)
        for (const change of signal(document, id).changes) {
          if (change[0] < op.from || change[0] >= op.to) continue;
          if (!change[0] && op.delta) throw new Error('Initial values cannot shift away from 0');
          change[0] += op.delta;
          if (change[2] !== undefined) seeds.set(change[2], change[0]);
        }
      if (op.includeMarkers ?? op.signalIds === undefined)
        for (const marker of document.markers ?? [])
          for (const key of ['t', 'from', 'to'])
            if (marker[key] >= op.from && marker[key] < op.to) marker[key] += op.delta;
      break;
    }
    case 'insertTicks': {
      tick(op.at, 'at');
      tick(op.count, 'count', 1);
      if (op.at > document.length) throw new Error('at exceeds length');
      document.length += op.count;
      // Initial values describe time 0 even when ticks are inserted at the origin.
      for (const s of document.signals)
        for (const c of s.changes) if (c[0] && c[0] >= op.at) c[0] += op.count;
      for (const m of document.markers ?? [])
        for (const k of ['t', 'from', 'to']) if (m[k] >= op.at) m[k] += op.count;
      if (document.grid && document.grid.offset >= op.at) document.grid.offset += op.count;
      break;
    }
    case 'deleteTicks': {
      range(op, document.length);
      if (op.to - op.from >= document.length) throw new Error('Cannot delete the complete duration');
      const warp = (t) => (t < op.from ? t : t < op.to ? op.from : t - (op.to - op.from));
      const used = new Set((document.links ?? []).flatMap((l) => [l.from, l.to]));
      for (const s of document.signals) {
        for (const c of s.changes)
          if (c[0] >= op.from && c[0] < op.to && used.has(c[2]))
            throw new Error('Would delete referenced edge: ' + c[2]);
        const kept = s.changes
          .filter((c) => c[0] < op.from || c[0] >= op.to)
          .map((c) => [warp(c[0]), c[1], ...c.slice(2)]);
        const at = kept.find((c) => c[0] === op.from);
        if (!at) kept.push([op.from, valueAt(s.changes, op.to)]);
        s.changes = coalesce(kept.sort((a, b) => a[0] - b[0]));
      }
      document.length -= op.to - op.from;
      for (const m of document.markers ?? [])
        for (const k of ['t', 'from', 'to']) if (m[k] !== undefined) m[k] = warp(m[k]);
      document.markers = document.markers?.filter((m) => m.t !== undefined || m.from < m.to);
      if (document.grid) document.grid.offset = warp(document.grid.offset);
      break;
    }
    case 'setValue': {
      range(op, document.length);
      const s = signal(document, op.signalId),
        before = s.changes;
      signalValue(op.value, s.width, 'value');
      const next = before.filter((c) => c[0] < op.from || c[0] >= op.to);
      next.push([op.from, op.value, ...(before.find((c) => c[0] === op.from)?.slice(2) ?? [])]);
      if (op.to < document.length && !next.some((c) => c[0] === op.to))
        next.push([op.to, valueAt(before, op.to)]);
      s.changes = coalesce(next.sort((a, b) => a[0] - b[0]));
      preserveNames(before, s.changes);
      break;
    }
    case 'encodeBits': {
      if (!document.grid) throw new Error('Bit encoding requires grid');
      const s = signal(document, op.signalId),
        { ticksPerBit, offset } = document.grid;
      if (
        s.width !== 1 ||
        !Array.isArray(op.bits) ||
        !op.bits.length ||
        op.bits.some((b) => b !== 0 && b !== 1)
      )
        throw new Error('Expected a bit lane and binary bits');
      for (const key of ['zeroHigh', 'oneHigh']) {
        tick(op[key], key);
        if (op[key] > ticksPerBit) throw new Error(key + ' must not exceed ticksPerBit');
      }
      if (offset + op.bits.length * ticksPerBit > document.length)
        throw new Error('Encoded bits exceed length');
      const changes = [[0, 0]];
      op.bits.forEach((bit, i) => {
        const start = offset + i * ticksPerBit;
        const high = bit ? op.oneHigh : op.zeroHigh;
        if (!start) changes[0][1] = high ? 1 : 0;
        else changes.push([start, high ? 1 : 0]);
        if (high && high < ticksPerBit) changes.push([start + high, 0]);
      });
      changes.push([offset + op.bits.length * ticksPerBit, 0]);
      const encoded = coalesce(changes);
      for (const c of encoded) {
        const old = s.changes.find((old) => old[0] === c[0]);
        if (old?.[2] !== undefined) c.push(old[2]);
      }
      preserveNames(s.changes, encoded);
      s.changes = encoded;
      break;
    }
    case 'nameEdge': {
      const change = selectedEdge(document, op);
      change[2] = op.name;
      break;
    }
    case 'followLocked': {
      const links = (document.links ?? []).filter((l) => l.locked),
        outgoing = lockedOutgoing(document),
        edges = edgeIndex(document);
      const sources = [...new Set(links.map((l) => l.from))],
        targets = new Set(links.map((l) => l.to)),
        covered = new Set();
      const starters =
        op.edgeId !== undefined ? [op.edgeId] : [...sources.filter((id) => !targets.has(id)), ...sources];
      for (const id of starters) {
        if (covered.has(id)) continue;
        const source = edges.get(id);
        if (!source) throw new Error('Unknown edge: ' + id);
        seeds.set(id, source.change[0]);
        const pending = [id];
        for (let i = 0; i < pending.length; i++) {
          if (covered.has(pending[i])) continue;
          covered.add(pending[i]);
          pending.push(...(outgoing.get(pending[i]) ?? []).map((l) => l.to));
        }
      }
      break;
    }
    case 'setSignal': {
      const index = document.signals.findIndex((s) => s.id === op.signal?.id);
      if (index < 0) document.signals.push(structuredClone(op.signal));
      else document.signals[index] = structuredClone(op.signal);
      break;
    }
    case 'setLinks':
      document.links = structuredClone(op.links);
      break;
    case 'setMarkers':
      document.markers = structuredClone(op.markers);
      break;
    case 'updateDocument': {
      if (
        !op.patch ||
        Object.keys(op.patch).some((k) => !['title', 'timescale', 'length', 'grid'].includes(k))
      )
        throw new Error('Unsupported document field');
      Object.assign(document, structuredClone(op.patch));
      break;
    }
    default:
      throw new Error('Unknown operation: ' + op?.op);
  }
  if (op.followLocked !== false) follow(document, baseline, seeds);
}

export function applyWaveformOps(value, operations, { allowProblems = false } = {}) {
  let document = parseWaveform(value);
  if (!Array.isArray(operations)) fail('operations', 'expected a list');
  if (typeof allowProblems !== 'boolean') fail('allowProblems', 'expected a boolean');
  for (const [i, operation] of operations.entries()) {
    try {
      edit(document, structuredClone(operation));
      document = parseWaveform(document);
    } catch (cause) {
      throw Object.assign(new Error(`ops[${i}] ${operation?.op}: ${cause.message}`, { cause }), {
        path: cause.path ?? `ops[${i}]`,
      });
    }
  }
  const result = parseWaveform(document),
    problems = waveformProblems(result);
  if (!allowProblems && problems.length) fail(problems[0].path, problems[0].message);
  return { document: result, diff: documentDiff(value, result), problems };
}
