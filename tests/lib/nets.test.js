import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';
import {
  renameModule,
  renamePort,
  removePort,
  removeModule,
  removeTerminal,
  saveTerminal,
} from '../../src/editor/state/commands.js';
const sample = (both = false) => ({
  version: 1,
  diagram: { name: 'Net' },
  modules: [
    { id: 'Master', ports: [{ id: 'bus', direction: both ? 'inout' : 'output' }] },
    ...['A', 'B', 'C'].map((id) => ({ id, ports: [{ id: 'bus', direction: both ? 'inout' : 'input' }] })),
  ],
  connections: [
    {
      id: 'control',
      from: 'Master.bus',
      to: ['A.bus', 'B.bus', 'C.bus'],
      label: 'Control bus',
      ...(both ? { direction: 'both' } : {}),
    },
  ],
});

test('Net expands branches without mutating input and shares width validation across all targets', () => {
  const raw = sample(),
    before = structuredClone(raw),
    m = createDiagramModel(raw);
  assert.deepEqual(raw, before);
  assert.equal(m.connections.length, 3);
  assert.ok(m.connections.every((e) => e.netId === 'control' && e.connectionIndex === 0));
  raw.modules[1].ports[0].width = 16;
  assert.ok(createDiagramModel(raw).connections.every((e) => e.width === 16));
  raw.modules[2].ports[0].width = 32;
  assert.throws(() => createDiagramModel(raw), /width mismatch/);
});

test('Net rejects duplicate targets, IDs, empty targets, conflicting sources and outside drivers', () => {
  const changes = [
    (r) => r.connections[0].to.push('A.bus'),
    (r) => (r.connections[0].to = []),
    (r) => r.connections.push({ ...r.connections[0] }),
    (r) => r.connections.push({ id: 'other', from: 'Master.bus', to: ['A.bus'] }),
    (r) => {
      r.modules.push({ id: 'Other', ports: [{ id: 'out', direction: 'output' }] });
      r.connections.push({ id: 'other', from: 'Other.out', to: ['B.bus'] });
    },
  ];
  for (const change of changes) {
    const r = sample();
    change(r);
    assert.throws(() => createDiagramModel(r));
  }
});

test('Net source and branch styles stay separate in rendered shared trunks', async () => {
  const raw = sample();
  raw.connections[0].style = { strokeColor: '#0000ff' };
  raw.connections[0].to[0] = { endpoint: 'A.bus', style: { strokeColor: '#ff0000' } };
  const l = await layoutDiagram(createDiagramModel(raw)),
    edge = l.connections[0],
    svg = renderSvg(l);
  assert.equal(edge.netStyle.strokeColor, '#0000ff');
  assert.equal(edge.style.strokeColor, '#ff0000');
  const d = edge.sections[0].points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  assert.ok(svg.includes(`<path d="${d}" stroke="#0000ff"`));
});

test('Bidirectional Net permits N inout peers but rejects ordinary inputs and unrelated membership', () => {
  const r = sample(true);
  assert.equal(createDiagramModel(r).connections.length, 3);
  r.modules[1].ports[0].direction = 'input';
  assert.throws(() => createDiagramModel(r), /inout/);
  const invalid = sample(true);
  invalid.modules.push({ id: 'Other', ports: [{ id: 'bus', direction: 'inout' }] });
  invalid.connections.push({ id: 'other', from: 'A.bus', to: ['Other.bus'], direction: 'both' });
  assert.throws(() => createDiagramModel(invalid));
});

test('Boundary inout interfaces keep separate inside/outside Nets and reject mixing faces', async () => {
  const raw = {
    version: 1,
    diagram: { name: 'Boundary Nets' },
    modules: [
      { id: 'Master', ports: [{ id: 'bus', direction: 'inout' }] },
      { id: 'ALU', ports: [{ id: 'bus', direction: 'inout' }] },
    ],
    groups: [
      {
        id: 'G',
        type: 'boundary',
        members: ['ALU'],
        ports: [{ id: 'bus', direction: 'inout', side: 'left' }],
      },
    ],
    connections: [
      { id: 'outside', from: 'Master.bus', to: ['G.bus'], direction: 'both', label: 'External bus' },
      { id: 'inside', from: 'G.bus', to: ['ALU.bus'], direction: 'both', label: 'Internal bus' },
    ],
  };
  const layout = await layoutDiagram(createDiagramModel(raw));
  copyLayout(layout);
  assert.equal(layout.connections.length, 2);
  const bad = structuredClone(raw);
  bad.connections = [{ id: 'mixed', from: 'G.bus', to: ['ALU.bus', 'Master.bus'], direction: 'both' }];
  assert.throws(() => createDiagramModel(bad), /separate Nets/);
});

