import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';
import { signalModel, receiverLabels } from '../../src/lib/blockchart/layout/signals.js';
import { buildElkGraph } from '../../src/lib/blockchart/layout/elk-graph.js';
import { moduleGeometry } from '../../src/lib/blockchart/geometry.js';

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: true }).compile(
  JSON.parse(await readFile(new URL('../../schema/blockchart.schema.json', import.meta.url), 'utf8')),
);
const overlap = (a, b) =>
  a.x < b.x + b.width - 1e-6 &&
  a.x + a.width > b.x + 1e-6 &&
  a.y < b.y + b.height - 1e-6 &&
  a.y + a.height > b.y + 1e-6;

function verify(layout) {
  assert.deepEqual(copyLayout(layout), layout);
  assert.equal(layout.warnings, undefined, JSON.stringify(layout.warnings));
  for (const edge of layout.connections) {
    for (const section of edge.sections)
      for (let i = 1; i < section.points.length; i++) {
        const a = section.points[i - 1],
          b = section.points[i];
        assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6, 'orthogonal route');
      }
    for (const label of edge.labelInstances ?? []) {
      assert.ok(
        layout.modules.every((n) => !overlap(n, label.bounds)),
        'label clears hardware',
      );
      assert.ok(
        (layout.groups ?? []).every((n) => n.style.label.hidden || !overlap(n.labelBounds, label.bounds)),
        'label clears group titles',
      );
    }
  }
  for (const [i, a] of layout.modules.entries())
    for (const b of layout.modules.slice(i + 1)) assert.ok(!overlap(a, b), 'hardware envelopes are disjoint');
}

test('single layout defaults reject retired fields and preserve explicit spacing', async () => {
  const raw = await load('processor-cross-group-grid');
  raw.layout = {};
  const before = structuredClone(raw);
  const model = createDiagramModel(raw);
  assert.equal(model.layout.moduleSpacing, 20);
  assert.equal(model.layout.layerSpacing, 30);
  assert.equal(Object.hasOwn(model.layout, 'density'), false);
  assert.deepEqual(raw, before);
  assert.equal(validate(raw), true);
  raw.layout.moduleSpacing = 180;
  raw.layout.layerSpacing = 70;
  const explicit = createDiagramModel(raw);
  assert.equal(explicit.layout.moduleSpacing, 180);
  assert.equal(explicit.layout.layerSpacing, 70);
  for (const value of ['standard', 'compact', 'dense', null, false, 0, {}, undefined]) {
    raw.layout.density = value;
    if (value !== undefined) assert.equal(validate(raw), false);
    assert.throws(
      () => createDiagramModel(raw),
      (e) => e.path === 'layout.density',
    );
  }
  delete raw.layout.density;
  raw.groups[0].layout.density = 'compact';
  assert.equal(validate(raw), false);
  assert.throws(() => createDiagramModel(raw), /Unsupported grid property/);
});

for (const direction of ['right', 'down'])
  test(`mixed receiver slots preserve names/order, reduce hardware and keep user minimums (${direction})`, async () => {
    const raw = {
      version: 1,
      diagram: { name: 'Unequal receiver names', style: { module: { portLabel: { hidden: true } } } },
      modules: [
        ...['A', 'B', 'C'].map((id) => ({ id, ports: [{ id: 'out', direction: 'output' }] })),
        { id: 'Sink', ports: ['a', 'b', 'c'].map((id) => ({ id, direction: 'input' })) },
      ],
      connections: [
        {
          from: 'A.out',
          to: ['Sink.a'],
          label: 'Long receiver label\nSecond line\nThird line',
          style: { label: { repeatAtEnd: 'always' } },
        },
        { from: 'B.out', to: ['Sink.b'], label: 'B', style: { label: { repeatAtEnd: 'always' } } },
        { from: 'C.out', to: ['Sink.c'] },
      ],
      layout: { direction },
    };
    const before = structuredClone(raw),
      model = createDiagramModel(raw),
      modelBefore = structuredClone(model);
    const result = await layoutDiagram(model);
    verify(result);
    assert.deepEqual(raw, before);
    assert.deepEqual(model, modelBefore);
    const slots = signalModel(model, receiverLabels(model)).modules.find(
      (n) => n.id === 'Sink',
    )._receiverSlots;
    assert.ok(
      slots[direction === 'down' ? 'top' : 'left'][0].size >
        slots[direction === 'down' ? 'top' : 'left'][1].size,
    );
    assert.ok(result.connections.filter((e) => e.label).every((e) => e.labelInstances.length === 2));
    const ends = result.connections
      .filter((e) => e.label)
      .map((e) => e.labelInstances.find((l) => l.role === 'end'));
    assert.ok(!overlap(ends[0].bounds, ends[1].bounds));
    raw.modules[3].width = 8;
    raw.modules[3].height = 8;
    const large = await layoutDiagram(createDiagramModel(raw));
    assert.ok(large.modules[3].width >= 8 * 140 && large.modules[3].height >= 8 * 84);
  });

for (const name of [
  'processor-components',
  'processor-cross-group-grid',
  'boundary-groups',
  'net-bidirectional',
  'terminals',
])
  for (const direction of ['right', 'down'])
    test(`default layout preserves semantic layout and public geometry: ${name} ${direction}`, async () => {
      const raw = await load(name);
      raw.layout = { ...raw.layout, direction };
      const before = structuredClone(raw),
        model = createDiagramModel(raw);
      const result = await layoutDiagram(model);
      verify(result);
      assert.deepEqual(raw, before);
      assert.equal(result.modules.length, model.modules.length);
      assert.equal(result.connections.length, model.connections.length);
      assert.ok(!renderSvg(result).includes('_receiverSlots'));
      if (name === 'processor-cross-group-grid') {
        const scoped = await layoutDiagram(model, { rootGroupId: 'ComputeCluster' });
        verify(scoped);
        assert.equal(scoped.modules.length, 5);
      }
    });

test('default hidden-port geometry and ELK spacing retain text, stroke and Boundary constraints', async () => {
  const raw = await load('boundary-groups');
  const model = createDiagramModel(raw),
    graph = buildElkGraph(model);
  assert.equal(graph.layoutOptions['elk.layered.compaction.postCompaction.strategy'], undefined);
  const find = (n) => (n.ports?.length && n.children ? n : n.children?.map(find).find(Boolean));
  const boundary = find(graph);
  assert.equal(boundary.layoutOptions['elk.portConstraints'], 'FIXED_ORDER');
  const small = await load('port-adjustment');
  const node = createDiagramModel(small).modules[0];
  const geometry = moduleGeometry(node, 'down');
  assert.ok(geometry.width >= (node.width ?? 0) * 140 && geometry.height >= (node.height ?? 0) * 84);
  assert.deepEqual(node.style, createDiagramModel(small).modules[0].style);
});
