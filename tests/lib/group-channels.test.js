import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramModel, layoutDiagram } from '../../src/lib/blockchart/index.js';
import { routeFixed } from '../../src/lib/blockchart/layout/fixed.js';
import { routeGroupChannels } from '../../src/lib/blockchart/layout/group-channels.js';
import { netRouteQuality } from '../../src/lib/blockchart/layout/route-quality.js';
import { readFileSync } from 'node:fs';
function fixture(direction = 'right', overlapping = false) {
  const down = direction === 'down',
    pt = (x, y) => (down ? { x: y, y: x } : { x, y });
  const box = (x, y, width, height) =>
    down ? { x: y, y: x, width: height, height: width } : { x, y, width, height };
  const sourceY = [40, overlapping ? 60 : 180],
    targetY = [overlapping ? 120 : 80, 140];
  const raw = {
    version: 1,
    diagram: { name: 'Sibling Container channels' },
    layout: { direction },
    modules: ['A', 'B', 'C', 'D'].map((id, i) => ({
      id,
      ports: [{ id: 'p', direction: i < 2 ? 'output' : 'input', style: { hidden: true } }],
    })),
    groups: [
      { id: 'Parent', members: ['Left', 'Right'] },
      { id: 'Left', members: ['A', 'B'] },
      { id: 'Right', members: ['C', 'D'] },
    ],
    connections: [
      { id: 'AC', from: 'A.p', to: ['C.p'], feedback: true },
      { id: 'BD', from: 'B.p', to: ['D.p'] },
    ],
  };
  const model = createDiagramModel(raw);
  const modules = model.modules.map((m, i) => ({
    ...m,
    ...box(i < 2 ? 20 : 240, (i < 2 ? sourceY[i] : targetY[i - 2]) - 10, 40, 20),
    ports: [
      {
        ...m.ports[0],
        ...pt(i < 2 ? 60 : 240, i < 2 ? sourceY[i] : targetY[i - 2]),
        side: i < 2 ? (down ? 'bottom' : 'right') : down ? 'top' : 'left',
      },
    ],
  }));
  const groups = model.groups.map((g) => ({
    ...g,
    ...(g.id === 'Parent'
      ? box(0, 0, 320, 230)
      : box(g.id === 'Left' ? 10 : 210, 10, g.id === 'Left' ? 100 : 100, 200)),
  }));
  const connections = model.connections.map((e, i) => ({
    ...e,
    sections: [
      { points: [pt(60, sourceY[i]), pt(228, sourceY[i]), pt(228, targetY[i]), pt(240, targetY[i])] },
    ],
  }));
  return { raw, model, result: { modules, groups, terminals: [], connections }, axis: down ? 'y' : 'x' };
}
for (const direction of ['right', 'down'])
  for (const overlapping of [false, true])
    test(`inter-Container tracks stay outside frames and separate conflicting spans (${direction}, ${overlapping})`, () => {
      const f = fixture(direction, overlapping),
        geometry = structuredClone({ modules: f.result.modules, groups: f.result.groups }),
        model = structuredClone(f.model),
        before = netRouteQuality(f.result);
      routeGroupChannels(f.result, f.model);
      const [a, b] = f.result.connections;
      assert.equal(a.routingInfo.method, 'group-channel');
      assert.equal(b.routingInfo.method, 'group-channel');
      const coordinates = f.result.connections.map((e) => {
        const p = e.sections[0].points;
        assert.equal(p.length, 4);
        assert.ok(p[1][f.axis] > 119 && p[1][f.axis] < 201);
        assert.equal(p[1][f.axis], p[2][f.axis]);
        return p[1][f.axis];
      });
      if (overlapping) assert.ok(Math.abs(coordinates[0] - coordinates[1]) >= 7.5);
      else assert.equal(coordinates[0], coordinates[1]);
      const after = netRouteQuality(f.result);
      assert.ok(after.length <= before.length + 1e-6);
      assert.ok(after.bends <= before.bends);
      assert.equal(after.overlaps, 0);
      assert.deepEqual({ modules: f.result.modules, groups: f.result.groups }, geometry);
      assert.deepEqual(f.model, model);
      const saved = structuredClone(f.result);
      routeGroupChannels(f.result, f.model);
      assert.deepEqual(f.result, saved);
    });
