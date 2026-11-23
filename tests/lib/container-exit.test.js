import test from 'node:test';
import assert from 'node:assert/strict';
import { routeContainerExits } from '../../src/lib/blockchart/layout/container-exit.js';
import { connectionStyle } from '../../src/lib/blockchart/styles.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/blockchart/index.js';

function fixture() {
  const modules = [
    {
      id: 'Source',
      x: 400,
      y: 90,
      width: 50,
      height: 40,
      ports: [{ id: 'out', direction: 'output', side: 'right', x: 450, y: 110 }],
    },
    {
      id: 'Target',
      x: 80,
      y: 230,
      width: 50,
      height: 40,
      ports: [{ id: 'in', direction: 'input', side: 'left', x: 80, y: 250 }],
    },
  ];
  const groups = [
    {
      id: 'Bank',
      x: 0,
      y: 0,
      width: 700,
      height: 450,
      members: ['Producer', 'Consumer'],
      ports: [],
      portMode: 'direct',
    },
    {
      id: 'Producer',
      x: 300,
      y: 50,
      width: 300,
      height: 300,
      members: ['Source'],
      ports: [],
      portMode: 'direct',
    },
    {
      id: 'Consumer',
      x: 20,
      y: 180,
      width: 180,
      height: 160,
      members: ['Target'],
      ports: [],
      portMode: 'direct',
    },
  ];
  const ref = {
    id: 'wire',
    source: { moduleId: 'Source', portId: 'out' },
    target: { moduleId: 'Target', portId: 'in' },
    style: connectionStyle(null),
    netId: 'net',
  };
  const edge = {
    ...structuredClone(ref),
    sections: [
      {
        points: [
          { x: 450, y: 110 },
          { x: 460, y: 110 },
          { x: 460, y: 250 },
          { x: 80, y: 250 },
        ],
      },
    ],
  };
  return {
    result: { modules, groups, terminals: [], connections: [edge] },
    model: { modules, groups, connections: [ref], layout: { direction: 'right', layerSpacing: 30 } },
  };
}
const frozenNodes = (f) => structuredClone({ modules: f.result.modules, groups: f.result.groups });
const path = (edge) => edge.sections.flatMap((s) => s.points);
const hit = (a, b, r) =>
  Math.abs(a.y - b.y) < 1e-6
    ? a.y > r.y && a.y < r.y + r.height && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width
    : a.x > r.x && a.x < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height;

for (let rotation = 0; rotation < 4; rotation++)
  test(`exit before turning, enter straight, stay in common ancestor (${rotation})`, () => {
    const f = fixture(),
      point = (p) => {
        let { x, y } = p;
        for (let i = 0; i < rotation; i++) [x, y] = [-y, x];
        return { x, y };
      };
    for (const n of [...f.result.modules, ...f.result.groups]) {
      const a = point(n),
        b = point({ x: n.x + n.width, y: n.y + n.height });
      Object.assign(n, {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y),
      });
      for (const p of n.ports) {
        Object.assign(p, point(p));
        p.side = ['right', 'bottom', 'left', 'top'][
          (['right', 'bottom', 'left', 'top'].indexOf(p.side) + rotation) % 4
        ];
      }
    }
    const edge = f.result.connections[0];
    edge.sections[0].points = edge.sections[0].points.map(point);
    const before = frozenNodes(f),
      source = { ...path(edge)[0] },
      target = { ...path(edge).at(-1) };
    routeContainerExits(f.result, f.model);
    assert.equal(edge.routingInfo.containerExit.status, 'routed');
    assert.deepEqual(path(edge)[0], source);
    assert.deepEqual(path(edge).at(-1), target);
    const p = path(edge),
      frame = f.result.groups.find((g) => g.id === 'Producer'),
      bank = f.result.groups[0];
    const v = point({ x: 1, y: 0 }),
      turn = p[1];
    if (v.x > 0) assert.ok(turn.x >= frame.x + frame.width + 9);
    if (v.x < 0) assert.ok(turn.x <= frame.x - 9);
    if (v.y > 0) assert.ok(turn.y >= frame.y + frame.height + 9);
    if (v.y < 0) assert.ok(turn.y <= frame.y - 9);
    const destination = f.result.groups.find((g) => g.id === 'Consumer'),
      entry = p.at(-2),
      w = point({ x: -1, y: 0 });
    if (w.x < 0) assert.ok(entry.x <= destination.x - 9);
    if (w.x > 0) assert.ok(entry.x >= destination.x + destination.width + 9);
    if (w.y < 0) assert.ok(entry.y <= destination.y - 9);
    if (w.y > 0) assert.ok(entry.y >= destination.y + destination.height + 9);
    for (let i = 1; i < p.length; i++) {
      assert.ok(p[i].x === p[i - 1].x || p[i].y === p[i - 1].y);
      for (const n of f.result.modules) assert.equal(hit(p[i - 1], p[i], n), false);
      assert.ok(
        p[i].x >= bank.x &&
          p[i].x <= bank.x + bank.width &&
          p[i].y >= bank.y &&
          p[i].y <= bank.y + bank.height,
      );
    }
    assert.deepEqual(frozenNodes(f), before);
  });

