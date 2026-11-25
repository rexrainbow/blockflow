import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramModel } from '../../src/lib/blockchart/index.js';
import { distributeCorridorRails } from '../../src/lib/blockchart/layout/corridor-distribution.js';
import { parallelApproachIssues } from '../../src/lib/blockchart/layout/approach-spacing.js';
import { netRouteQuality } from '../../src/lib/blockchart/layout/route-quality.js';
import { segmentCrossesInterior, sectionSegments } from '../../src/lib/blockchart/layout/routing-geometry.js';

function fixture(rotation = 0, strokeWidth = 1.5) {
  const point = (p) => {
    let { x, y } = p;
    for (let i = 0; i < rotation; i++) [x, y] = [-y, x];
    return { x, y };
  };
  const box = (b) => {
    const a = point(b),
      z = point({ x: b.x + b.width, y: b.y + b.height });
    return {
      ...b,
      x: Math.min(a.x, z.x),
      y: Math.min(a.y, z.y),
      width: Math.abs(a.x - z.x),
      height: Math.abs(a.y - z.y),
    };
  };
  // Two rotations cover both supported primary flow directions.
  const side = (s) =>
    ['right', 'bottom', 'left', 'top'][(['right', 'bottom', 'left', 'top'].indexOf(s) + rotation) % 4];
  const raw = {
    version: 1,
    diagram: { name: 'Physical corridor', style: { connection: { strokeWidth } } },
    layout: { direction: rotation % 2 ? 'down' : 'right' },
    modules: [
      { id: 'Source', ports: ['a', 'b'].map((id) => ({ id, direction: 'output', side: side('right') })) },
      {
        id: 'Sink',
        ports: ['a', 'b', 'external'].map((id) => ({ id, direction: 'input', side: side('left') })),
      },
      { id: 'External', ports: [{ id: 'out', direction: 'output', side: side('right') }] },
    ],
    groups: [
      { id: 'Left', members: ['Source'] },
      { id: 'Right', members: ['Sink'] },
    ],
    connections: [
      { id: 'A', from: 'Source.a', to: ['Sink.a'] },
      { id: 'B', from: 'Source.b', to: ['Sink.b'] },
      { id: 'Control', from: 'External.out', to: [{ endpoint: 'Sink.external', constraint: false }] },
    ],
  };
  const model = createDiagramModel(raw);
  const geometry = [
    {
      x: 20,
      y: 50,
      width: 60,
      height: 70,
      ports: [
        [80, 80],
        [80, 100],
      ],
    },
    {
      x: 240,
      y: 160,
      width: 60,
      height: 80,
      ports: [
        [240, 180],
        [240, 200],
        [240, 220],
      ],
    },
    { x: -80, y: -40, width: 40, height: 40, ports: [[-40, -20]] },
  ];
  const modules = model.modules.map((n, i) => ({
    ...n,
    ...box(geometry[i]),
    ports: n.ports.map((p, j) => ({
      ...p,
      ...point({ x: geometry[i].ports[j][0], y: geometry[i].ports[j][1] }),
    })),
  }));
  const groups = model.groups.map((g, i) => ({
    ...g,
    ...box({ x: i ? 220 : 0, y: 0, width: 100, height: 300 }),
    ports: [],
  }));
  const paths = [
    [
      [80, 80],
      [200, 80],
      [200, 180],
      [240, 180],
    ],
    [
      [80, 100],
      [190, 100],
      [190, 200],
      [240, 200],
    ],
    [
      [-40, -20],
      [206, -20],
      [206, 220],
      [240, 220],
    ],
  ];
  const connections = model.connections.map((e, i) => ({
    ...e,
    sections: [{ points: paths[i].map(([x, y]) => point({ x, y })) }],
  }));
  return { raw, model, result: { modules, groups, terminals: [], connections }, point, box };
}
const rail = (edge, axis = 'x') => edge.sections[0].points[1][axis];