for (const reason of [
  'boundary',
  'collapsed',
  'collection',
  'bidirectional',
  'reserved',
  'outer',
  'wrong-side',
  'narrow',
  'obstacle',
  'terminal',
  'foreign-contact',
])
  test(`unsafe/ineligible group routes keep their baseline: ${reason}`, () => {
    const f = fixture();
    const left = f.model.groups.find((g) => g.id === 'Left'),
      frame = f.result.groups.find((g) => g.id === 'Left');
    if (reason === 'boundary') left.portMode = frame.portMode = 'boundary';
    if (reason === 'collapsed') left.collapsed = frame.collapsed = true;
    if (reason === 'collection') left.type = frame.type = 'collection';
    if (reason === 'bidirectional') for (const e of f.model.connections) e.netStyle.startArrow = 'triangle';
    if (reason === 'reserved')
      for (const e of f.result.connections)
        e.routingInfo = { method: 'grid-channel', channelStatus: 'routed' };
    if (reason === 'outer') for (const e of f.result.connections) e.routingInfo = { method: 'outer-aabb' };
    if (reason === 'wrong-side') for (const n of f.result.modules) n.ports[0].side = 'top';
    if (reason === 'narrow') frame.width = 195;
    if (reason === 'obstacle')
      f.result.modules.push({ id: 'ForeignBody', x: 112, y: 15, width: 95, height: 200, ports: [] });
    if (reason === 'terminal')
      f.result.terminals.push({
        id: 'Text',
        style: { hidden: false },
        labelBounds: { x: 112, y: 15, width: 95, height: 200 },
      });
    if (reason === 'foreign-contact')
      f.result.connections.push({
        ...structuredClone(f.result.connections[0]),
        id: 'Foreign',
        netId: 'Foreign',
        sections: [
          {
            points: [
              { x: 115, y: 60 },
              { x: 205, y: 60 },
            ],
          },
        ],
      });
    const before = structuredClone(f.result);
    routeGroupChannels(f.result, f.model);
    assert.deepEqual(f.result, before);
  });
test('channels separate pre-existing coincident corridor rails instead of treating them as compliant', () => {
  const f = fixture('right', true);
  for (const e of f.result.connections) for (const p of e.sections[0].points.slice(1, -1)) p.x = 160;
  assert.ok(netRouteQuality(f.result).overlaps > 0);
  routeGroupChannels(f.result, f.model);
  assert.equal(netRouteQuality(f.result).overlaps, 0);
  assert.equal(f.result.connections[0].routingInfo.method, 'group-channel');
});
test('the public scoped pipeline applies group channels while preserving authored Grid order and source JSON', async () => {
  const raw = JSON.parse(
      readFileSync(new URL('../fixtures/blockchart/scoped-peripheral-input.json', import.meta.url), 'utf8'),
    ),
    saved = structuredClone(raw),
    model = createDiagramModel(raw),
    snapshot = structuredClone(model);
  const r = await layoutDiagram(model, { rootGroupId: 'Device' });
  const from = r.groups.find((g) => g.id === 'Controllers'),
    to = r.groups.find((g) => g.id === 'Workers');
  for (const name of ['StartEvent', 'StopEvent']) {
    const e = r.connections.find((e) => e.source.moduleId === name);
    assert.equal(e.routingInfo.method, 'group-channel');
    const p = e.sections[0].points;
    assert.ok(p[1].x > from.x + from.width && p[1].x < to.x);
  }
  const stopNet = r.connections.filter((e) => e.source.moduleId === 'ReceiveComplete');
  const timerStop = stopNet.find((e) => e.target.moduleId === 'ReceiveDelay');
  const fifoStop = stopNet.find((e) => e.target.moduleId === 'CaptureQueue');
  assert.equal(timerStop.routingInfo.method, 'group-channel');
  assert.ok(
    timerStop.sections[0].points[1].x > from.x + from.width && timerStop.sections[0].points[1].x < to.x,
  );
  assert.equal(fifoStop.sections[0].points.length, 2, 'aligned fanout stays straight');
  assert.equal(timerStop.netId, fifoStop.netId);
  const y = (id) => r.modules.find((n) => n.id === id).y;
  assert.ok(y('StartEvent') < y('StopEvent'));
  assert.ok(y('Clock') < y('TransmitQueue'));
  assert.deepEqual(raw, saved);
  assert.deepEqual(model, snapshot);
  assert.deepEqual(r.warnings ?? [], []);
});
for (const direction of ['right', 'down'])
  test(`non-constraining fanout shares one channel and preserves straight/internal branches (${direction})`, () => {
    const f = fixture(direction),
      cross = f.axis === 'x' ? 'y' : 'x';
    const source = f.result.modules[0].ports[0],
      target = f.result.modules[3].ports[0];
    target[cross] = source[cross];
    f.result.modules[3][cross] = target[cross] - 10;
    const first = f.model.connections[0],
      second = f.model.connections[1];
    f.model.connections = [
      { ...first, id: 'Shared_0', constraint: false },
      { ...first, id: 'Shared_1', constraint: false, target: second.target },
    ];
    f.result.connections = [
      { ...f.result.connections[0], ...f.model.connections[0] },
      {
        ...f.result.connections[1],
        ...f.model.connections[1],
        sections: [
          {
            points: [
              { x: source.x, y: source.y },
              { x: target.x, y: target.y },
            ],
          },
        ],
        routingInfo: { method: 'elk', reason: 'straight' },
      },
    ];
    const internal = { ...structuredClone(f.result.modules[2]), id: 'Internal' };
    internal[f.axis] = 20;
    internal[cross] = 140;
    internal.ports[0][f.axis] = 20;
    internal.ports[0][cross] = 150;
    f.model.modules.push({ ...structuredClone(f.model.modules[2]), id: 'Internal' });
    f.result.modules.push(internal);
    f.model.groups.find((g) => g.id === 'Left').members.push('Internal');
    const internalRef = {
      ...first,
      id: 'Shared_2',
      constraint: false,
      target: { moduleId: 'Internal', portId: 'p' },
    };
    f.model.connections.push(internalRef);
    const turn = { ...source, [f.axis]: 80 },
      turn2 = { ...internal.ports[0], [f.axis]: 80 };
    f.result.connections.push({
      ...internalRef,
      sections: [
        {
          points: [
            { x: source.x, y: source.y },
            { x: turn.x, y: turn.y },
            { x: turn2.x, y: turn2.y },
            { x: internal.ports[0].x, y: internal.ports[0].y },
          ],
        },
      ],
    });
    const straight = structuredClone(f.result.connections[1]),
      inside = structuredClone(f.result.connections[2]),
      model = structuredClone(f.model);
    routeGroupChannels(f.result, f.model);
    assert.equal(f.result.connections[0].routingInfo.method, 'group-channel');
    assert.equal(f.result.connections[0].routingInfo.channelTrackCount, 1);
    assert.deepEqual(f.result.connections[1], straight);
    assert.deepEqual(f.result.connections[2], inside);
    assert.deepEqual(f.model, model);
    const once = structuredClone(f.result);
    routeGroupChannels(f.result, f.model);
    assert.deepEqual(f.result, once);
  });