test('nested source Containers share one straight escape through the outer exclusive boundary', () => {
  const f = fixture();
  f.result.groups[1].members = ['Inner'];
  f.result.groups.push({
    id: 'Inner',
    x: 390,
    y: 80,
    width: 90,
    height: 80,
    members: ['Source'],
    ports: [],
    portMode: 'direct',
  });
  routeContainerExits(f.result, f.model);
  const e = f.result.connections[0];
  assert.deepEqual(e.routingInfo.containerExit.groups, ['Producer', 'Inner']);
  assert.equal(e.routingInfo.containerExit.status, 'routed');
  assert.ok(path(e)[1].x >= 609);
});

for (const reason of ['obstacle', 'scope', 'boundary', 'channel', 'feedback', 'detour'])
  test(`blocked exit retains original sections: ${reason}`, () => {
    const f = fixture(),
      edge = f.result.connections[0];
    if (reason === 'obstacle') {
      const n = { id: 'Blocker', x: 520, y: 100, width: 30, height: 30, ports: [] };
      f.result.modules.push(n);
      f.result.groups[1].members.push(n.id);
    }
    if (reason === 'scope') f.result.groups[0].width = 600;
    if (reason === 'boundary') f.result.groups[1].portMode = 'boundary';
    if (reason === 'channel') edge.routingInfo = { method: 'auto-channel', channelStatus: 'routed' };
    if (reason === 'feedback') edge.routingInfo = { method: 'outer-aabb', side: 'top' };
    if (reason === 'detour') {
      f.result.groups[1].width = 1500;
      f.result.groups[0].width = 2100;
    }
    const before = structuredClone(edge.sections),
      nodes = frozenNodes(f);
    routeContainerExits(f.result, f.model);
    assert.deepEqual(edge.sections, before);
    assert.equal(edge.routingInfo.containerExit.status, 'blocked');
    assert.deepEqual(frozenNodes(f), nodes);
  });

test('internal destination does not take an exit detour', () => {
  const f = fixture();
  f.result.groups[1].members.push('Target');
  f.result.groups[2].members = [];
  const before = structuredClone(f.result.connections);
  routeContainerExits(f.result, f.model);
  assert.deepEqual(f.result.connections, before);
});

test('a straight attachment and a route already beyond the source boundary are preserved', () => {
  for (const points of [
    [
      { x: 450, y: 110 },
      { x: 800, y: 110 },
    ],
    [
      { x: 450, y: 110 },
      { x: 620, y: 110 },
      { x: 620, y: 250 },
      { x: 80, y: 250 },
    ],
  ]) {
    const f = fixture();
    f.result.connections[0].sections = [{ points }];
    const before = structuredClone(f.result.connections);
    routeContainerExits(f.result, f.model);
    assert.deepEqual(f.result.connections, before);
  }
});

