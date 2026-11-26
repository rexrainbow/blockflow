import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { DOMParser } from '@xmldom/xmldom';
import {
  parseWaveform,
  waveformProblems,
  applyWaveformOps,
  layoutWaveform,
  renderWaveformSvg,
  importVcd,
  listVcdSignals,
  snapWaveformTime,
} from '../../src/lib/waveform/index.js';

const fixture = () =>
  JSON.parse(readFileSync(new URL('../fixtures/waveform/dshot.json', import.meta.url), 'utf8'));
const vcd = () => readFileSync(new URL('../fixtures/waveform/small.vcd', import.meta.url), 'utf8');
const lane = (document, id) => document.signals.find((s) => s.id === id);

test('waveform normalization owns input, agrees with schema and retains edge IDs and scopes', () => {
  const raw = fixture(),
    saved = structuredClone(raw),
    document = parseWaveform(raw);
  assert.deepEqual(parseWaveform(document), document);
  assert.deepEqual(waveformProblems(document), []);
  const schema = JSON.parse(readFileSync(new URL('../../schema/waveform.schema.json', import.meta.url)));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(document), true, JSON.stringify(validate.errors));
  document.signals[0].changes[0][1] = 1;
  assert.deepEqual(raw, saved);
});

test('structural errors carry field paths, with integer times and width limits', () => {
  for (const change of [
    (d) => {
      d.signals[1].id = d.signals[0].id;
    },
    (d) => {
      d.signals[1].changes[1][2] = 'clock_start';
    },
    (d) => {
      d.signals[1].changes[1][0] = 1.5;
    },
    (d) => {
      d.signals[1].changes[2][0] = 2;
    },
    (d) => {
      d.signals[1].changes[0][0] = 1;
    },
    (d) => {
      d.signals[1].changes[1][1] = 2;
    },
    (d) => {
      d.signals[5].changes[0][1] = 16;
    },
    (d) => {
      d.signals[5].changes[0][1] = 'b10000';
    },
    (d) => {
      d.signals[5].changes[0][1] = '0x10';
    },
    (d) => {
      d.signals[1].changes[1][1] = 0;
    },
    (d) => {
      d.signals[1].changes[0].push('initial');
      d.links[0].from = 'initial';
    },
  ]) {
    const document = fixture();
    change(document);
    assert.throws(
      () => parseWaveform(document),
      (error) => Boolean(error.path) && /signals|links/.test(error.message),
    );
  }
});

test('draft problems retain missing links and report delay and duration paths', () => {
  const raw = fixture();
  raw.links.push({ from: 'missing', to: 'hi_start' });
  raw.links[0].delay = 9;
  raw.signals[0].changes.push([25, 1]);
  raw.markers[0].t = 26;
  const parsed = parseWaveform(raw),
    problems = waveformProblems(parsed);
  assert.equal(parsed.links.at(-1).from, 'missing');
  assert.ok(problems.some((p) => p.code === 'MISSING_EDGE' && p.path === 'links[2].from'));
  assert.ok(problems.some((p) => p.code === 'DELAY_MISMATCH' && p.path === 'links[0].delay'));
  assert.ok(problems.some((p) => p.path === 'signals[0].changes[7]'));
  assert.ok(problems.some((p) => p.path === 'markers[0]'));
});

