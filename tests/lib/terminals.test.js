import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { copyLayout, connectionKey } from '../../src/lib/view/layout.js';
import {
  endpoints,
  targetReason,
  saveTerminal,
  removeTerminal,
  renameModule,
  removeModule,
} from '../../src/editor/state/commands.js';
import { endpointKey } from '../../src/lib/endpoints.js';

const example = JSON.parse(await readFile(new URL('../../examples/terminals.json', import.meta.url), 'utf8'));
const schema = JSON.parse(
  await readFile(new URL('../../schema/blockflow.schema.json', import.meta.url), 'utf8'),
);
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

test('terminal JSON validates without mutation, retains endpoint identity and text styles', () => {
  const raw = structuredClone(example),
    before = structuredClone(raw);
  raw.terminals[0].label = '輸入\r\n信號';
  raw.terminals[0].style = { color: '#1234', padding: 3, backgroundColor: '#fff' };
  assert.equal(validate(raw), true, JSON.stringify(validate.errors));
  const snapshot = structuredClone(raw),
    model = createDiagramModel(raw);
  assert.deepEqual(raw, snapshot);
  assert.deepEqual(model.connections[0].source, { terminal: 'DataIn' });
  assert.equal(model.terminals[0].label, '輸入\n信號');
  assert.equal(model.terminals[0].style.color, '#11223344');
  assert.equal(model.terminals[0].width, null);
  assert.deepEqual(example, before);
});

test('terminal validation rejects malformed definitions and cross-object mistakes', () => {
  const changes = [
    (d) => (d.terminals[0].id = 'Processor'),
    (d) => (d.terminals[1].id = d.terminals[0].id),
    (d) => (d.terminals[0].direction = 'output'),
    (d) => (d.terminals[0].width = null),
    (d) => (d.terminals[0].width = 1.2),
    (d) => (d.terminals[0].width = Number.MAX_SAFE_INTEGER + 1),
    (d) => (d.terminals[0].style = { borderColor: '#fff' }),
    (d) => (d.terminals[0].label = 'bad\ttext'),
    (d) => (d.terminals[0].ports = []),
    (d) => (d.connections[0].from = { terminal: 'Missing' }),
    (d) => (d.connections[0].from = { terminal: 'DataIn', extra: true }),
    (d) => (d.connections[0].from = '@terminal:DataIn'),
    (d) => (d.connections[0].from = { terminal: 'DataIn\n' }),
    (d) => (d.connections[0].to = [{ terminal: 'DataOut' }]),
    (d) => d.connections.push(structuredClone(d.connections[0])),
    (d) => d.connections.push({ from: 'Processor.interrupts', to: [{ terminal: 'DataOut' }] }),
    (d) => {
      d.terminals[0].width = 8;
      d.modules[0].ports[0].width = 16;
    },
  ];
  for (const [index, change] of changes.entries()) {
    const raw = structuredClone(example);
    change(raw);
    assert.throws(() => createDiagramModel(raw), { name: 'DiagramValidationError' }, `case ${index}`);
  }
  for (const value of [null, {}, 1, 'input']) {
    const raw = { ...example, terminals: value };
    assert.equal(validate(raw), false);
    assert.throws(() => createDiagramModel(raw));
  }
});

test('terminal inputs fan out; bit widths stay local and unknown ports remain unknown', () => {
  const raw = structuredClone(example);
  raw.terminals[0].width = 8;
  raw.modules.push({ id: 'B', ports: [{ id: 'i', direction: 'input' }] });
  raw.connections[0].to.push('B.i');
  const model = createDiagramModel(raw);
  assert.equal(model.connections[0].width, 8);
  assert.equal(model.connections[1].width, 8);
  assert.equal(model.modules[0].ports[0].width, null);
  assert.equal(targetReason(raw, { terminal: 'DataIn' }, 'B.i'), 'Input already connected');
});

test('root terminals honor every boundary and cannot become group members', () => {
  const raw = structuredClone(example);
  raw.groups = [
    {
      id: 'G',
      type: 'boundary',
      members: ['Processor'],
      ports: [
        { id: 'i', direction: 'input' },
        { id: 'o', direction: 'output' },
      ],
    },
  ];
  assert.throws(() => createDiagramModel(raw), /crosses boundary/);
  raw.connections = [
    { from: { terminal: 'DataIn' }, to: ['G.i'] },
    { from: 'G.i', to: ['Processor.data_in'] },
    { from: 'Processor.data_out', to: ['G.o'] },
    { from: 'G.o', to: [{ terminal: 'DataOut' }] },
  ];
  createDiagramModel(raw);
  raw.groups[0].members.push('DataIn');
  assert.throws(() => createDiagramModel(raw), /Unknown group member/);
});

