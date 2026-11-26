import { parseWaveform, tick, fail, object } from './model.js';

const UNITS = { s: 1000000000000000n, ms: 1000000000000n, us: 1000000000n, ns: 1000000n, ps: 1000n, fs: 1n };
function scale(text) {
  if (typeof text !== 'string') fail('timescale', 'expected text');
  const match = /^(1|10|100)(s|ms|us|ns|ps|fs)$/.exec(text.replace(/\s+/g, ''));
  if (!match) fail('timescale', 'expected a VCD timescale such as 1ns or 10ps');
  return BigInt(match[1]) * UNITS[match[2]];
}

/** Import the wire/reg synchronous VCD subset with bounded input and event counts. */
export function importVcd(source, options = {}) {
  return readVcd(source, options, false);
}

/** Inspect declarations and source timestamps without allocating change buffers. */
export function listVcdSignals(source, options = {}) {
  return readVcd(source, options, true);
}

function readVcd(source, options, inspect) {
  object(
    options,
    inspect
      ? ['maxBytes', 'maxDeclarations', 'maxChanges']
      : [
          'signals',
          'from',
          'to',
          'timescale',
          'maxBytes',
          'maxSignals',
          'maxChanges',
          'maxDeclarations',
          'title',
        ],
    'options',
  );
  if (typeof source !== 'string') fail('vcd', 'expected text');
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024,
    maxDeclarations = options.maxDeclarations ?? 100000,
    maxSignals = options.maxSignals ?? 256,
    maxChanges = options.maxChanges ?? 200000;
  for (const [name, value] of Object.entries({ maxBytes, maxSignals, maxChanges, maxDeclarations }))
    tick(value, `options.${name}`, 1);
  if (source.length > maxBytes || new TextEncoder().encode(source).length > maxBytes)
    fail('vcd', 'input exceeds maxBytes');
  if (
    options.signals !== undefined &&
    (!Array.isArray(options.signals) || options.signals.some((s) => typeof s !== 'string'))
  )
    fail('options.signals', 'expected a list of VCD names');
  const chosen = options.signals === undefined ? null : new Set(options.signals),
    matched = new Set(),
    scopes = [],
    declarations = [],
    codes = new Map(),
    names = new Set();
  const iterator = source.matchAll(/\S+/g);
  let consumed = 0;
  const next = () => {
    if (++consumed > 2000000) fail('vcd', 'token limit exceeded');
    return iterator.next().value?.[0];
  };
  function directive() {
    const values = [];
    let token;
    while ((token = next()) !== undefined && token !== '$end') values.push(token);
    if (token === undefined) fail('vcd', 'unterminated directive');
    return values;
  }
  let token,
    time = 0,
    firstTimestamp,
    timescale = 'tick',
    definitions = false,
    events = 0,
    stored = 0,
    dumping = false;
  while ((token = next()) !== undefined) {
    if (['$comment', '$date', '$version'].includes(token)) {
      directive();
      continue;
    }
    if (token === '$timescale') {
      if (definitions) fail('vcd', 'timescale after definitions');
      timescale = directive().join('');
      scale(timescale);
      continue;
    }
    if (token === '$scope') {
      const parts = directive();
      if (definitions || parts.length !== 2) fail('vcd.scope', 'invalid scope');
      scopes.push(parts[1]);
      continue;
    }
    if (token === '$upscope') {
      if (directive().length || !scopes.length || definitions) fail('vcd.scope', 'unbalanced upscope');
      scopes.pop();
      continue;
    }
    if (token === '$var') {
      const [type, widthText, code, reference] = [next(), next(), next(), next()];
      const close = next(),
        range = close === '$end' ? [] : [close];
      if (close !== '$end' && next() !== '$end') fail('vcd.var', 'unterminated declaration');
      if (definitions || !['wire', 'reg'].includes(type) || !code || !reference)
        fail('vcd.var', 'expected wire/reg width code reference');
      if (!/^\d+$/.test(widthText)) fail('vcd.var.width', 'expected integer width');
      const width = tick(Number(widthText), 'vcd.var.width', 1);
      if (width > 4096) fail('vcd.var.width', 'maximum width is 4096');
      if (range.length > 1 || (range.length && !/^\[-?\d+(?::-?\d+)?\]$/.test(range[0])))
        fail('vcd.var', 'unsupported reference range');
      const base = [...scopes, reference].join('.'),
        name = base + range.join('');
      if (names.has(name)) fail('vcd.var', 'duplicate signal name ' + name);
      names.add(name);
      if (names.size > maxDeclarations) fail('vcd.var', 'declaration count exceeds maxDeclarations');
      const selected = !inspect && (!chosen || chosen.has(name) || chosen.has(base));
      if (chosen?.has(name)) matched.add(name);
      if (chosen?.has(base)) matched.add(base);
      const declaration = {
        type,
        width,
        name,
        reference: base,
        label: reference + range.join(''),
        scope: scopes.join('.'),
        selected,
        ...(selected ? { changes: [[0, width === 1 ? 'x' : 'b' + 'x'.repeat(width)]] } : {}),
      };
      if (selected && ++stored > maxChanges) fail('vcd.changes', 'initial values exceed maxChanges');
      if (codes.has(code) && codes.get(code)[0].width !== width) fail('vcd.var', 'alias width disagrees');
      if (!codes.has(code)) codes.set(code, []);
      codes.get(code).push(declaration);
      if (selected || inspect) declarations.push(declaration);
      if (!inspect && declarations.length > maxSignals)
        fail('vcd.signals', 'selected lane count exceeds maxSignals');
      continue;
    }
    if (token === '$enddefinitions') {
      if (directive().length || scopes.length || definitions) fail('vcd', 'invalid enddefinitions');
      definitions = true;
      continue;
    }
    if (['$dumpvars', '$dumpall', '$dumpon', '$dumpoff'].includes(token)) {
      if (!definitions || dumping) fail('vcd', 'invalid dump block');
      dumping = true;
      continue;
    }
    if (token === '$end') {
      if (!dumping) fail('vcd', 'unexpected $end');
      dumping = false;
      continue;
    }
    if (!definitions) fail('vcd', 'expected declarations and $enddefinitions');
    if (token.startsWith('#')) {
      if (!/^#\d+$/.test(token)) fail('vcd.time', 'expected integer timestamp');
      const t = tick(Number(token.slice(1)), 'vcd.time');
      if (t < time) fail('vcd.time', 'time must not decrease');
      firstTimestamp ??= t;
      time = t;
      continue;
    }
    firstTimestamp ??= time;
    let code, value;
    if (/^[01xz]/i.test(token)) {
      value = token[0].toLowerCase();
      code = token.slice(1);
    } else if (/^b[01xz]+$/i.test(token)) {
      value = token.toLowerCase();
      code = next();
    } else fail('vcd.value', 'unsupported value token ' + token);
    const aliases = codes.get(code);
    if (!aliases) fail('vcd.value', 'unknown identifier code ' + code);
    if (++events > maxChanges) fail('vcd.changes', 'change count exceeds maxChanges');
    const width = aliases[0].width;
    if (value.startsWith('b')) {
      let bits = value.slice(1);
      if (bits.length > width) fail('vcd.value', 'vector exceeds declared width');
      bits = bits.padStart(width, ['x', 'z'].includes(bits[0]) ? bits[0] : '0');
      value = width === 1 ? (bits === '0' ? 0 : bits === '1' ? 1 : bits) : 'b' + bits;
    } else {
      if (width !== 1) fail('vcd.value', 'scalar change on a vector');
      if (value === '0' || value === '1') value = Number(value);
    }
    for (const declaration of aliases)
      if (declaration.selected) {
        const changes = declaration.changes,
          last = changes.at(-1);
        if (last[0] === time) last[1] = value;
        else if (last[1] !== value) {
          if (++stored > maxChanges) fail('vcd.changes', 'stored change count exceeds maxChanges');
          changes.push([time, value]);
        }
        // Multiple writes at one timestamp can cancel the transition entirely.
        if (changes.length > 1 && changes.at(-1)[1] === changes.at(-2)[1]) changes.pop();
      }
  }
  if (!definitions) fail('vcd', 'missing $enddefinitions');
  if (dumping) fail('vcd', 'unterminated dump block');
  if (inspect)
    return {
      signals: declarations.map(({ name, reference, width, type, scope }) => ({
        name,
        reference,
        width,
        type,
        scope,
      })),
      timescale,
      firstTimestamp: firstTimestamp ?? 0,
      lastTimestamp: time,
    };
  if (chosen)
    for (const name of chosen) if (!matched.has(name)) fail('options.signals', 'unknown VCD name ' + name);
  const from = tick(options.from ?? 0, 'options.from'),
    to = tick(options.to ?? Math.max(1, time), 'options.to', 1);
  if (from >= to || to > Math.max(1, time)) fail('options.to', 'expected from < to within recorded duration');
  const target = options.timescale ?? timescale;
  const numerator = target === timescale ? 1n : scale(timescale),
    denominator = target === timescale ? 1n : scale(target);
  function convert(t) {
    const n = BigInt(t) * numerator;
    if (n % denominator) fail('options.timescale', 'conversion produces fractional ticks');
    return tick(Number(n / denominator), 'converted time');
  }
  const ids = new Set();
  const signals = declarations.map((d) => {
    let name = d.name.replace(/[^\w.-]/g, '_');
    if (!/^[A-Za-z_]/.test(name)) name = 'signal_' + name;
    const base = name;
    for (let suffix = 2; ids.has(name); suffix++) name = base + '_' + suffix;
    ids.add(name);
    const initial = d.changes.findLast((c) => c[0] <= from)[1];
    return {
      id: name,
      label: d.label,
      width: d.width,
      scope: d.scope,
      changes: [
        [0, initial],
        ...d.changes.filter((c) => c[0] > from && c[0] <= to).map((c) => [convert(c[0] - from), c[1]]),
      ],
    };
  });
  return parseWaveform({
    format: 'blockflow-waveform',
    version: 1,
    title: options.title ?? 'Imported VCD',
    timescale: target,
    length: convert(to - from),
    signals,
  });
}
