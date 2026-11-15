import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';
import { reconcileGrids, createGridPlan, directGridMembers } from '../../src/lib/blockchart/grid.js';
import { renameModule, removeModule, removeGroup } from '../../src/editor/state/commands.js';
const source = JSON.parse(
  await readFile(new URL('../../examples/processor-cross-group-grid.json', import.meta.url), 'utf8'),
);
const schema = JSON.parse(
  await readFile(new URL('../../schema/blockchart.schema.json', import.meta.url), 'utf8'),
);
const validate = new Ajv2020({ strict: true }).compile(schema);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
function verify(result) {
  assert.deepEqual(copyLayout(result), result);
  const nodes = new Map(result.modules.map((n) => [n.id, n])),
    frame = result.groups.find((g) => g.id === 'ComputeCluster');
  const center = (id) => {
    const n = nodes.get(id);
    return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
  };
  near(center('Clock').y, center('ALU0').y);
  near(center('Controller').y, center('ALU1').y);
  near(center('ALU1').y, center('ALU2').y);
  near(center('ALU4').y, center('ALU3').y);
  for (const id of frame.members) {
    const n = nodes.get(id);
    assert.ok(
      n.x >= frame.x &&
        n.x + n.width <= frame.x + frame.width + 1e-5 &&
        n.y >= frame.labelBounds.y + frame.labelBounds.height &&
        n.y + n.height <= frame.y + frame.height + 1e-5,
    );
  }
  for (const id of ['Clock', 'Controller']) {
    const n = nodes.get(id);
    assert.ok(n.x + n.width < frame.x);
  }
  for (const edge of result.connections)
    for (const section of edge.sections)
      for (let i = 1; i < section.points.length; i++) {
        const a = section.points[i - 1],
          b = section.points[i];
        assert.ok(Math.abs(a.x - b.x) < 1e-5 || Math.abs(a.y - b.y) < 1e-5);
        for (const n of result.modules) {
          const horizontal =
            Math.abs(a.y - b.y) < 1e-5 &&
            a.y > n.y + 1e-5 &&
            a.y < n.y + n.height - 1e-5 &&
            Math.max(a.x, b.x) > n.x + 1e-5 &&
            Math.min(a.x, b.x) < n.x + n.width - 1e-5;
          const vertical =
            Math.abs(a.x - b.x) < 1e-5 &&
            a.x > n.x + 1e-5 &&
            a.x < n.x + n.width - 1e-5 &&
            Math.max(a.y, b.y) > n.y + 1e-5 &&
            Math.min(a.y, b.y) < n.y + n.height - 1e-5;
          assert.ok(!horizontal && !vertical, `route crosses ${n.id}`);
        }
      }
  return { nodes, frame, center };
}
for (const direction of ['right', 'down'])
  test(`cross-group Grid shares centers and preserves Container identity (${direction})`, async () => {
    const raw = structuredClone(source);
    raw.layout.direction = direction;
    const before = structuredClone(raw);
    assert.equal(validate(raw), true, JSON.stringify(validate.errors));
    const result = await layoutDiagram(createDiagramModel(raw));
    verify(result);
    assert.deepEqual(raw, before);
    assert.equal(result.modules.length, 7);
    assert.equal(result.groups.length, 1);
    assert.equal(result.connections.length, 4);
    assert.equal((renderSvg(result).match(/connection-start-arrow/g) ?? []).length, 3);
  });
