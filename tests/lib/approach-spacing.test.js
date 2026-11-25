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

function trappedRails(rotation = 0) {
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
  const side = (s) =>
    ['right', 'bottom', 'left', 'top'][(['right', 'bottom', 'left', 'top'].indexOf(s) + rotation) % 4];
  const model = createDiagramModel({
    version: 1,
    diagram: { name: 'Unplaced controls beside reserved channels' },
    modules: [
      {
        id: 'Control',
        ports: [
          { id: 'start', direction: 'output', side: side('right') },
          { id: 'data', direction: 'output', side: side('right') },
        ],
      },
      {
        id: 'Sender',
        ports: [
          { id: 'sample', direction: 'output', side: side('right') },
          { id: 'stop', direction: 'output', side: side('right') },
        ],
      },
      {
        id: 'Receiver',
        ports: ['start', 'sample', 'stop', 'data'].map((id) => ({
          id,
          direction: 'input',
          side: side('left'),
        })),
      },
    ],
    groups: [
      { id: 'Bank', members: ['Senders', 'Receivers'] },
      { id: 'Senders', members: ['Sender'] },
      { id: 'Receivers', members: ['Receiver'] },
    ],
    connections: [
      { id: 'Start', from: 'Control.start', to: [{ endpoint: 'Receiver.start', constraint: false }] },
      { id: 'Data', from: 'Control.data', to: [{ endpoint: 'Receiver.data', constraint: false }] },
      { id: 'Sample', from: 'Sender.sample', to: ['Receiver.sample'] },
      { id: 'Stop', from: 'Sender.stop', to: ['Receiver.stop'] },
    ],
  });
  const geometry = [
    {
      x: 0,
      y: 0,
      width: 140,
      height: 108,
      ports: [
        [140, 60],
        [140, 84],
      ],
    },
    {
      x: 476,
      y: 180,
      width: 308,
      height: 214,
      ports: [
        [784, 236],
        [784, 370],
      ],
    },
    {
      x: 863.5,
      y: 100,
      width: 308,
      height: 294,
      ports: [
        [863.5, 164],
        [863.5, 322],
        [863.5, 346],
        [863.5, 370],
      ],
    },
  ];
  const modules = model.modules.map((n, i) => ({
    ...n,
    ...box(geometry[i]),
    ports: n.ports.map((p, j) => ({
      ...p,
      ...point({ x: geometry[i].ports[j][0], y: geometry[i].ports[j][1] }),
    })),
  }));
  const frames = [
    { x: 176.5, y: 0, width: 1384.5, height: 918 },
    { x: 463, y: 130, width: 334, height: 751 },
    { x: 850.5, y: 46, width: 412, height: 859 },
  ];
  const groups = model.groups.map((g, i) => ({ ...g, ...box(frames[i]), ports: [] }));
  const paths = [
    [
      [140, 60],
      [832, 60],
      [832, 164],
      [863.5, 164],
    ],
    [
      [140, 84],
      [824.5, 84],
      [824.5, 370],
      [863.5, 370],
    ],
    [
      [784, 236],
      [823.75, 236],
      [823.75, 322],
      [863.5, 322],
    ],
    [
      [784, 370],
      [823.75, 370],
      [823.75, 346],
      [863.5, 346],
    ],
  ];
  const connections = model.connections.map((e, i) => ({
    ...e,
    sections: [{ points: paths[i].map(([x, y]) => point({ x, y })) }],
    ...(i >= 2 ? { routingInfo: { method: 'group-channel', channelStatus: 'routed' } } : {}),
  }));
  return { model, result: { modules, groups, terminals: [], connections }, point };
}

