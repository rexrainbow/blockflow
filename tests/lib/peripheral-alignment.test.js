import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ELK from 'elkjs/lib/elk.bundled.js';
import { createDiagramModel, layoutDiagram } from '../../src/lib/blockchart/index.js';
import { signalModel } from '../../src/lib/blockchart/layout/signals.js';
import { buildElkGraph } from '../../src/lib/blockchart/layout/elk-graph.js';
import { readElkResult } from '../../src/lib/blockchart/layout/elk-result.js';
import { arrangeGrids } from '../../src/lib/blockchart/layout/grid-layout.js';
import { routeFixed } from '../../src/lib/blockchart/layout/fixed.js';
import { alignPeripheralGroups } from '../../src/lib/blockchart/layout/peripheral-alignment.js';
import { createCandidateRouter } from '../../src/lib/blockchart/layout/routing-trial.js';
import { groupGeometry } from '../../src/lib/blockchart/layout/groups.js';
import { translateNode } from '../../src/lib/blockchart/layout/translate.js';
import { descendants } from '../../src/lib/blockchart/hierarchy.js';
import { netRouteQuality } from '../../src/lib/blockchart/layout/route-quality.js';

test('DShot Auto chain stays downstream across source label widths after restoring signal Nets', async () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../fixtures/blockchart/dshot-auto-chain.json', import.meta.url), 'utf8'),
  );
  for (const label of ['HI0/HI1', 'DShot waveform']) {
    const raw = structuredClone(fixture);
    raw.connections.find((n) => n.from === 'TXGluelogic1.out').label = label;
    const saved = structuredClone(raw);
    const layout = await layoutDiagram(createDiagramModel(raw));
    const source = layout.groups.find((g) => g.id === 'Bank0TXClockRouting');
    const target = layout.groups.find((g) => g.id === 'Bank0OverlayOutputs');
    assert.ok(target.x >= source.x + source.width, label);
    assert.ok(target.y < source.y + source.height, label);
    assert.equal(netRouteQuality(layout).overlaps, 0);
    const bank = layout.groups.find((g) => g.id === 'Bank0');
    const nextBank = layout.groups.find((g) => g.id === 'Bank1');
    const children = [...layout.groups, ...layout.modules].filter((n) => bank.members.includes(n.id));
    const bottom = Math.max(...children.map((n) => n.y + n.height));
    const model = createDiagramModel(raw);
    const pad = groupGeometry(
      model.groups.find((g) => g.id === bank.id),
      model.layout.direction,
      model,
    );
    assert.ok(bank.y + bank.height >= bottom + pad.bottom - 1e-6);
    assert.ok(bank.y + bank.height <= bottom + pad.bottom + 1, label);
    assert.ok(Math.abs(nextBank.y - bank.y - bank.height - model.layout.rowGap) < 1e-6);
    assert.deepEqual(raw, saved);
  }
});

test('a candidate reuses only identical searches and gives each trial its own path', () => {
  let searches = 0;
  const router = createCandidateRouter((start, end) => {
    searches++;
    return [{ ...start }, { ...end }];
  });
  const geometry = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    [{ x: 20, y: 10, width: 5, height: 5 }],
    { x: 0, y: 0, width: 100, height: 100 },
    10,
    [
      [
        { x: 8, y: 4 },
        { x: 22, y: 4 },
      ],
    ],
    { startDirection: { x: 1, y: 0 }, endDirection: { x: 1, y: 0 } },
  ];
  const path = router(...geometry);
  path[0].x = 999;
  assert.deepEqual(router(...structuredClone(geometry)), geometry.slice(0, 2));
  assert.equal(searches, 1);
  for (const mutate of [
    (g) => g[0].x++,
    (g) => g[1].y++,
    (g) => (g[2][0].x += 1e-7),
    (g) => g[3].width++,
    (g) => g[4]++,
    (g) => g[5][0][1].x++,
    (g) => (g[6].endDirection.x = -1),
  ]) {
    const changed = structuredClone(geometry);
    mutate(changed);
    const before = searches;
    router(...changed);
    assert.equal(searches, before + 1);
  }
});

