export class FlowchartValidationError extends Error {
  constructor(message, path = '') {
    super(`${path ? path + ': ' : ''}${message}`);
    this.name = 'FlowchartValidationError';
    this.path = path;
  }
}
export const NODE_STYLE = Object.freeze({
  fillColor: '#eaf2ff',
  borderColor: '#52606d',
  borderWidth: 1.1,
  borderStyle: 'solid',
  borderRadius: 0,
  color: '#243b53',
  fontSize: 12,
  padding: 12,
  opacity: 1,
});
export const EDGE_STYLE = Object.freeze({
  strokeColor: '#34495e',
  strokeWidth: 1.2,
  lineStyle: 'solid',
  color: '#34495e',
  fontSize: 11,
  labelBackgroundColor: '#ffffff',
  opacity: 1,
});
const fail = (message, path) => {
  throw new FlowchartValidationError(message, path);
};
const own = (o, k) => Object.hasOwn(o, k);
function object(o, keys, path) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail('Expected an object', path);
  for (const k of Object.keys(o)) if (!keys.includes(k)) fail('Unsupported property: ' + k, path + '.' + k);
}
function text(v, path) {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u.test(v) ||
    v.includes('\t')
  )
    fail('Expected nonempty XML-compatible text', path);
  return v.replace(/\r\n?/g, '\n');
}
function id(v, path) {
  if (typeof v !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(v)) fail('Expected an identifier', path);
  return v;
}
function choice(v, values, path) {
  if (!values.includes(v)) fail('Expected ' + values.join(', '), path);
  return v;
}
function number(v, path, zero = false) {
  if (typeof v !== 'number' || !Number.isFinite(v) || (zero ? v < 0 : v <= 0))
    fail('Expected a finite ' + (zero ? 'non-negative' : 'positive') + ' number', path);
  return v;
}
export function parseFlowStyle(raw = {}, kind = 'node', path = 'style') {
  const defaults = kind === 'edge' ? EDGE_STYLE : NODE_STYLE;
  object(raw, [...Object.keys(defaults), 'textAlign'], path);
  const result = {};
  for (const [k, v] of Object.entries(raw)) {
    const p = path + '.' + k;
    if (k === 'textAlign') result[k] = choice(v, ['left', 'center', 'right'], p);
    else if (k.endsWith('Color') || k === 'color') {
      if (v === 'transparent') result[k] = '#00000000';
      else {
        if (typeof v !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(v))
          fail('Expected a hex color or transparent', p);
        result[k] = (v.length <= 5 ? '#' + [...v.slice(1)].map((c) => c + c).join('') : v).toLowerCase();
      }
    } else if (k === 'lineStyle' || k === 'borderStyle')
      result[k] = choice(v, ['solid', 'dashed', 'dotted'], p);
    else {
      result[k] = number(v, p, ['opacity', 'padding', 'borderRadius'].includes(k));
      if (k === 'opacity' && v > 1) fail('Expected opacity in [0, 1]', p);
    }
  }
  return result;
}
export function createFlowchartModel(raw) {
  object(raw, ['version', 'diagram', 'layout', 'nodes', 'edges', 'groups'], 'document');
  if (raw.version !== 1) fail('Expected version 1', 'version');
  object(raw.diagram, ['name', 'caption', 'style'], 'diagram');
  const diagram = { name: text(raw.diagram.name, 'diagram.name') };
  if (own(raw.diagram, 'caption')) diagram.caption = text(raw.diagram.caption, 'diagram.caption');
  const global = raw.diagram.style ?? {};
  object(global, ['node', 'edge', 'group', 'note'], 'diagram.style');
  for (const k of Object.keys(global))
    parseFlowStyle(global[k], k === 'edge' ? 'edge' : 'node', 'diagram.style.' + k);
  const conf = raw.layout ?? {};
  object(conf, ['direction', 'nodeSpacing', 'layerSpacing', 'noteGap', 'loopSide'], 'layout');
  const layout = {
    direction: choice(conf.direction ?? 'down', ['down', 'right', 'up', 'left'], 'layout.direction'),
    nodeSpacing: number(conf.nodeSpacing ?? 40, 'layout.nodeSpacing'),
    layerSpacing: number(conf.layerSpacing ?? 60, 'layout.layerSpacing'),
    noteGap: number(conf.noteGap ?? 40, 'layout.noteGap'),
    loopSide: choice(conf.loopSide ?? 'auto', ['auto', 'left', 'right', 'top', 'bottom'], 'layout.loopSide'),
  };
  const vertical = ['down', 'up'].includes(layout.direction);
  if (
    layout.loopSide !== 'auto' &&
    !(vertical ? ['left', 'right'] : ['top', 'bottom']).includes(layout.loopSide)
  )
    fail('Loop side must be perpendicular to flow', 'layout.loopSide');
  if (!Array.isArray(raw.nodes) || !raw.nodes.length) fail('Expected a nonempty node array', 'nodes');
  if (!Array.isArray(raw.edges)) fail('Expected an edge array', 'edges');
  if (raw.groups !== undefined && !Array.isArray(raw.groups)) fail('Expected a group array', 'groups');
  const ids = new Set();
  const register = (value, path) => {
    const key = id(value, path);
    if (ids.has(key)) fail('Duplicate ID', path);
    ids.add(key);
    return key;
  };
  const nodes = raw.nodes.map((n, i) => {
    const p = `nodes[${i}]`;
    object(n, ['id', 'type', 'label', 'style', 'width', 'height', 'attachTo', 'side'], p);
    const type = choice(
      n.type ?? 'process',
      ['process', 'decision', 'terminator', 'start', 'end', 'note'],
      p + '.type',
    );
    const base =
      type === 'note'
        ? { ...NODE_STYLE, fillColor: '#fffbea', borderColor: '#b38900', color: '#5f4b00' }
        : NODE_STYLE;
    const result = {
      id: register(n.id, p + '.id'),
      type,
      label: text(n.label ?? n.id, p + '.label'),
      style: {
        ...base,
        ...parseFlowStyle(global.node),
        ...parseFlowStyle(type === 'note' ? global.note : {}),
        ...parseFlowStyle(n.style, 'node', p + '.style'),
      },
    };
    for (const key of ['width', 'height']) if (own(n, key)) result[key] = number(n[key], p + '.' + key);
    for (const key of ['attachTo', 'side'])
      if (own(n, key)) {
        if (type !== 'note') fail('Only notes support ' + key, p + '.' + key);
        result[key] =
          key === 'attachTo'
            ? id(n[key], p + '.' + key)
            : choice(n[key], ['left', 'right', 'top', 'bottom'], p + '.' + key);
      }
    return result;
  });
  const nodeMap = new Map(nodes.map((n) => [n.id, n])),
    edgeIds = new Set();
  const edges = raw.edges.map((e, i) => {
    const p = `edges[${i}]`;
    object(e, ['id', 'from', 'to', 'label', 'kind', 'fromSide', 'toSide', 'arrow', 'style'], p);
    const edgeId = id(e.id ?? 'edge_' + (i + 1), p + '.id');
    if (edgeIds.has(edgeId)) fail('Duplicate edge ID', p + '.id');
    edgeIds.add(edgeId);
    for (const k of ['from', 'to']) if (!nodeMap.has(e[k])) fail('Unknown node', p + '.' + k);
    const kind = choice(e.kind ?? 'flow', ['flow', 'loop', 'association'], p + '.kind');
    if (kind !== 'association' && [e.from, e.to].some((k) => nodeMap.get(k).type === 'note'))
      fail('Notes require association edges', p + '.kind');
    if (own(e, 'arrow') && typeof e.arrow !== 'boolean') fail('Expected a boolean', p + '.arrow');
    const result = {
      id: edgeId,
      from: e.from,
      to: e.to,
      kind,
      arrow: e.arrow ?? kind !== 'association',
      style: {
        ...EDGE_STYLE,
        ...parseFlowStyle(global.edge, 'edge'),
        ...(kind === 'association' ? { lineStyle: 'dotted' } : {}),
        ...parseFlowStyle(e.style, 'edge', p + '.style'),
      },
    };
    if (own(e, 'label')) result.label = text(e.label, p + '.label');
    for (const k of ['fromSide', 'toSide'])
      if (own(e, k)) result[k] = choice(e[k], ['left', 'right', 'top', 'bottom'], p + '.' + k);
    return result;
  });
  const groups = (raw.groups ?? []).map((g, i) => {
    const p = `groups[${i}]`;
    object(g, ['id', 'label', 'members', 'style'], p);
    if (!Array.isArray(g.members) || !g.members.length || new Set(g.members).size !== g.members.length)
      fail('Expected nonempty unique members', p + '.members');
    return {
      id: register(g.id, p + '.id'),
      label: text(g.label ?? g.id, p + '.label'),
      members: [...g.members],
      style: {
        ...NODE_STYLE,
        fillColor: '#f3f6fa',
        borderColor: '#8296ad',
        borderRadius: 8,
        ...parseFlowStyle(global.group),
        ...parseFlowStyle(g.style, 'node', p + '.style'),
      },
    };
  });
  const parents = new Map();
  for (const g of groups)
    for (const key of g.members) {
      if (!ids.has(key)) fail('Unknown group member', 'groups.' + g.id);
      if (parents.has(key)) fail('Group member has multiple parents', 'groups.' + g.id);
      parents.set(key, g.id);
    }
  for (const g of groups) {
    const seen = new Set([g.id]);
    for (let p = parents.get(g.id); p; p = parents.get(p)) {
      if (seen.has(p)) fail('Group cycle', 'groups.' + g.id);
      seen.add(p);
    }
  }
  const attached = new Set();
  for (const n of nodes.filter((n) => n.type === 'note')) {
    n.attachTo ??= edges
      .filter((e) => e.kind === 'association' && (e.from === n.id || e.to === n.id))
      .map((e) => (e.from === n.id ? e.to : e.from))
      .find((key) => nodeMap.get(key).type !== 'note');
    if (!nodeMap.has(n.attachTo) || nodeMap.get(n.attachTo).type === 'note')
      fail('Note requires a non-note attachment', 'nodes.' + n.id + '.attachTo');
    if (attached.has(n.attachTo))
      fail('Only one attached note per node is supported', 'nodes.' + n.id + '.attachTo');
    attached.add(n.attachTo);
    if (parents.get(n.id) !== parents.get(n.attachTo))
      fail('Note and attachment must belong to the same group', 'nodes.' + n.id + '.attachTo');
    n.side ??= vertical ? 'right' : 'bottom';
  }
  // Classify back edges in the normalized model; authoring JSON remains unchanged.
  const state = new Map();
  function visit(key) {
    state.set(key, 1);
    for (const e of edges.filter((e) => e.kind === 'flow' && e.from === key)) {
      if (state.get(e.to) === 1) e.kind = 'loop';
      else if (!state.has(e.to)) visit(e.to);
    }
    state.set(key, 2);
  }
  const active = nodes.filter((n) => n.type !== 'note');
  for (const n of [
    ...active.filter((n) => !edges.some((e) => e.kind === 'flow' && e.to === n.id)),
    ...active,
  ])
    if (!state.has(n.id)) visit(n.id);
  return { version: 1, diagram, layout, nodes, edges, groups };
}