for (const rotation of [0, 1])
  test(`external receiver entry shares the gap while a foreign rail keeps its clearance (${rotation})`, () => {
    const { result, model, point } = fixture(rotation);
    const path = (coords) => coords.map(([x, y]) => point({ x, y }));
    const external = result.connections[2];
    // Cross the receiving face at 220, then turn at 224 inside the frame.
    external.sections[0].points = path([
      [-40, -20],
      [-25, -20],
      [-25, 27],
      [224, 27],
      [224, 220],
      [240, 220],
    ]);
    // A stationary foreign rail in the gap would conflict with the two-track
    // distribution that omits the external input.
    const sink = result.modules[1];
    sink.ports.push(
      { ...sink.ports[0], id: 'loopOut', direction: 'output', ...point({ x: 240, y: 161 }) },
      { ...sink.ports[0], id: 'loopIn', ...point({ x: 240, y: 170 }) },
    );
    const fixed = {
      ...result.connections[0],
      id: 'Fixed',
      netId: 'Fixed',
      source: { moduleId: 'Sink', portId: 'loopOut' },
      target: { moduleId: 'Sink', portId: 'loopIn' },
      sections: [
        {
          points: path([
            [240, 161],
            [142, 161],
            [142, 170],
            [240, 170],
          ]),
        },
      ],
    };
    result.connections.push(fixed);
    const saved = structuredClone(fixed);
    const quality = netRouteQuality(result);
    distributeCorridorRails(result, model);
    const axis = rotation ? 'y' : 'x';
    const rails = result.connections
      .slice(0, 3)
      .map((edge) => {
        const [record] = edge.routingInfo.distributedCorridors;
        assert.equal(record.count, 3);
        return edge.sections[record.section].points[record.index][axis];
      })
      .sort((a, b) => a - b);
    assert.ok(Math.abs(rails[2] - rails[1] - (rails[1] - rails[0])) < 1e-6);
    assert.ok(rails[0] < 160 && rails[2] < 220 - 12);
    assert.deepEqual(external.sections[0].points.at(-1), point({ x: 240, y: 220 }));
    assert.deepEqual(fixed, saved);
    assert.deepEqual(parallelApproachIssues(result.connections), []);
    const final = netRouteQuality(result);
    assert.equal(final.length, quality.length);
    assert.ok(final.crossings <= quality.crossings && final.bends <= quality.bends && !final.overlaps);
  });

test('an inside rail stays put for a deep, internal or non-final detour', () => {
  for (const kind of ['deep', 'internal', 'non-final']) {
    const { result, model } = fixture();
    const edge = result.connections[2];
    const x = kind === 'deep' ? 234 : 224;
    const points = edge.sections[0].points;
    points.splice(1, 2, { x: -25, y: -20 }, { x: -25, y: 27 }, { x, y: 27 }, { x, y: 220 });
    if (kind === 'internal') model.groups[1].members.push('External');
    if (kind === 'non-final')
      edge.sections.push({
        points: [
          { x: 240, y: 220 },
          { x: 250, y: 220 },
        ],
      });
    const saved = structuredClone(edge);
    distributeCorridorRails(result, model);
    assert.deepEqual(edge, saved, kind);
  }
});

for (const rotation of [0, 1])
  for (const width of [1.5, 6])
    test(`physical rails spread with external non-placement input (${rotation}, width ${width})`, () => {
      const { model, result } = fixture(rotation, width),
        before = structuredClone(result),
        saved = structuredClone(model);
      const q = netRouteQuality(result);
      distributeCorridorRails(result, model);
      const axis = rotation ? 'y' : 'x';
      const positions = result.connections.map((e) => rail(e, axis)).sort((a, b) => a - b);
      assert.ok(positions[0] < 160, 'use the previously empty left half');
      assert.ok(positions[1] - positions[0] > positions[2] - positions[1] - 1e-6);
      assert.ok(Math.abs(positions[1] - positions[0] - (positions[2] - positions[1])) < 1e-6);
      assert.ok(result.connections.every((e) => e.routingInfo.distributedCorridors.length === 1));
      assert.deepEqual(parallelApproachIssues(result.connections), []);
      assert.deepEqual(netRouteQuality(result), q);
      assert.deepEqual(result.modules, before.modules);
      assert.deepEqual(result.groups, before.groups);
      assert.deepEqual(model, saved);
      assert.equal(result.connections[2].constraint, false);
      for (let i = 0; i < result.connections.length; i++) {
        assert.deepEqual(
          result.connections[i].sections[0].points[0],
          before.connections[i].sections[0].points[0],
        );
        assert.deepEqual(
          result.connections[i].sections[0].points.at(-1),
          before.connections[i].sections[0].points.at(-1),
        );
      }
      const stable = structuredClone(result);
      distributeCorridorRails(result, model);
      assert.deepEqual(result, stable);
    });

