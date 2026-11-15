import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import { createDiagramModel, layoutDiagram, resolveLayoutSpacing } from '../../src/lib/index.js';
import { buildElkGraph } from '../../src/lib/blockchart/layout/elk-graph.js';
import { scopeModel } from '../../src/lib/blockchart/layout/scope.js';
import { signalModel } from '../../src/lib/blockchart/layout/signals.js';
import { reconcileGrids } from '../../src/lib/blockchart/grid.js';

const schema = JSON.parse(
  await readFile(new URL('../../schema/blockchart.schema.json', import.meta.url), 'utf8'),
);
const validate = new Ajv({ strict: true }).compile(schema);
const layer = 'elk.layered.spacing.nodeNodeBetweenLayers',
  node = 'elk.spacing.nodeNode';
const find = (graph, id) => (graph.id === id ? graph : graph.children?.map((n) => find(n, id)).find(Boolean));
function sample(direction = 'down') {
  return {
    version: 1,
    diagram: { name: 'Local spacing', style: { module: { portLabel: { hidden: true } } } },
    layout: { direction, moduleSpacing: 20, layerSpacing: 30, portAdjustment: 'fixed' },
    modules: ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      ports: [
        { id: 'in', direction: 'input' },
        { id: 'out', direction: 'output' },
      ],
    })),
    groups: [
      { id: 'Dense', members: ['a', 'b'], layout: { layerSpacing: 100, moduleSpacing: 70 } },
      { id: 'Default', members: ['c', 'd'] },
    ],
    connections: [
      { from: 'a.out', to: ['b.in'] },
      { from: 'c.out', to: ['d.in'] },
    ],
  };
}
test('independent properties inherit nearest ancestors, independent of declaration order', () => {
  const raw = sample();
  raw.groups.push({ id: 'Outer', members: ['Dense'], layout: { layerSpacing: 90, moduleSpacing: 60 } });
  raw.groups[0].layout = { moduleSpacing: 45 };
  const before = structuredClone(raw),
    model = createDiagramModel(raw);
  assert.equal(validate(raw), true, JSON.stringify(validate.errors));
  assert.deepEqual(resolveLayoutSpacing(raw, 'Dense'), { moduleSpacing: 45, layerSpacing: 90 });
  assert.deepEqual(resolveLayoutSpacing(model, 'Dense'), { moduleSpacing: 45, layerSpacing: 90 });
  assert.deepEqual(resolveLayoutSpacing(raw, 'Default'), { moduleSpacing: 20, layerSpacing: 30 });
  assert.deepEqual(raw, before, 'resolution does not insert inherited values');
  delete raw.groups[0].layout.moduleSpacing;
  assert.deepEqual(resolveLayoutSpacing(raw, 'Dense'), { moduleSpacing: 60, layerSpacing: 90 });
  assert.deepEqual(model.groups[0].layout, { type: 'auto', moduleSpacing: 45 });
  assert.deepEqual(before.groups[0].layout, { moduleSpacing: 45 });
  assert.throws(() => resolveLayoutSpacing(model, 'Missing'), RangeError);
  assert.deepEqual(resolveLayoutSpacing({ groups: [] }), { moduleSpacing: 20, layerSpacing: 30 });
});
for (const key of ['moduleSpacing', 'layerSpacing'])
  test(`${key} rejects invalid local values with an exact field path`, () => {
    for (const value of [0, -1, null, '60', NaN, Infinity]) {
      const raw = sample();
      raw.groups[0].layout = { [key]: value };
      assert.equal(validate(raw), false, String(value));
      assert.throws(
        () => createDiagramModel(raw),
        (e) => e.path === `groups[0].layout.${key}`,
      );
      assert.throws(
        () => reconcileGrids(raw),
        (e) => e.path === `groups[0].layout.${key}`,
      );
    }
    // Undefined cannot occur in JSON. Native JS drafts still reject an explicit value.
    const draft = sample();
    draft.groups[0].layout = { [key]: undefined };
    assert.throws(
      () => createDiagramModel(draft),
      (e) => e.path === `groups[0].layout.${key}`,
    );
    assert.throws(
      () => reconcileGrids(draft),
      (e) => e.path === `groups[0].layout.${key}`,
    );
    const raw = sample();
    raw.groups[0].layout = { [key]: 0.5 };
    assert.equal(validate(raw), true);
    assert.doesNotThrow(() => createDiagramModel(raw));
  });
for (const direction of ['down', 'right'])
  test(`local Auto spacing affects the interior but not sibling settings/sizes (${direction})`, async () => {
    const raw = sample(direction),
      before = structuredClone(raw),
      model = createDiagramModel(raw);
    const graph = buildElkGraph(model);
    assert.equal(find(graph, 'Dense').layoutOptions[layer], '100');
    assert.equal(find(graph, 'Dense').layoutOptions[node], '70');
    assert.equal(find(graph, 'Default').layoutOptions[layer], '30');
    assert.equal(find(graph, 'Default').layoutOptions[node], '20');
    assert.equal(find(graph, 'Dense').layoutOptions['elk.spacing.componentComponent'], '70');
    const wide = await layoutDiagram(model);
    const compact = sample(direction);
    delete compact.groups[0].layout;
    const compactGraph = buildElkGraph(createDiagramModel(compact));
    assert.deepEqual(
      graph.layoutOptions,
      compactGraph.layoutOptions,
      'parent external settings stay unchanged',
    );
    const small = await layoutDiagram(createDiagramModel(compact));
    const get = (l, id) => l.modules.find((n) => n.id === id),
      axis = direction === 'down' ? 'y' : 'x',
      extent = direction === 'down' ? 'height' : 'width';
    const gap = (l, a, b) => get(l, b)[axis] - get(l, a)[axis] - get(l, a)[extent];
    assert.ok(gap(wide, 'a', 'b') >= 100 - 1e-6);
    assert.ok(gap(wide, 'a', 'b') > gap(small, 'a', 'b') + 60);
    for (const key of ['width', 'height'])
      assert.equal(
        wide.groups.find((g) => g.id === 'Default')[key],
        small.groups.find((g) => g.id === 'Default')[key],
      );
    assert.deepEqual(raw, before);
    assert.deepEqual(model, createDiagramModel(raw));
  });