for (const direction of ['right', 'down'])
  for (const grid of [false, true])
    test(`Virtual source label is small, shared and absent from public blocks ${direction} Grid=${grid}`, async () => {
      const raw = sample(true);
      raw.layout = {
        direction,
        ...(grid
          ? {
              type: 'grid',
              cells: direction === 'down' ? [['Master'], ['A'], ['B'], ['C']] : [['Master', 'A', 'B', 'C']],
            }
          : {}),
      };
      const model = createDiagramModel(raw),
        before = structuredClone(model),
        l = await layoutDiagram(model);
      assert.deepEqual(model, before);
      copyLayout(l);
      assert.deepEqual(
        l.modules.map((n) => n.id),
        ['Master', 'A', 'B', 'C'],
      );
      assert.equal(l.groups, undefined);
      assert.equal(l.connections.length, 3);
      const starts = l.connections.map((e) => e.labelInstances[0]);
      assert.ok(starts.every((label) => label.role === 'start' && label.sharedKey === starts[0].sharedKey));
      const svg = renderSvg(l);
      assert.equal((svg.match(/data-label-position="start"/g) || []).length, 1);
      assert.equal((svg.match(/data-role="connection-start-arrow"/g) || []).length, 1);
      assert.equal((svg.match(/data-role="connection-arrow"/g) || []).length, 3);
      assert.ok(!svg.includes('_signal_owner'));
      assert.ok((await sharp(Buffer.from(svg)).png().toBuffer()).length > 100);
    });

test('Long Net branches reserve end labels through Auto/Always/Never controls', async () => {
  const raw = sample();
  raw.layout = { layerSpacing: 800 };
  const auto = await layoutDiagram(createDiagramModel(raw));
  assert.ok(
    auto.connections.every((e) =>
      e.labelInstances.some((label) => label.role === 'end' && label.placement === 'inline' && !label.leader),
    ),
  );
  raw.connections[0].style = { label: { repeatAtEnd: 'never' } };
  const never = await layoutDiagram(createDiagramModel(raw));
  assert.ok(never.connections.every((e) => e.labelInstances.length === 1));
  raw.layout.layerSpacing = 40;
  raw.connections[0].style.label.repeatAtEnd = 'always';
  const always = await layoutDiagram(createDiagramModel(raw));
  assert.ok(always.connections.every((e) => e.labelInstances.length === 2));
});

test('Net targets retain local constraints and survive group views, collapse and cross-group Grid', async () => {
  const raw = sample();
  raw.groups = [{ id: 'G', members: ['Master', 'A'], style: { borderRadius: 12 } }];
  raw.connections[0].to[1] = { endpoint: 'B.bus', constraint: false };
  let model = createDiagramModel(raw);
  assert.equal(model.connections[1].constraint, false);
  const l = await layoutDiagram(model);
  copyLayout(l);
  assert.deepEqual(l.groups[0].members, ['Master', 'A']);
  const scoped = await layoutDiagram(model, { rootGroupId: 'G' });
  copyLayout(scoped);
  assert.equal(scoped.connections.length, 1);
  assert.equal(scoped.connections[0].netId, 'control');
  raw.layout = { type: 'grid', expandGroups: ['G'], cells: [['Master', 'A', 'B', 'C']] };
  copyLayout(await layoutDiagram(createDiagramModel(raw)));
  delete raw.layout;
  raw.groups[0].type = 'collection';
  raw.groups[0].collapsed = true;
  copyLayout(await layoutDiagram(createDiagramModel(raw)));
});

test('Renaming/deleting branches updates Net targets instead of discarding healthy receivers', () => {
  const raw = sample();
  renameModule(raw, 'A', 'Receiver');
  assert.equal(raw.connections[0].to[0], 'Receiver.bus');
  renamePort(raw, 'B', 'bus', 'input');
  assert.equal(raw.connections[0].to[1], 'B.input');
  removeModule(raw, 'Receiver');
  assert.equal(raw.connections[0].to.length, 2);
  removePort(raw, 'B', 'input');
  assert.deepEqual(raw.connections[0].to, ['C.bus']);
  removeModule(raw, 'C');
  assert.equal(raw.connections.length, 0);
});

test('Terminal branches preserve signal identity and surviving destinations', () => {
  const raw = sample();
  raw.terminals = [{ id: 'Out', direction: 'output' }];
  raw.connections[0].to.push({ terminal: 'Out' });
  saveTerminal(raw, 'Out', { id: 'Result', direction: 'output' });
  assert.deepEqual(raw.connections[0].to.at(-1), { terminal: 'Result' });
  removeTerminal(raw, 'Result');
  assert.equal(raw.connections[0].to.length, 3);
  createDiagramModel(raw);
});
