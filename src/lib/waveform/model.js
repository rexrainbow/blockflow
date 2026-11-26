export const WAVEFORM_FORMAT = 'blockflow-waveform';
export function fail(path, message) {
  throw Object.assign(new Error(`${path}: ${message}`), { path });
}
export function object(value, fields, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  for (const key of Object.keys(value)) if (!fields.includes(key)) fail(`${path}.${key}`, 'unknown field');
}
export function tick(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(path, `expected an integer tick >= ${minimum}`);
  return value;
}
function text(value, path, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') fail(path, 'expected text');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/u.test(value))
    fail(path, 'text contains invalid XML characters');
  return value;
}
function id(value, path) {
  if (typeof value !== 'string' || !/^[A-Za-z_][\w.-]*$/.test(value)) fail(path, 'expected an identifier');
  return value;
}
function list(value, path) {
  if (!Array.isArray(value)) fail(path, 'expected a list');
  return value;
}
export function signalValue(value, width, path) {
  if (width === 1) {
    if (![0, 1, 'x', 'z'].includes(value)) fail(path, 'expected 0, 1, x or z');
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0 || BigInt(value) >= 1n << BigInt(width))
      fail(path, 'value exceeds bus width or safe integer range');
  } else if (typeof value !== 'string' || !value.length)
    fail(path, 'expected bus text or a nonnegative integer');
  else if (value.length > 4096) fail(path, 'bus text exceeds 4096 characters');
  else if (/^b[01xz]+$/i.test(value) && value.length - 1 > width) fail(path, 'vector exceeds bus width');
  else if (/^(?:\d+|0x[\da-f]+|0b[01]+)$/i.test(value) && BigInt(value) >= 1n << BigInt(width))
    fail(path, 'numeric text exceeds bus width');
  if (typeof value === 'string') text(value, path);
  return value;
}