test('mixed fanout preserves the shared source label, trunk sections and internal branch', () => {
  const f = fixture(),
    e = f.result.connections[0];
  const prefix = [
    {
      points: [
        { x: 450, y: 110 },
        { x: 465, y: 110 },
      ],
    },
    {
      points: [
        { x: 465, y: 110 },
        { x: 505, y: 110 },
      ],
    },
  ];
  e.sections = [
    ...structuredClone(prefix),
    {
      points: [
        { x: 505, y: 110 },
        { x: 515, y: 110 },
        { x: 515, y: 250 },
        { x: 80, y: 250 },
      ],
    },
  ];
  e.netTrunkSections = 2;
  e.signalLabel = {
    sharedKey: 'signal_net',
    bounds: { x: 465, y: 100, width: 40, height: 20 },
    position: { x: 485, y: 110, anchor: 'middle' },
  };
  const internal = {
    ...structuredClone(e),
    id: 'internal',
    target: { moduleId: 'Local', portId: 'in' },
    sections: [
      ...structuredClone(prefix),
      {
        points: [
          { x: 505, y: 110 },
          { x: 515, y: 110 },
          { x: 515, y: 200 },
          { x: 480, y: 200 },
        ],
      },
    ],
  };
  f.result.modules.push({
    id: 'Local',
    x: 480,
    y: 185,
    width: 40,
    height: 30,
    ports: [{ id: 'in', direction: 'input', side: 'left', x: 480, y: 200 }],
  });
  f.result.groups[1].members.push('Local');
  f.result.connections.push(internal);
  f.model.connections.push({ ...f.model.connections[0], id: 'internal', target: internal.target });
  const stable = structuredClone(internal),
    label = structuredClone(e.signalLabel);
  routeContainerExits(f.result, f.model);
  assert.equal(e.routingInfo.containerExit.status, 'routed');
  assert.deepEqual(e.sections.slice(0, 2), prefix);
  assert.equal(e.netTrunkSections, 2);
  assert.deepEqual(e.signalLabel, label);
  assert.deepEqual(internal, stable);
});

test('receiver label and hardware tail remain pinned', () => {
  const f = fixture(),
    e = f.result.connections[0];
  const suffix = [
    {
      points: [
        { x: 35, y: 250 },
        { x: 65, y: 250 },
      ],
    },
    {
      points: [
        { x: 65, y: 250 },
        { x: 80, y: 250 },
      ],
    },
  ];
  e.sections = [
    {
      points: [
        { x: 450, y: 110 },
        { x: 460, y: 110 },
        { x: 460, y: 250 },
        { x: 35, y: 250 },
      ],
    },
    ...structuredClone(suffix),
  ];
  e.signalEndLabel = {
    bounds: { x: 35, y: 240, width: 30, height: 20 },
    position: { x: 50, y: 250, anchor: 'middle' },
  };
  routeContainerExits(f.result, f.model);
  assert.equal(e.routingInfo.containerExit.status, 'routed');
  assert.deepEqual(e.sections.slice(-2), suffix);
});

test('public pipeline routes after restored signal labels without changing authoring data', async () => {
  const raw = {
    version: 1,
    diagram: { name: 'Container exit lanes' },
    modules: [
      { id: 'Source', ports: [{ id: 'out', direction: 'output', style: { hidden: true } }] },
      { id: 'FarCorner', ports: [] },
      { id: 'Target', ports: [{ id: 'in', direction: 'input', style: { hidden: true } }] },
    ],
    groups: [
      {
        id: 'Producer',
        members: ['Source', 'FarCorner'],
        layout: {
          type: 'grid',
          cells: [
            ['Source', null],
            [null, 'FarCorner'],
          ],
        },
      },
      { id: 'Consumer', members: ['Target'] },
    ],
    connections: [{ id: 'Data', from: 'Source.out', to: ['Target.in'], label: 'Payload' }],
    layout: {
      type: 'grid',
      cells: [
        ['Producer', null],
        [null, 'Consumer'],
      ],
    },
  };
  raw.layout = { direction: 'right', layerSpacing: 80 };
  raw.modules[2].ports[0].side = 'top';
  const saved = structuredClone(raw),
    model = createDiagramModel(raw),
    snapshot = structuredClone(model),
    layout = await layoutDiagram(model);
  assert.deepEqual(raw, saved);
  assert.deepEqual(model, snapshot);
  assert.ok(layout.connections[0].labelInstances?.some((l) => l.role === 'start'));
  assert.equal(layout.connections[0].routingInfo.containerExit?.status, 'routed');
  assert.deepEqual(await layoutDiagram(model), layout);
  assert.ok(renderSvg(layout).startsWith('<svg'));
});

