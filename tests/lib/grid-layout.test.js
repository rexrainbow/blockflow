import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';
import { fixture } from './helpers.js';
import { renameModule, removeModule, validateDocument } from '../../src/editor/blockchart/commands.js';
import { reconcileGrids } from '../../src/lib/blockchart/grid.js';
const example = JSON.parse(
  await readFile(new URL('../../examples/blockchart/processor-overview.json', import.meta.url), 'utf8'),
);
const schema = JSON.parse(
  await readFile(new URL('../../schema/blockchart.schema.json', import.meta.url), 'utf8'),
);
const validate = new Ajv2020({ strict: true }).compile(schema);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
function clearRoutes(layout) {
  for (const edge of layout.connections)
    for (const section of edge.sections)
      for (let i = 1; i < section.points.length; i++) {
        const a = section.points[i - 1],
          b = section.points[i];
        assert.ok(Math.abs(a.x - b.x) < 1e-5 || Math.abs(a.y - b.y) < 1e-5);
        for (const n of layout.modules) {
          const h =
            Math.abs(a.y - b.y) < 1e-5 &&
            a.y > n.y + 1e-5 &&
            a.y < n.y + n.height - 1e-5 &&
            Math.max(a.x, b.x) > n.x + 1e-5 &&
            Math.min(a.x, b.x) < n.x + n.width - 1e-5;
          const v =
            Math.abs(a.x - b.x) < 1e-5 &&
            a.x > n.x + 1e-5 &&
            a.x < n.x + n.width - 1e-5 &&
            Math.max(a.y, b.y) > n.y + 1e-5 &&
            Math.min(a.y, b.y) < n.y + n.height - 1e-5;
          assert.ok(!h && !v, edge.id + ' crosses ' + n.id);
        }
      }
}

test('ComputeCluster Grid preserves columns, rows, blank cells, bidirectional paths and caption', async () => {
  const raw = structuredClone(example),
    before = structuredClone(raw);
  assert.equal(validate(raw), true, JSON.stringify(validate.errors));
  const model = createDiagramModel(raw),
    layout = await layoutDiagram(model),
    nodes = new Map(layout.modules.map((n) => [n.id, n]));
  assert.deepEqual(raw, before);
  assert.deepEqual(copyLayout(layout), layout);
  clearRoutes(layout);
  const center = (id) => {
    const n = nodes.get(id);
    return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
  };
  near(center('ALU0').x, center('ALU4').x);
  near(center('ALU4').x, center('ALU1').x);
  near(center('ALU3').x, center('ALU2').x);
  near(center('ALU4').y, center('ALU3').y);
  near(center('ALU1').y, center('ALU2').y);
  assert.ok(center('ALU0').y < center('ALU4').y && center('ALU4').y < center('ALU1').y);
  assert.equal(model.modules.find((n) => n.id === 'ALU4').ports.length, 0);
  assert.equal(model.modules.find((n) => n.id === 'ALU3').ports.length, 0);
  for (const e of layout.connections.filter((e) => e.direction === 'both')) {
    assert.deepEqual(e.startArrow.points[0], e.sections[0].points[0]);
    assert.deepEqual(e.arrow.points[0], e.sections.at(-1).points.at(-1));
  }
  const svg = renderSvg(layout);
  assert.equal((svg.match(/connection-start-arrow/g) ?? []).length, 3);
  assert.ok(svg.includes('Double-headed edges'));
  assert.ok((await sharp(Buffer.from(svg)).png().toBuffer()).length > 1000);
  const scoped = await layoutDiagram(model, { rootGroupId: 'ComputeCluster' });
  assert.deepEqual(copyLayout(scoped), scoped);
  assert.equal(scoped.modules.length, 5);
  clearRoutes(scoped);
});

test('grid validation accepts subsets and empty grids but rejects non-members, duplicates and malformed tracks', () => {
  for (const cells of [[['ALU0', 'ALU0']], [['Missing']], [['ALU0'], ['ALU4', 'ALU1']], []]) {
    const raw = structuredClone(example);
    raw.groups[1].layout.cells = cells;
    assert.throws(() => createDiagramModel(raw), { name: 'DiagramValidationError' });
  }
  for (const cells of [[['ALU0']], [[null]]]) {
    const raw = structuredClone(example);
    raw.groups[1].layout.cells = cells;
    assert.equal(validate(raw), true);
    assert.doesNotThrow(() => createDiagramModel(raw));
  }
  for (const value of [-1, null, '10', Infinity]) {
    const raw = structuredClone(example);
    raw.groups[1].layout.rowGap = value;
    assert.equal(validate(raw), false);
    assert.throws(() => createDiagramModel(raw));
  }
  const auto = fixture();
  auto.layout = { type: 'auto', cells: [['a', 'b']] };
  assert.equal(validate(auto), false);
  assert.throws(() => createDiagramModel(auto));
});

