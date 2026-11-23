import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/blockchart/index.js';
const validate = new Ajv2020({ strict: true }).compile(
  JSON.parse(readFileSync('schema/blockchart.schema.json', 'utf8')),
);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function fixture(local = false, labels = false) {
  const raw = {
    version: 1,
    diagram: {
      name: 'Grid alignment',
      style: { module: { portLabel: { hidden: true } }, connection: { label: { repeatAtEnd: 'never' } } },
    },
    layout: {
      type: 'grid',
      cells: [
        ['A', 'B'],
        ['C', 'D'],
      ],
      blockMinWidth: 1.2,
    },
    modules: [
      { id: 'A', label: 'ALU', width: 1.2, ports: [{ id: 'out', direction: 'output' }] },
      { id: 'B', label: 'Processor', width: 2.8, ports: [{ id: 'in', direction: 'input' }] },
      { id: 'C', label: 'Decoder', width: 2.6, ports: [{ id: 'out', direction: 'output' }] },
      { id: 'D', label: 'Status', width: 1.2, ports: [{ id: 'in', direction: 'input' }] },
    ],
    connections: [
      { from: 'A.out', to: ['B.in'], ...(labels ? { label: 'A much longer signal name' } : {}) },
      { from: 'C.out', to: ['D.in'], ...(labels ? { label: 'Data' } : {}) },
    ],
  };
  if (local) {
    raw.groups = [{ id: 'G', members: ['A', 'B', 'C', 'D'], layout: raw.layout }];
    raw.layout = {};
  }
  return raw;
}
for (const local of [false, true])
  test(`Grid alignment schema/runtime validation ${local ? 'Group' : 'Top'}`, () => {
    for (const value of ['left', 'center', 'right', undefined, null, 'auto', 'LEFT', 1, true, {}]) {
      const raw = fixture(local),
        config = local ? raw.groups[0].layout : raw.layout;
      config.blockAlign = value;
      const valid = ['left', 'center', 'right'].includes(value);
      // Undefined is not JSON and is rejected by runtime; use serializable cases for schema.
      if (value !== undefined) assert.equal(validate(raw), valid, JSON.stringify(validate.errors));
      if (valid)
        assert.equal(
          (local ? createDiagramModel(raw).groups[0].layout : createDiagramModel(raw).layout).blockAlign,
          value,
        );
      else
        assert.throws(
          () => createDiagramModel(raw),
          (e) => e.path === (local ? 'groups[0].layout.' : 'layout.') + 'blockAlign',
        );
    }
    for (const type of ['auto', undefined]) {
      const raw = fixture(local),
        config = local ? raw.groups[0].layout : raw.layout;
      delete config.cells;
      delete config.blockMinWidth;
      if (type) config.type = type;
      else delete config.type;
      config.blockAlign = 'center';
      assert.equal(validate(raw), false);
      assert.throws(
        () => createDiagramModel(raw),
        (e) => e.path === (local ? 'groups[0].layout.' : 'layout.') + 'blockAlign',
      );
    }
  });