test('moving an edge follows locked chains atomically and rejects neighbour crossings', () => {
  const raw = fixture(),
    saved = structuredClone(raw);
  const result = applyWaveformOps(raw, [{ op: 'moveEdge', edgeId: 'trigger_start', to: 1 }]);
  assert.equal(lane(result.document, 'trigger').changes[1][0], 1);
  assert.equal(lane(result.document, 'hi').changes[1][0], 2);
  assert.equal(lane(result.document, 'sample').changes[1][0], 4);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(raw, saved);
  assert.throws(
    () => applyWaveformOps(raw, [{ op: 'moveEdge', edgeId: 'trigger_start', to: 4 }]),
    /ops\[0\]/,
  );
  assert.throws(
    () => applyWaveformOps(raw, [{ op: 'moveEdge', edgeId: 'trigger_start', to: 6 }]),
    /ops\[0\]/,
  );
  assert.throws(() => applyWaveformOps(raw, [{ op: 'moveEdge', edgeId: 'gone', to: 2 }]), /Unknown edge/);
  const unnamed = applyWaveformOps(raw, [{ op: 'moveEdge', signalId: 'tx', t: 6, to: 7 }]);
  assert.equal(lane(unnamed.document, 'tx').changes[1][0], 7);
  const draft = applyWaveformOps(
    raw,
    [{ op: 'moveEdge', edgeId: 'trigger_start', to: 1, followLocked: false }],
    { allowProblems: true },
  );
  assert.equal(draft.problems[0].code, 'DELAY_MISMATCH');
  assert.deepEqual(raw, saved);
});

test('locked graphs terminate for cycles and reject conflicting constraints', () => {
  const raw = fixture();
  lane(raw, 'hi').changes[1][0] = 2;
  raw.links = [
    { from: 'trigger_start', to: 'hi_start', delay: 0, locked: true },
    { from: 'hi_start', to: 'trigger_start', delay: 0, locked: true },
  ];
  const result = applyWaveformOps(raw, [{ op: 'moveEdge', edgeId: 'trigger_start', to: 1 }]);
  assert.equal(lane(result.document, 'hi').changes[1][0], 1);
  raw.links[1].delay = 1;
  assert.throws(() => applyWaveformOps(raw, [{ op: 'followLocked' }]), /Conflicting/);
  const stale = fixture();
  lane(stale, 'hi').changes[1][0] = 4;
  assert.deepEqual(applyWaveformOps(stale, [{ op: 'followLocked' }]).document, parseWaveform(fixture()));
});

test('shift, insertion and deletion preserve time 0, markers and valid edge references', () => {
  const raw = fixture();
  const shifted = applyWaveformOps(raw, [
    { op: 'shiftRange', signalIds: ['trigger', 'hi', 'sample'], from: 1, to: 8, delta: 1 },
  ]).document;
  assert.equal(lane(shifted, 'trigger').changes[1][0], 3);
  assert.equal(lane(shifted, 'sample').changes[1][0], 6);
  const inserted = applyWaveformOps(raw, [{ op: 'insertTicks', at: 8, count: 2 }]).document;
  assert.equal(inserted.length, 26);
  assert.equal(inserted.markers[0].t, 10);
  assert.deepEqual(
    applyWaveformOps(inserted, [{ op: 'deleteTicks', from: 8, to: 10 }]).document,
    parseWaveform(raw),
  );
  const origin = applyWaveformOps(raw, [{ op: 'insertTicks', at: 0, count: 2 }]).document;
  assert.ok(origin.signals.every((s) => s.changes[0][0] === 0));
  assert.ok(
    applyWaveformOps(raw, [{ op: 'deleteTicks', from: 0, to: 1 }]).document.signals.every(
      (s) => s.changes[0][0] === 0,
    ),
  );
  assert.throws(() => applyWaveformOps(raw, [{ op: 'deleteTicks', from: 2, to: 4 }]), /referenced edge/);
});

test('setting a range splits and coalesces values and protects named transitions', () => {
  const raw = fixture(),
    before = structuredClone(raw);
  const edited = applyWaveformOps(raw, [
    { op: 'setValue', signalId: 'tx', from: 4, to: 10, value: 0 },
  ]).document;
  assert.deepEqual(lane(edited, 'tx').changes, [
    [0, 1],
    [4, 0],
    [10, 1],
    [11, 0],
    [16, 1],
    [22, 0],
  ]);
  assert.throws(
    () => applyWaveformOps(raw, [{ op: 'setValue', signalId: 'trigger', from: 1, to: 4, value: 1 }]),
    /named edge/,
  );
  assert.deepEqual(raw, before);
});

