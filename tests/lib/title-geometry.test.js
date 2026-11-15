import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { moduleGeometry } from '../../src/lib/blockchart/geometry.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function input(direction, label = 'ALU', ports = []) {
  return {
    version: 1,
    diagram: { name: 'Title sizing', style: { module: { portLabel: { hidden: true } } } },
    layout: { direction },
    modules: [{ id: 'Core', label, ports }],
  };
}
const geometry = (raw) => {
  const m = createDiagramModel(raw);
  return moduleGeometry(m.modules[0], m.layout.direction);
};

for (const direction of ['right', 'down']) {
  test(`default geometry uses text padding once and identical title minima with/without hidden ports (${direction})`, async () => {
    for (const [label, w, h] of [
      ['ALU', 64, 36],
      ['Result logic\nx16', 122, 54],
    ])
      for (const ports of [
        [],
        [
          { id: 'i', direction: 'input' },
          { id: 'o', direction: 'output' },
        ],
      ]) {
        const raw = input(direction, label, ports),
          before = structuredClone(raw),
          g = geometry(raw);
        near(g.width, w);
        near(g.height, h);
        near(g.titleX, w / 2);
        near(g.titleY, h / 2);
        const result = await layoutDiagram(createDiagramModel(raw));
        assert.deepEqual(copyLayout(result), result);
        assert.deepEqual(raw, before);
      }
    const padded = input(direction, 'Result logic\nx16');
    padded.modules[0].style = { borderWidth: 3, label: { padding: 4 } };
    near(geometry(padded).width, 134);
    near(geometry(padded).height, 66);
  });

  for (const type of ['rectangle', 'stacked', 'trapezoid'])
    test(`default shape geometry clears names, hides phantom text and respects author minima (${direction}/${type})`, async () => {
      const ports = ['left', 'right', 'top', 'bottom'].map((side) => ({
        id: side,
        direction: 'inout',
        side,
        label: 'Hidden text\n'.repeat(10),
        style: { hidden: true, fontSize: 80, padding: 90 },
      }));
      const raw = input(direction, 'Compute\nunit', ports);
      raw.modules[0].appearance = { type };
      const plain = structuredClone(raw);
      plain.modules[0].ports = [];
      const a = geometry(raw),
        b = geometry(plain);
      near(a.width, b.width);
      near(a.height, b.height);
      const m = createDiagramModel(raw),
        before = structuredClone(m),
        r = await layoutDiagram(m),
        n = r.modules[0];
      const extra = type === 'stacked' ? 12 : 0;
      assert.ok(
        n.labelBounds.x >= n.x && n.labelBounds.x + n.labelBounds.width <= n.x + n.width - extra + 1e-6,
      );
      assert.ok(
        n.labelBounds.y >= n.y && n.labelBounds.y + n.labelBounds.height <= n.y + n.height - extra + 1e-6,
      );
      assert.deepEqual(copyLayout(r), r);
      assert.deepEqual(m, before);
      raw.modules[0].width = 3;
      raw.modules[0].height = 2;
      const large = geometry(raw);
      assert.ok(large.width >= 420 && large.height >= 168);
    });

  test(`default hidden port counts keep pitch and visible ports keep the text-aware path (${direction})`, async () => {
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const raw = input(
        direction,
        'ALU',
        Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, direction: 'inout', side })),
      );
      const r = await layoutDiagram(createDiagramModel(raw)),
        ports = r.modules[0].ports;
      const axis = ['top', 'bottom'].includes(side) ? 'x' : 'y';
      for (let i = 1; i < ports.length; i++) assert.ok(ports[i][axis] - ports[i - 1][axis] >= 16 - 1e-6);
      assert.deepEqual(copyLayout(r), r);
    }
    const visible = input(direction, 'ALU', [{ id: 'i', direction: 'input', style: { hidden: false } }]);
    const g = geometry(visible);
    assert.ok(g.width >= 140);
    assert.ok(g.height > 36);
  });
}

test('default connected title-sized Blocks retain route endpoints, receiver names and export bounds', async () => {
  for (const direction of ['right', 'down']) {
    const raw = input(direction);
    raw.modules = [
      { id: 'A', label: 'ALU', ports: [{ id: 'out', direction: 'output' }] },
      {
        id: 'B',
        label: 'Processor\ncore',
        ports: [
          { id: 'a', direction: 'input' },
          { id: 'b', direction: 'input' },
        ],
      },
      { id: 'C', label: 'DMA', ports: [{ id: 'out', direction: 'output' }] },
    ];
    raw.connections = [
      {
        from: 'A.out',
        to: ['B.a'],
        label: 'Data values\n16 bits',
        style: { label: { repeatAtEnd: 'always' } },
      },
      { from: 'C.out', to: ['B.b'], label: 'Enable', style: { label: { repeatAtEnd: 'always' } } },
    ];
    const m = createDiagramModel(raw),
      r = await layoutDiagram(m);
    assert.equal(r.warnings, undefined, JSON.stringify(r.warnings));
    assert.deepEqual(copyLayout(r), r);
    assert.ok(r.connections.every((e) => e.labelInstances.some((l) => l.role === 'end')));
    assert.ok(renderSvg(r).startsWith('<svg'));
    for (const e of r.connections) {
      const p = r.modules.find((n) => n.id === e.target.moduleId).ports.find((p) => p.id === e.target.portId),
        end = e.sections.at(-1).points.at(-1);
      near(p.x, end.x);
      near(p.y, end.y);
    }
  }
});