test('group views retain inherited spacing after ancestors are removed', async () => {
  const raw = sample();
  raw.groups[0].layout = { moduleSpacing: 45 };
  raw.groups.push({ id: 'Outer', members: ['Dense'], layout: { layerSpacing: 90, moduleSpacing: 60 } });
  const model = createDiagramModel(raw),
    before = structuredClone(model),
    scoped = scopeModel(model, 'Dense');
  assert.deepEqual(resolveLayoutSpacing(scoped, 'Dense'), { moduleSpacing: 45, layerSpacing: 90 });
  assert.equal(find(buildElkGraph(scoped), 'Dense').layoutOptions[layer], '90');
  const l = await layoutDiagram(model, { rootGroupId: 'Dense' }),
    a = l.modules.find((n) => n.id === 'a'),
    b = l.modules.find((n) => n.id === 'b');
  assert.ok(b.y - a.y - a.height >= 90 - 1e-6);
  assert.deepEqual(model, before);
});
test('signal-label wrappers keep their compact attachment spacing', () => {
  const raw = sample();
  raw.connections[0].label = 'Data';
  const model = signalModel(createDiagramModel(raw)),
    graph = buildElkGraph(model);
  const wrapper = model.groups.find((g) => g._signalWrapper);
  assert.equal(find(graph, wrapper.id).layoutOptions[layer], '8');
  assert.equal(find(graph, wrapper.id).layoutOptions[node], '8');
  assert.equal(find(graph, wrapper.id).layoutOptions['elk.randomSeed'], '1');
  assert.equal(find(graph, 'Dense').layoutOptions['elk.randomSeed'], '1');
  assert.equal(find(graph, 'Dense').layoutOptions[layer], '100');
});
for (const direction of ['down', 'right'])
  test(`Grid gaps stay independent and partial-Grid Auto neighbors use local spacing (${direction})`, async () => {
    const raw = sample(direction),
      g = raw.groups[0];
    g.layout = {
      ...g.layout,
      type: 'grid',
      cells: direction === 'down' ? [['a'], ['b']] : [['a', 'b']],
      rowGap: 12,
      columnGap: 12,
    };
    const exact = await layoutDiagram(createDiagramModel(raw));
    const axis = direction === 'down' ? 'y' : 'x',
      extent = direction === 'down' ? 'height' : 'width';
    const gap = (l) => {
      const a = l.modules.find((n) => n.id === 'a'),
        b = l.modules.find((n) => n.id === 'b');
      return b[axis] - a[axis] - a[extent];
    };
    assert.ok(Math.abs(gap(exact) - 12) < 1e-6);
    g.layout.cells = [['a']];
    const partial = await layoutDiagram(createDiagramModel(raw));
    assert.ok(gap(partial) >= 100 - 1e-6);
    assert.equal(g.layout.layerSpacing, 100);
  });
test('collapsed settings are retained but apply only when the interior is expanded', async () => {
  const raw = sample();
  raw.groups[0].type = 'collection';
  raw.groups[0].collapsed = true;
  const model = createDiagramModel(raw),
    collapsed = await layoutDiagram(model);
  assert.ok(!collapsed.modules.some((n) => n.id === 'a'));
  assert.equal(model.groups[0].layout.layerSpacing, 100);
  const expanded = await layoutDiagram(model, { rootGroupId: 'Dense' });
  assert.ok(expanded.modules.some((n) => n.id === 'a'));
  assert.equal(model.groups[0].collapsed, true);
});

test('local moduleSpacing changes same-layer separation without changing the layer budget', async () => {
  const raw = sample();
  raw.groups = [
    { id: 'Fork', members: raw.modules.map((n) => n.id), layout: { moduleSpacing: 140, layerSpacing: 30 } },
  ];
  raw.modules[3].ports = [
    { id: 'left', direction: 'input' },
    { id: 'right', direction: 'input' },
  ];
  raw.connections = [
    { from: 'a.out', to: ['b.in', 'c.in'] },
    { from: 'b.out', to: ['d.left'] },
    { from: 'c.out', to: ['d.right'] },
  ];
  const wide = await layoutDiagram(createDiagramModel(raw));
  raw.groups[0].layout.moduleSpacing = 20;
  const narrow = await layoutDiagram(createDiagramModel(raw));
  const separation = (l) => {
    const nodes = l.modules.filter((n) => ['b', 'c'].includes(n.id)).sort((a, b) => a.x - b.x);
    return nodes[1].x - nodes[0].x - nodes[0].width;
  };
  assert.ok(separation(wide) >= 140 - 1e-6);
  assert.ok(separation(wide) > separation(narrow) + 100);
});