test('a failed search can be retried and a new candidate starts fresh', () => {
  let searches = 0;
  const search = () => {
    if (++searches === 1) throw new Error('obstructed');
    return [{ x: 0, y: 0 }];
  };
  const router = createCandidateRouter(search);
  assert.throws(() => router(), /obstructed/);
  assert.deepEqual(router(), router());
  assert.equal(searches, 2);
  createCandidateRouter(search)();
  assert.equal(searches, 3);
});

test('a scoped Grid fanout input moves toward its receivers without moving the core', async () => {
  const raw = JSON.parse(
    readFileSync(new URL('../fixtures/blockchart/scoped-peripheral-input.json', import.meta.url), 'utf8'),
  );
  const saved = structuredClone(raw),
    model = createDiagramModel(raw),
    savedModel = structuredClone(model);
  const full = await layoutDiagram(model);
  const scoped = await layoutDiagram(model, { rootGroupId: 'Device' });
  const anchor = (id, port) => scoped.modules.find((n) => n.id === id).ports.find((p) => p.id === port).y;
  const source = anchor('SerialInput', 'output');
  const targets = [anchor('ReceiveEvent', 'overlay'), anchor('CaptureQueue', 'data')];
  // Previously the scoped input stayed above both targets (404 vs 552/662).
  assert.ok(source >= Math.min(...targets) && source <= Math.max(...targets));
  assert.ok(Math.abs(source - (targets[0] + targets[1]) / 2) < 1e-6);
  const coreIds = new Set([
    'Workers',
    'Controllers',
    ...descendants(model, 'Workers'),
    ...descendants(model, 'Controllers'),
  ]);
  const core = (r) =>
    [...r.modules, ...r.groups]
      .filter((n) => coreIds.has(n.id))
      .map((n) => [n.id, n.x, n.y, n.width, n.height]);
  assert.deepEqual(core(scoped), core(full));
  assert.deepEqual(scoped.warnings ?? [], []);
  assert.deepEqual(await layoutDiagram(model, { rootGroupId: 'Device' }), scoped);
  assert.deepEqual(raw, saved);
  assert.deepEqual(model, savedModel);
});

