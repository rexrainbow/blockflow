import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramModel, layoutDiagram } from '../../src/lib/index.js';
import { moduleGeometry } from '../../src/lib/blockchart/geometry.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
function model(direction, appearance, ports, dimensions = {}) {
  return createDiagramModel({
    version: 1,
    diagram: { name: 'Hidden port geometry', style: { module: { portLabel: { hidden: true } } } },
    layout: { direction },
    modules: [
      {
        id: 'WithPorts',
        label: 'Shared block\nMain core / Core 0 / Core 1 / Core 2',
        appearance,
        ports,
        ...dimensions,
      },
      { id: 'Plain', label: 'Shared block\nMain core / Core 0 / Core 1 / Core 2', appearance, ...dimensions },
    ],
  });
}
for (const direction of ['right', 'down'])
  for (const type of ['rectangle', 'stacked', 'trapezoid', 'bar'])
    test(`hidden side-port text takes no lanes or phantom rows: ${direction}/${type}`, async () => {
      const m = model(
        direction,
        { type },
        ['left', 'right', 'top', 'bottom'].map((side) => ({
          id: side,
          direction: 'inout',
          side,
          label: 'A very long hidden port name\nthat must not enlarge the block',
          style: { hidden: true, fontSize: 48, padding: 60 },
        })),
      );
      const layout = await layoutDiagram(m),
        [n, plain] = layout.modules;
      near(n.width, plain.width);
      near(n.height, plain.height);
      assert.deepEqual(copyLayout(layout), layout);
      for (const p of n.ports) {
        assert.equal(p.labelBounds.width, 0);
        assert.equal(p.labelBounds.height, 0);
        if (p.side === 'left' || p.side === 'right') assert.ok(p.y >= n.y && p.y <= n.y + n.height);
        else assert.ok(p.x >= n.x && p.x <= n.x + n.width);
      }
      const shown = structuredClone(m.modules[0]);
      shown.ports.forEach((p) => (p.style.hidden = false));
      const large = moduleGeometry(shown, direction);
      assert.ok(large.width > n.width && large.height > n.height);
    });

test('hidden default-side ports use the same title-only sizing as explicit sides', async () => {
  for (const direction of ['right', 'down']) {
    const m = model(direction, { type: 'rectangle' }, [
      { id: 'i', direction: 'input' },
      { id: 'o', direction: 'output' },
    ]);
    const [n, plain] = (await layoutDiagram(m)).modules;
    near(n.width, plain.width);
    near(n.height, plain.height);
    assert.equal(n.ports.length, 2);
  }
});

test('many hidden ports retain minimum connection spacing and explicit minimum dimensions', async () => {
  for (const direction of ['right', 'down'])
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const m = model(
        direction,
        { type: 'trapezoid' },
        Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, direction: 'inout', side })),
      );
      const [n] = (await layoutDiagram(m)).modules,
        axis = ['top', 'bottom'].includes(side) ? 'x' : 'y';
      for (let i = 1; i < n.ports.length; i++) assert.ok(n.ports[i][axis] - n.ports[i - 1][axis] >= 24);
    }
  const m = model('right', { type: 'stacked' }, [{ id: 'i', direction: 'input' }], { width: 5, height: 4 });
  const [n, plain] = (await layoutDiagram(m)).modules;
  near(n.width, plain.width);
  near(n.height, plain.height);
  assert.ok(n.width >= 700 && n.height >= 336);
});