for (const direction of ['right', 'down'])
  test(`partial Grid reserves blank tracks and Auto uses real signal ranks (${direction})`, async () => {
    const raw = {
      version: 1,
      diagram: { name: 'Partial Grid' },
      modules: ['A', 'B', 'C', 'D', 'E'].map((id) => ({
        id,
        ports: [
          { id: 'i', direction: 'input' },
          { id: 'o', direction: 'output' },
        ],
      })),
      layout: {
        direction,
        type: 'grid',
        cells: [
          ['A', null, 'C'],
          ['B', null, null],
        ],
        columnGap: 80,
        rowGap: 60,
      },
      connections: [
        { from: 'D.o', to: ['A.i'] },
        { from: 'B.o', to: ['E.i'] },
        { from: 'C.o', to: ['D.i'], constraint: false },
      ],
    };
    const before = structuredClone(raw),
      model = createDiagramModel(raw),
      result = await layoutDiagram(model);
    assert.deepEqual(raw, before);
    assert.deepEqual(copyLayout(result), result);
    assert.equal(result.groups, undefined);
    assert.equal(result.modules.length, 5);
    assert.equal(result.connections.length, 3);
    clearRoutes(result);
    const n = Object.fromEntries(result.modules.map((n) => [n.id, n]));
    near(n.A.x, n.B.x);
    near(n.A.y, n.C.y);
    assert.ok(n.C.x - n.A.x - n.A.width >= 140 + 2 * 80);
    assert.ok(n.B.y - n.A.y - n.A.height >= 60);
    const box = { x: n.A.x, y: n.A.y, right: n.C.x + n.C.width, bottom: n.B.y + n.B.height };
    for (const a of [n.D, n.E])
      assert.ok(a.x + a.width <= box.x || a.x >= box.right || a.y + a.height <= box.y || a.y >= box.bottom);
    if (direction === 'right') {
      assert.ok(n.D.x + n.D.width < box.x);
      assert.ok(n.E.x > box.right);
    } else {
      assert.ok(n.D.y + n.D.height < box.y);
      assert.ok(n.E.y > box.bottom);
    }
    const noConstraint = structuredClone(raw);
    noConstraint.connections.pop();
    const next = await layoutDiagram(createDiagramModel(noConstraint));
    for (const p of next.modules) {
      near(p.x - next.modules[0].x, n[p.id].x - n.A.x);
      near(p.y - next.modules[0].y, n[p.id].y - n.A.y);
    }
    const empty = structuredClone(raw);
    empty.layout.cells = [[null]];
    const auto = await layoutDiagram(createDiagramModel(empty));
    assert.equal(auto.modules.length, 5);
    clearRoutes(auto);
  });

test('partial nested Grids keep group identities and scoped/collapsed bounds', async () => {
  const raw = {
    version: 1,
    diagram: { name: 'Nested partial' },
    modules: ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id })),
    groups: [
      { id: 'Inner', members: ['A', 'B', 'C'], layout: { type: 'grid', cells: [['A', null, 'B']] } },
      { id: 'Outer', members: ['Inner', 'D', 'E'], layout: { type: 'grid', cells: [['Inner', null]] } },
    ],
    layout: { type: 'grid', cells: [['Outer']] },
  };
  const model = createDiagramModel(raw),
    layout = await layoutDiagram(model);
  assert.deepEqual(layout.groups.map((g) => g.id).sort(), ['Inner', 'Outer']);
  assert.deepEqual(copyLayout(layout), layout);
  for (const rootGroupId of ['Inner', 'Outer']) {
    const scoped = await layoutDiagram(model, { rootGroupId });
    assert.deepEqual(copyLayout(scoped), scoped);
    const root = scoped.groups.find((g) => g.id === rootGroupId);
    for (const n of scoped.modules)
      assert.ok(
        n.x >= root.x &&
          n.x + n.width <= root.x + root.width &&
          n.y >= root.y &&
          n.y + n.height <= root.y + root.height,
      );
  }
  raw.groups[0].type = 'collection';
  raw.groups[0].collapsed = true;
  const collapsed = await layoutDiagram(createDiagramModel(raw));
  assert.deepEqual(collapsed.modules.map((n) => n.id).sort(), ['D', 'E']);
  assert.deepEqual(copyLayout(collapsed), collapsed);
});

for (const flow of ['right', 'down'])
  test(`explicit sides keep port roles, text and endpoints (${flow})`, async () => {
    const raw = {
      version: 1,
      diagram: { name: 'Sides' },
      layout: { direction: flow },
      modules: [
        {
          id: 'A',
          ports: ['left', 'right', 'top', 'bottom'].map((side) => ({
            id: side,
            direction: 'inout',
            side,
            label: 'Port ' + side,
          })),
        },
      ],
    };
    const layout = await layoutDiagram(createDiagramModel(raw)),
      n = layout.modules[0];
    for (const p of n.ports) {
      if (p.side === 'left') near(p.x, n.x);
      if (p.side === 'right') near(p.x, n.x + n.width);
      if (p.side === 'top') near(p.y, n.y);
      if (p.side === 'bottom') near(p.y, n.y + n.height);
      assert.ok(p.labelBounds.x >= n.x);
      assert.ok(p.labelBounds.x + p.labelBounds.width <= n.x + n.width + 1e-5);
    }
    assert.deepEqual(copyLayout(layout), layout);
  });

