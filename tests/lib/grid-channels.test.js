import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import {
  allocateTracks,
  parallelOverlap,
  routeGridChannel,
  reconcileChannelRoutes,
} from '../../src/lib/blockchart/layout/grid-channels.js';

const example = JSON.parse(
  await readFile(new URL('../../examples/grid-routing-channels.json', import.meta.url), 'utf8'),
);
const parts = (e) => e.sections.flatMap((s) => s.points.slice(1).map((p, i) => [s.points[i], p]));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);

test('interval coloring shares Net fan-out, reuses disjoint ranges and respects stroke widths', () => {
  const branches = [
    { id: 'a1', net: 'A', lo: 0, hi: 2, width: 2 },
    { id: 'a2', net: 'A', lo: 0, hi: 3, width: 4 },
    { id: 'b', net: 'B', lo: 1, hi: 4, width: 12 },
    { id: 'c', net: 'C', lo: 5, hi: 6, width: 2 },
  ];
  const before = structuredClone(branches),
    tracks = allocateTracks(branches);
  assert.equal(tracks.length, 2);
  assert.deepEqual(
    tracks.find((t) => t.nets.some((n) => n.key === 'A')).nets.map((n) => n.key),
    ['A', 'C'],
  );
  assert.equal(tracks.find((t) => t.nets.some((n) => n.key === 'B')).width, 12);
  assert.deepEqual(branches, before);
  assert.deepEqual(allocateTracks([...branches].reverse()), tracks);
});

for (const direction of ['down', 'right'])
  test(`multi-track ${direction} Grid keeps foreign Nets separate, names and endpoints intact`, async () => {
    const raw = structuredClone(example);
    if (direction === 'right') {
      raw.layout.direction = 'right';
      raw.layout.cells = example.layout.cells[0].map((_, c) => example.layout.cells.map((row) => row[c]));
      raw.layout.rowGap = 12;
      raw.layout.columnGap = 8;
    }
    const original = structuredClone(raw),
      model = createDiagramModel(raw),
      snapshot = structuredClone(model),
      layout = await layoutDiagram(model);
    assert.deepEqual(raw, original);
    assert.deepEqual(model, snapshot);
    assert.deepEqual(layout.warnings ?? [], []);
    const routes = layout.connections.filter((e) => e.netId !== 'AuditNet');
    assert.equal(routes.length, 5);
    assert.ok(
      routes.every((e) => e.routingInfo.method === 'grid-channel' && e.routingInfo.channelTrackCount === 4),
    );
    const coordinate = direction === 'down' ? 'y' : 'x';
    const tracks = new Map();
    for (const edge of routes) {
      assert.equal(edge.routingInfo.channelAxis, coordinate);
      const [a, b] = edge.routingInfo.waypoints;
      near(a[coordinate], b[coordinate]);
      if (tracks.has(edge.netId)) near(tracks.get(edge.netId), a[coordinate]);
      tracks.set(edge.netId, a[coordinate]);
      const source = layout.modules
        .find((n) => n.id === edge.source.moduleId)
        .ports.find((p) => p.id === edge.source.portId);
      const target = layout.modules
        .find((n) => n.id === edge.target.moduleId)
        .ports.find((p) => p.id === edge.target.portId);
      near(edge.sections[0].points[0].x, source.x);
      near(edge.sections[0].points[0].y, source.y);
      near(edge.sections.at(-1).points.at(-1).x, target.x);
      near(edge.sections.at(-1).points.at(-1).y, target.y);
      assert.ok(edge.labelInstances.some((l) => l.role === 'start'));
      for (const [p, q] of parts(edge)) {
        assert.ok(Math.abs(p.x - q.x) < 1e-5 || Math.abs(p.y - q.y) < 1e-5);
        for (const node of layout.modules) {
          const hit =
            Math.abs(p.y - q.y) < 1e-5
              ? p.y > node.y + 1e-5 &&
                p.y < node.y + node.height - 1e-5 &&
                Math.max(p.x, q.x) > node.x + 1e-5 &&
                Math.min(p.x, q.x) < node.x + node.width - 1e-5
              : p.x > node.x + 1e-5 &&
                p.x < node.x + node.width - 1e-5 &&
                Math.max(p.y, q.y) > node.y + 1e-5 &&
                Math.min(p.y, q.y) < node.y + node.height - 1e-5;
          assert.equal(hit, false, `${edge.netId} crosses ${node.id}`);
        }
      }
    }
    assert.equal(new Set(tracks.values()).size, 4);
    for (let i = 0; i < layout.connections.length; i++)
      for (let j = 0; j < i; j++) {
        const a = layout.connections[i],
          b = layout.connections[j];
        if (a.netId === b.netId) continue;
        for (const [u, v] of parts(a))
          for (const [x, y] of parts(b))
            assert.equal(
              parallelOverlap(u, v, x, y, (a.style.strokeWidth + b.style.strokeWidth) / 2),
              false,
              `${a.netId}/${b.netId}`,
            );
      }
    const consumer = layout.modules.find((n) => n.id === 'ConsumerA'),
      audit = layout.modules.find((n) => n.id === 'Audit');
    near(
      direction === 'down' ? audit.y - consumer.y - consumer.height : audit.x - consumer.x - consumer.width,
      8,
    );
    assert.ok(!JSON.stringify(layout).includes('_gridChannels'));
    assert.ok(renderSvg(layout).includes('Data A'));
  });