for (let rotation = 0; rotation < 4; rotation++)
  test(`atomic ordinary-rail repair separates unplaced input from reserved channels (${rotation})`, () => {
    const { model, result, point } = trappedRails(rotation),
      before = structuredClone(result),
      raw = structuredClone(model);
    assert.equal(parallelApproachIssues(result.connections).length, 2);
    separateApproachSpacing(result, model);
    assert.deepEqual(parallelApproachIssues(result.connections), []);
    assert.deepEqual(result.connections[1].sections[0].points[1], point({ x: 832, y: 84 }));
    assert.deepEqual(result.connections[0].sections[0].points[1], point({ x: 824.5, y: 60 }));
    assert.deepEqual(result.connections.slice(2), before.connections.slice(2));
    assert.deepEqual(result.modules, before.modules);
    assert.deepEqual(result.groups, before.groups);
    assert.deepEqual(model, raw);
    const stable = structuredClone(result);
    separateApproachSpacing(result, model);
    assert.deepEqual(result, stable);
  });

test('blocked companion rail rolls back the entire spacing batch', () => {
  const { model, result } = trappedRails();
  result.connections[0].routingInfo = { method: 'grid-channel', channelStatus: 'routed' };
  const before = structuredClone(result);
  separateApproachSpacing(result, model);
  assert.deepEqual(result, before);
});

test('a long parallel return and its incoming corner clear the other Net together', () => {
  // Two left-facing inputs share an approach column. The timer body below its
  // output and the start body below the return leave no room to spread downward.
  const model = createDiagramModel({
    version: 1,
    diagram: { name: 'Opposed return corners' },
    modules: [
      { id: 'Timer', ports: [{ id: 'out', direction: 'output' }] },
      {
        id: 'Done',
        ports: [
          { id: 'in', direction: 'input' },
          { id: 'out', direction: 'output' },
        ],
      },
      { id: 'Trigger', ports: [{ id: 'start', direction: 'input' }] },
    ],
    groups: [{ id: 'Bank', members: ['Timer', 'Done', 'Trigger'] }],
    connections: [
      { id: 'TimerDone', from: 'Timer.out', to: ['Done.in'] },
      { id: 'Start', from: 'Done.out', to: ['Trigger.start'] },
    ],
  });
  const shapes = [
    { x: 540, y: 58, width: 308, height: 84, ports: [[848, 118]] },
    {
      x: 40,
      y: 20.5,
      width: 308,
      height: 84,
      ports: [
        [40, 80.5],
        [348, 80.5],
      ],
    },
    { x: 40, y: 154.5, width: 308, height: 132, ports: [[40, 238.5]] },
  ];
  const paths = [
    [
      [848, 118],
      [894, 118],
      [894, 145],
      [15, 145],
      [15, 80.5],
      [40, 80.5],
    ],
    [
      [348, 80.5],
      [434, 80.5],
      [434, 146.5],
      [15, 146.5],
      [15, 238.5],
      [40, 238.5],
    ],
  ];
  const result = {
    modules: model.modules.map((m, i) => ({
      ...m,
      ...shapes[i],
      ports: m.ports.map((p, j) => ({ ...p, x: shapes[i].ports[j][0], y: shapes[i].ports[j][1] })),
    })),
    groups: [{ ...model.groups[0], x: 0, y: 0, width: 960, height: 320, ports: [] }],
    connections: model.connections.map((e, i) => ({
      ...e,
      sections: [{ points: paths[i].map(([x, y]) => ({ x, y })) }],
    })),
  };
  const [issue] = parallelApproachIssues(result.connections);
  assert.equal(issue.span, 419);
  assert.equal(issue.distance, 1.5);
  separateApproachSpacing(result, model);
  assert.deepEqual(parallelApproachIssues(result.connections), []);
  for (const [i, edge] of result.connections.entries()) {
    const points = edge.sections[0].points;
    assert.deepEqual(
      [points[0], points.at(-1)].map(({ x, y }) => [x, y]),
      [paths[i][0], paths[i].at(-1)],
    );
    for (const [p, q] of sectionSegments(edge.sections))
      assert.ok(result.modules.every((m) => !segmentCrossesInterior(p, q, m)));
  }
});