/** Normalize owned synchronous data. Missing link ends and range overflow are checked separately. */
export function parseWaveform(value) {
  object(
    value,
    ['format', 'version', 'title', 'timescale', 'grid', 'length', 'signals', 'links', 'markers'],
    'waveform',
  );
  if (value.format !== WAVEFORM_FORMAT) fail('format', `expected ${WAVEFORM_FORMAT}`);
  if (value.version !== 1) fail('version', 'expected 1');
  const result = {
    format: WAVEFORM_FORMAT,
    version: 1,
    title: text(value.title, 'title', 'Waveform'),
    timescale: text(value.timescale, 'timescale'),
    length: tick(value.length, 'length', 1),
    signals: [],
  };
  if (!result.timescale.trim()) fail('timescale', 'must not be empty');
  if (value.grid !== undefined) {
    object(value.grid, ['ticksPerBit', 'offset'], 'grid');
    result.grid = {
      ticksPerBit: tick(value.grid.ticksPerBit, 'grid.ticksPerBit', 1),
      offset: tick(value.grid.offset ?? 0, 'grid.offset'),
    };
  }
  const signals = new Set(),
    edges = new Set();
  result.signals = list(value.signals, 'signals').map((s, i) => {
    const path = `signals[${i}]`;
    object(s, ['id', 'label', 'width', 'scope', 'port', 'changes', 'style'], path);
    const name = id(s.id, `${path}.id`);
    if (signals.has(name)) fail(`${path}.id`, 'duplicate signal id');
    signals.add(name);
    const width = tick(s.width, `${path}.width`, 1);
    if (width > 4096) fail(`${path}.width`, 'maximum width is 4096');
    const out = { id: name, label: text(s.label, `${path}.label`, name), width };
    if (s.scope !== undefined) out.scope = text(s.scope, `${path}.scope`);
    if (s.port !== undefined) {
      out.port = text(s.port, `${path}.port`);
      if (!/^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(out.port)) fail(`${path}.port`, 'expected Module.port');
    }
    if (s.style !== undefined) {
      object(s.style, ['color'], `${path}.style`);
      if (typeof s.style.color !== 'string' || !/^#[\da-f]{6}$/i.test(s.style.color))
        fail(`${path}.style.color`, 'expected #RRGGBB');
      out.style = { color: s.style.color };
    }
    let previous = -1;
    out.changes = list(s.changes, `${path}.changes`).map((change, j) => {
      const cp = `${path}.changes[${j}]`;
      if (!Array.isArray(change) || change.length < 2 || change.length > 3)
        fail(cp, 'expected [t, value, edgeId?]');
      const t = tick(change[0], cp);
      if (t <= previous) fail(cp, 'time must increase');
      if (j === 0 && t !== 0) fail(cp, 'first change must start at 0');
      previous = t;
      const item = [t, signalValue(change[1], width, cp)];
      if (j && item[1] === s.changes[j - 1][1]) fail(cp, 'value must change');
      if (change.length === 3) {
        const edge = id(change[2], cp);
        if (edges.has(edge)) fail(cp, 'duplicate edge id');
        edges.add(edge);
        item.push(edge);
      }
      return item;
    });
    if (!out.changes.length) fail(`${path}.changes`, 'initial value at 0 is required');
    return out;
  });
  if (value.links !== undefined)
    result.links = list(value.links, 'links').map((link, i) => {
      const path = `links[${i}]`;
      object(link, ['from', 'to', 'label', 'delay', 'locked'], path);
      const out = { from: id(link.from, `${path}.from`), to: id(link.to, `${path}.to`) };
      if (link.label !== undefined) out.label = text(link.label, `${path}.label`);
      if (link.delay !== undefined) out.delay = tick(link.delay, `${path}.delay`);
      if (link.locked !== undefined) {
        if (typeof link.locked !== 'boolean') fail(`${path}.locked`, 'expected a boolean');
        out.locked = link.locked;
      }
      return out;
    });
  const markers = new Set();
  if (value.markers !== undefined)
    result.markers = list(value.markers, 'markers').map((m, i) => {
      const path = `markers[${i}]`;
      object(m, ['id', 't', 'from', 'to', 'label'], path);
      const name = id(m.id, `${path}.id`);
      if (markers.has(name)) fail(`${path}.id`, 'duplicate marker id');
      markers.add(name);
      const out = { id: name };
      if (m.t !== undefined) {
        if (m.from !== undefined || m.to !== undefined) fail(path, 'choose t or from/to');
        out.t = tick(m.t, `${path}.t`);
      } else {
        out.from = tick(m.from, `${path}.from`);
        out.to = tick(m.to, `${path}.to`);
        if (out.to <= out.from) fail(path, 'span to must exceed from');
      }
      if (m.label !== undefined) out.label = text(m.label, `${path}.label`);
      return out;
    });
  const named = edgeIndex(result);
  for (const [i, link] of (result.links ?? []).entries())
    for (const end of ['from', 'to']) {
      const edge = named.get(link[end]);
      if (edge && !edge.transition)
        fail(`links[${i}].${end}`, 'must reference a value-changing edge after time 0');
    }
  return result;
}

export function edgeIndex(document) {
  const result = new Map();
  document.signals.forEach((signal, si) =>
    signal.changes.forEach((change, ci) => {
      if (change[2] !== undefined)
        result.set(change[2], {
          signal,
          change,
          si,
          ci,
          transition: ci > 0 && change[1] !== signal.changes[ci - 1][1],
        });
    }),
  );
  return result;
}

export function waveformProblems(value) {
  const document = parseWaveform(value),
    edges = edgeIndex(document),
    problems = [];
  function problem(path, code, message) {
    problems.push({ path, code, message });
  }
  document.signals.forEach((s, i) =>
    s.changes.forEach((c, j) => {
      if (c[0] > document.length)
        problem(`signals[${i}].changes[${j}]`, 'BEYOND_LENGTH', 'change exceeds length');
    }),
  );
  (document.links ?? []).forEach((link, i) => {
    for (const end of ['from', 'to'])
      if (!edges.has(link[end])) problem(`links[${i}].${end}`, 'MISSING_EDGE', `missing edge ${link[end]}`);
    if (
      edges.has(link.from) &&
      edges.has(link.to) &&
      link.delay !== undefined &&
      edges.get(link.to).change[0] - edges.get(link.from).change[0] !== link.delay
    )
      problem(`links[${i}].delay`, 'DELAY_MISMATCH', 'stored edge distance disagrees with delay');
  });
  (document.markers ?? []).forEach((m, i) => {
    if ((m.t ?? m.to) > document.length) problem(`markers[${i}]`, 'BEYOND_LENGTH', 'marker exceeds length');
  });
  return problems;
}
export function validateWaveform(value) {
  parseWaveform(value);
  return { ok: true };
}

/** Snap an interaction coordinate to phase-1 ticks or existing bit-grid boundaries. */
export function snapWaveformTime(document, time, level = 'tick') {
  if (!Number.isFinite(time)) fail('time', 'expected a finite coordinate');
  const length = tick(document?.length, 'length', 1);
  const clamped = Math.max(0, Math.min(length, time));
  if (level === 'tick') return Math.round(clamped);
  if (level !== 'bit') fail('level', 'expected tick or bit');
  const period = tick(document.grid?.ticksPerBit, 'grid.ticksPerBit', 1),
    offset = tick(document.grid?.offset ?? 0, 'grid.offset');
  if (offset > length) fail('grid.offset', 'no bit boundary within length');
  const index = Math.max(
    0,
    Math.min(Math.floor((length - offset) / period), Math.round((clamped - offset) / period)),
  );
  return offset + index * period;
}
