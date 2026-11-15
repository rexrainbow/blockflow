import test from 'node:test';
import assert from 'node:assert/strict';
import ELK from 'elkjs/lib/elk.bundled.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { buildElkGraph } from '../../src/lib/blockchart/layout/elk-graph.js';
import { absoluteGraph, groupGeometry } from '../../src/lib/blockchart/layout/groups.js';
import { signalModel } from '../../src/lib/blockchart/layout/signals.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';

const layer = 'elk.layered.spacing.nodeNodeBetweenLayers';
function sample(direction = 'down') {
  return {
    version: 1,
    diagram: { name: 'Container chain', style: { module: { portLabel: { hidden: true } } } },
    layout: { direction, layerSpacing: 65 },
    modules: [
      { id: 'Filter', ports: [{ id: 'out', direction: 'output' }] },
      { id: 'Processor', ports: [{ id: 'in', direction: 'input' }] },
    ],
    groups: [
      { id: 'Pipeline', members: ['Conditioning', 'Compute'] },
      { id: 'Conditioning', label: 'Input conditioning', members: ['Filter'] },
      { id: 'Compute', label: 'Signal processing', members: ['Processor'] },
    ],
    connections: [{ from: 'Filter.out', to: ['Processor.in'], label: 'Filtered data' }],
  };
}
function find(graph, id) {
  if (graph.id === id) return graph;
  return graph.children?.map((n) => find(n, id)).find(Boolean);
}
const overlap = (a, b) =>
  a.x < b.x + b.width - 1e-6 &&
  a.x + a.width > b.x + 1e-6 &&
  a.y < b.y + b.height - 1e-6 &&
  a.y + a.height > b.y + 1e-6;

for (const direction of ['right', 'down'])
  test(`sibling Containers share a spacing budget, retaining geometry and safe labels: ${direction}`, async () => {
    const raw = sample(direction);
    const saved = structuredClone(raw);
    const model = createDiagramModel(raw),
      before = structuredClone(model);
    const routing = signalModel(model),
      graph = buildElkGraph(routing),
      baseline = structuredClone(graph);
    find(baseline, 'Pipeline').layoutOptions[layer] = graph.layoutOptions[layer];
    const elk = new ELK();
    const a = await elk.layout(graph),
      b = await elk.layout(baseline);
    const axis = direction === 'down' ? 'height' : 'width';
    assert.ok(a[axis] < b[axis], 'the existing padded frames no longer pay the full outer gap');
    const nodesA = absoluteGraph(a).nodes,
      nodesB = absoluteGraph(b).nodes;
    for (const id of ['Filter', 'Processor', 'Conditioning', 'Compute']) {
      assert.equal(nodesA.get(id).width, nodesB.get(id).width);
      assert.equal(nodesA.get(id).height, nodesB.get(id).height);
    }
    const layout = await layoutDiagram(model);
    assert.deepEqual(copyLayout(layout), layout);
    assert.equal(layout.warnings, undefined);
    for (const edge of layout.connections) {
      for (const label of edge.labelInstances ?? []) {
        assert.ok(layout.modules.every((node) => !overlap(node, label.bounds)));
        assert.ok(layout.groups.every((group) => !overlap(group.labelBounds, label.bounds)));
      }
      for (const section of edge.sections)
        for (let i = 1; i < section.points.length; i++) {
          const p = section.points[i - 1],
            q = section.points[i];
          assert.ok(Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.y - q.y) < 1e-6);
        }
    }
    assert.equal(renderSvg(await layoutDiagram(model)), renderSvg(layout));
    assert.deepEqual(model, before);
    assert.deepEqual(raw, saved);
  });

test('flat/mixed regions, Boundary interfaces, synthetic owners and Grid regions retain their spacing', () => {
  for (const kind of ['mixed', 'boundary', 'grid', 'root-grid', 'collapsed']) {
    const raw = sample();
    if (kind === 'mixed') {
      raw.modules.push({ id: 'Monitor' });
      raw.groups[0].members.push('Monitor');
    }
    if (kind === 'boundary') {
      raw.groups[1].type = 'boundary';
      raw.connections = [];
    }
    if (kind === 'collapsed') {
      raw.groups[1].type = 'collection';
      raw.groups[1].collapsed = true;
      raw.connections = [];
    }
    if (kind === 'grid') raw.groups[0].layout = { type: 'grid', cells: [['Conditioning', 'Compute']] };
    if (kind === 'root-grid') raw.layout = { ...raw.layout, type: 'grid', cells: [['Pipeline']] };
    const model = signalModel(createDiagramModel(raw)),
      graph = buildElkGraph(model);
    assert.equal(find(graph, 'Pipeline').layoutOptions[layer], graph.layoutOptions[layer], kind);
    const wrapper = model.groups.find((g) => g._signalWrapper);
    if (wrapper) assert.equal(find(graph, wrapper.id).layoutOptions[layer], '8');
  }
});

test('asymmetric titles use the smallest entry and exit gutters, and small explicit gaps never grow', () => {
  const raw = sample();
  raw.groups[1].style = { label: { fontSize: 24 } };
  let model = createDiagramModel(raw),
    graph = buildElkGraph(model);
  const pads = model.groups.slice(1).map((g) => groupGeometry(g, 'down', model));
  const expected = Math.max(
    8,
    Number(graph.layoutOptions['elk.spacing.edgeEdge']),
    65 - Math.min(...pads.map((p) => p.top)) - Math.min(...pads.map((p) => p.bottom)),
  );
  assert.equal(Number(find(graph, 'Pipeline').layoutOptions[layer]), expected);
  raw.layout.layerSpacing = 1;
  model = createDiagramModel(raw);
  graph = buildElkGraph(model);
  assert.equal(find(graph, 'Pipeline').layoutOptions[layer], graph.layoutOptions[layer]);
});

test('Terminal layers and explicit Container minimum options are preserved', async () => {
  const raw = sample();
  raw.terminals = [
    { id: 'Input', direction: 'input' },
    { id: 'Output', direction: 'output' },
  ];
  raw.modules[0].ports.push({ id: 'in', direction: 'input' });
  raw.modules[1].ports.push({ id: 'out', direction: 'output' });
  raw.connections.push(
    { from: { terminal: 'Input' }, to: ['Filter.in'] },
    { from: 'Processor.out', to: [{ terminal: 'Output' }] },
  );
  raw.groups[1].width = 3;
  raw.groups[1].height = 3;
  const model = createDiagramModel(raw),
    graph = buildElkGraph(signalModel(model));
  assert.equal(graph.layoutOptions[layer], '65');
  assert.equal(
    find(graph, '@terminal:Input').layoutOptions['elk.layered.layering.layerConstraint'],
    'FIRST_SEPARATE',
  );
  assert.equal(
    find(graph, '@terminal:Output').layoutOptions['elk.layered.layering.layerConstraint'],
    'LAST_SEPARATE',
  );
  assert.equal(find(graph, 'Conditioning').layoutOptions['elk.nodeSize.minimum'], '(252,420)');
  const baseline = structuredClone(graph);
  find(baseline, 'Pipeline').layoutOptions[layer] = graph.layoutOptions[layer];
  const elk = new ELK(),
    a = absoluteGraph(await elk.layout(graph)).nodes.get('Conditioning'),
    b = absoluteGraph(await elk.layout(baseline)).nodes.get('Conditioning');
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  const result = await layoutDiagram(model);
  const frame = result.groups.find((group) => group.id === 'Conditioning');
  assert.ok(frame.width >= 420 - 1e-6 && frame.height >= 252 - 1e-6);
  assert.equal(result.warnings, undefined);
});
