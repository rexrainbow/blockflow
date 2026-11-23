import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/blockchart/index.js';
import { withGridBlockMinimums } from '../../src/lib/blockchart/layout/grid-minimums.js';
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
  JSON.parse(readFileSync(new URL('../../schema/blockchart.schema.json', import.meta.url), 'utf8')),
);
function document() {
  return {
    version: 1,
    diagram: {
      name: 'Grid Block minima',
      style: { module: { portLabel: { hidden: true } }, connection: { label: { repeatAtEnd: 'never' } } },
    },
    layout: { type: 'grid', cells: [['A', 'B']] },
    modules: [
      { id: 'A', label: 'ALU', ports: [{ id: 'out', direction: 'output' }] },
      { id: 'B', label: 'Processor', width: 3, height: 2, ports: [{ id: 'in', direction: 'input' }] },
    ],
    connections: [{ from: 'A.out', to: ['B.in'], label: 'Payload' }],
  };
}
function scope(raw, local) {
  if (!local) return raw.layout;
  raw.groups = [{ id: 'G', members: ['A', 'B'], layout: raw.layout }];
  raw.layout = {};
  return raw.groups[0].layout;
}
for (const local of [false, true])
  for (const key of ['blockMinWidth', 'blockMinHeight'])
    test(`schema/runtime validate numeric Grid-only ${key} (${local ? 'Group' : 'Top'})`, () => {
      for (const value of [0, -1, null, 'auto', true, Infinity, NaN]) {
        const raw = document(),
          config = scope(raw, local);
        config[key] = value;
        assert.equal(validate(raw), false, String(value));
        assert.throws(
          () => createDiagramModel(raw),
          (e) => e.path === (local ? 'groups[0].layout.' : 'layout.') + key,
        );
      }
      const raw = document(),
        config = scope(raw, local);
      config[key] = 1.25;
      assert.equal(validate(raw), true, JSON.stringify(validate.errors));
      const model = createDiagramModel(raw);
      assert.equal((local ? model.groups[0].layout : model.layout)[key], 1.25);
      config.type = 'auto';
      delete config.cells;
      assert.equal(validate(raw), false);
      assert.throws(
        () => createDiagramModel(raw),
        (e) => e.path === (local ? 'groups[0].layout.' : 'layout.') + key,
      );
    });

test('Auto is omission and a single-axis bound does not author the other axis', () => {
  const raw = document(),
    model = createDiagramModel(raw);
  assert.equal(withGridBlockMinimums(model), model);
  assert.ok(!Object.hasOwn(model.layout, 'blockMinWidth'));
  raw.layout.blockMinWidth = 2;
  const source = createDiagramModel(raw),
    saved = structuredClone(source),
    effective = withGridBlockMinimums(source);
  assert.equal(effective.modules[0].width, 2);
  assert.ok(!Object.hasOwn(effective.modules[0], 'height'));
  assert.equal(effective.modules[1], source.modules[1]);
  assert.deepEqual(source, saved);
});
for (const direction of ['right', 'down'])
  for (const appearance of [
    undefined,
    { type: 'stacked', layers: 3 },
    { type: 'trapezoid', rightHeightRatio: 0.7 },
  ])
    test(`pre-measurement Grid minima match equivalent authored Block dimensions (${direction}, ${appearance?.type ?? 'rectangle'})`, async () => {
      const raw = document();
      raw.layout.direction = direction;
      raw.layout.blockMinWidth = 2;
      raw.layout.blockMinHeight = 1.25;
      if (appearance) raw.modules[0].appearance = appearance;
      const reference = structuredClone(raw);
      delete reference.layout.blockMinWidth;
      delete reference.layout.blockMinHeight;
      reference.modules[0].width = 2;
      reference.modules[0].height = 1.25;
      const saved = structuredClone(raw),
        model = createDiagramModel(raw),
        snapshot = structuredClone(model),
        result = await layoutDiagram(model),
        expected = await layoutDiagram(createDiagramModel(reference));
      assert.deepEqual(result, expected);
      assert.equal(renderSvg(result), renderSvg(expected));
      const a = result.modules.find((m) => m.id === 'A'),
        b = result.modules.find((m) => m.id === 'B');
      assert.ok(a.width >= 280 && a.height >= 105);
      assert.ok(b.width >= 420 && b.height >= 168);
      const edge = result.connections[0];
      assert.deepEqual(edge.sections[0].points[0], { x: a.ports[0].x, y: a.ports[0].y });
      assert.ok(edge.labelInstances.some((label) => label.role === 'start'));
      assert.deepEqual(raw, saved);
      assert.deepEqual(model, snapshot);
      assert.deepEqual(result.warnings ?? [], []);
    });