function document(direction = 'right') {
  const port = (id, direction) => ({ id, direction, style: { hidden: true } });
  return {
    version: 1,
    diagram: {
      name: 'Grid with peripheral interfaces',
      style: { connection: { label: { repeatAtEnd: 'never' } } },
    },
    layout: { direction, moduleSpacing: 30, layerSpacing: 70 },
    modules: [
      { id: 'Top', ports: [port('input', 'input'), port('output', 'output')] },
      { id: 'Bottom', ports: [port('input', 'input'), port('output', 'output'), port('aux', 'output')] },
      { id: 'OutputA', ports: [port('input', 'input'), port('pad', 'output')] },
      { id: 'OutputB', ports: [port('input', 'input'), port('aux', 'input')] },
      { id: 'Input', ports: [port('input', 'input'), port('output', 'output')] },
    ],
    groups: [
      { id: 'Bank', members: ['Core', 'Outputs', 'Inputs'] },
      {
        id: 'Core',
        members: ['Top', 'Bottom'],
        layout: {
          type: 'grid',
          cells: direction === 'down' ? [['Top', 'Bottom']] : [['Top'], ['Bottom']],
          rowGap: 160,
          columnGap: 180,
        },
      },
      { id: 'Outputs', members: ['OutputA', 'OutputB'] },
      { id: 'Inputs', members: ['Input'] },
    ],
    connections: [
      { id: 'A', from: 'Top.output', to: ['OutputA.input'], label: 'Payload A' },
      { id: 'B', from: 'Bottom.output', to: ['OutputB.input'] },
      { id: 'Aux', from: 'Bottom.aux', to: ['OutputB.aux'] },
      { id: 'Fanout', from: 'Input.output', to: ['Top.input', 'Bottom.input'] },
      {
        id: 'Return',
        from: 'OutputA.pad',
        to: [{ endpoint: 'Input.input', constraint: false, feedback: true }],
        label: 'Return payload',
      },
    ],
  };
}
async function working(raw, nudge = true) {
  const model = signalModel(createDiagramModel(raw)),
    elk = new ELK();
  const result = readElkResult(await elk.layout(buildElkGraph(model)), model);
  await arrangeGrids(result, model, elk);
  const nodes = new Map([...result.modules, ...result.groups].map((n) => [n.id, n]));
  const axis = model.layout.direction === 'down' ? 'x' : 'y',
    extent = axis === 'x' ? 'width' : 'height';
  function shift(node, d) {
    translateNode(node, axis === 'x' ? d : 0, axis === 'y' ? d : 0);
    for (const id of node.members ?? []) shift(nodes.get(id), d);
  }
  if (nudge) {
    const bank = nodes.get('Bank'),
      pad = groupGeometry(
        model.groups.find((g) => g.id === 'Bank'),
        model.layout.direction,
        model,
      );
    const out = nodes.get('Outputs'),
      input = nodes.get('Inputs');
    shift(out, bank[axis] + bank[extent] - (axis === 'x' ? pad.right : pad.bottom) - out[extent] - out[axis]);
    shift(input, bank[axis] + (axis === 'x' ? pad.left : pad.top) - input[axis]);
  }
  routeFixed(result, model);
  return { result, model, axis };
}
function core(result, model) {
  const ids = new Set(['Core', ...descendants(model, 'Core')]);
  return [...result.modules, ...result.groups].filter((n) => ids.has(n.id));
}
function error(result, model, axis) {
  const semantic = model._signalOriginal ?? model,
    nodes = new Map([...result.modules, ...result.groups].map((n) => [n.id, n]));
  const point = (ref) => nodes.get(ref.moduleId).ports.find((p) => p.id === ref.portId);
  return semantic.connections
    .filter((e) => e.constraint !== false)
    .reduce((sum, e) => sum + Math.abs(point(e.source)[axis] - point(e.target)[axis]), 0);
}

for (const direction of ['right', 'down'])
  for (const placement of [true, false])
    test(`Auto chain follows only Placement-enabled branches (${direction}, ${placement})`, async () => {
      const raw = document(direction);
      raw.connections = raw.connections.filter((n) => !['Fanout', 'Return'].includes(n.id));
      raw.connections.push({ from: 'OutputA.pad', to: [{ endpoint: 'Input.input', constraint: placement }] });
      raw.groups = [raw.groups[0], raw.groups[1], raw.groups[3], raw.groups[2]];
      const f = await working(raw, false);
      const nodes = new Map([...f.result.modules, ...f.result.groups].map((n) => [n.id, n]));
      const input = nodes.get('Inputs'),
        output = nodes.get('Outputs'),
        bank = nodes.get('Bank');
      const flow = direction === 'right' ? 'x' : 'y',
        tangent = flow === 'x' ? 'y' : 'x';
      const size = tangent === 'x' ? 'width' : 'height';
      const delta = output[tangent] + output[size] + 100 - input[tangent];
      const along = output[flow] - input[flow];
      function move(node) {
        translateNode(node, flow === 'x' ? along : delta, flow === 'y' ? along : delta);
        for (const id of node.members ?? []) move(nodes.get(id));
      }
      move(input);
      bank[size] = Math.max(bank[size], input[tangent] + input[size] + 30 - bank[tangent]);
      routeFixed(f.result, f.model);
      const before = input[flow],
        original = structuredClone(raw),
        fixed = structuredClone(core(f.result, f.model));
      alignPeripheralGroups(f.result, f.model);
      const placed = f.result.groups.find((g) => g.id === 'Inputs');
      if (placement) assert.ok(placed[flow] > before);
      else assert.equal(placed[flow], before);
      assert.deepEqual(core(f.result, f.model), fixed);
      assert.deepEqual(raw, original);
    });