test('bit encoding uses the bit grid including its offset', () => {
  const raw = fixture();
  const encoded = applyWaveformOps(raw, [
    { op: 'encodeBits', signalId: 'tx', bits: [1, 0, 1], zeroHigh: 3, oneHigh: 6 },
  ]).document;
  assert.deepEqual(lane(encoded, 'tx').changes, lane(raw, 'tx').changes);
  const offset = applyWaveformOps(raw, [
    { op: 'updateDocument', patch: { grid: { ticksPerBit: 8, offset: 2 } } },
    { op: 'encodeBits', signalId: 'tx', bits: [1, 0], zeroHigh: 3, oneHigh: 6 },
  ]).document;
  assert.deepEqual(lane(offset, 'tx').changes, [
    [0, 0],
    [2, 1],
    [8, 0],
    [10, 1],
    [13, 0],
  ]);
  assert.throws(
    () => applyWaveformOps(raw, [{ op: 'encodeBits', signalId: 'tx', bits: [0], zeroHigh: 9, oneHigh: 6 }]),
    /exceed/,
  );
  const nrz = applyWaveformOps(raw, [
    { op: 'encodeBits', signalId: 'tx', bits: [1, 1, 0], zeroHigh: 0, oneHigh: 8 },
  ]).document;
  assert.deepEqual(lane(nrz, 'tx').changes, [
    [0, 1],
    [16, 0],
  ]);
});

test('tick and bit snapping return bounded integer coordinates', () => {
  const raw = fixture();
  assert.equal(snapWaveformTime(raw, 1.6), 2);
  assert.equal(snapWaveformTime(raw, -4), 0);
  assert.equal(snapWaveformTime(raw, 100), 24);
  assert.equal(snapWaveformTime(raw, 5, 'bit'), 8);
  raw.grid.offset = 2;
  assert.equal(snapWaveformTime(raw, 0, 'bit'), 2);
  assert.equal(snapWaveformTime(raw, 24, 'bit'), 18);
  const generated = applyWaveformOps(fixture(), [
    { op: 'updateDocument', patch: { grid: { ticksPerBit: 8 } } },
    { op: 'encodeBits', signalId: 'tx', bits: [1], oneHigh: 6, zeroHigh: 3 },
  ]);
  assert.equal(generated.document.grid.offset, 0);
});

test('batch failures and reference repair are atomic', () => {
  const raw = fixture(),
    before = structuredClone(raw);
  assert.throws(
    () => applyWaveformOps(raw, [{ op: 'updateDocument', patch: { title: 'New' } }, { op: 'bad' }]),
    /ops\[1\]/,
  );
  assert.deepEqual(raw, before);
  const replaced = applyWaveformOps(raw, [
    { op: 'setLinks', links: [{ from: 'future', to: 'hi_start' }] },
    { op: 'nameEdge', signalId: 'clock', t: 8, name: 'future' },
  ]);
  assert.deepEqual(replaced.problems, []);
  assert.throws(
    () => applyWaveformOps(raw, [{ op: 'moveEdge', edgeId: 'hi_start', to: 4, followLocked: 'no' }]),
    /boolean/,
  );
});