test('cross-group Grid fits inside a parent scope and leaves unrelated Auto nodes outside the whole Grid', async () => {
  const raw = structuredClone(source);
  raw.modules.push({ id: 'Outside', ports: [{ id: 'o', direction: 'output' }] });
  raw.modules.find((n) => n.id === 'Clock').ports.push({ id: 'extra', direction: 'input' });
  raw.connections.push({ from: 'Outside.o', to: ['Clock.extra'] });
  const result = await layoutDiagram(createDiagramModel(raw)),
    { nodes, frame } = verify(result),
    outside = nodes.get('Outside');
  assert.ok(outside.x + outside.width < nodes.get('Clock').x);
  assert.ok(outside.x + outside.width < frame.x);
  const nested = structuredClone(source),
    own = nested.layout;
  nested.layout = { direction: 'right' };
  delete own.direction;
  nested.groups.push({ id: 'Outer', members: ['Clock', 'Controller', 'ComputeCluster'], layout: own });
  const model = createDiagramModel(nested);
  verify(await layoutDiagram(model));
  const scoped = await layoutDiagram(model, { rootGroupId: 'Outer' });
  verify(scoped);
  const root = scoped.groups.find((g) => g.id === 'Outer');
  for (const n of [...scoped.modules, ...scoped.groups.filter((g) => g.id !== 'Outer')])
    assert.ok(
      n.x >= root.x &&
        n.y >= root.y &&
        n.x + n.width <= root.x + root.width + 1e-5 &&
        n.y + n.height <= root.y + root.height + 1e-5,
    );
});
test('ancestor Grid suspends saved child layouts while group views use them', async () => {
  const raw = structuredClone(source);
  raw.groups[0].layout.cells = [
    ['ALU4', 'ALU3'],
    ['ALU1', 'ALU2'],
    ['ALU0', null],
  ];
  const model = createDiagramModel(raw);
  verify(await layoutDiagram(model));
  const scoped = await layoutDiagram(model, { rootGroupId: 'ComputeCluster' });
  assert.deepEqual(copyLayout(scoped), scoped);
  assert.ok(scoped.modules.find((n) => n.id === 'ALU4').y < scoped.modules.find((n) => n.id === 'ALU0').y);
  assert.equal(scoped.modules.length, 5);
  assert.equal(scoped.connections.length, 1);
});
test('validation rejects partial Containers, outside cells, obsolete expansion flags and non-Containers', () => {
  const cases = [
    (d) => (d.layout.cells[2][1] = null),
    (d) => (d.layout.expandGroups = ['Clock']),
    (d) => (d.layout.expandGroups = ['Missing']),
    (d) => (d.layout.expandGroups = 'ComputeCluster'),
    (d) => (d.layout.expandGroups = null),
    (d) => (d.layout.cells[0][1] = 'ComputeCluster'),
    (d) => {
      d.layout.cells[0][0] = 'ALU0';
      d.layout.cells[0][1] = 'Clock';
    },
    (d) => (d.groups[0].type = 'collection'),
    (d) => {
      d.groups[0].type = 'boundary';
      d.groups[0].ports = [{ id: 'in', direction: 'input' }];
    },
    (d) => {
      d.layout.type = 'auto';
    },
  ];
  for (const change of cases) {
    const raw = structuredClone(source);
    change(raw);
    assert.throws(() => createDiagramModel(raw));
  }
  for (const expandGroups of [null, 'ComputeCluster', ['ComputeCluster', 'ComputeCluster'], [3]]) {
    const raw = structuredClone(source);
    raw.layout.expandGroups = expandGroups;
    assert.equal(validate(raw), false);
  }
});
test('membership edits preserve cross-group references and never auto-fill required cells', () => {
  const raw = structuredClone(source);
  renameModule(raw, 'ALU4', 'Spare');
  reconcileGrids(raw);
  assert.equal(raw.layout.cells[2][1], 'Spare');
  assert.doesNotThrow(() => createDiagramModel(raw));
  raw.modules.push({ id: 'New' });
  raw.groups[0].members.push('New');
  assert.throws(() => reconcileGrids(raw), /every direct member/);
  assert.throws(() => createDiagramModel(raw), /every direct member/);
  raw.layout.cells.push([null, 'New', null]);
  assert.doesNotThrow(() => createDiagramModel(raw));
  removeModule(raw, 'New');
  assert.throws(() => reconcileGrids(raw), /Grid cells/);
  raw.layout.cells[3][1] = null; // The deletion command must explicitly clean its references.
  reconcileGrids(raw);
  assert.doesNotThrow(() => createDiagramModel(raw));
  removeGroup(raw, 'ComputeCluster');
  reconcileGrids(raw);
  assert.equal(raw.layout.expandGroups, undefined);
  assert.doesNotThrow(() => createDiagramModel(raw));
});

test('multiple Container frames reserve headers/minima and reject overlapping empty regions', async () => {
  const raw = {
    version: 1,
    diagram: { name: 'Two frames' },
    modules: ['A0', 'A1', 'B0', 'B1'].map((id) => ({ id })),
    groups: [
      {
        id: 'A',
        label: 'A long Container heading that sets the minimum width',
        width: 4,
        height: 4,
        members: ['A0', 'A1'],
      },
      { id: 'B', label: 'B\nSecond line', members: ['B0', 'B1'] },
    ],
    layout: {
      type: 'grid',
      cells: [
        ['A0', 'B0'],
        ['A1', 'B1'],
      ],
    },
  };
  const result = await layoutDiagram(createDiagramModel(raw));
  assert.deepEqual(copyLayout(result), result);
  const [a, b] = result.groups;
  assert.ok(a.x + a.width < b.x);
  assert.ok(a.width >= 560 && a.height >= 336);
  const nodes = new Map(result.modules.map((n) => [n.id, n]));
  near(nodes.get('A0').y + nodes.get('A0').height / 2, nodes.get('B0').y + nodes.get('B0').height / 2);
  for (const frame of result.groups)
    for (const id of frame.members) {
      const n = nodes.get(id);
      assert.ok(
        n.x >= frame.x &&
          n.x + n.width <= frame.x + frame.width + 1e-5 &&
          n.y >= frame.labelBounds.y + frame.labelBounds.height &&
          n.y + n.height <= frame.y + frame.height + 1e-5,
      );
    }
  raw.layout.cells = [
    [null, 'A0', null],
    ['B0', null, 'B1'],
    [null, 'A1', null],
  ];
  assert.throws(() => createDiagramModel(raw), /regions must not overlap/);
});

