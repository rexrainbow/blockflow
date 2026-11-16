import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { autoBands, planAutoChannels } from '../../src/lib/blockchart/layout/auto-channels.js';
import { channelAssignments, parallelOverlap } from '../../src/lib/blockchart/layout/grid-channels.js';
import { groupGeometry } from '../../src/lib/blockchart/layout/groups.js';

const example = JSON.parse(
  await readFile(new URL('../../examples/blockchart/auto-routing-channels.json', import.meta.url), 'utf8'),
);
const parts = (edge) => edge.sections.flatMap((s) => s.points.slice(1).map((p, i) => [s.points[i], p]));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);

test('geometric bands merge overlapping different-height envelopes, not merely equal top coordinates', () => {
  const nodes = [
    { id: 'a', x: 0, y: 40, width: 20, height: 40 },
    { id: 'b', x: 30, y: 0, width: 20, height: 80 },
    { id: 'c', x: 0, y: 90, width: 20, height: 20 },
  ];
  const before = structuredClone(nodes),
    bands = autoBands(nodes, 'y');
  assert.deepEqual(
    bands.map((b) => b.nodes.map((n) => n.id)),
    [['b', 'a'], ['c']],
  );
  assert.deepEqual(nodes, before);
});

function synthetic(gap = 8) {
  const raw = structuredClone(example);
  raw.groups = [raw.groups[0]];
  raw.modules = raw.modules.filter((n) => !['InputBuffer', 'OutputBuffer', 'Audit'].includes(n.id));
  raw.groups[0].members = raw.modules.map((n) => n.id);
  raw.groups[0].label = 'Fabric';
  raw.groups[0].style = { label: { hidden: true } };
  raw.connections = raw.connections.slice(0, 3).map((e) => {
    const copy = { ...e };
    delete copy.label;
    return copy;
  });
  raw.modules.push({ id: 'Outside' });
  const model = createDiagramModel(raw),
    position = {};
  ['ProducerA', 'ProducerB', 'ProducerC'].forEach((id, i) => (position[id] = { x: i * 160, y: 0 }));
  ['ConsumerA', 'ConsumerB', 'ConsumerC'].forEach(
    (id, i) => (position[id] = { x: 80 + i * 160, y: 36 + gap }),
  );
  position.Outside = { x: 700, y: 36 + gap + 36 + 50 };
  const modules = model.modules.map((n) => {
    const { x, y } = position[n.id],
      width = 64,
      height = 36,
      inputs = n.ports.filter((p) => p.direction === 'input');
    return {
      ...n,
      x,
      y,
      width,
      height,
      labelPosition: { x: x + 32, y: y + 18 },
      labelBounds: { x, y, width, height },
      ports: n.ports.map((p) => {
        const px = x + (p.direction === 'input' ? (64 * (inputs.indexOf(p) + 1)) / (inputs.length + 1) : 32),
          py = y + (p.direction === 'input' ? 0 : 36);
        return {
          ...p,
          x: px,
          y: py,
          labelPosition: { x: px, y: py },
          labelBounds: { x: px, y: py, width: 0, height: 0 },
        };
      }),
    };
  });
  const group = {
    ...model.groups[0],
    x: -20,
    y: -20,
    width: 600,
    height: 36 + gap + 36 + 40,
    labelPosition: { x: 0, y: -10 },
    labelBounds: { x: 0, y: -10, width: 0, height: 0 },
    ports: [],
  };
  return { model, result: { modules, groups: [group], terminals: [], connections: [] } };
}

test('only the missing track space is added, preserving later gaps and transverse positions', () => {
  const { model, result } = synthetic(),
    before = structuredClone(result);
  assert.equal(planAutoChannels(result, model), true);
  assert.equal(result._autoChannels.length, 1);
  const plan = result._autoChannels[0],
    delta = plan.required - 8;
  const pad = groupGeometry(model.groups[0], model.layout.direction, model);
  const oldFrame = before.groups[0];
  const unused =
    oldFrame.y +
    oldFrame.height -
    (Math.max(...before.modules.filter((n) => n.id.startsWith('Consumer')).map((n) => n.y + n.height)) +
      pad.bottom);
  const growth = Math.max(0, delta - unused);
  assert.equal(plan.tracks.length, 3);
  assert.ok(delta > 0);
  for (const node of result.modules) {
    const old = before.modules.find((n) => n.id === node.id);
    near(node.x, old.x);
    near(node.y, old.y + (node.id.startsWith('Consumer') ? delta : node.id === 'Outside' ? growth : 0));
  }
  near(result.groups[0].height, before.groups[0].height + growth);
  assert.equal(channelAssignments(result._autoChannels).size, 9);
  assert.equal(model.groups[0].layout.layerSpacing, 8);
});