test('input ordering does not change allocations or mutate private placement plans', () => {
  const a = fixture(),
    b = fixture();
  const plan = { nodes: [a.result.modules[0]], token: {} };
  a.result._gridChannels = [plan];
  b.result.connections.reverse();
  b.result.groups.reverse();
  b.model.groups.reverse();
  distributeCorridorRails(a.result, a.model);
  distributeCorridorRails(b.result, b.model);
  const sorted = (r) => [...r.connections].sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(sorted(a.result), sorted(b.result));
  assert.equal(a.result._gridChannels[0], plan);
  assert.equal(plan.nodes[0], a.result.modules[0]);
});

test('an obstructed distribution rolls back every wire in the corridor', () => {
  const { model, result } = fixture();
  result.modules.push({ id: 'Obstacle', x: 150, y: 130, width: 20, height: 20, ports: [] });
  const before = structuredClone(result);
  distributeCorridorRails(result, model);
  assert.deepEqual(result, before);
});

test('insufficient spacing retains geometry and diagnostics without partial allocation', () => {
  const { model, result } = fixture(0, 50),
    before = structuredClone(result);
  distributeCorridorRails(result, model);
  assert.deepEqual(result, before);
});

test('reserved Auto/Grid channels and outer feedback remain fixed obstacles', () => {
  for (const reservation of [
    { method: 'grid-channel', channelStatus: 'routed' },
    { method: 'auto-channel', channelStatus: 'routed' },
    { method: 'outer-aabb' },
  ]) {
    const { model, result } = fixture();
    result.connections[0].routingInfo = reservation;
    const frozen = structuredClone(result.connections[0]);
    distributeCorridorRails(result, model);
    assert.deepEqual(result.connections[0], frozen);
    assert.deepEqual(parallelApproachIssues(result.connections), []);
  }
});

test('Boundary, Collection and collapsed scopes never become distribution corridors', () => {
  for (const change of [{ portMode: 'boundary' }, { type: 'collection' }, { collapsed: true }]) {
    const { model, result } = fixture();
    Object.assign(model.groups[0], change);
    Object.assign(result.groups[0], change);
    const before = structuredClone(result);
    distributeCorridorRails(result, model);
    assert.deepEqual(result, before);
  }
});

test('pinned source-name sections and label geometry are never moved', () => {
  const { model, result } = fixture();
  const edge = result.connections[2];
  edge.netTrunkSections = 1;
  const label = { bounds: { x: 0, y: -30, width: 80, height: 20 }, position: { x: 40, y: -20 } };
  edge.signalLabel = label;
  const frozen = structuredClone(edge);
  distributeCorridorRails(result, model);
  assert.deepEqual(edge, frozen);
  assert.equal(edge.signalLabel, label);
});

test('different Nets can reuse one centered rail when their intervals do not overlap', () => {
  const { model, result } = fixture();
  result.connections.pop();
  const b = result.connections[1];
  b.sections[0].points = [
    { x: 80, y: 240 },
    { x: 190, y: 240 },
    { x: 190, y: 280 },
    { x: 240, y: 280 },
  ];
  result.modules[0].height = 240;
  result.modules[0].ports[1].y = 240;
  result.modules[1].height = 140;
  result.modules[1].ports[1].y = 280;
  distributeCorridorRails(result, model);
  assert.equal(rail(result.connections[0]), 160);
  assert.equal(rail(b), 160);
  assert.deepEqual(parallelApproachIssues(result.connections), []);
});