test('blocked channel and out-of-scope channel fall back without moving endpoints', () => {
  const options = {
    start: { x: 0, y: 6 },
    finish: { x: 100, y: 94 },
    source: { x: 0, y: 0 },
    target: { x: 100, y: 100 },
    av: { x: 0, y: 1 },
    bv: { x: 0, y: -1 },
    channel: { axis: 'y', coordinate: 50 },
    clearance: 20,
    avoid: [],
    gap: 3,
  };
  const obstacles = [{ x: -100, y: 40, width: 300, height: 20 }];
  assert.equal(routeGridChannel({ ...options, obstacles }), null);
  assert.equal(
    routeGridChannel({ ...options, obstacles: [], bounds: { x: -10, y: -10, width: 120, height: 50 } }),
    null,
  );
});

test('perpendicular crossings are allowed while parallel ink is separated', () => {
  assert.equal(
    parallelOverlap({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: -10 }, { x: 50, y: 10 }, 4),
    false,
  );
  assert.equal(parallelOverlap({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 2 }, { x: 150, y: 2 }, 4), true);
  assert.equal(
    parallelOverlap({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 110, y: 0 }, { x: 150, y: 0 }, 4),
    false,
  );
});

for (const partial of [false, true])
  test(`nested ${partial ? 'partial' : 'full'} Grid channels follow moved ancestors and scoped views`, async () => {
    const raw = structuredClone(example),
      config = { ...raw.layout };
    delete config.direction;
    raw.layout = { direction: 'down' };
    if (partial) raw.modules.push({ id: 'Unrelated', label: 'Automatic placement' });
    raw.groups = [
      {
        id: 'Cluster',
        type: 'container',
        label: 'Routing cluster',
        members: raw.modules.map((n) => n.id),
        layout: config,
      },
    ];
    for (const options of [{}, { rootGroupId: 'Cluster' }]) {
      const l = await layoutDiagram(createDiagramModel(raw), options);
      const frame = l.groups.find((g) => g.id === 'Cluster');
      for (const edge of l.connections.filter((e) => e.netId !== 'AuditNet')) {
        assert.equal(edge.routingInfo.method, 'grid-channel');
        for (const p of edge.routingInfo.waypoints) {
          assert.ok(p.x >= frame.x && p.x <= frame.x + frame.width);
          assert.ok(p.y >= frame.y && p.y <= frame.y + frame.height);
        }
      }
      assert.deepEqual(l.warnings ?? [], []);
    }
  });

test('cross-Container Grid reserves frames and repeated receiver labels before routing', async () => {
  const raw = structuredClone(example);
  raw.groups = [
    {
      id: 'Sources',
      type: 'container',
      members: raw.modules.filter((n) => n.id.startsWith('Producer')).map((n) => n.id),
    },
    {
      id: 'Receivers',
      type: 'container',
      members: raw.modules.filter((n) => n.id.startsWith('Consumer')).map((n) => n.id),
    },
  ];
  raw.diagram.style.connection.label.repeatAtEnd = 'always';
  const l = await layoutDiagram(createDiagramModel(raw));
  assert.deepEqual(l.warnings ?? [], []);
  for (const edge of l.connections.filter((e) => e.netId !== 'AuditNet')) {
    assert.equal(edge.routingInfo.method, 'grid-channel');
    assert.ok(edge.labelInstances.some((label) => label.role === 'end'));
  }
});

test('thick tracks keep enough ink separation and expand only the crowded gap', async () => {
  const raw = structuredClone(example);
  raw.connections[1].style.strokeWidth = 14;
  const l = await layoutDiagram(createDiagramModel(raw));
  const routed = l.connections.filter((e) => e.netId !== 'AuditNet');
  const b = routed.find((e) => e.netId === 'DataB'),
    y = b.routingInfo.waypoints[0].y;
  assert.equal(b.routingInfo.method, 'grid-channel');
  for (const e of routed.filter((e) => e.netId !== 'DataB'))
    assert.ok(Math.abs(y - e.routingInfo.waypoints[0].y) >= (14 + e.style.strokeWidth) / 2 + 6 - 1e-5);
});

test('Auto layouts do not opt into Grid channels', async () => {
  const raw = structuredClone(example);
  raw.layout = { direction: 'down' };
  const l = await layoutDiagram(createDiagramModel(raw));
  assert.ok(l.connections.every((e) => e.routingInfo?.method !== 'grid-channel'));
});

test('late fallbacks roll back conflicting new channels until final foreign ink is separated', () => {
  const section = (y) => [
    {
      points: [
        { x: 0, y },
        { x: 100, y },
      ],
    },
  ];
  const edge = (id, y) => ({
    id,
    sections: section(y),
    style: { strokeWidth: 2 },
    routingInfo: { method: 'grid-channel' },
  });
  const connections = [edge('A', 0), edge('C', 10), edge('Blocked', 0)];
  connections[2].routingInfo = { method: 'fixed-orthogonal', channelStatus: 'blocked' };
  const refs = new Map(connections.map((e) => [e.id, { netId: e.id }]));
  const originals = new Map([
    ['A', { sections: section(10), routingInfo: { method: 'fixed-orthogonal', reason: 'grid' } }],
    ['C', { sections: section(20), routingInfo: { method: 'fixed-orthogonal', reason: 'grid' } }],
  ]);
  assert.deepEqual(reconcileChannelRoutes(connections, refs, originals), ['A', 'C']);
  assert.equal(originals.size, 0);
  assert.equal(connections[0].sections[0].points[0].y, 10);
  assert.equal(connections[1].sections[0].points[0].y, 20);
  assert.ok(connections.every((e) => e.routingInfo.channelStatus === 'blocked'));
  assert.equal(connections[2].sections[0].points[0].y, 0);
});