test('existing spacious gaps are reused without moving any geometry', () => {
  const { model, result } = synthetic(120),
    before = structuredClone(result);
  assert.equal(planAutoChannels(result, model), false);
  assert.ok(result._autoChannels.length);
  assert.deepEqual(result.modules, before.modules);
  assert.deepEqual(result.groups, before.groups);
});

test('single-Net traffic is a geometry no-op', () => {
  const { model, result } = synthetic(),
    before = structuredClone(result);
  model.connections = model.connections.filter((e) => e.netId === model.connections[0].netId);
  assert.equal(planAutoChannels(result, model), false);
  assert.equal(result._autoChannels.length, 0);
  assert.deepEqual(result.modules, before.modules);
  assert.deepEqual(result.groups, before.groups);
});

for (const direction of ['down', 'right'])
  test(`adjacent Auto channels keep names, physical endpoints, frame containment and foreign ink separated (${direction})`, async () => {
    const raw = structuredClone(example);
    raw.layout.direction = direction;
    const before = structuredClone(raw),
      model = createDiagramModel(raw),
      snapshot = structuredClone(model);
    const l = await layoutDiagram(model),
      routed = l.connections.filter((e) => e.routingInfo?.method === 'auto-channel');
    assert.ok(routed.length >= 5);
    assert.deepEqual(l.warnings ?? [], []);
    assert.deepEqual(raw, before);
    assert.deepEqual(model, snapshot);
    const frame = l.groups.find((g) => g.id === 'Fabric'),
      axis = direction === 'down' ? 'y' : 'x',
      netCoordinates = new Map();
    for (const e of routed) {
      assert.equal(e.routingInfo.reason, 'auto-channels');
      assert.equal(e.routingInfo.channelOwner, 'Fabric');
      assert.equal(e.routingInfo.channelAxis, axis);
      assert.equal(e.routingInfo.channelTrackCount, 3);
      const [a, b] = e.routingInfo.waypoints;
      near(a[axis], b[axis]);
      if (netCoordinates.has(e.netId)) near(netCoordinates.get(e.netId), a[axis]);
      netCoordinates.set(e.netId, a[axis]);
      for (const p of [a, b])
        assert.ok(
          p.x >= frame.x && p.y >= frame.y && p.x <= frame.x + frame.width && p.y <= frame.y + frame.height,
        );
      assert.ok(e.labelInstances.some((label) => label.role === 'start'));
    }
    assert.equal(netCoordinates.size, 3);
    for (const e of l.connections) {
      const source = l.modules
          .find((n) => n.id === e.source.moduleId)
          .ports.find((p) => p.id === e.source.portId),
        target = l.modules
          .find((n) => n.id === e.target.moduleId)
          .ports.find((p) => p.id === e.target.portId);
      near(e.sections[0].points[0].x, source.x);
      near(e.sections[0].points[0].y, source.y);
      near(e.sections.at(-1).points.at(-1).x, target.x);
      near(e.sections.at(-1).points.at(-1).y, target.y);
      for (const [a, b] of parts(e))
        for (const n of l.modules) {
          const hit =
            Math.abs(a.y - b.y) < 1e-5
              ? a.y > n.y + 1e-5 &&
                a.y < n.y + n.height - 1e-5 &&
                Math.max(a.x, b.x) > n.x + 1e-5 &&
                Math.min(a.x, b.x) < n.x + n.width - 1e-5
              : a.x > n.x + 1e-5 &&
                a.x < n.x + n.width - 1e-5 &&
                Math.max(a.y, b.y) > n.y + 1e-5 &&
                Math.min(a.y, b.y) < n.y + n.height - 1e-5;
          assert.equal(hit, false, `${e.netId} intersects ${n.id}`);
        }
    }
    for (let i = 0; i < l.connections.length; i++)
      for (let j = 0; j < i; j++) {
        const a = l.connections[i],
          b = l.connections[j];
        if (a.netId === b.netId) continue;
        for (const [p, q] of parts(a))
          for (const [u, v] of parts(b))
            assert.equal(parallelOverlap(p, q, u, v), false, `${a.netId}/${b.netId}`);
      }
    assert.ok(!JSON.stringify(l).includes('_autoChannels'));
    assert.ok(renderSvg(l).includes('Data A'));
  });

