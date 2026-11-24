import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramModel } from '../../src/lib/blockchart/index.js';
import {
  separateApproachSpacing,
  parallelApproachIssues,
} from '../../src/lib/blockchart/layout/approach-spacing.js';
import { wireClearance } from '../../src/lib/blockchart/layout/routing-spacing.js';
import { sectionSegments, segmentCrossesInterior } from '../../src/lib/blockchart/layout/routing-geometry.js';
function fixture(rotation = 0, width = 1.5) {
  const point = (p) => {
    let { x, y } = p;
    for (let i = 0; i < rotation; i++) [x, y] = [-y, x];
    return { x, y };
  };
  const box = (b) => {
    const a = point(b),
      c = point({ x: b.x + b.width, y: b.y + b.height });
    return {
      ...b,
      x: Math.min(a.x, c.x),
      y: Math.min(a.y, c.y),
      width: Math.abs(a.x - c.x),
      height: Math.abs(a.y - c.y),
    };
  };
  const side = (value) => {
    const sides = ['right', 'bottom', 'left', 'top'];
    return sides[(sides.indexOf(value) + rotation) % 4];
  };
  const port = (id, direction) => ({ id, direction, side: side(direction === 'output' ? 'right' : 'left') });
  const model = createDiagramModel({
    version: 1,
    diagram: { name: 'Separated approach corners', style: { connection: { strokeWidth: width } } },
    modules: [
      { id: 'Source', ports: [port('out', 'output')] },
      { id: 'Upper', ports: [port('in', 'input'), port('stop', 'input')] },
      { id: 'Lower', ports: [port('in', 'input')] },
      { id: 'Controller', ports: [port('out', 'output')] },
    ],
    groups: [
      { id: 'SourceFrame', members: ['Source'] },
      { id: 'UpperFrame', members: ['Upper'] },
    ],
    connections: [
      { id: 'Data', from: 'Source.out', to: ['Upper.in', 'Lower.in'] },
      {
        id: 'Stop',
        from: 'Controller.out',
        to: [{ endpoint: 'Upper.stop', feedback: true, constraint: false }],
      },
    ],
  });
  const coords = {
    Source: { x: 200, y: 270, width: 40, height: 60 },
    Upper: { x: 320, y: 180, width: 100, height: 110 },
    Lower: { x: 550, y: 380, width: 100, height: 80 },
    Controller: { x: 440, y: 380, width: 60, height: 40 },
  };
  const ports = {
    Source: [{ x: 240, y: 300 }],
    Upper: [
      { x: 320, y: 200 },
      { x: 320, y: 270 },
    ],
    Lower: [{ x: 550, y: 400 }],
    Controller: [{ x: 500, y: 400 }],
  };
  const modules = model.modules.map((n) => ({
    ...n,
    ...box(coords[n.id]),
    ports: n.ports.map((p, i) => ({ ...p, ...point(ports[n.id][i]) })),
  }));
  const groups = model.groups.map((g) => ({
    ...g,
    ...box(
      g.id === 'SourceFrame'
        ? { x: 188, y: 234, width: 64, height: 109 }
        : { x: 307, y: 144, width: 126, height: 159 },
    ),
  }));
  const paths = [
    [
      [240, 300],
      [270, 300],
      [270, 200],
      [320, 200],
    ],
    [
      [240, 300],
      [290, 300],
      [290, 450],
      [530, 450],
      [530, 400],
      [550, 400],
    ],
    [
      [500, 400],
      [506, 400],
      [506, 301],
      [286, 301],
      [286, 270],
      [320, 270],
    ],
  ];
  const connections = model.connections.map((e, i) => ({
    ...e,
    sections: [{ points: paths[i].map(([x, y]) => point({ x, y })) }],
    routingInfo:
      i === 0
        ? { method: 'group-channel', channelStatus: 'routed', channelTrack: 0 }
        : { method: 'fixed-orthogonal' },
  }));
  return { model, result: { modules, groups, terminals: [], connections }, point, box };
}
for (const width of [1.5, 6])
  for (let rotation = 0; rotation < 4; rotation++)
    test(`near corner spacing reuses a same-Net fork and keeps geometry (${rotation}, stroke ${width})`, () => {
      const { model, result, point } = fixture(rotation, width),
        before = structuredClone(result),
        saved = structuredClone(model);
      assert.ok(parallelApproachIssues(result.connections).length > 0);
      separateApproachSpacing(result, model);
      assert.deepEqual(parallelApproachIssues(result.connections), []);
      assert.deepEqual(result.modules, before.modules);
      assert.deepEqual(result.groups, before.groups);
      assert.deepEqual(model, saved);
      assert.deepEqual(result.connections[0], before.connections[0]);
      const data = result.connections[1];
      assert.deepEqual(data.sections[0].points[1], point({ x: 270, y: 300 }));
      assert.equal(data.routingInfo.approachSpacing, 'separated');
      for (let i = 0; i < result.connections.length; i++) {
        const next = result.connections[i],
          old = before.connections[i];
        assert.deepEqual(next.sections[0].points[0], old.sections[0].points[0]);
        assert.deepEqual(next.sections.at(-1).points.at(-1), old.sections.at(-1).points.at(-1));
      }
      const stable = structuredClone(result);
      separateApproachSpacing(result, model);
      assert.deepEqual(result, stable);
    });