test('cyclic Placement dependencies retain their baseline flow positions', async () => {
  const raw = document();
  raw.connections = raw.connections.filter((n) => !['Fanout', 'Return'].includes(n.id));
  raw.modules.find((m) => m.id === 'OutputA').ports.push({ id: 'cycle', direction: 'input' });
  raw.connections.push(
    { from: 'OutputA.pad', to: ['Input.input'] },
    { from: 'Input.output', to: ['OutputA.cycle'] },
  );
  const f = await working(raw, false);
  const input = f.result.groups.find((g) => g.id === 'Inputs');
  const x = input.x;
  alignPeripheralGroups(f.result, f.model);
  assert.equal(f.result.groups.find((g) => g.id === 'Inputs').x, x);
});

for (const direction of ['right', 'down'])
  test(`a downstream Auto group can leave the Grid's flow band (${direction})`, async () => {
    const f = await working(document(direction), false);
    const nodes = new Map([...f.result.modules, ...f.result.groups].map((n) => [n.id, n]));
    const group = nodes.get('Outputs'),
      grid = nodes.get('Core'),
      parent = nodes.get('Bank');
    const flow = direction === 'down' ? 'y' : 'x',
      axis = flow === 'x' ? 'y' : 'x';
    const size = axis === 'x' ? 'width' : 'height';
    const dx = flow === 'x' ? grid.x - group.x : grid.x + grid.width + 100 - group.x;
    const dy = flow === 'y' ? grid.y - group.y : grid.y + grid.height + 100 - group.y;
    function move(n) {
      translateNode(n, dx, dy);
      for (const id of n.members ?? []) move(nodes.get(id));
    }
    move(group);
    parent[size] = Math.max(parent[size], group[axis] + group[size] + 30 - parent[axis]);
    routeFixed(f.result, f.model);
    const fixed = structuredClone(core(f.result, f.model));
    alignPeripheralGroups(f.result, f.model);
    const placed = f.result.groups.find((n) => n.id === 'Outputs');
    assert.ok(placed[flow] >= grid[flow] + grid[flow === 'x' ? 'width' : 'height']);
    assert.deepEqual(core(f.result, f.model), fixed);
  });

for (const direction of ['right', 'down'])
  test(`post-Grid alignment preserves the core and improves real Port alignment (${direction})`, async () => {
    const raw = document(direction),
      saved = structuredClone(raw),
      f = await working(raw);
    const fixed = structuredClone(core(f.result, f.model)),
      model = structuredClone(f.model),
      old = error(f.result, f.model, f.axis);
    assert.equal(alignPeripheralGroups(f.result, f.model), true);
    assert.ok(error(f.result, f.model, f.axis) < old - 20);
    assert.deepEqual(core(f.result, f.model), fixed);
    assert.deepEqual(f.model, model);
    assert.deepEqual(raw, saved);
    const replay = await working(raw);
    alignPeripheralGroups(replay.result, replay.model);
    assert.deepEqual(replay.result, f.result);
  });

test('owned source-label wrappers move with their physical peripheral Block', async () => {
  const f = await working(document()),
    node = (id) => [...f.result.modules, ...f.result.groups].find((n) => n.id === id);
  const wrapper = f.model.groups.find((g) => g._signalWrapper && g.members.includes('OutputA'));
  const label = f.model._signals.find((s) => s.netId === 'Return').signalId;
  const before = { block: node('OutputA').y, label: node(label).y, wrapper: node(wrapper.id).y };
  alignPeripheralGroups(f.result, f.model);
  const delta = node('OutputA').y - before.block;
  assert.ok(Math.abs(delta) > 1);
  assert.ok(Math.abs(node(label).y - before.label - delta) < 1e-5);
  assert.ok(Math.abs(node(wrapper.id).y - before.wrapper - delta) < 1e-5);
});

test('a parent Grid explicitly pinning peripheral groups is not overridden', async () => {
  const raw = document();
  raw.groups[0].layout = { type: 'grid', cells: [['Inputs', 'Core', 'Outputs']] };
  const f = await working(raw, false),
    before = structuredClone(f.result);
  assert.equal(alignPeripheralGroups(f.result, f.model), false);
  assert.deepEqual(f.result, before);
});

