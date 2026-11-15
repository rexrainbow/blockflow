import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';

function sample(direction, incidentStroke) {
  return {
    version: 1,
    diagram: { name: 'Local Terminal clearance', style: { module: { portLabel: { hidden: true } } } },
    layout: { direction, portAdjustment: 'fixed', moduleSpacing: 65, layerSpacing: 65 },
    modules: [
      {
        id: 'Processor',
        ports: [
          { id: 'in', direction: 'input' },
          { id: 'out', direction: 'output' },
        ],
      },
      { id: 'Monitor', ports: [{ id: 'out', direction: 'output' }] },
      { id: 'Counter', ports: [{ id: 'in', direction: 'input' }] },
    ],
    groups: [{ id: 'Core', members: ['Processor'] }],
    terminals: [
      { id: 'In', direction: 'input' },
      { id: 'Out', direction: 'output' },
      { id: 'Reserved', direction: 'output', style: { hidden: true } },
    ],
    connections: [
      {
        from: { terminal: 'In' },
        to: ['Processor.in'],
        style: { strokeWidth: incidentStroke, startArrow: 'triangle' },
      },
      { from: 'Processor.out', to: [{ terminal: 'Out' }], style: { strokeWidth: incidentStroke } },
      { from: 'Monitor.out', to: ['Counter.in'], style: { strokeWidth: 12 } },
    ],
  };
}
for (const direction of ['right', 'down'])
  for (const stroke of [1.5, 8])
    test(`rail clearance is local and stroke-aware ${direction}, stroke=${stroke}`, async () => {
      const raw = sample(direction, stroke),
        saved = structuredClone(raw),
        model = createDiagramModel(raw),
        before = structuredClone(model),
        layout = await layoutDiagram(model);
      const normal = direction === 'down' ? 'y' : 'x',
        extent = normal === 'y' ? 'height' : 'width',
        internal = [...layout.modules, ...layout.groups],
        low = Math.min(...internal.map((n) => n[normal])),
        high = Math.max(...internal.map((n) => n[normal] + n[extent])),
        input = layout.terminals.find((t) => t.id === 'In'),
        output = layout.terminals.find((t) => t.id === 'Out');
      const gap = stroke === 8 ? 32 : 13;
      assert.ok(Math.abs(low - input.anchor[normal] - gap) < 1e-6);
      assert.ok(Math.abs(output.anchor[normal] - high - gap) < 1e-6);
      assert.equal(layout.terminals.find((t) => t.id === 'Reserved').anchor[normal], output.anchor[normal]);
      assert.equal(layout.warnings, undefined);
      for (const edge of layout.connections) {
        for (const [ref, point] of [
          [edge.source, edge.sections[0].points[0]],
          [edge.target, edge.sections.at(-1).points.at(-1)],
        ])
          if (ref.terminal)
            assert.deepEqual(point, layout.terminals.find((t) => t.id === ref.terminal).anchor);
        for (const arrow of [edge.arrow, edge.startArrow].filter(Boolean))
          assert.ok(arrow.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
      }
      assert.deepEqual(model, before);
      assert.deepEqual(raw, saved);
      assert.equal(renderSvg(await layoutDiagram(model)), renderSvg(layout));
    });

test('layout exposes fixed defaults without a density selector', () => {
  const model = createDiagramModel(sample('down', 1.5));
  assert.equal(Object.hasOwn(model.layout, 'density'), false);
  assert.equal(model.layout.moduleSpacing, 65);
  assert.equal(model.layout.layerSpacing, 65);
});