test('non-constraining feedback leaves relative auto placement unchanged', async () => {
  const raw = fixture(),
    base = await layoutDiagram(createDiagramModel(raw));
  raw.connections.push({ from: 'b.o', to: ['a.i'], constraint: false });
  const next = await layoutDiagram(createDiagramModel(raw));
  for (let i = 0; i < base.modules.length; i++) {
    near(next.modules[i].x - next.modules[0].x, base.modules[i].x - base.modules[0].x);
    near(next.modules[i].y - next.modules[0].y, base.modules[i].y - base.modules[0].y);
  }
  assert.equal(next.connections[1].routingInfo.reason, 'non-constraining');
  clearRoutes(next);
});

test('both-direction links require inout ends and enforce driver/width rules in both directions', () => {
  const raw = structuredClone(example);
  raw.modules.find((n) => n.id === 'Controller').ports[0].direction = 'output';
  assert.throws(() => createDiagramModel(raw), /inout/);
  const duplicate = structuredClone(example);
  duplicate.connections.push({ from: 'ALU1.controller', to: ['Controller.alu1'], direction: 'both' });
  assert.throws(() => createDiagramModel(duplicate), /driver|Duplicate/);
  const width = structuredClone(example);
  width.modules.find((n) => n.id === 'Controller').ports[0].width = 16;
  width.modules.find((n) => n.id === 'ALU1').ports[0].width = 32;
  assert.throws(() => createDiagramModel(width), /width mismatch/);
});

test('caption reserves complete image space, hides without space and rejects unsafe DOM data', async () => {
  const raw = fixture(),
    base = await layoutDiagram(createDiagramModel(raw));
  raw.diagram.caption = 'A long footer\nsecond line';
  raw.diagram.style = { caption: { padding: 12, fontSize: 20, backgroundColor: '#fff' } };
  const layout = await layoutDiagram(createDiagramModel(raw));
  assert.ok(layout.height > base.height);
  assert.ok(layout.caption.labelBounds.y >= base.height);
  assert.ok(layout.caption.labelBounds.x + layout.caption.labelBounds.width <= layout.width);
  raw.diagram.style.caption.hidden = true;
  const hidden = await layoutDiagram(createDiagramModel(raw));
  near(hidden.width, base.width);
  near(hidden.height, base.height);
  assert.ok(!renderSvg(hidden).includes('A long footer'));
  const invalid = structuredClone(layout);
  invalid.caption.text = '<bad>\u0000';
  assert.throws(() => copyLayout(invalid));
});

test('Grid references survive rename, removal and new members without fake signal edges', () => {
  const raw = structuredClone(example);
  renameModule(raw, 'ALU4', 'Spare');
  assert.equal(raw.groups[1].layout.cells[1][0], 'Spare');
  removeModule(raw, 'ALU3');
  assert.throws(() => reconcileGrids(raw), /Grid cells/);
  raw.groups[1].layout.cells[1][1] = null; // Explicit deletion cleanup, not silent reconciliation.
  reconcileGrids(raw);
  assert.equal(raw.groups[1].layout.cells[1][1], null);
  const cells = structuredClone(raw.groups[1].layout.cells);
  raw.modules.push({ id: 'New' });
  raw.groups[1].members.push('New');
  reconcileGrids(raw);
  assert.deepEqual(raw.groups[1].layout.cells, cells);
  assert.doesNotThrow(() => createDiagramModel(raw));
  const empty = {
    version: 1,
    diagram: { name: 'Empty editor' },
    modules: [],
    layout: { type: 'grid', cells: [[null]] },
  };
  assert.doesNotThrow(() => validateDocument(empty));
});

test('bidirectional boundary interfaces validate inside and outside receiving faces independently', async () => {
  const raw = {
    version: 1,
    diagram: { name: 'Inout boundary' },
    modules: [
      { id: 'Peer', ports: [{ id: 'io', direction: 'inout', side: 'right' }] },
      { id: 'Child', ports: [{ id: 'io', direction: 'inout', side: 'left' }] },
      { id: 'InnerSpare' },
    ],
    groups: [
      {
        id: 'G',
        type: 'boundary',
        ports: [{ id: 'io', direction: 'inout', side: 'left' }],
        members: ['Child', 'InnerSpare'],
        layout: { type: 'grid', cells: [['Child']] },
      },
    ],
    connections: [
      { from: 'Peer.io', to: ['G.io'], direction: 'both' },
      { from: 'G.io', to: ['Child.io'], direction: 'both' },
    ],
  };
  const model = createDiagramModel(raw),
    layout = await layoutDiagram(model);
  assert.deepEqual(copyLayout(layout), layout);
  clearRoutes(layout);
  const scoped = await layoutDiagram(model, { rootGroupId: 'G' });
  assert.equal(scoped.connections.length, 1);
  assert.deepEqual(copyLayout(scoped), scoped);
  raw.modules.push({ id: 'Other', ports: [{ id: 'io', direction: 'inout' }] });
  raw.connections.push({ from: 'Other.io', to: ['G.io'], direction: 'both' });
  assert.throws(() => createDiagramModel(raw), /driver/);
});