for (const direction of ['right', 'down']) {
  test(`a partially anchored Auto group moves as a whole (${direction})`, async () => {
    const raw = document(direction);
    raw.connections = raw.connections.filter((e) => !['B', 'Aux'].includes(e.id));
    const { model, result, axis } = await working(raw);
    const groupId = 'Outputs',
      ids = [groupId, ...descendants(model, groupId)];
    const nodes = () => new Map([...result.groups, ...result.modules].map((n) => [n.id, n]));
    const shape = () => {
      const current = nodes(),
        g = current.get(groupId);
      return ids.map((id) => {
        const n = current.get(id);
        return [n.x - g.x, n.y - g.y, n.width, n.height, ...n.ports.map((p) => [p.x - g.x, p.y - g.y])];
      });
    };
    const before = shape(),
      prior = nodes().get(groupId)[axis],
      fixed = structuredClone(core(result, model));
    const mismatch = () =>
      Math.abs(
        nodes()
          .get('Top')
          .ports.find((p) => p.id === 'output')[axis] -
          nodes()
            .get('OutputA')
            .ports.find((p) => p.id === 'input')[axis],
      );
    const oldError = mismatch();
    alignPeripheralGroups(result, model);
    assert.ok(mismatch() < oldError - 1);
    assert.notEqual(nodes().get(groupId)[axis], prior);
    assert.deepEqual(shape(), before);
    assert.deepEqual(core(result, model), fixed);
  });
}

test('a rigid translation is rolled back when the weak downstream routes would be longer overall', async () => {
  const raw = document();
  for (const e of raw.connections.filter((e) => ['B', 'Aux'].includes(e.id))) e.constraint = false;
  const { model, result } = await working(raw);
  const owned = new Set(['Outputs', ...descendants(model, 'Outputs')]);
  const geometry = () => [...result.modules, ...result.groups].filter((n) => owned.has(n.id));
  const before = structuredClone(geometry());
  alignPeripheralGroups(result, model);
  assert.deepEqual(geometry(), before);
});

test('without a fixed Grid peer the refinement is inactive', async () => {
  const raw = document();
  delete raw.groups[1].layout;
  const f = await working(raw, false),
    before = structuredClone(f.result);
  assert.equal(alignPeripheralGroups(f.result, f.model), false);
  assert.deepEqual(f.result, before);
});

test('a foreign Terminal footprint prevents an unsafe upward relocation', async () => {
  const f = await working(document()),
    g = f.result.groups.find((g) => g.id === 'Outputs'),
    bank = f.result.groups.find((g) => g.id === 'Bank');
  const ids = new Set(['Outputs', ...descendants(f.model, 'Outputs')]);
  const snapshot = () =>
    structuredClone([...f.result.modules, ...f.result.groups].filter((n) => ids.has(n.id)));
  const before = snapshot();
  f.result.terminals.push({
    id: 'ObstacleText',
    style: { hidden: false },
    labelBounds: { x: g.x, y: bank.y, width: g.width, height: g.y - bank.y - 1 },
  });
  alignPeripheralGroups(f.result, f.model);
  assert.deepEqual(snapshot(), before);
});

test('full public layout remains deterministic and source data stays portable', async () => {
  const raw = document(),
    saved = structuredClone(raw),
    model = createDiagramModel(raw),
    snapshot = structuredClone(model);
  const layout = await layoutDiagram(model);
  assert.deepEqual(await layoutDiagram(model), layout);
  assert.deepEqual(raw, saved);
  assert.deepEqual(model, snapshot);
});

test('cross-group Grid cells pin the containing Auto group and its children', async () => {
  const raw = document();
  raw.groups[0].layout = {
    type: 'grid',
    cells: [
      ['Core', 'OutputA'],
      [null, 'OutputB'],
    ],
  };
  const f = await working(raw, false),
    ids = new Set(['Outputs', ...descendants(f.model, 'Outputs')]);
  const snapshot = () =>
    structuredClone([...f.result.modules, ...f.result.groups].filter((n) => ids.has(n.id)));
  const before = snapshot();
  alignPeripheralGroups(f.result, f.model);
  assert.deepEqual(snapshot(), before);
});