test('stroke-aware spacing includes short positive overlap at a corner', () => {
  const { result } = fixture(),
    issues = parallelApproachIssues(result.connections);
  assert.ok(issues.some((i) => i.distance === 1 && i.span === 4));
  assert.ok(issues.some((i) => i.distance === 4 && i.span === 1));
  assert.equal(wireClearance(result.connections[1], result.connections[2]), 7.5);
});
test('shared same-Net strokes and shared fixed endpoint attachments stay intentional', () => {
  const { model, result } = fixture();
  result.connections[2].netId = result.connections[0].netId;
  const before = structuredClone(result);
  assert.deepEqual(parallelApproachIssues(result.connections), []);
  separateApproachSpacing(result, model);
  assert.deepEqual(result, before);
  const edge = (id) => ({
    id,
    netId: id,
    style: { strokeWidth: 2 },
    sections: [
      {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
        ],
      },
    ],
  });
  assert.deepEqual(parallelApproachIssues([edge('A'), edge('B')]), []);
});
test('explicit reservations and outer feedback routes are never moved', () => {
  const { model, result } = fixture();
  result.connections[1].routingInfo = { method: 'grid-channel', channelStatus: 'routed' };
  result.connections[2].routingInfo = { method: 'outer-aabb' };
  const before = structuredClone(result);
  separateApproachSpacing(result, model);
  assert.deepEqual(result, before);
});
test('protected endpoint ancestors keep their valid baseline', () => {
  const { model, result } = fixture();
  for (const g of model.groups) g.portMode = 'boundary';
  const before = structuredClone(result);
  separateApproachSpacing(result, model);
  assert.deepEqual(result, before);
});
test('a pinned label blocks reuse of its occupied corridor without being moved', () => {
  const { model, result } = fixture(),
    bounds = { x: 260, y: 320, width: 20, height: 70 };
  result.connections[2].signalLabel = { bounds: { ...bounds }, position: { x: 270, y: 355 } };
  const label = structuredClone(result.connections[2].signalLabel),
    before = structuredClone(result.modules);
  separateApproachSpacing(result, model);
  assert.deepEqual(result.connections[2].signalLabel, label);
  assert.deepEqual(result.modules, before);
  for (const e of result.connections)
    for (const [a, b] of sectionSegments(e.sections))
      assert.equal(segmentCrossesInterior(a, b, bounds), false);
});
test('a lone clear route is a geometry and routing no-op', () => {
  const { model, result } = fixture();
  result.connections = result.connections.slice(0, 1);
  const before = structuredClone(result);
  separateApproachSpacing(result, model);
  assert.deepEqual(result, before);
});
test('repair retains an existing exterior gate even inside a shared ordinary Container', () => {
  const { model, result } = fixture();
  model.groups.push({
    id: 'Shared',
    type: 'container',
    portMode: 'direct',
    members: ['UpperFrame', 'Lower', 'Controller'],
  });
  result.groups.push({
    id: 'Shared',
    type: 'container',
    portMode: 'direct',
    x: 307,
    y: 144,
    width: 360,
    height: 340,
    members: ['UpperFrame', 'Lower', 'Controller'],
    ports: [],
  });
  result.connections[1].routingInfo = { method: 'grid-channel', channelStatus: 'routed' };
  const fixed = structuredClone({
    modules: result.modules,
    groups: result.groups,
    reserved: result.connections.slice(0, 2),
  });
  separateApproachSpacing(result, model);
  const last = result.connections[2].sections.at(-1).points.at(-2);
  assert.ok(307 - last.x >= 12 - 1e-6);
  assert.deepEqual(
    { modules: result.modules, groups: result.groups, reserved: result.connections.slice(0, 2) },
    fixed,
  );
});