test('waveform SVG is deterministic, escaped, immutable and exposes selectable timing identities', () => {
  const raw = fixture();
  raw.title = '<script>&';
  raw.signals[0].label = '<Clock>';
  const saved = structuredClone(raw),
    svg = renderWaveformSvg(raw);
  assert.equal(renderWaveformSvg(raw), svg);
  assert.deepEqual(raw, saved);
  const errors = [],
    doc = new DOMParser({ onError: (l, m) => errors.push(m) }).parseFromString(svg, 'image/svg+xml');
  assert.deepEqual(errors, []);
  assert.equal(doc.getElementsByTagName('script').length, 0);
  const elements = Array.from(doc.getElementsByTagName('*'));
  assert.ok(elements.some((e) => e.getAttribute('data-edge-id') === 'trigger_start'));
  assert.ok(elements.some((e) => e.getAttribute('data-link') === 'trigger_start -> hi_start'));
  assert.ok(elements.some((e) => e.getAttribute('data-marker') === 'cursor'));
  assert.ok(
    elements.some((e) => e.getAttribute('data-role') === 'bit-grid' && e.getAttribute('data-t') === '8'),
  );
  assert.ok(
    elements.some(
      (e) => e.getAttribute('data-role') === 'value-segment' && e.getAttribute('data-signal') === 'bus',
    ),
  );
  const window = layoutWaveform(raw, { from: 8, to: 16 });
  assert.ok(window.lanes.every((s) => s.segments.every((v) => v.from >= 8 && v.to <= 16)));
  assert.throws(() => renderWaveformSvg({ ...raw, length: 1000000 }), /display limit/);
  assert.throws(() => renderWaveformSvg({ ...raw, length: 8888 }), /display limit/);
});

test('VCD imports scoped vectors, x/z, initial values and shared identifier aliases', () => {
  const parsed = importVcd(vcd());
  assert.deepEqual(waveformProblems(parsed), []);
  assert.equal(parsed.timescale, '1ns');
  assert.equal(parsed.length, 16);
  assert.equal(parsed.signals[1].scope, 'top');
  assert.equal(parsed.signals[1].changes[1][1], 'b1010');
  assert.equal(parsed.signals[1].changes[2][1], 'bxxzz');
  assert.equal(parsed.signals[2].changes[0][1], 'x');
  assert.equal(parsed.signals[2].changes[1][1], 'z');
  const alias = vcd().replace('$upscope $end', '$var wire 1 ! alias $end\n$upscope $end');
  const imported = importVcd(alias);
  assert.deepEqual(imported.signals[0].changes, imported.signals[3].changes);
  assert.equal(imported.signals[3].label, 'alias');
});

test('VCD windows rebase held values and conversion requires exact integer ticks', () => {
  const window = importVcd(vcd(), { signals: ['top.data'], from: 2, to: 8 });
  assert.equal(window.signals.length, 1);
  assert.equal(window.length, 6);
  assert.deepEqual(window.signals[0].changes, [
    [0, 'b1010'],
    [6, 'bxxzz'],
  ]);
  const fine = importVcd(vcd(), { timescale: '1ps' });
  assert.equal(fine.length, 16000);
  assert.throws(() => importVcd(vcd(), { timescale: '10ns' }), /fractional ticks/);
  assert.throws(() => importVcd(vcd(), { signals: ['missing'] }), /unknown VCD name/);
});

