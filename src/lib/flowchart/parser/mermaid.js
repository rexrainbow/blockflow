import { createFlowchartModel } from '../model.js';

export class MermaidSyntaxError extends Error {
  constructor(message, source, offset) {
    const rows = source.slice(0, offset).split('\n'),
      line = rows.length,
      column = rows.at(-1).length + 1;
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'MermaidSyntaxError';
    this.line = line;
    this.column = column;
    this.offset = offset;
  }
}
/** A documented Mermaid Flowchart subset. Produces portable authoring JSON, not an ELK graph. */
export function parseMermaid(source) {
  if (typeof source !== 'string') throw new TypeError('Mermaid input must be a string');
  source = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let pos = 0;
  const nodes = new Map(),
    groups = [],
    stack = [],
    classes = new Map(),
    assignments = [],
    locations = new Map();
  const doc = {
    version: 1,
    diagram: { name: 'Flowchart' },
    layout: { direction: 'down' },
    nodes: [],
    edges: [],
  };
  const error = (message, at = pos) => {
    throw new MermaidSyntaxError(message, source, at);
  };
  const spaces = () => {
    while (/[ \t]/.test(source[pos] ?? '') && pos < source.length) pos++;
  };
  const separator = () => pos >= source.length || /[\n;]/.test(source[pos]);
  function identifier() {
    spaces();
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));
    if (!m) error('Expected an identifier');
    pos += m[0].length;
    return m[0];
  }
  function until(close) {
    const start = pos;
    let quoted = false,
      escaped = false;
    while (pos < source.length) {
      const c = source[pos];
      if (escaped) {
        escaped = false;
        pos++;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        pos++;
        continue;
      }
      if (c === '"') {
        quoted = !quoted;
        pos++;
        continue;
      }
      if (!quoted && source.startsWith(close, pos)) {
        const value = source.slice(start, pos).trim();
        pos += close.length;
        return value;
      }
      pos++;
    }
    error('Unterminated label; expected ' + close, start);
  }
  function label(value, at = pos) {
    const quoted = value.startsWith('"');
    if (quoted) {
      try {
        value = JSON.parse(value.replace(/\n/g, '\\n'));
      } catch {
        error('Invalid quoted label; use JSON string escapes', at);
      }
    } else if (value.includes('"')) error('Quote the complete label', at);
    if (!value.trim()) error('Labels must not be empty', at);
    value = value.replace(/<br\s*\/?\s*>/gi, '\n');
    return quoted ? value : value.replace(/\\n/g, '\n');
  }
  function properties() {
    const result = {};
    while (true) {
      spaces();
      const key = identifier();
      spaces();
      if (source[pos++] !== ':') error('Expected :', pos - 1);
      spaces();
      const start = pos;
      let value;
      if (source[pos] === '"') {
        pos++;
        let escaped = false;
        while (pos < source.length) {
          const c = source[pos++];
          if (c === '"' && !escaped) break;
          escaped = c === '\\' && !escaped;
        }
        value = label(source.slice(start, pos), start);
      } else {
        while (pos < source.length && !/[,}]/.test(source[pos])) pos++;
        value = source.slice(start, pos).trim();
      }
      if (Object.hasOwn(result, key)) error('Duplicate property ' + key, start);
      result[key] = value;
      spaces();
      if (source[pos] === '}') {
        pos++;
        return result;
      }
      if (source[pos++] !== ',') error('Expected , or }', pos - 1);
    }
  }
  function node() {
    spaces();
    const at = pos,
      key = identifier();
    let definition;
    spaces();
    if (source.startsWith('@{', pos)) {
      pos += 2;
      const props = properties();
      for (const k of Object.keys(props))
        if (!['shape', 'label'].includes(k)) error('Unsupported shape property ' + k, at);
      const shapes = {
        rect: 'process',
        rectangle: 'process',
        diam: 'decision',
        diamond: 'decision',
        decision: 'decision',
        stadium: 'terminator',
        rounded: 'terminator',
        doc: 'note',
        document: 'note',
      };
      if (!shapes[props.shape]) error('Unsupported shape ' + props.shape, at);
      definition = { type: shapes[props.shape], label: props.label ?? key };
    } else {
      for (const [open, close, type] of [
        ['([', '])', 'terminator'],
        ['[', ']', 'process'],
        ['{', '}', 'decision'],
        ['(', ')', 'terminator'],
      ])
        if (source.startsWith(open, pos)) {
          pos += open.length;
          definition = { type, label: label(until(close), at) };
          break;
        }
    }
    const existed = nodes.has(key);
    if (!existed) {
      nodes.set(key, { id: key, type: 'process', label: key });
      locations.set(key, at);
    }
    if (definition) Object.assign(nodes.get(key), definition);
    if (stack.length && (!existed || definition)) {
      const g = stack.at(-1);
      if (!g.members.includes(key)) g.members.push(key);
    }
    spaces();
    if (source.startsWith(':::', pos)) {
      pos += 3;
      assignments.push({ ids: [key], name: identifier(), at });
    }
    return key;
  }
  function endStatement() {
    spaces();
    if (!separator()) error('Expected an edge or end of statement; unsupported syntax');
  }
  function readStyle(kind = 'node') {
    const start = pos;
    while (!separator()) pos++;
    const css = source.slice(start, pos).trim(),
      style = {};
    if (!css) error('Expected style declarations', start);
    const map =
      kind === 'edge'
        ? {
            fill: 'labelBackgroundColor',
            stroke: 'strokeColor',
            color: 'color',
            'stroke-width': 'strokeWidth',
            'font-size': 'fontSize',
            opacity: 'opacity',
          }
        : {
            fill: 'fillColor',
            stroke: 'borderColor',
            color: 'color',
            'stroke-width': 'borderWidth',
            'font-size': 'fontSize',
            opacity: 'opacity',
          };
    for (const part of css.split(',')) {
      const m = /^\s*([a-z-]+)\s*:\s*(.*?)\s*$/.exec(part);
      if (!m || !map[m[1]]) error('Unsupported style declaration ' + part, start);
      const key = map[m[1]],
        value = m[2];
      if (!value.trim()) error('Expected a style value', start);
      style[key] = ['borderWidth', 'strokeWidth', 'fontSize', 'opacity'].includes(key)
        ? Number(value.replace(/px$/, ''))
        : value;
    }
    return style;
  }
  // Leading comments are allowed, but Mermaid init/config directives are explicit errors.
  function skip() {
    while (pos < source.length) {
      spaces();
      if (source.startsWith('%%{', pos)) error('Mermaid configuration directives are not supported');
      if (source.startsWith('%%', pos)) {
        while (pos < source.length && source[pos] !== '\n') pos++;
      } else if (/[\n;]/.test(source[pos] ?? '')) pos++;
      else break;
    }
  }
  skip();
  const header = /^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/.exec(source.slice(pos));
  if (!header) error('Expected flowchart TD, TB, LR, RL or BT');
  pos += header[0].length;
  doc.layout.direction = { TD: 'down', TB: 'down', LR: 'right', RL: 'left', BT: 'up' }[header[1]];
  endStatement();
  while (pos < source.length) {
    skip();
    if (pos >= source.length) break;
    const at = pos;
    const keyword = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (keyword === 'subgraph') {
      identifier();
      spaces();
      const key = identifier();
      spaces();
      let name = key;
      if (source[pos] === '[') {
        pos++;
        name = label(until(']'), at);
      }
      const group = { id: key, label: name, members: [] };
      groups.push(group);
      if (stack.length) stack.at(-1).members.push(key);
      stack.push(group);
      locations.set(key, at);
      endStatement();
      continue;
    }
    if (keyword === 'end') {
      identifier();
      if (!stack.length) error('Unexpected end', at);
      stack.pop();
      endStatement();
      continue;
    }
    if (keyword === 'classDef') {
      identifier();
      const name = identifier();
      classes.set(name, readStyle());
      continue;
    }
    if (keyword === 'style') {
      identifier();
      const key = identifier(),
        style = readStyle();
      assignments.push({ ids: [key], style, at });
      continue;
    }
    if (keyword === 'linkStyle') {
      identifier();
      spaces();
      const m = /^(default|[0-9]+(?:,[0-9]+)*)/.exec(source.slice(pos));
      if (!m) error('Expected edge indices or default');
      pos += m[0].length;
      assignments.push({
        edgeIndices: m[0] === 'default' ? 'default' : m[0].split(',').map(Number),
        style: readStyle('edge'),
        at,
      });
      continue;
    }
    if (keyword === 'class') {
      identifier();
      const ids = [identifier()];
      spaces();
      while (source[pos] === ',') {
        pos++;
        ids.push(identifier());
        spaces();
      }
      const name = identifier();
      assignments.push({ ids, name, at });
      endStatement();
      continue;
    }
    if (['click', 'direction'].includes(keyword)) error('Unsupported Mermaid directive ' + keyword, at);
    let from = node();
    while (true) {
      spaces();
      if (separator()) break;
      let token = ['-.->', '-.-', '-->', '---', '==>'].find((t) => source.startsWith(t, pos)),
        edgeLabel;
      if (!token && source.startsWith('--', pos)) {
        pos += 2;
        const start = pos,
          end = source.indexOf('-->', pos);
        if (end < 0 || source.slice(pos, end).includes('\n')) error('Expected --> after edge label', start);
        edgeLabel = label(source.slice(pos, end).trim(), start);
        pos = end;
        token = '-->';
      }
      if (!token) error('Expected a supported edge (-->, ---, -.->, -.- or ==>)');
      pos += token.length;
      spaces();
      if (source[pos] === '|') {
        pos++;
        edgeLabel = label(until('|'));
        spaces();
      }
      const to = node(),
        edge = { id: 'edge_' + (doc.edges.length + 1), from, to, arrow: token.endsWith('>') };
      if (edgeLabel !== undefined) edge.label = edgeLabel;
      if (token === '---' || token === '-.-') edge.arrow = false;
      if (token.startsWith('-.')) edge.style = { lineStyle: 'dotted' };
      if (token === '==>') edge.style = { strokeWidth: 3 };
      doc.edges.push(edge);
      locations.set(edge.id, at);
      from = to;
    }
  }
  if (stack.length) error('Unclosed subgraph', locations.get(stack.at(-1).id));
  if (classes.has('default')) doc.diagram.style = { ...doc.diagram.style, node: classes.get('default') };
  for (const a of assignments) {
    if (a.edgeIndices) {
      if (a.edgeIndices === 'default') {
        doc.diagram.style ??= {};
        doc.diagram.style.edge = { ...doc.diagram.style.edge, ...a.style };
      } else
        for (const i of a.edgeIndices) {
          if (!doc.edges[i]) error('Unknown edge index ' + i, a.at);
          doc.edges[i].style = { ...doc.edges[i].style, ...a.style };
        }
      continue;
    }
    const targetStyle = a.style ?? classes.get(a.name);
    if (!targetStyle) error('Unknown class ' + a.name, a.at);
    for (const key of a.ids) {
      const target = nodes.get(key) ?? groups.find((g) => g.id === key);
      if (!target) error('Unknown style target ' + key, a.at);
      target.style = { ...target.style, ...targetStyle };
    }
  }
  doc.nodes = [...nodes.values()];
  if (groups.length) doc.groups = groups;
  for (const edge of doc.edges)
    if ([edge.from, edge.to].some((key) => nodes.get(key).type === 'note')) {
      edge.kind = 'association';
      edge.style ??= { lineStyle: 'solid' };
    }
  try {
    createFlowchartModel(doc);
  } catch (e) {
    const match = /^(nodes|edges|groups)\[(\d+)\]/.exec(e.path ?? '');
    const key = match ? doc[match[1]]?.[Number(match[2])]?.id : e.path?.split('.')[1];
    error(e.message, locations.get(key) ?? 0);
  }
  return doc;
}