for (const direction of ['right'])
  test(`terminal geometry, order, endpoints, SVG and PNG ${direction}`, async () => {
    const raw = structuredClone(example);
    raw.layout = { direction };
    raw.connections[0].label = 'Pixel data';
    const model = createDiagramModel(raw),
      before = structuredClone(model),
      layout = await layoutDiagram(model);
    assert.deepEqual(model, before);
    assert.equal(layout.modules.length, 1);
    assert.equal(layout.terminals.length, 5);
    const block = layout.modules[0];
    for (const side of ['input', 'output']) {
      const items = layout.terminals.filter((item) => item.direction === side);
      for (const [i, item] of items.entries()) {
        assert.ok(side === 'input' ? item.x + item.width < block.x : item.x > block.x + block.width);
        if (i) assert.ok(item.y > items[i - 1].y, `${side} order`);
        assert.ok(item.labelBounds.x >= 0 && item.labelBounds.y >= 0);
        assert.ok(item.labelBounds.x + item.labelBounds.width <= layout.width + 1e-6);
      }
    }
    for (const edge of layout.connections) {
      for (const [end, start] of [
        [edge.source, true],
        [edge.target, false],
      ])
        if (end.terminal) {
          const terminal = layout.terminals.find((item) => item.id === end.terminal);
          assert.deepEqual(
            start ? edge.sections[0].points[0] : edge.sections.at(-1).points.at(-1),
            terminal.anchor,
          );
        }
      for (const section of edge.sections)
        for (let i = 1; i < section.points.length; i++) {
          const a = section.points[i - 1],
            b = section.points[i];
          assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6);
        }
    }
    assert.deepEqual(copyLayout(layout), layout);
    assert.equal(connectionKey(layout.connections[0]), '@terminal:DataIn->Processor.data_in');
    const svg = renderSvg(layout);
    assert.equal((svg.match(/data-role="terminal"/g) ?? []).length, 5);
    assert.ok(!svg.includes('@terminal:'));
    assert.ok(svg.includes('<tspan'));
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    assert.ok(png.length > 0);
  });

test('unused terminals reserve space, and exterior routing leaves terminal edges to ELK', async () => {
  const raw = structuredClone(example);
  raw.terminals.push({ id: 'Unused', direction: 'input', label: 'Unused\nexternal signal' });
  raw.layout = { feedbackRouting: 'outer' };
  const layout = await layoutDiagram(createDiagramModel(raw));
  assert.equal(layout.terminals.length, 6);
  assert.ok(layout.connections.every((edge) => edge.routingInfo.reason === 'terminal'));
});

test('collection projection retains terminal references; group views omit external terminals', async () => {
  const raw = structuredClone(example);
  raw.groups = [{ id: 'G', type: 'collection', collapsed: true, members: ['Processor'] }];
  const model = createDiagramModel(raw),
    layout = await layoutDiagram(model);
  assert.equal(layout.modules.length, 0);
  assert.equal(layout.terminals.length, 5);
  assert.deepEqual(layout.connections[0].source, { terminal: 'DataIn' });
  assert.equal(layout.connections[0].routingTarget.moduleId, 'G');
  copyLayout(layout);
  const scoped = await layoutDiagram(model, { rootGroupId: 'G' });
  assert.equal(scoped.terminals, undefined);
  assert.equal(scoped.connections.length, 0);
  assert.equal(scoped.modules.length, 1);
});

test('terminal editing is atomic; renames update references and delete cleans only dependent links', () => {
  const raw = structuredClone(example);
  assert.ok(endpoints(raw, 'output').some((item) => item.ref === '@terminal:DataIn'));
  assert.ok(endpoints(raw, 'input').some((item) => item.ref === '@terminal:DataOut'));
  const before = structuredClone(raw);
  assert.throws(() => saveTerminal(raw, 'DataIn', { id: 'Renamed', direction: 'output' }));
  assert.deepEqual(raw, before);
  saveTerminal(raw, 'DataIn', { id: 'Renamed', direction: 'input' });
  assert.deepEqual(raw.connections[0].from, { terminal: 'Renamed' });
  renameModule(raw, 'Processor', 'NewBlock');
  assert.deepEqual(raw.connections[0].to, ['NewBlock.data_in']);
  removeTerminal(raw, 'Renamed');
  assert.equal(raw.connections.length, 4);
  createDiagramModel(raw);
  removeModule(raw, 'NewBlock');
  assert.equal(raw.connections.length, 0);
  assert.equal(endpointKey({ terminal: 'DataOut' }), '@terminal:DataOut');
});