test('VCD rejects malformed and oversized input with explicit bounds', () => {
  assert.throws(() => importVcd(vcd(), { maxSignals: 1 }), /maxSignals/);
  assert.equal(importVcd(vcd(), { maxSignals: 1, signals: ['top.clk'] }).signals.length, 1);
  assert.throws(() => importVcd(vcd(), { maxBytes: 20 }), /maxBytes/);
  assert.throws(() => importVcd(vcd(), { maxChanges: 4 }), /maxChanges/);
  assert.throws(() => importVcd(vcd().replace('#8', '#1')), /time must not decrease/);
  assert.throws(() => importVcd(vcd().replace('b1010', 'b11111')), /width/);
  assert.throws(() => importVcd('$scope module top'), /unterminated/);
  assert.throws(() => importVcd(vcd().replace(/\$end\r?\n#2/, '\n#2')), /dump/);
  assert.deepEqual(
    importVcd(vcd().replaceAll('!', '$end')).signals[0].changes,
    importVcd(vcd()).signals[0].changes,
  );
});

test('VCD inspection lists aliases and ranges without allocating imported lanes', () => {
  const source = vcd().replace('$upscope $end', '$var wire 1 ! alias $end\n$upscope $end');
  const result = listVcdSignals(source);
  assert.deepEqual(result, listVcdSignals(source));
  assert.equal(result.timescale, '1ns');
  assert.equal(result.firstTimestamp, 0);
  assert.equal(result.lastTimestamp, 16);
  assert.equal(result.signals.length, 4);
  assert.deepEqual(result.signals[1], {
    name: 'top.data[3:0]',
    reference: 'top.data',
    width: 4,
    type: 'reg',
    scope: 'top',
  });
  assert.equal(result.signals[3].name, 'top.alias');
  for (const { name, reference } of result.signals) {
    assert.equal(importVcd(source, { signals: [name] }).signals.length, 1);
    assert.equal(importVcd(source, { signals: [reference] }).signals.length, 1);
  }
  const declarations = Array.from({ length: 300 }, (_, i) => `$var wire 4096 c${i} s${i} $end`).join('\n');
  const header = `${declarations}\n$enddefinitions $end`;
  assert.equal(listVcdSignals(header, { maxChanges: 1 }).signals.length, 300);
  assert.deepEqual(listVcdSignals('$enddefinitions $end'), {
    signals: [],
    timescale: 'tick',
    firstTimestamp: 0,
    lastTimestamp: 0,
  });
  assert.equal(listVcdSignals('$enddefinitions $end #7 #9').firstTimestamp, 7);
});

test('VCD inspection shares import validation paths and enforces declaration and input bounds', () => {
  const badSources = [
    vcd().replace('#8', '#1'),
    vcd().replace('b1010', 'b11111'),
    vcd().replace('0!', '0unknown'),
    '$scope module top',
    vcd().replace(/\$end\r?\n#2/, '\n#2'),
    vcd().replace('$var wire', '$var real'),
  ];
  for (const source of badSources) {
    let importedError;
    try {
      importVcd(source);
    } catch (error) {
      importedError = error.message;
    }
    assert.ok(importedError);
    assert.throws(
      () => listVcdSignals(source),
      (error) => error.message === importedError,
    );
  }
  for (const api of [listVcdSignals, importVcd]) {
    assert.throws(() => api(vcd(), { maxDeclarations: 2 }), /vcd.var:.*maxDeclarations/);
    assert.throws(() => api(vcd(), { maxBytes: 20 }), /vcd:.*maxBytes/);
    assert.throws(() => api(vcd(), { maxChanges: 4 }), /vcd.changes:.*maxChanges/);
    assert.throws(() => api(vcd(), { maxDeclarations: 0 }), /options.maxDeclarations/);
  }
  assert.throws(() => listVcdSignals(vcd(), { signals: [] }), /options.signals/);
});

test('marker labels use nonoverlapping deterministic rows and clipped window starts', () => {
  const raw = fixture();
  raw.markers = [
    { id: 'a', from: 0, to: 24, label: 'packet' },
    { id: 'b', from: 0, to: 8, label: 'second packet' },
    { id: 'c', t: 1, label: '<nearby>' },
    { id: 'd', t: 16, label: 'later' },
    { id: 'unlabelled', t: 2 },
  ];
  const saved = structuredClone(raw);
  const layout = layoutWaveform(raw);
  assert.deepEqual(
    layout.markerLabels.map((m) => m.row),
    [0, 1, 2, 0],
  );
  for (const a of layout.markerLabels) {
    for (const b of layout.markerLabels) {
      if (a.id !== b.id && a.row === b.row) assert.ok(a.x + a.width + 8 <= b.x || b.x + b.width + 8 <= a.x);
    }
    assert.ok(a.y < layout.height);
    assert.ok(a.x + a.width <= layout.width);
  }
  const single = layoutWaveform({ ...raw, markers: [raw.markers[0]] });
  assert.equal(layout.height, single.height + 40);
  assert.equal(layout.plotBottom, single.plotBottom);
  const window = layoutWaveform(raw, { from: 4, to: 12 });
  assert.deepEqual(
    window.markerLabels.map((m) => m.id),
    ['a', 'b'],
  );
  assert.equal(window.markerLabels[0].x, window.markerLabels[1].x);
  assert.notEqual(window.markerLabels[0].y, window.markerLabels[1].y);
  const multiline = layoutWaveform({ ...raw, markers: [{ id: 'multiline', t: 24, label: 'long\nlabel' }] });
  assert.ok(multiline.markerLabels[0].x + multiline.markerLabels[0].width <= multiline.width);
  const svg = renderWaveformSvg(raw);
  assert.equal(svg, renderWaveformSvg(raw));
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const labels = Array.from(doc.getElementsByTagName('text')).filter(
    (e) => e.getAttribute('data-role') === 'marker-label',
  );
  assert.equal(labels.length, 4);
  assert.equal(labels[2].textContent, '<nearby>');
  assert.equal(new Set(labels.slice(0, 3).map((e) => e.getAttribute('y'))).size, 3);
  assert.deepEqual(raw, saved);
});

const routingFixture = () =>
  JSON.parse(readFileSync(new URL('../fixtures/waveform/local-routing.json', import.meta.url), 'utf8'));
const routeLength = (r) =>
  r.points.slice(1).reduce((n, p, i) => n + Math.abs(p.x - r.points[i].x) + Math.abs(p.y - r.points[i].y), 0);

test('DShot local links reflect causal distance and keep their complete identity groups', () => {
  const raw = fixture(),
    saved = structuredClone(raw),
    local = layoutWaveform(raw),
    rail = layoutWaveform(raw, { linkRoute: 'rail' });
  assert.deepEqual(
    local.linkRoutes.map((r) => r.route),
    ['local', 'local'],
  );
  assert.deepEqual(
    local.linkRoutes.map((r) => r.dimension.x2 - r.dimension.x1),
    [24, 48],
  );
  for (const [i, r] of local.linkRoutes.entries()) {
    assert.ok(routeLength(r) < routeLength(rail.linkRoutes[i]) / 2);
    const g = local.gutters[r.gutter];
    assert.ok(r.points[1].y > g.top && r.dimension.y + 4 < g.bottom);
    assert.ok(r.points.every((p) => p.x >= Math.min(r.from.x, r.to.x) && p.x <= Math.max(r.from.x, r.to.x)));
    assert.ok(r.label.x + r.label.width <= local.width);
  }
  const svg = renderWaveformSvg(raw);
  assert.equal(svg, renderWaveformSvg(raw));
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const groups = Array.from(doc.getElementsByTagName('g')).filter((g) => g.hasAttribute('data-link'));
  assert.equal(groups.length, 2);
  for (const g of groups) {
    assert.equal(g.getAttribute('data-route'), 'local');
    assert.ok(g.getAttribute('data-from-edge'));
    assert.ok(g.getAttribute('data-to-edge'));
    const children = Array.from(g.getElementsByTagName('*'));
    for (const role of ['link-path', 'link-arrow', 'link-label', 'delay-dimension'])
      assert.ok(children.some((e) => e.getAttribute('data-role') === role));
    assert.match(g.textContent, /clk/);
  }
  assert.deepEqual(raw, saved);
});

test('shared gutters grow in author order and rail measurements have separate footer rows', () => {
  const raw = routingFixture(),
    l = layoutWaveform(raw),
    old = layoutWaveform({ ...raw, links: [] });
  assert.deepEqual(
    l.linkRoutes.map((r) => r.route),
    ['local', 'local', 'local', 'local', 'rail'],
  );
  assert.deepEqual(
    l.linkRoutes.slice(0, 3).map((r) => r.track),
    [0, 1, 2],
  );
  assert.equal(l.gutters[1].trackCount, 3);
  assert.ok(l.lanes[2].y > old.lanes[2].y);
  const far = l.linkRoutes.at(-1);
  assert.equal(far.reason, 'distance');
  assert.ok(far.points.some((p) => p.x > l.right));
  assert.ok(far.dimension.y > l.lanes.at(-1).y + 12);
  assert.ok(far.dimension.y + 4 < l.plotBottom);
  for (const r of l.linkRoutes) {
    if (!r.label) continue;
    for (const other of l.linkRoutes)
      other.points.slice(1).forEach((p, i) => {
        const q = other.points[i];
        if (Math.max(p.y, q.y) >= r.label.y - 12 && Math.min(p.y, q.y) <= r.label.y + 4)
          assert.ok(r.label.x > Math.max(p.x, q.x) + 4 || r.label.x + r.label.width < Math.min(p.x, q.x) - 4);
      });
  }
});

test('auto fallback and forced routing have explicit lane and track thresholds', () => {
  const raw = routingFixture();
  raw.links = [
    { from: 'e0', to: 'e3' },
    { from: 'e0', to: 'e4' },
  ];
  assert.deepEqual(
    layoutWaveform(raw).linkRoutes.map((r) => r.route),
    ['local', 'rail'],
  );
  assert.deepEqual(
    layoutWaveform(raw, { linkRoute: 'local' }).linkRoutes.map((r) => r.route),
    ['local', 'local'],
  );
  raw.links = Array.from({ length: 9 }, () => ({ from: 'e0', to: 'e2', delay: 2 }));
  const l = layoutWaveform(raw);
  assert.equal(l.linkRoutes.filter((r) => r.route === 'local').length, 8);
  assert.equal(l.linkRoutes[8].reason, 'tracks');
  assert.equal(layoutWaveform(raw, { linkRoute: 'local' }).gutters[1].trackCount, 9);
  raw.links = Array.from({ length: 33 }, () => ({ from: 'e0', to: 'e2' }));
  assert.throws(() => layoutWaveform(raw, { linkRoute: 'local' }), /render.links.*32 tracks/);
  assert.throws(() => layoutWaveform(raw, { linkRoute: 'unknown' }), /options.linkRoute/);
});

test('link routing handles upward arrows, same-lane loops, zero delay and skipped endpoints', () => {
  const raw = routingFixture();
  raw.links = [
    { from: 'e3', to: 'e2', label: 'up <&' },
    { from: 'e0fall', to: 'e1', delay: 0 },
  ];
  const l = layoutWaveform(raw);
  assert.ok(l.linkRoutes[0].points.at(-2).y > l.linkRoutes[0].to.y);
  assert.equal(l.linkRoutes[1].dimension.x1, l.linkRoutes[1].dimension.x2);
  assert.match(renderWaveformSvg(raw), /up &lt;&amp;/);
  const svgDoc = new DOMParser().parseFromString(renderWaveformSvg(raw), 'image/svg+xml');
  const arrow = Array.from(svgDoc.getElementsByTagName('polygon')).find(
    (e) => e.getAttribute('data-role') === 'link-arrow',
  );
  const coords = arrow.getAttribute('points').split(/[ ,]/).map(Number);
  assert.ok(coords[3] > coords[1]);
  const single = { ...raw, signals: [raw.signals[0]], links: [{ from: 'e0', to: 'e0fall', delay: 1 }] };
  const one = layoutWaveform(single);
  assert.ok(one.linkRoutes[0].dimension.y < one.plotBottom);
  assert.equal(one.linkRoutes[0].route, 'local');
  assert.deepEqual(layoutWaveform({ ...raw, links: [{ from: 'gone', to: 'e2' }] }).linkRoutes, []);
  assert.deepEqual(layoutWaveform(fixture(), { from: 8, to: 16 }).linkRoutes, []);
  assert.throws(() => layoutWaveform(raw, { pixelsPerTick: 1e308 }), /dimensions/);
  assert.deepEqual(layoutWaveform({ ...raw, signals: [], links: [] }).gutters, []);
});
