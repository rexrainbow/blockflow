import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { groupGeometry } from '../../src/lib/blockchart/layout/groups.js';
import { signalModel, receiverLabels } from '../../src/lib/blockchart/layout/signals.js';

for (const direction of ['right', 'down'])
  for (const stroke of [1.5, 8])
    test(`ordinary Container title fits the frame without a phantom left lane: ${direction} stroke=${stroke}`, async () => {
      const raw = {
        version: 1,
        diagram: { name: 'A measured frame', style: { connection: { strokeWidth: stroke } } },
        layout: { direction },
        modules: [{ id: 'ALU', ports: [{ id: 'in', direction: 'input' }] }],
        terminals: [{ id: 'Input', direction: 'input' }],
        connections: [{ from: { terminal: 'Input' }, to: ['ALU.in'] }],
        groups: [{ id: 'Frame', label: 'A deliberately long descriptive group heading', members: ['ALU'] }],
      };
      const model = createDiagramModel(raw),
        saved = structuredClone(model),
        geometry = groupGeometry(model.groups[0], direction, model);
      assert.equal(geometry.left, geometry.right, 'title length does not become a left content gutter');
      assert.ok(geometry.left < 40);
      const layout = await layoutDiagram(model),
        group = layout.groups[0],
        child = layout.modules[0];
      assert.ok(group.labelBounds.x >= group.x);
      assert.ok(group.labelBounds.x + group.labelBounds.width <= group.x + group.width + 1e-6);
      assert.ok(group.labelBounds.y + group.labelBounds.height <= child.y + 1e-6);
      assert.ok(child.x >= group.x && child.x + child.width <= group.x + group.width + 1e-6);
      assert.equal(layout.warnings, undefined);
      assert.ok(!renderSvg(layout).includes('container-title-mask'));
      assert.ok(layout.connections.every((edge) => edge.routingInfo?.reason !== 'container-title-clearance'));
      assert.deepEqual(model, saved);
      assert.equal(renderSvg(await layoutDiagram(model)), renderSvg(layout));
    });

for (const type of ['container', 'boundary', 'collection'])
  for (const [width, height] of [
    [3, 2],
    [2, 5],
  ])
    test(`Down-flow frame minimums refer to physical width/height: ${type} ${width}x${height}`, async () => {
      const raw = {
        version: 1,
        diagram: { name: 'Physical frame minima' },
        layout: { direction: 'down' },
        modules: [{ id: 'Child' }],
        groups: [{ id: 'Frame', type, members: ['Child'], width, height }],
      };
      const layout = await layoutDiagram(createDiagramModel(raw)),
        group = layout.groups[0];
      assert.ok(group.width >= width * 140 - 1e-6, `physical width ${group.width}`);
      assert.ok(group.height >= height * 84 - 1e-6, `physical height ${group.height}`);
      assert.equal(layout.warnings, undefined);
    });

test(`Concat reserves only actual repeated-name slots:`, async () => {
  const raw = {
    version: 1,
    diagram: { name: 'Named Concat input', style: { module: { portLabel: { hidden: true } } } },
    layout: { direction: 'down' },
    modules: [
      { id: 'Filtered', ports: [{ id: 'out', direction: 'output', width: 32 }] },
      { id: 'Prior', ports: [{ id: 'out', direction: 'output', width: 4 }] },
      {
        id: 'Join',
        type: 'concat',
        ports: [
          { id: 'filtered', direction: 'input', width: 32 },
          { id: 'prior', direction: 'input', width: 4 },
          { id: 'out', direction: 'output', width: 36 },
        ],
      },
      { id: 'Processor', ports: [{ id: 'in', direction: 'input', width: 36 }] },
    ],
    connections: [
      { from: 'Filtered.out', to: ['Join.filtered'] },
      {
        from: 'Prior.out',
        to: ['Join.prior'],
        label: 'Prior computation results',
        style: { label: { repeatAtEnd: 'always' } },
      },
      { from: 'Join.out', to: ['Processor.in'] },
    ],
  };
  const model = createDiagramModel(raw),
    before = structuredClone(model),
    routing = signalModel(model, receiverLabels(model));
  const slots = routing.modules.find((node) => node.id === 'Join')._receiverSlots.top;
  assert.ok(slots[0].size < slots[1].size, 'the unlabeled input does not copy the largest receiver name');
  const layout = await layoutDiagram(model),
    join = layout.modules.find((node) => node.id === 'Join');
  assert.ok(join.width > join.height * 3, 'Concat remains a thin horizontal bar');
  assert.equal(layout.connections.find((edge) => edge.source.moduleId === 'Prior').labelInstances.length, 2);
  assert.equal(layout.warnings, undefined);
  assert.deepEqual(model, before);
});