test('cells alone infer runtime Grid plans without adding fields to authoring or normalized configs', () => {
  const raw = structuredClone(source),
    before = structuredClone(raw);
  reconcileGrids(raw);
  const model = createDiagramModel(raw);
  const plan = createGridPlan(raw.layout.cells, directGridMembers(raw), raw.groups);
  assert.deepEqual(plan.expandedContainers, ['ComputeCluster']);
  assert.equal(plan.regions[0].id, 'ComputeCluster');
  assert.deepEqual(raw, before);
  for (const config of [model.layout, ...model.groups.map((g) => g.layout)].filter(Boolean)) {
    assert.equal(Object.hasOwn(config, 'expandGroups'), false);
    assert.equal(Object.hasOwn(config, 'expandedContainers'), false);
    assert.equal(Object.hasOwn(config, 'regions'), false);
  }
  raw.layout.cells = [
    ['Clock', 'ComputeCluster'],
    ['Controller', null],
  ];
  assert.deepEqual(createGridPlan(raw.layout.cells, directGridMembers(raw), raw.groups), {
    expandedContainers: [],
    regions: [],
  });
  assert.doesNotThrow(() => reconcileGrids(raw));
  raw.layout.cells = [[null]];
  assert.deepEqual(createGridPlan(raw.layout.cells, directGridMembers(raw), raw.groups), {
    expandedContainers: [],
    regions: [],
  });
});

test('reconciliation reports invalid cells at their source and never silently repairs them', () => {
  const cases = [
    [(d) => (d.layout.cells[0][0] = 'ComputeCluster'), /and its children/, 'layout.cells[0][0]'],
    [(d) => (d.layout.cells[0][0] = 'Typo'), /direct members/, 'layout.cells[0][0]'],
    [(d) => (d.layout.cells[1][0] = 'Clock'), /only once/, 'layout.cells[1][0]'],
    [(d) => (d.layout.cells[2][1] = null), /missing: ALU4/, 'layout.cells[0][1]'],
    [(d) => delete d.layout.cells, /at least one/, 'layout.cells'],
    [(d) => (d.layout.cells[1] = null), /equal column/, 'layout.cells[1]'],
  ];
  for (const [edit, pattern, path] of cases) {
    const raw = structuredClone(source);
    edit(raw);
    const before = structuredClone(raw);
    for (const validate of [reconcileGrids, createDiagramModel])
      assert.throws(
        () => validate(raw),
        (error) => pattern.test(error.message) && error.path === path && !(error instanceof TypeError),
      );
    assert.deepEqual(raw, before);
  }
});

test('legacy fields are rejected at both root and nested scopes, including Auto', () => {
  for (const nested of [false, true])
    for (const auto of [false, true]) {
      const raw = structuredClone(source);
      const config = nested ? raw.groups[0].layout : raw.layout;
      if (auto) {
        config.type = 'auto';
        delete config.cells;
      }
      config.expandGroups = [];
      const before = structuredClone(raw);
      assert.equal(validate(raw), false);
      for (const check of [reconcileGrids, createDiagramModel])
        assert.throws(() => check(raw), /Remove expandGroups/);
      assert.deepEqual(raw, before);
    }
});

test('Grid expansion is limited to direct nonempty Containers and one descendant level', () => {
  const groups = [
    { id: 'Outer', members: ['Inner'] },
    { id: 'Inner', members: ['Leaf'] },
    { id: 'Empty', members: [] },
    { id: 'Boundary', type: 'boundary', members: ['B'] },
    { id: 'Collection', type: 'collection', members: ['C'] },
  ];
  const members = ['Outer', 'Empty', 'Boundary', 'Collection'];
  assert.deepEqual(createGridPlan([['Inner']], members, groups).expandedContainers, ['Outer']);
  assert.deepEqual(
    createGridPlan([['Empty', 'Boundary', 'Collection']], members, groups).expandedContainers,
    [],
  );
  for (const id of ['Leaf', 'B', 'C'])
    assert.throws(() => createGridPlan([[id]], members, groups), /direct members/);
});