test('Auto group spacing overrides remain minimum member gaps', async () => {
  const raw = document();
  raw.groups.find((g) => g.id === 'Outputs').layout = { type: 'auto', moduleSpacing: 90 };
  const f = await working(raw);
  alignPeripheralGroups(f.result, f.model);
  const a = f.result.modules.find((n) => n.id === 'OutputA'),
    b = f.result.modules.find((n) => n.id === 'OutputB');
  assert.ok(b.y >= a.y + a.height + 90 - 1e-5);
});
for (const direction of ['right', 'down'])
  test(`peripheral receiver follows its driver while flow-axis size changes (${direction})`, async () => {
    const anchors = [];
    for (const size of [1.2, 2, 3]) {
      const raw = document(direction);
      raw.modules = raw.modules.filter((n) => n.id !== 'OutputB');
      raw.groups.find((g) => g.id === 'Outputs').members = ['OutputA'];
      raw.connections = raw.connections.filter((e) => !['B', 'Aux'].includes(e.id));
      const module = raw.modules.find((n) => n.id === 'OutputA');
      module[direction === 'right' ? 'width' : 'height'] = size;
      const result = await layoutDiagram(createDiagramModel(raw));
      const axis = direction === 'right' ? 'y' : 'x',
        port = (id, p) => result.modules.find((n) => n.id === id).ports.find((n) => n.id === p)[axis];
      assert.ok(
        Math.abs(port('OutputA', 'input') - port('Top', 'output')) < 1e-6,
        `${direction} ${size}: ${port('OutputA', 'input')} vs ${port('Top', 'output')}`,
      );
      const parent = result.groups.find((g) => g.id === 'Bank');
      anchors.push(port('OutputA', 'input') - parent[axis]);
    }
    assert.ok(anchors.every((value) => Math.abs(value - anchors[0]) < 1e-6));
  });

test('peripheral groups do not exhaust a shared trial budget before later interfaces align', async () => {
  const count = 10,
    ids = Array.from({ length: count }, (_, i) => 'Sink' + i);
  const raw = {
    version: 1,
    diagram: { name: 'Independent peripheral anchors' },
    layout: { moduleSpacing: 20, layerSpacing: 40 },
    modules: [
      { id: 'Driver', ports: [{ id: 'out', direction: 'output', style: { hidden: true } }] },
      ...ids.map((id) => ({ id, ports: [{ id: 'in', direction: 'input', style: { hidden: true } }] })),
    ],
    groups: [
      { id: 'Bank', members: ['Core', ...ids.map((id) => id + 'Frame')] },
      { id: 'Core', members: ['Driver'], layout: { type: 'grid', cells: [['Driver']] } },
      ...ids.map((id) => ({ id: id + 'Frame', members: [id] })),
    ],
    connections: [{ from: 'Driver.out', to: ids.map((id) => id + '.in') }],
  };
  const f = await working(raw, false),
    nodes = new Map([...f.result.modules, ...f.result.groups].map((n) => [n.id, n])),
    bank = nodes.get('Bank');
  bank.width = 5000;
  bank.height = 1000;
  const fixed = structuredClone(core(f.result, f.model)),
    driver = nodes.get('Driver'),
    anchor = driver.ports[0].y;
  for (const [i, id] of ids.entries()) {
    const frame = nodes.get(id + 'Frame'),
      block = nodes.get(id),
      dx = nodes.get('Core').x + nodes.get('Core').width + 150 + i * 180 - frame.x,
      dy = 500 - frame.y;
    translateNode(frame, dx, dy);
    translateNode(block, dx, dy);
  }
  routeFixed(f.result, f.model);
  assert.equal(alignPeripheralGroups(f.result, f.model), true);
  for (const id of ids)
    assert.ok(
      Math.abs(f.result.modules.find((n) => n.id === id).ports[0].y - anchor) < 1e-6,
      id + ' should align',
    );
  assert.deepEqual(core(f.result, f.model), fixed);
});
