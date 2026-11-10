import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';

const near = (a, b) => Math.abs(a - b) < 1e-6;
const overlaps = (a, b) =>
  a.x < b.x + b.width - 1e-6 &&
  a.x + a.width > b.x + 1e-6 &&
  a.y < b.y + b.height - 1e-6 &&
  a.y + a.height > b.y + 1e-6;
const fixture = () => ({
  version: 1,
  diagram: { name: 'Aligned external interfaces' },
  modules: [
    {
      id: 'Source',
      ports: [
        { id: 'a', direction: 'input' },
        { id: 'b', direction: 'input' },
        { id: 'out', direction: 'output' },
      ],
    },
    ...['First', 'Second'].map((id) => ({
      id,
      ports: [
        { id: 'in', direction: 'input' },
        { id: 'out', direction: 'output' },
      ],
    })),
  ],
  groups: [{ id: 'Stages', members: ['First', 'Second'] }],
  terminals: [
    { id: 'InputA', direction: 'input', label: 'Input' },
    { id: 'InputB', direction: 'input', label: 'Long input name\nwith another line' },
    { id: 'OutputA', direction: 'output', label: 'Early output\n32 signals' },
    { id: 'OutputB', direction: 'output', label: 'Hidden', style: { hidden: true } },
    { id: 'OutputC', direction: 'output', label: 'Final results' },
    { id: 'Unused', direction: 'output', label: 'Reserved output' },
  ],
  connections: [
    {
      from: { terminal: 'InputA' },
      to: ['Source.a'],
      label: 'Incoming data',
      style: { label: { repeatAtEnd: 'never' } },
    },
    { from: { terminal: 'InputB' }, to: ['Source.b'] },
    {
      from: 'Source.out',
      to: ['First.in', { terminal: 'OutputA' }],
      label: 'Broadcast result\nwith a long name',
      style: { label: { repeatAtEnd: 'always' } },
    },
    { from: 'First.out', to: ['Second.in', { terminal: 'OutputB' }] },
    {
      from: 'Second.out',
      to: [{ terminal: 'OutputC' }],
      label: 'Final status',
      style: { label: { repeatAtEnd: 'always' } },
    },
  ],
});

for (const direction of ['right', 'down'])
  for (const grid of [false, true])
    for (const adjustment of ['fixed', 'reduce-bends'])
      test(`Terminal rails include labels and preserve routes ${direction} Grid=${grid} ${adjustment}`, async () => {
        const raw = fixture();
        raw.layout = { direction, portAdjustment: adjustment };
        if (grid)
          Object.assign(raw.layout, {
            type: 'grid',
            cells: direction === 'right' ? [['Source', 'Stages']] : [['Source'], ['Stages']],
          });
        const model = createDiagramModel(raw),
          before = structuredClone(model),
          layout = await layoutDiagram(model);
        copyLayout(layout);
        assert.deepEqual(model, before);
        assert.equal(layout.warnings, undefined, JSON.stringify(layout.warnings));
        const axis = direction === 'right' ? 'x' : 'y',
          extent = axis === 'x' ? 'width' : 'height',
          nodes = [...layout.modules, ...layout.groups];
        for (const side of ['input', 'output']) {
          const terminals = layout.terminals.filter((t) => t.direction === side),
            rail = terminals[0].anchor[axis];
          assert.ok(
            terminals.every((t) => near(t.anchor[axis], rail)),
            'same-side anchors align',
          );
          const textAxis =
            side === 'input'
              ? (t) => t.labelBounds[axis] + t.labelBounds[extent]
              : (t) => t.labelBounds[axis];
          const visible = terminals.filter((t) => !t.style.hidden);
          assert.ok(
            visible.every((t) => near(textAxis(t), textAxis(visible[0]))),
            'visible text edges align despite unequal dimensions',
          );
          for (const terminal of terminals) {
            assert.ok(
              nodes.every((n) => !overlaps(n, terminal)),
              'Terminals clear hardware',
            );
            assert.ok(
              terminals.every((other) => other === terminal || !overlaps(other, terminal)),
              'same-side names do not overlap',
            );
          }
        }
        for (const e of layout.connections) {
          for (const [ref, p] of [
            [e.source, e.sections[0].points[0]],
            [e.target, e.sections.at(-1).points.at(-1)],
          ])
            if (ref.terminal) {
              const anchor = layout.terminals.find((t) => t.id === ref.terminal).anchor;
              assert.ok(near(anchor.x, p.x) && near(anchor.y, p.y));
            }
          for (const s of e.sections)
            for (let i = 1; i < s.points.length; i++)
              assert.ok(
                near(s.points[i - 1].x, s.points[i].x) || near(s.points[i - 1].y, s.points[i].y),
                'routes stay orthogonal',
              );
          const label = e.labelInstances?.find((l) => l.role === 'end');
          if (label && e.target.terminal) {
            const t = layout.terminals.find((t) => t.id === e.target.terminal);
            assert.ok(
              label.bounds[axis] + label.bounds[extent] <= t.anchor[axis] - 3,
              'receiver name stays on the incoming side',
            );
            assert.ok(
              nodes.every((n) => !overlaps(label.bounds, n)),
              'receiver footprint clears hardware',
            );
            assert.ok(
              layout.terminals.every((t) => !overlaps(label.bounds, t)),
              'receiver name clears Terminal text',
            );
          }
        }
        assert.ok(!renderSvg(layout).includes('_signal_owner_'));
      });
