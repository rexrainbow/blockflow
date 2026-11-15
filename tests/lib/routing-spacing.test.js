import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { buildElkGraph } from '../../src/lib/blockchart/layout/elk-graph.js';
import {
  endpointEscape,
  obstacleClearance,
  routingSpacing,
  fitEndpointEscape,
} from '../../src/lib/blockchart/layout/routing-spacing.js';
import { groupGeometry } from '../../src/lib/blockchart/layout/groups.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';

function sample(direction = 'right', width = 1.5, arrow = 'none') {
  return {
    version: 1,
    diagram: {
      name: 'Routing clearance',
      style: { module: { portLabel: { hidden: true } }, connection: { strokeWidth: width, endArrow: arrow } },
    },
    layout: { direction },
    modules: [
      { id: 'A', ports: [{ id: 'out', direction: 'output' }] },
      { id: 'B', ports: [{ id: 'in', direction: 'input' }] },
    ],
    connections: [{ from: 'A.out', to: ['B.in'] }],
  };
}

test('channel spacing uses body ink independently of arrows', () => {
  const raw = sample();
  const without = buildElkGraph(createDiagramModel(raw));
  raw.diagram.style.connection.endArrow = 'triangle';
  raw.diagram.style.connection.startArrow = 'triangle';
  const arrows = buildElkGraph(createDiagramModel(raw));
  assert.deepEqual(arrows, without, 'arrowheads do not pad every channel');
  const nodeBase = 20,
    layerBase = 30,
    channelBase = 6;
  assert.equal(arrows.layoutOptions['elk.spacing.nodeNode'], String(nodeBase));
  assert.equal(arrows.layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'], String(layerBase));
  assert.equal(arrows.layoutOptions['elk.spacing.edgeNode'], String(channelBase + 0.75));
  assert.equal(arrows.layoutOptions['elk.spacing.edgeEdge'], String(channelBase + 1.5));
  raw.diagram.style.connection.strokeWidth = 8;
  const thick = buildElkGraph(createDiagramModel(raw));
  assert.equal(thick.layoutOptions['elk.spacing.nodeNode'], String(nodeBase + 6.5));
  assert.equal(thick.layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'], String(layerBase + 6.5));
  assert.equal(thick.layoutOptions['elk.spacing.edgeNode'], String(channelBase + 4));
  assert.equal(thick.layoutOptions['elk.spacing.edgeEdge'], String(channelBase + 8));
});

test('endpoint escapes and obstacle inflation share stroke-aware, arrow-local rules', () => {
  const m = createDiagramModel(sample('right', 1.5, 'triangle')),
    edge = m.connections[0];
  assert.equal(endpointEscape(edge, true), 6);
  assert.equal(endpointEscape(edge), 9);
  assert.equal(obstacleClearance(edge), 3);
  assert.equal(routingSpacing([edge]).gutter, 13);
  edge.style.startArrow = 'triangle';
  edge.netStyle.startArrow = 'triangle';
  assert.equal(endpointEscape(edge, true), 9);
  edge.style.strokeWidth = 8;
  edge.netStyle.strokeWidth = 8;
  assert.equal(endpointEscape(edge, true), 25);
  assert.equal(endpointEscape(edge), 25);
  assert.equal(obstacleClearance(edge), 6);
  assert.equal(routingSpacing([edge]).gutter, 32);
  for (const flag of ['_signalTrunk', '_signalTail']) {
    const virtual = { ...edge, [flag]: true };
    assert.equal(endpointEscape(virtual, true), 3);
    assert.equal(obstacleClearance(virtual), 1);
  }
});

test('endpoint escape rays stop before foreign obstacles while clearing their own envelope', () => {
  const endpoint = { p: { x: 64, y: 18 }, node: { id: 'A' } };
  const point = { x: 89, y: 18 };
  fitEndpointEscape(endpoint, point, { x: 1, y: 0 }, [
    { x: -3, y: -3, width: 70, height: 42, _owner: 'A' },
    { x: 80, y: 0, width: 64, height: 36, _owner: 'B' },
    { x: 70, y: 100, width: 64, height: 36, _owner: 'C' },
  ]);
  assert.deepEqual(point, { x: 79, y: 18 });
  const reverse = { x: 55, y: 18 };
  fitEndpointEscape({ p: { x: 80, y: 18 }, node: { id: 'B' } }, reverse, { x: -1, y: 0 }, [
    { x: 0, y: 0, width: 64, height: 36, _owner: 'A' },
  ]);
  assert.deepEqual(reverse, { x: 65, y: 18 });
});

test('ordinary Container gutters use only incident routes; Boundary geometry is unchanged', () => {
  const raw = sample();
  raw.groups = [{ id: 'G', members: ['A', 'B'] }];
  raw.modules.push(
    { id: 'C', ports: [{ id: 'out', direction: 'output' }] },
    { id: 'D', ports: [{ id: 'in', direction: 'input' }] },
  );
  raw.connections.push({ from: 'C.out', to: ['D.in'], style: { strokeWidth: 10, endArrow: 'triangle' } });
  const model = createDiagramModel(raw),
    group = model.groups[0],
    g = groupGeometry(group, 'right', model);
  assert.equal(g.left, 10);
  assert.equal(g.right, 10, 'arrowless thin edge uses a smaller local gutter');
  model.connections[0].style.endArrow = 'triangle';
  assert.equal(groupGeometry(group, 'right', model).right, 13);
  model.connections[0].style.strokeWidth = 10;
  assert.equal(groupGeometry(group, 'right', model).right, 39);
  const boundary = { ...group, portMode: 'boundary' };
  assert.equal(groupGeometry(boundary, 'right', model).inset, 18 + boundary.style.borderWidth);
});

test('Default routing retains the receiver name and clear foreign Nets in the processor reference', async () => {
  const raw = JSON.parse(
    await readFile(new URL('../../examples/processor-components.json', import.meta.url), 'utf8'),
  );
  const source = raw.connections.find((edge) => edge.from === 'InputLogic.combined');
  source.style ??= {};
  source.style.label ??= {};
  source.style.label.repeatAtEnd = 'always';
  delete raw.layout.moduleSpacing;
  delete raw.layout.layerSpacing;
  const result = await layoutDiagram(createDiagramModel(raw));
  assert.equal(result.warnings, undefined);
  const owner = result.connections.find((edge) => edge.id === 'connection_3_branch_0');
  const label = owner.labelInstances.find((label) => label.role === 'end');
  assert.ok(label, 'the previously conflicting receiver name remains visible');
  const box = label.bounds;
  for (const edge of result.connections.filter((edge) => edge.netId !== owner.netId))
    for (const section of edge.sections)
      for (let i = 1; i < section.points.length; i++) {
        const a = section.points[i - 1],
          b = section.points[i];
        const horizontal = Math.abs(a.y - b.y) < 1e-6;
        const hit = horizontal
          ? a.y > box.y &&
            a.y < box.y + box.height &&
            Math.max(a.x, b.x) > box.x &&
            Math.min(a.x, b.x) < box.x + box.width
          : a.x > box.x &&
            a.x < box.x + box.width &&
            Math.max(a.y, b.y) > box.y &&
            Math.min(a.y, b.y) < box.y + box.height;
        assert.equal(hit, false, `${edge.id} clears the repeated label`);
      }
});

for (const direction of ['right', 'down'])
  for (const width of [1.5, 4, 8])
    test(`shared fixed routing retains thick-arrow endpoints and avoids hardware (${direction}, stroke=${width})`, async () => {
      const raw = sample(direction, width, 'triangle');
      raw.connections[0].constraint = false;
      const model = createDiagramModel(raw),
        before = structuredClone(model),
        layout = await layoutDiagram(model);
      assert.equal(layout.warnings, undefined);
      assert.deepEqual(copyLayout(layout), layout);
      assert.deepEqual(model, before);
      const edge = layout.connections[0],
        tip = edge.sections.at(-1).points.at(-1),
        port = layout.modules[1].ports[0];
      assert.deepEqual(tip, { x: port.x, y: port.y });
      assert.deepEqual(edge.arrow.points[0], tip);
      assert.ok(renderSvg(layout).includes('data-role="connection-arrow"'));
      for (const section of edge.sections)
        for (let i = 1; i < section.points.length; i++) {
          const a = section.points[i - 1],
            b = section.points[i];
          assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6);
          for (const node of layout.modules) {
            const h =
              Math.abs(a.y - b.y) < 1e-6 &&
              a.y > node.y + 1e-6 &&
              a.y < node.y + node.height - 1e-6 &&
              Math.max(a.x, b.x) > node.x + 1e-6 &&
              Math.min(a.x, b.x) < node.x + node.width - 1e-6;
            const v =
              Math.abs(a.x - b.x) < 1e-6 &&
              a.x > node.x + 1e-6 &&
              a.x < node.x + node.width - 1e-6 &&
              Math.max(a.y, b.y) > node.y + 1e-6 &&
              Math.min(a.y, b.y) < node.y + node.height - 1e-6;
            assert.ok(!h && !v, 'route clears hardware');
          }
        }
    });
