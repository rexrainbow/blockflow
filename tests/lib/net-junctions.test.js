import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { netJunctions } from '../../src/lib/blockchart/layout/net-junctions.js';
import { finalizeLayout } from '../../src/lib/blockchart/layout/finalize.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/blockchart/index.js';
import { copyLayout, routeBounds } from '../../src/lib/blockchart/view/layout.js';
import { connectionStyle } from '../../src/lib/blockchart/styles.js';
const p = (x, y) => ({ x, y });
const edge = (id, points, netId = 'Net', width = 1.5) => ({
  id,
  netId,
  style: { ...connectionStyle(1), strokeColor: '#123456', strokeWidth: width },
  sections: [{ points: points.map(([x, y]) => p(x, y)) }],
});
const graph = () => ({
  modules: [],
  groups: [],
  terminals: [],
  connections: [
    edge('A', [
      [0, 10],
      [20, 10],
      [20, 0],
    ]),
    edge('B', [
      [0, 10],
      [40, 10],
      [40, 20],
    ]),
    edge('C', [
      [0, 10],
      [60, 10],
      [60, 30],
    ]),
  ],
});
const xy = (dots) => dots.map((j) => [j.x, j.y]);
test('three receivers with two real forks produce two union junctions', () => {
  const layout = graph(),
    saved = structuredClone(layout),
    dots = netJunctions(layout);
  assert.deepEqual(xy(dots), [
    [20, 10],
    [40, 10],
  ]);
  assert.deepEqual(dots[0].connectionIds, ['A', 'B', 'C']);
  assert.deepEqual(dots[1].connectionIds, ['B', 'C']);
  assert.ok(dots.every((j) => j.radius === 2.5 && j.style.strokeColor === '#123456'));
  assert.deepEqual(layout, saved);
});
test('three branches leaving the same point produce only one four-way dot', () => {
  const layout = {
    modules: [],
    connections: [
      edge('A', [
        [0, 0],
        [20, 0],
        [20, -20],
      ]),
      edge('B', [
        [0, 0],
        [20, 0],
        [20, 20],
      ]),
      edge('C', [
        [0, 0],
        [40, 0],
      ]),
    ],
  };
  assert.deepEqual(xy(netJunctions(layout)), [[20, 0]]);
});
test('duplicate and differently split collinear strokes do not create a fork', () => {
  const layout = {
    connections: [
      edge('A', [
        [0, 0],
        [30, 0],
      ]),
      edge('B', [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 0],
      ]),
      edge('C', [
        [30, 0],
        [0, 0],
        [30, 0],
      ]),
    ],
  };
  assert.deepEqual(netJunctions(layout), []);
});
test('ordinary bends and a single-branch self-crossing do not become junctions', () => {
  assert.deepEqual(
    netJunctions({
      connections: [
        edge('A', [
          [0, 0],
          [20, 0],
          [20, 20],
        ]),
      ],
    }),
    [],
  );
  assert.deepEqual(
    netJunctions({
      connections: [
        edge('A', [
          [0, 0],
          [20, 0],
          [20, 20],
          [10, 20],
          [10, -10],
        ]),
      ],
    }),
    [],
  );
});
test('interior intersections use same-Net direction degree, never branch count alone', () => {
  assert.deepEqual(
    xy(
      netJunctions({
        connections: [
          edge('A', [
            [0, 0],
            [40, 0],
          ]),
          edge('B', [
            [20, -20],
            [20, 20],
          ]),
        ],
      }),
    ),
    [[20, 0]],
  );
  assert.deepEqual(
    netJunctions({
      connections: [
        edge(
          'A',
          [
            [0, 0],
            [40, 0],
          ],
          'First',
        ),
        edge(
          'B',
          [
            [20, -20],
            [20, 20],
          ],
          'Second',
        ),
      ],
    }),
    [],
  );
});
test('a genuine own-Net fork is suppressed when its marker would bridge a foreign Net', () => {
  const layout = graph();
  layout.connections.push(
    edge(
      'Other',
      [
        [20, -20],
        [20, 40],
      ],
      'Foreign',
    ),
  );
  assert.deepEqual(xy(netJunctions(layout)), [[40, 10]]);
  const near = graph();
  near.connections.push(
    edge(
      'Other',
      [
        [0, 13],
        [30, 13],
      ],
      'Foreign',
    ),
  );
  assert.deepEqual(xy(netJunctions(near)), [[40, 10]]);
});
test('Port and Terminal anchors never get duplicate junction markers', () => {
  const layout = graph();
  layout.terminals = [{ anchor: p(20, 10) }];
  layout.modules = [{ x: 100, y: 100, width: 20, height: 20, ports: [p(40, 10)] }];
  assert.deepEqual(netJunctions(layout), []);
});
test('inline names and physical bodies keep marker ink from being hidden or clipped', () => {
  const layout = graph();
  layout.connections[0].labelInstances = [
    { placement: 'inline', bounds: { x: 18, y: 8, width: 4, height: 4 } },
  ];
  layout.modules = [{ x: 39, y: 9, width: 2, height: 2, ports: [] }];
  assert.deepEqual(netJunctions(layout), []);
});
test('a thin Concat body does not reserve its whole label envelope as hardware ink', () => {
  const layout = graph();
  layout.modules = [
    {
      x: 10,
      y: 5,
      width: 20,
      height: 20,
      ports: [],
      body: { shapes: [{ kind: 'rect', x: 0, y: 15, width: 20, height: 2 }] },
    },
  ];
  assert.deepEqual(xy(netJunctions(layout)), [
    [20, 10],
    [40, 10],
  ]);
});
test('marker radius follows incident ink while color/opacity inherit the Net style', () => {
  const layout = graph();
  for (const e of layout.connections) {
    e.style.strokeWidth = 6;
    e.netStyle = { ...e.style, strokeColor: '#ff8800', opacity: 0.4 };
    e.netTrunkSections = 1;
  }
  const dots = netJunctions(layout);
  assert.ok(
    dots.every((j) => j.radius === 6 && j.style.strokeColor === '#ff8800' && j.style.opacity === 0.4),
  );
});
test('epsilon deduplication and input ordering do not duplicate or move markers', () => {
  const layout = graph();
  layout.connections[1].sections[0].points.splice(1, 0, p(20 + 0.5e-6, 10));
  const first = netJunctions(layout),
    reversed = structuredClone(layout);
  reversed.connections.reverse();
  for (const e of reversed.connections) for (const s of e.sections) s.points.reverse();
  assert.equal(first.length, 2);
  assert.deepEqual(netJunctions(reversed), first);
});
test('finalization includes disk ink in bounds and translates markers with the routes', () => {
  const layout = graph();
  for (const e of layout.connections) for (const point of e.sections[0].points) point.y -= 10;
  const result = finalizeLayout(layout, { diagram: {} });
  assert.equal(result.junctions.length, 2);
  for (const j of result.junctions) {
    assert.ok(j.x - j.radius >= -1e-6 && j.y - j.radius >= -1e-6);
    assert.ok(j.x + j.radius <= result.width + 1e-6 && j.y + j.radius <= result.height + 1e-6);
  }
  assert.deepEqual(copyLayout(result), result);
});
test('SVG draws one filled Net marker per fork beneath blocks, with branch ownership attributes', () => {
  const result = finalizeLayout(graph(), { diagram: {} }),
    before = structuredClone(result),
    svg = renderSvg(result);
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml'),
    dots = [...Array.from(doc.getElementsByTagName('circle'))].filter(
      (n) => n.getAttribute('data-role') === 'connection-junction',
    );
  assert.equal(dots.length, 2);
  for (const dot of dots) {
    assert.equal(dot.getAttribute('fill'), '#123456');
    assert.equal(dot.getAttribute('stroke'), 'none');
    assert.equal(dot.getAttribute('data-net'), 'Net');
    assert.ok(dot.getAttribute('data-connections').includes('B'));
    assert.equal(dot.getAttribute('pointer-events'), 'none');
  }
  assert.deepEqual(result, before);
});
test('DOM copying rejects malformed styles, geometry and cross-Net ownership', () => {
  const original = finalizeLayout(graph(), { diagram: {} });
  const corruptions = [
    (j) => (j.radius = 0),
    (j) => (j.x = NaN),
    (j) => (j.y = -100),
    (j) => (j.style.strokeColor = 'url(evil)'),
    (j) => (j.style.opacity = 2),
    (j) => (j.style.extra = 'bad'),
    (j) => (j.netId = 'Other'),
    (j) => (j.connectionIds = ['A']),
    (j) => (j.connectionIds = ['A', 'Missing']),
    (j) => (j.connectionIds = ['A', 'A']),
  ];
  for (const corrupt of corruptions) {
    const layout = structuredClone(original);
    corrupt(layout.junctions[0]);
    assert.throws(() => copyLayout(layout), /Invalid DOM layout/);
  }
  for (const bad of [null, [], 'invalid']) {
    const layout = structuredClone(original);
    layout.junctions[0] = bad;
    assert.throws(() => copyLayout(layout), /Invalid DOM layout/);
  }
  const duplicate = structuredClone(original);
  duplicate.junctions.push(structuredClone(duplicate.junctions[0]));
  assert.throws(() => copyLayout(duplicate), /duplicate junction/);
});
test('connection bounds include thick markers only for the participating branches', () => {
  const layout = graph();
  for (const e of layout.connections) e.style.strokeWidth = 10;
  const result = finalizeLayout(layout, { diagram: {} }),
    a = result.connections.find((e) => e.id === 'A'),
    before = routeBounds(a),
    after = routeBounds(a, result.junctions);
  assert.ok(after.height > before.height);
  assert.ok(after.width > before.width);
  assert.ok(after.x <= result.junctions[0].x - result.junctions[0].radius);
  const foreign = { ...a, id: 'Unrelated' };
  assert.deepEqual(routeBounds(foreign, result.junctions), routeBounds(foreign));
});
test('public layout derives junctions without authoring fields or input mutation', async () => {
  const raw = {
    version: 1,
    diagram: { name: 'One signal, three consumers', style: { module: { portLabel: { hidden: true } } } },
    layout: {
      type: 'grid',
      cells: [
        ['S', 'A'],
        [null, 'B'],
        [null, 'C'],
      ],
    },
    modules: [
      { id: 'S', ports: [{ id: 'out', direction: 'output' }] },
      ...['A', 'B', 'C'].map((id) => ({ id, ports: [{ id: 'in', direction: 'input' }] })),
    ],
    connections: [{ id: 'Signal', from: 'S.out', to: ['A.in', 'B.in', 'C.in'] }],
  };
  const saved = structuredClone(raw),
    model = createDiagramModel(raw),
    before = structuredClone(model),
    result = await layoutDiagram(model);
  assert.equal(result.junctions.length, 2);
  assert.ok(result.junctions.every((j) => j.netId === 'Signal'));
  assert.deepEqual(raw, saved);
  assert.deepEqual(model, before);
  assert.deepEqual(copyLayout(result), result);
  assert.deepEqual(await layoutDiagram(model), result);
});