test('same-Net fanout uses one shared rail and stable branch addresses', () => {
  const { model, result } = fixture();
  const original = result.connections[0],
    branch = structuredClone(original);
  branch.id = 'A_branch';
  branch.target.portId = 'extra';
  branch.sections[0].points.at(-2).y = 190;
  branch.sections[0].points.at(-1).y = 190;
  result.modules[1].ports.push({ ...result.modules[1].ports[0], id: 'extra', y: 190 });
  result.connections.push(branch);
  distributeCorridorRails(result, model);
  assert.ok(original.routingInfo.distributedCorridors.length);
  assert.equal(rail(original), rail(branch));
  assert.equal(
    original.routingInfo.distributedCorridors[0].track,
    branch.routingInfo.distributedCorridors[0].track,
  );
  assert.deepEqual(parallelApproachIssues(result.connections), []);
});

test('a foreign pinned label blocks newly entering strokes without moving the label', () => {
  const { model, result } = fixture();
  const label = { bounds: { x: 150, y: 130, width: 20, height: 20 } };
  result.connections[0].signalEndLabel = label;
  const frozen = structuredClone(result);
  distributeCorridorRails(result, model);
  assert.deepEqual(result, frozen);
  assert.equal(result.connections[0].signalEndLabel, label);
  for (const e of result.connections)
    for (const [a, b] of sectionSegments(e.sections))
      assert.equal(segmentCrossesInterior(a, b, label.bounds), false);
});

test('one branch can receive independent segment edits from two physical corridors', () => {
  const { model, result } = fixture();
  const last = {
    ...model.modules[1],
    id: 'Last',
    x: 460,
    y: 200,
    width: 60,
    height: 80,
    ports: [
      { ...result.modules[1].ports[0], id: 'a', x: 460, y: 220 },
      { ...result.modules[1].ports[0], id: 'later', x: 460, y: 260 },
    ],
  };
  result.modules.push(last);
  model.modules.push({ ...model.modules[1], id: 'Last' });
  const g = { ...model.groups[1], id: 'LastFrame', members: ['Last'] };
  model.groups.push(g);
  result.groups.push({ ...g, x: 440, y: 0, width: 100, height: 300, ports: [] });
  const a = result.connections[0];
  a.target = { moduleId: 'Last', portId: 'a' };
  a.sections[0].points = [
    { x: 80, y: 80 },
    { x: 200, y: 80 },
    { x: 200, y: 140 },
    { x: 420, y: 140 },
    { x: 420, y: 220 },
    { x: 460, y: 220 },
  ];
  const source = {
    ...result.modules[1].ports[0],
    id: 'out',
    direction: 'output',
    side: 'right',
    x: 300,
    y: 180,
  };
  result.modules[1].ports.push(source);
  const e = {
    ...structuredClone(result.connections[1]),
    id: 'Later',
    netId: 'Later',
    source: { moduleId: 'Sink', portId: 'out' },
    target: { moduleId: 'Last', portId: 'later' },
    sections: [
      {
        points: [
          { x: 300, y: 180 },
          { x: 410, y: 180 },
          { x: 410, y: 260 },
          { x: 460, y: 260 },
        ],
      },
    ],
  };
  result.connections.push(e);
  const before = structuredClone(result),
    q = netRouteQuality(result);
  distributeCorridorRails(result, model);
  assert.equal(a.routingInfo.distributedCorridors.length, 2);
  assert.notEqual(a.sections[0].points[1].x, 200);
  assert.notEqual(a.sections[0].points[3].x, 420);
  assert.deepEqual(result.modules, before.modules);
  assert.deepEqual(result.groups, before.groups);
  assert.deepEqual(netRouteQuality(result), q);
  assert.deepEqual(parallelApproachIssues(result.connections), []);
});