test('strong and non-constraining demands allocate together independent of declaration order', () => {
  const a = fixture('right', true),
    b = fixture('right', true);
  a.model.connections[1].constraint = false;
  b.model.connections[1].constraint = false;
  b.model.connections.reverse();
  b.result.connections.reverse();
  routeGroupChannels(a.result, a.model);
  routeGroupChannels(b.result, b.model);
  const routes = (r) =>
    r.connections
      .map((e) => ({ id: e.id, sections: e.sections, routingInfo: e.routingInfo }))
      .sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(routes(a.result), routes(b.result));
  assert.ok(a.result.connections.every((e) => e.routingInfo?.channelTrackCount === 2));
  assert.equal(netRouteQuality(a.result).overlaps, 0);
});

test('an earlier group-channel plan is jointly reassigned when another Net joins the corridor', () => {
  const f = fixture('right', true);
  f.model.connections[1].constraint = false;
  const first = f.result.connections[0];
  for (const p of first.sections[0].points.slice(1, -1)) p.x = 160;
  first.routingInfo = {
    method: 'group-channel',
    reason: 'inter-container',
    channelStatus: 'routed',
    channelTrack: 0,
    channelTrackCount: 1,
  };
  const previousCoordinate = first.sections[0].points[1].x;
  routeGroupChannels(f.result, f.model);
  assert.ok(f.result.connections.every((e) => e.routingInfo?.channelTrackCount === 2));
  assert.equal(first, f.result.connections[0]);
  assert.notEqual(previousCoordinate, f.result.connections[0].sections[0].points[1].x);
  assert.equal(netRouteQuality(f.result).overlaps, 0);
});

test('shared collection cannot steal a foreign reservation without a matching planner offer', () => {
  const f = fixture('right', true);
  for (const edge of f.result.connections)
    edge.routingInfo = { method: 'grid-channel', channelStatus: 'routed', channelTrack: 0 };
  const before = structuredClone(f.result);
  routeFixed(f.result, f.model, { strategy: 'shared-channels' });
  assert.deepEqual(f.result, before);
});