for (const direction of ['right', 'down'])
  for (const align of ['left', 'center', 'right'])
    for (const local of [false, true])
      test(`Grid ${direction} ${align} ${local ? 'Group scoped' : 'Top'} aligns bodies and attached routes`, async () => {
        const raw = fixture(local, true),
          config = local ? raw.groups[0].layout : raw.layout;
        raw.layout.direction = direction;
        config.blockAlign = align;
        const before = structuredClone(raw),
          model = createDiagramModel(raw),
          snapshot = structuredClone(model);
        const result = await layoutDiagram(model, local ? { rootGroupId: 'G' } : {});
        const nodes = new Map(result.modules.map((n) => [n.id, n]));
        const anchor = (n) => n.x + (align === 'left' ? 0 : align === 'right' ? n.width : n.width / 2);
        // Center intentionally preserves envelope placement, including label overhang.
        if (align !== 'center') {
          near(anchor(nodes.get('A')), anchor(nodes.get('C')));
          near(anchor(nodes.get('B')), anchor(nodes.get('D')));
        }
        for (const edge of result.connections) {
          const pts = edge.sections.flatMap((s) => s.points);

          // Every route is orthogonal and its endpoints attach to some matching Port.
          for (let i = 1; i < pts.length; i++)
            assert.ok(Math.abs(pts[i].x - pts[i - 1].x) < 1e-6 || Math.abs(pts[i].y - pts[i - 1].y) < 1e-6);
          for (const point of [pts[0], pts.at(-1)])
            assert.ok(
              result.modules.some((n) =>
                n.ports.some((p) => Math.abs(p.x - point.x) < 1e-6 && Math.abs(p.y - point.y) < 1e-6),
              ),
            );
        }
        for (const [a, b] of [
          ['A', 'B'],
          ['C', 'D'],
        ])
          assert.ok(nodes.get(a).x + nodes.get(a).width < nodes.get(b).x);
        assert.ok(renderSvg(result).includes('<svg'));
        assert.deepEqual(raw, before);
        assert.deepEqual(model, snapshot);
      });
test('omitted Grid alignment equals explicit center including SVG', async () => {
  const raw = fixture(false, true),
    a = await layoutDiagram(createDiagramModel(raw));
  raw.layout.blockAlign = 'center';
  const b = await layoutDiagram(createDiagramModel(raw));
  assert.deepEqual(a, b);
  assert.equal(renderSvg(a), renderSvg(b));
});
test('whole Container cells translate descendants without changing internal geometry', async () => {
  const raw = fixture();
  raw.groups = [{ id: 'G', members: ['A', 'B'] }];
  raw.layout.cells = [['G'], ['C']];
  const results = [];
  for (const blockAlign of ['left', 'right']) {
    raw.layout.blockAlign = blockAlign;
    results.push(await layoutDiagram(createDiagramModel(raw)));
  }
  for (const result of results) {
    const g = result.groups.find((n) => n.id === 'G'),
      c = result.modules.find((n) => n.id === 'C');
    if (result === results[0]) near(g.x, c.x);
    else near(g.x + g.width, c.x + c.width);
  }
  for (const id of ['A', 'B']) {
    const relative = results.map((r) => {
      const g = r.groups.find((n) => n.id === 'G'),
        n = r.modules.find((n) => n.id === id);
      return { x: n.x - g.x, y: n.y - g.y, width: n.width, height: n.height };
    });
    assert.deepEqual(relative[0], relative[1]);
  }
});
for (const direction of ['right', 'down'])
  test(`cross-Container and partial Grid alignment preserves bounds and Auto geometry (${direction})`, async () => {
    const raw = fixture(false, true);
    raw.layout.direction = direction;
    raw.groups = [{ id: 'G', members: ['A', 'B', 'C', 'D'] }];
    raw.modules.push({ id: 'AutoPeer', label: 'Auto peer', ports: [] });
    const results = [];
    for (const blockAlign of ['left', 'right']) {
      raw.layout.blockAlign = blockAlign;
      const result = await layoutDiagram(createDiagramModel(raw));
      const n = new Map(result.modules.map((n) => [n.id, n]));
      const x = (node) => node.x + (blockAlign === 'right' ? node.width : 0);
      near(x(n.get('A')), x(n.get('C')));
      near(x(n.get('B')), x(n.get('D')));
      const group = result.groups.find((n) => n.id === 'G');
      for (const id of group.members) {
        const child = n.get(id);
        assert.ok(child.x >= group.x - 1e-6 && child.x + child.width <= group.x + group.width + 1e-6);
        assert.ok(child.y >= group.y - 1e-6 && child.y + child.height <= group.y + group.height + 1e-6);
      }
      results.push(result);
    }
    for (const id of ['A', 'B', 'C', 'D', 'AutoPeer']) {
      const sizes = results.map((r) => {
        const n = r.modules.find((n) => n.id === id);
        return [n.width, n.height];
      });
      assert.deepEqual(sizes[0], sizes[1]);
    }
  });
