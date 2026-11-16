import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import sharp from 'sharp';
import { DOMParser } from '@xmldom/xmldom';
import {
  parseMermaid,
  createStatechartModel,
  layoutStatechart,
  renderStatechartSvg,
} from '../../src/lib/statechart/index.js';
const source = await readFile(new URL('../fixtures/statechart/timer-fsm.mmd', import.meta.url), 'utf8');
const schema = JSON.parse(
  await readFile(new URL('../../schema/statechart.schema.json', import.meta.url), 'utf8'),
);
const validate = new Ajv({ strict: true }).compile(schema);
test('Timer FSM preserves state descriptions, individual conditions, stop transitions and immutable kinds', async () => {
  const raw = parseMermaid(source),
    before = structuredClone(raw),
    model = createStatechartModel(raw);
  assert.equal(validate(raw), true, JSON.stringify(validate.errors));
  assert.equal(raw.states.length, 5);
  assert.equal(raw.transitions.length, 12);
  assert.equal(raw.states.find((s) => s.id === 'INIT').description, 'idle-output');
  assert.equal(raw.transitions.filter((t) => t.from === 'LO' && t.to === 'HI').length, 2);
  assert.equal(raw.transitions.filter((t) => t.label === 'Function-Stop').length, 3);
  const layout = await layoutStatechart(model);
  assert.equal(layout.transitions.length, 12);
  assert.deepEqual(raw, before);
  assert.ok(model.transitions.every((t) => !t.kind));
  const parallel = layout.transitions.filter((t) => t.from === 'LO' && t.to === 'HI');
  assert.notDeepEqual(parallel[0].sections, parallel[1].sections);
  assert.ok(layout.width > 0 && layout.height > 0);
  const styled = JSON.parse(
    await readFile(new URL('../fixtures/statechart/timer-fsm.json', import.meta.url), 'utf8'),
  );
  const styledBefore = structuredClone(styled);
  assert.equal(validate(styled), true, JSON.stringify(validate.errors));
  const styledLayout = await layoutStatechart(styled);
  assert.equal(styledLayout.states.length, 5);
  assert.equal(styledLayout.transitions.length, 12);
  assert.deepEqual(styled, styledBefore);
});
test('aliases, repeated descriptions, pseudostates and generated IDs avoid name collisions', () => {
  const raw = parseMermaid(
    'stateDiagram-v2\r\n %% comment\r\n state "Friendly" as A\r\n A: output = 1\r\n initial_1\r\n [*] --> A\r\n A --> [*]',
  );
  assert.equal(raw.states[0].label, 'Friendly');
  assert.equal(raw.states[0].description, 'output = 1');
  assert.equal(raw.states.find((s) => s.kind === 'initial').id, 'initial_2');
  assert.equal(raw.states.find((s) => s.kind === 'final').id, 'final_1');
  assert.equal(validate(raw), true);
});
test('unsupported syntax and invalid inputs fail explicitly with source locations', () => {
  for (const line of [
    'state A {',
    'state C <<choice>>',
    'A --> B --> C',
    '--',
    'note right of A',
    'classDef x fill:red',
    'A; B',
    '---',
    '[*] --> [*]',
  ])
    assert.throws(
      () => parseMermaid('stateDiagram-v2\n' + line),
      (e) => e.line === 2 && e.column === 1,
      line,
    );
  assert.throws(
    () => parseMermaid('flowchart TD\nA'),
    (e) => e.line === 1,
  );
});
test('strict domain validation rejects references, duplicates, invalid styles and pseudostate misuse', () => {
  const base = () => ({
    version: 1,
    diagram: { name: 'FSM' },
    states: [{ id: 'A' }, { id: 'B' }],
    transitions: [],
  });
  for (const change of [
    (d) => (d.states = []),
    (d) => (d.groups = []),
    (d) => (d.states[1].id = 'A'),
    (d) => (d.states[0].kind = 'choice'),
    (d) => (d.states[0].style = { fillColor: 'red' }),
    (d) => (d.states[0].description = ''),
    (d) => (d.transitions = [{ from: 'A', to: 'Missing' }]),
    (d) => (d.transitions = [{ from: 'A', to: 'B', arrow: false }]),
    (d) => {
      d.states[0].kind = 'final';
      d.transitions = [{ from: 'A', to: 'B' }];
    },
    (d) => {
      d.states[1].kind = 'initial';
      d.transitions = [{ from: 'A', to: 'B' }];
    },
    (d) => {
      d.states[0].kind = 'initial';
      d.states[0].label = 'No';
    },
  ]) {
    const raw = base();
    change(raw);
    assert.throws(
      () => createStatechartModel(raw),
      (e) => typeof e.path === 'string' && e.name === 'StatechartValidationError',
    );
  }
  const raw = base();
  raw.transitions = [
    { from: 'A', to: 'B' },
    { id: 'transition_1', from: 'B', to: 'A' },
  ];
  assert.throws(() => createStatechartModel(raw));
  raw.transitions = [
    { from: 'A', to: 'B' },
    { id: 'edge_1', from: 'B', to: 'A' },
  ];
  assert.doesNotThrow(() => createStatechartModel(raw));
});
test('all directions, self loops, final symbols and XML escaping produce valid SVG/PNG', async () => {
  for (const direction of ['down', 'right', 'up', 'left']) {
    const raw = {
      version: 1,
      diagram: { name: '<FSM>' },
      layout: { direction },
      states: [
        { id: 'I', kind: 'initial' },
        { id: 'A', label: 'A < &', description: 'out = 1' },
        { id: 'F', kind: 'final' },
      ],
      transitions: [
        { from: 'I', to: 'A' },
        { from: 'A', to: 'A', label: 'again' },
        { from: 'A', to: 'F' },
      ],
    };
    const before = structuredClone(raw),
      layout = await layoutStatechart(raw),
      svg = renderStatechartSvg(layout);
    assert.deepEqual(raw, before);
    assert.match(svg, /&lt;FSM&gt;/);
    assert.match(svg, /A &lt; &amp;/);
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    assert.equal(xml.getElementsByTagName('circle').length, 3);
    assert.equal(xml.getElementsByTagName('script').length, 0);
    const points = layout.transitions[1].sections[0].points;
    assert.ok(points.length >= 4);
    assert.ok(points.every((p, i) => !i || p.x === points[i - 1].x || p.y === points[i - 1].y));
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    assert.ok(png.length > 500);
  }
});
test('schema and runtime both reject null option values instead of silently applying defaults', () => {
  for (const change of [
    (d) => (d.layout = null),
    (d) => (d.layout = { direction: null }),
    (d) => (d.diagram.style = { state: null }),
    (d) => (d.diagram.style = { transition: false }),
    (d) => (d.states[0].kind = null),
    (d) => (d.transitions[0].id = null),
  ]) {
    const raw = {
      version: 1,
      diagram: { name: 'Strict' },
      states: [{ id: 'A' }, { id: 'B' }],
      transitions: [{ from: 'A', to: 'B' }],
    };
    change(raw);
    assert.equal(validate(raw), false);
    assert.throws(
      () => createStatechartModel(raw),
      (e) => e.name === 'StatechartValidationError',
    );
  }
});
test('punctuation in literal conditions and names is not mistaken for composite syntax', () => {
  const raw = parseMermaid('stateDiagram-v2\nstate "Ready {output}" as A\nA --> B: guard {value} >> 1');
  assert.equal(raw.states[0].label, 'Ready {output}');
  assert.equal(raw.transitions[0].label, 'guard {value} >> 1');
});
