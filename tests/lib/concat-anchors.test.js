import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramModel, layoutDiagram } from '../../src/lib/index.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';
import { freeze } from './helpers.js';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const title =
  'Interrupt vector mapping\nBank 0 selectable interrupts\nBank 0 combined interrupt\nBank 1 selectable interrupts\nBank 1 combined interrupt\nWatchdog event';
function attached(layout, direction) {
  const node = layout.modules.find((n) => n.type === 'concat'),
    bar = node.body.shapes[0],
    stroke = node.style.borderWidth;
  const axis = direction === 'down' ? 'y' : 'x',
    tangent = axis === 'y' ? 'x' : 'y',
    extent = axis === 'y' ? 'height' : 'width',
    crossExtent = axis === 'y' ? 'width' : 'height';
  const start = node[axis] + bar[axis] - stroke / 2,
    end = start + bar[extent] + stroke;
  for (const port of node.ports) {
    near(port[axis], port.direction === 'input' ? start : end);
    assert.ok(port[tangent] >= node[tangent] + bar[tangent] - stroke / 2 - 1e-6);
    assert.ok(port[tangent] <= node[tangent] + bar[tangent] + bar[crossExtent] + stroke / 2 + 1e-6);
    for (const edge of layout.connections) {
      if (edge.target.moduleId === node.id && edge.target.portId === port.id) {
        const tip = edge.sections.at(-1).points.at(-1);
        near(tip.x, port.x);
        near(tip.y, port.y);
        assert.ok(edge.arrow);
        near(edge.arrow.points[0].x, port.x);
        near(edge.arrow.points[0].y, port.y);
      }
      if (edge.source.moduleId === node.id && edge.source.portId === port.id) {
        const point = edge.sections[0].points[0];
        near(point.x, port.x);
        near(point.y, port.y);
      }
    }
  }
  for (const edge of layout.connections)
    for (const section of edge.sections)
      for (let i = 1; i < section.points.length; i++) {
        const a = section.points[i - 1],
          b = section.points[i];
        assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6);
      }
  assert.deepEqual(copyLayout(layout), layout);
  assert.equal(layout.warnings, undefined, JSON.stringify(layout.warnings));
}
for (const direction of ['right', 'down'])
  for (const hiddenTitle of [false, true])
    for (const hiddenPorts of [false, true])
      for (const explicit of [false, true])
        test(`Concat wires touch the physical bar: ${direction}, titleHidden=${hiddenTitle}, portsHidden=${hiddenPorts}, minimum=${explicit}`, async () => {
          const raw = {
            version: 1,
            diagram: { name: 'External Concat text', style: { connection: { endArrow: 'triangle' } } },
            layout: { direction },
            modules: [
              {
                id: 'Join',
                type: 'concat',
                label: title,
                ...(explicit ? { width: 4, height: 4 } : {}),
                style: {
                  borderWidth: 1.5,
                  label: { hidden: hiddenTitle, padding: 6 },
                  portLabel: { hidden: hiddenPorts },
                },
                ports: [
                  { id: 'a', direction: 'input', width: 9, label: 'First bank interrupts' },
                  { id: 'b', direction: 'input', width: 9, label: 'Second bank interrupts' },
                  { id: 'c', direction: 'input', width: 1, label: 'Watchdog event' },
                  { id: 'out', direction: 'output', width: 19, label: 'Joined vector' },
                ],
              },
            ],
            terminals: [
              { id: 'A', direction: 'input', width: 9 },
              { id: 'B', direction: 'input', width: 9 },
              { id: 'C', direction: 'input', width: 1 },
              { id: 'Out', direction: 'output', width: 19 },
            ],
            connections: [
              ...['a', 'b', 'c'].map((id, i) => ({
                from: { terminal: ['A', 'B', 'C'][i] },
                to: [`Join.${id}`],
                ...(explicit && i === 1 ? { constraint: false } : {}),
              })),
              { from: 'Join.out', to: [{ terminal: 'Out' }] },
            ],
          };
          const saved = structuredClone(raw),
            model = createDiagramModel(freeze(raw)),
            before = structuredClone(model),
            layout = await layoutDiagram(freeze(model));
          attached(layout, direction);
          assert.deepEqual(raw, saved);
          assert.deepEqual(model, before);
          if (explicit) {
            assert.ok(layout.modules[0].width >= 560);
            assert.ok(layout.modules[0].height >= 336);
          }
        });
for (const direction of ['right', 'down'])
  test(`Grid and scoped Concat preserve physical anchors with reserved signal names (${direction})`, async () => {
    const raw = {
      version: 1,
      diagram: {
        name: 'Grouped signal concatenation',
        style: {
          module: { portLabel: { hidden: true } },
          connection: { endArrow: 'triangle', label: { repeatAtEnd: 'always' } },
        },
      },
      layout: { direction },
      modules: [
        ...['A', 'B'].map((id) => ({ id, ports: [{ id: 'out', direction: 'output' }] })),
        {
          id: 'Join',
          type: 'concat',
          label: title,
          ports: [
            { id: 'a', direction: 'input' },
            { id: 'b', direction: 'input' },
            { id: 'out', direction: 'output' },
          ],
        },
        { id: 'Sink', ports: [{ id: 'in', direction: 'input' }] },
      ],
      groups: [
        {
          id: 'Frame',
          type: 'container',
          members: ['A', 'B', 'Join', 'Sink'],
          layout: {
            type: 'grid',
            cells:
              direction === 'down'
                ? [
                    ['A', null, 'B'],
                    [null, 'Join', null],
                    [null, 'Sink', null],
                  ]
                : [
                    ['A', null, null],
                    [null, 'Join', 'Sink'],
                    ['B', null, null],
                  ],
            rowGap: 70,
            columnGap: 60,
          },
        },
      ],
      connections: [
        { from: 'A.out', to: ['Join.a'], label: 'First source' },
        { from: 'B.out', to: ['Join.b'], label: 'Second source' },
        { from: 'Join.out', to: ['Sink.in'], label: 'Combined vector' },
      ],
    };
    const model = createDiagramModel(freeze(raw)),
      before = structuredClone(model);
    for (const options of [{}, { rootGroupId: 'Frame' }]) {
      const result = await layoutDiagram(freeze(model), options);
      attached(result, direction);
      assert.ok(result.connections.every((e) => e.labelInstances.some((l) => l.role === 'end')));
    }
    assert.deepEqual(model, before);
  });
