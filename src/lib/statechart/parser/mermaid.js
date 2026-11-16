import { createStatechartModel } from '../model.js';

export class StatechartSyntaxError extends Error {
  constructor(message, line, column = 1) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'StatechartSyntaxError';
    this.line = line;
    this.column = column;
  }
}
/** Deliberately flat stateDiagram-v2 subset. Conditions and actions remain plain text. */
export function parseMermaid(source) {
  if (typeof source !== 'string') throw new TypeError('Expected Mermaid text');
  const doc = {
    version: 1,
    diagram: { name: 'Statechart' },
    layout: { direction: 'down' },
    states: [],
    transitions: [],
  };
  const states = new Map(),
    bodies = new Map(),
    reserved = new Set();
  const lines = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  let header = false,
    initial,
    final;
  // Prevent generated pseudostate IDs from colliding with later declarations.
  for (const m of source.matchAll(/\b[A-Za-z_][A-Za-z0-9_-]*\b/g)) reserved.add(m[0]);
  function state(id) {
    if (!states.has(id)) {
      const s = { id };
      states.set(id, s);
      doc.states.push(s);
    }
    return states.get(id);
  }
  function pseudo(kind) {
    let id = kind === 'initial' ? initial : final;
    if (id) return id;
    let n = 1;
    while (reserved.has(`${kind}_${n}`)) n++;
    id = `${kind}_${n}`;
    reserved.add(id);
    state(id).kind = kind;
    if (kind === 'initial') initial = id;
    else final = id;
    return id;
  }
  let row = 0;
  for (const line of lines) {
    row++;
    const s = line.trim();
    if (!s || s.startsWith('%%')) continue;
    const error = (message) => {
      throw new StatechartSyntaxError(message, row, line.indexOf(s) + 1);
    };
    if (!header) {
      if (s !== 'stateDiagram-v2') error('Expected stateDiagram-v2');
      header = true;
      continue;
    }
    let m;
    if ((m = /^direction\s+(TB|TD|LR|BT|RL)$/.exec(s))) {
      doc.layout.direction = { TB: 'down', TD: 'down', LR: 'right', BT: 'up', RL: 'left' }[m[1]];
      continue;
    }
    if ((m = /^state\s+"((?:[^"\\]|\\.)*)"\s+as\s+([A-Za-z_][A-Za-z0-9_-]*)$/.exec(s))) {
      let label;
      try {
        label = JSON.parse('"' + m[1] + '"');
      } catch {
        error('Invalid quoted state label');
      }
      state(m[2]).label = label;
      continue;
    }
    if (
      (m = /^([A-Za-z_][A-Za-z0-9_-]*|\[\*\])\s*-->\s*([A-Za-z_][A-Za-z0-9_-]*|\[\*\])(?:\s*:\s*(.+))?$/.exec(
        s,
      ))
    ) {
      if (m[1] === '[*]' && m[2] === '[*]') error('A transition needs a real state');
      const from = m[1] === '[*]' ? pseudo('initial') : state(m[1]).id,
        to = m[2] === '[*]' ? pseudo('final') : state(m[2]).id;
      doc.transitions.push({ from, to, ...(m[3] ? { label: m[3] } : {}) });
      continue;
    }
    if ((m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/.exec(s))) {
      state(m[1]);
      const body = bodies.get(m[1]) ?? [];
      body.push(m[2]);
      bodies.set(m[1], body);
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(s)) {
      state(s);
      continue;
    }
    error('Unsupported stateDiagram-v2 syntax');
  }
  if (!header) throw new StatechartSyntaxError('Expected stateDiagram-v2', 1);
  for (const [id, rows] of bodies) {
    const s = state(id);
    if (!s.label) s.label = rows.shift();
    if (rows.length) s.description = rows.join('\n');
  }
  try {
    createStatechartModel(doc);
  } catch (e) {
    throw new StatechartSyntaxError(e.message, row || 1);
  }
  return doc;
}