test('natural text dimensions may exceed the Grid lower bound', async () => {
  const raw = document();
  raw.modules[0].label = Array(12).fill('A'.repeat(60)).join('\n');
  raw.layout.blockMinWidth = 1;
  raw.layout.blockMinHeight = 1;
  const result = await layoutDiagram(createDiagramModel(raw)),
    a = result.modules.find((m) => m.id === 'A');
  assert.ok(a.width > 140 && a.height > 84);
});

test('partial Grids leave unselected ordinary Blocks untouched', async () => {
  const raw = document();
  raw.modules.push({ id: 'Free', label: 'Free', ports: [] });
  raw.layout.cells = [['A', null]];
  raw.layout.blockMinWidth = 2;
  raw.layout.blockMinHeight = 1.25;
  const source = createDiagramModel(raw),
    effective = withGridBlockMinimums(source);
  assert.equal(effective.modules[2], source.modules[2]);
  const result = await layoutDiagram(source),
    free = result.modules.find((m) => m.id === 'Free');
  assert.ok(free.width < 280 && free.height < 105);
});

test('Container and Concat cells do not propagate the ordinary Block bounds', () => {
  const raw = {
    version: 1,
    diagram: { name: 'Excluded cells' },
    layout: { type: 'grid', cells: [['G', 'B', 'Join']], blockMinWidth: 2, blockMinHeight: 2 },
    modules: [
      { id: 'A', ports: [] },
      { id: 'B', ports: [] },
      {
        id: 'Join',
        type: 'concat',
        ports: [
          { id: 'a', direction: 'input' },
          { id: 'b', direction: 'input' },
          { id: 'out', direction: 'output' },
        ],
      },
    ],
    groups: [{ id: 'G', members: ['A'] }],
  };
  const source = createDiagramModel(raw),
    effective = withGridBlockMinimums(source);
  assert.equal(effective.modules[0], source.modules[0]);
  assert.equal(effective.modules[2], source.modules[2]);
  assert.equal(effective.modules[1].width, 2);
  assert.equal(effective.modules[1].height, 2);
  assert.equal(effective.groups, source.groups);
});

for (const collapsed of [false, true])
  test(`expanded cross-Group bounds combine by max and survive scoped projection (collapsed ${collapsed})`, async () => {
    const raw = {
      version: 1,
      diagram: { name: 'Scoped bounds' },
      layout: { type: 'grid', cells: [['A', 'B']], blockMinWidth: 2, blockMinHeight: 1.25 },
      modules: [
        { id: 'A', ports: [] },
        { id: 'B', ports: [] },
      ],
      groups: [
        {
          id: 'Left',
          members: ['A'],
          layout: { type: 'grid', cells: [['A']], blockMinWidth: 3, blockMinHeight: 2.5 },
        },
        { id: 'Right', members: ['B'] },
      ],
    };
    const model = createDiagramModel(raw),
      snapshot = structuredClone(model),
      scoped = await layoutDiagram(model, { rootGroupId: 'Left' }),
      a = scoped.modules.find((m) => m.id === 'A');
    assert.equal(a.width, 420);
    assert.equal(a.height, 210);
    if (!collapsed) {
      const full = await layoutDiagram(model);
      const same = full.modules.find((m) => m.id === 'A');
      assert.equal(same.width, a.width);
      assert.equal(same.height, a.height);
      const b = full.modules.find((m) => m.id === 'B');
      assert.equal(b.width, 280);
      assert.equal(b.height, 105);
    } else {
      raw.layout = {};
      raw.groups[0].type = 'boundary';
      raw.groups[0].collapsed = true;
      const opened = await layoutDiagram(createDiagramModel(raw), { rootGroupId: 'Left' });
      assert.equal(opened.modules[0].width, 420);
      assert.equal(opened.modules[0].height, 210);
    }
    assert.deepEqual(model, snapshot);
  });