test('nested and scoped Auto Containers retain inherited budgets and safe outer frames', async () => {
  const raw = structuredClone(example);
  raw.groups.push({
    id: 'Outer',
    type: 'container',
    members: ['Fabric', 'Regular'],
    layout: { layerSpacing: 8 },
  });
  delete raw.groups[0].layout.layerSpacing;
  for (const options of [{}, { rootGroupId: 'Fabric' }, { rootGroupId: 'Outer' }]) {
    const l = await layoutDiagram(createDiagramModel(raw), options);
    assert.ok(l.connections.some((e) => e.routingInfo?.method === 'auto-channel'));
    assert.deepEqual(l.warnings ?? [], []);
    for (const group of l.groups)
      for (const id of group.members) {
        const child = [...l.groups, ...l.modules].find((n) => n.id === id);
        if (!child) continue;
        assert.ok(
          child.x >= group.x - 1e-5 &&
            child.y >= group.y - 1e-5 &&
            child.x + child.width <= group.x + group.width + 1e-5 &&
            child.y + child.height <= group.y + group.height + 1e-5,
        );
      }
  }
});

test('larger local layerSpacing supplies existing channel space while sibling size stays unchanged', async () => {
  const raw = structuredClone(example),
    compact = await layoutDiagram(createDiagramModel(raw));
  raw.groups[0].layout.layerSpacing = 120;
  const wide = await layoutDiagram(createDiagramModel(raw));
  assert.ok(wide.connections.some((e) => e.routingInfo?.method === 'auto-channel'));
  assert.ok(
    wide.groups.find((g) => g.id === 'Fabric').height > compact.groups.find((g) => g.id === 'Fabric').height,
  );
  for (const key of ['width', 'height'])
    assert.equal(
      wide.groups.find((g) => g.id === 'Regular')[key],
      compact.groups.find((g) => g.id === 'Regular')[key],
    );
  assert.equal(raw.groups[0].layout.layerSpacing, 120);
});

test('an independent Grid sibling keeps its tracks while Auto Container channels run', async () => {
  const raw = structuredClone(example);
  raw.groups[1].layout = {
    type: 'grid',
    cells: [['InputBuffer'], ['OutputBuffer']],
    rowGap: 12,
    columnGap: 12,
  };
  const l = await layoutDiagram(createDiagramModel(raw));
  assert.ok(l.connections.some((e) => e.routingInfo?.method === 'auto-channel'));
  const a = l.modules.find((n) => n.id === 'InputBuffer'),
    b = l.modules.find((n) => n.id === 'OutputBuffer');
  near(b.y - a.y - a.height, 12);
});

for (const variant of ['root-grid', 'local-grid', 'boundary', 'outside-container'])
  test(`Auto channels do not take over ${variant} placement`, async () => {
    const raw = structuredClone(example);
    if (variant === 'root-grid') raw.layout = { ...raw.layout, type: 'grid', cells: [['Fabric', 'Regular']] };
    if (variant === 'local-grid')
      raw.groups[0].layout = {
        type: 'grid',
        cells: [
          ['ProducerA', 'ProducerB', 'ProducerC'],
          ['ConsumerA', 'ConsumerB', 'ConsumerC'],
          ['Audit', null, null],
        ],
      };
    if (variant === 'boundary') raw.groups[0].type = 'boundary';
    if (variant === 'outside-container') delete raw.groups;
    const l = await layoutDiagram(createDiagramModel(raw));
    assert.ok(l.connections.every((e) => e.routingInfo?.method !== 'auto-channel'));
  });

test('reverse, feedback, bidirectional, skipped-layer and side-facing links are ineligible', () => {
  for (const variant of ['reverse', 'feedback', 'both', 'skip', 'side']) {
    const { model, result } = synthetic();
    if (variant === 'reverse') for (const e of model.connections) [e.source, e.target] = [e.target, e.source];
    if (variant === 'feedback') for (const e of model.connections) e.feedback = true;
    if (variant === 'both') for (const e of model.connections) e.direction = 'both';
    if (variant === 'skip') {
      const n = { ...result.modules.at(-1), id: 'Middle', x: 600, y: 38, width: 20, height: 2, ports: [] };
      result.modules.push(n);
      result.groups[0].members.push(n.id);
    }
    if (variant === 'side')
      for (const n of result.modules.filter((n) => n.id.startsWith('Consumer')))
        for (const p of n.ports) p.side = 'left';
    planAutoChannels(result, model);
    assert.equal(result._autoChannels.length, 0, variant);
  }
});