test('a reserved source label with an interior bend is not moved or detached', () => {
  const f = fixture(),
    e = f.result.connections[0];
  e.netTrunkSections = 2;
  e.sections = [
    {
      points: [
        { x: 450, y: 110 },
        { x: 460, y: 110 },
        { x: 460, y: 150 },
      ],
    },
    {
      points: [
        { x: 460, y: 150 },
        { x: 500, y: 150 },
      ],
    },
    {
      points: [
        { x: 500, y: 150 },
        { x: 510, y: 150 },
        { x: 510, y: 250 },
        { x: 80, y: 250 },
      ],
    },
  ];
  e.signalLabel = {
    bounds: { x: 460, y: 140, width: 40, height: 20 },
    position: { x: 480, y: 150, anchor: 'middle' },
  };
  const before = structuredClone(e.sections),
    label = structuredClone(e.signalLabel);
  routeContainerExits(f.result, f.model);
  assert.deepEqual(e.sections, before);
  assert.deepEqual(e.signalLabel, label);
  assert.equal(e.routingInfo.containerExit.reason, 'reserved-source-label');
});

test('foreign Terminal text in the escape ray blocks the optional exit', () => {
  const f = fixture(),
    e = f.result.connections[0];
  f.result.terminals.push({
    id: 'Other',
    style: { hidden: false },
    labelBounds: { x: 520, y: 100, width: 40, height: 20 },
  });
  const before = structuredClone(e.sections);
  routeContainerExits(f.result, f.model);
  assert.deepEqual(e.sections, before);
  assert.equal(e.routingInfo.containerExit.reason, 'obstructed-access');
});

test('sub-pixel receiver-label coordinate drift cannot create a diagonal access ray', () => {
  const f = fixture(),
    e = f.result.connections[0];
  const suffix = [
    {
      points: [
        { x: 35, y: 250 },
        { x: 65, y: 250 + 1e-12 },
      ],
    },
    {
      points: [
        { x: 65, y: 250 + 1e-12 },
        { x: 80, y: 250 },
      ],
    },
  ];
  e.sections = [
    {
      points: [
        { x: 450, y: 110 },
        { x: 460, y: 110 },
        { x: 460, y: 250 },
        { x: 35, y: 250 },
      ],
    },
    ...structuredClone(suffix),
  ];
  e.signalEndLabel = {
    bounds: { x: 35, y: 240, width: 30, height: 20 },
    position: { x: 50, y: 250, anchor: 'middle' },
  };
  routeContainerExits(f.result, f.model);
  assert.equal(e.routingInfo.containerExit.status, 'routed');
  for (const section of e.sections)
    for (let i = 1; i < section.points.length; i++) {
      const a = section.points[i - 1],
        b = section.points[i];
      assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6);
    }
  assert.deepEqual(e.sections.slice(-2), suffix);
});

test('an unavoidable new foreign crossing retains the existing route', () => {
  const f = fixture(),
    edge = f.result.connections[0];
  // The common ancestor blocks the lower detour; an upper escape would cross
  // this independent Net twice, whereas the baseline crosses it zero times.
  f.result.groups[0].height = 350;
  f.result.connections.push({
    id: 'foreign',
    netId: 'other',
    style: connectionStyle(null),
    sections: [
      {
        points: [
          { x: 0, y: 80 },
          { x: 700, y: 80 },
        ],
      },
    ],
  });
  const before = structuredClone(edge.sections);
  routeContainerExits(f.result, f.model);
  assert.deepEqual(edge.sections, before);
  assert.equal(edge.routingInfo.containerExit.reason, 'detour-or-crossing-budget');
});
