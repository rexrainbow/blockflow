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
import { groupGeometry } from '../../src/lib/blockchart/layout/groups.js';
import { translateNode } from '../../src/lib/blockchart/layout/translate.js';
import { descendants } from '../../src/lib/blockchart/hierarchy.js';

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
