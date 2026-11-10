import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';
import { routeLength } from '../../src/lib/blockchart/layout/signals.js';

const near = (a, b) => Math.abs(a - b) < 1e-6;
const overlap = (a, b) =>
  a.x < b.x + b.width - 1e-6 &&
  a.x + a.width > b.x + 1e-6 &&
  a.y < b.y + b.height - 1e-6 &&
  a.y + a.height > b.y + 1e-6;
const sample = (direction = 'right') => ({
  version: 1,
  diagram: { name: 'Receiver slots', style: { module: { portLabel: { hidden: true } } } },
  modules: [
    ...['A', 'B', 'C'].map((id) => ({ id, ports: [{ id: 'out', direction: 'output' }] })),
    {
      id: 'Join',
      type: 'concat',
      ports: [
        ...['a', 'b', 'c'].map((id) => ({ id, direction: 'input' })),
        { id: 'out', direction: 'output' },
      ],
    },
    { id: 'Sink', ports: [{ id: 'in', direction: 'input' }] },
  ],
  connections: [
    ...['A', 'B', 'C'].map((id, i) => ({
      id: 'signal_' + id,
      from: id + '.out',
      to: ['Join.' + id.toLowerCase()],
      label: ['Alpha events\n32 signals', 'Beta events\n16 signals', 'Gamma status'][i],
      style: { label: { repeatAtEnd: 'always', padding: 4 } },
    })),
    { from: 'Join.out', to: ['Sink.in'] },
  ],
  layout: { direction },
});

function verify(layout) {
  copyLayout(layout);
  assert.equal(layout.warnings, undefined, JSON.stringify(layout.warnings));
  assert.ok(
    [...layout.modules, ...(layout.groups ?? [])].every((n) => !n.id.startsWith('_signal_')),
    'synthetic objects stay private',
  );
  const nodes = [...layout.modules, ...(layout.groups ?? [])];
  for (const edge of layout.connections) {
    const label = edge.labelInstances?.find((l) => l.role === 'end');
    if (!label) continue;
    assert.equal(label.placement, 'inline');
    assert.equal(label.leader, undefined);
    const tail = edge.sections.at(-1).points;
    assert.equal(tail.length, 2, 'short receiver tail is straight');
    const owner = nodes.find((n) => n.id === edge.target.moduleId),
      port =
        owner?.ports.find((p) => p.id === edge.target.portId) ??
        layout.terminals.find((t) => t.id === edge.target.terminal).anchor;
    assert.ok(
      near(tail.at(-1).x, port.x) && near(tail.at(-1).y, port.y),
      'arrow still terminates at the physical Port',
    );
    assert.ok(
      Math.abs(tail[0].x - port.x) + Math.abs(tail[0].y - port.y) <= (owner?.members ? 160 : 48),
      edge.id + ' label is adjacent to receiver: ' + JSON.stringify(tail),
    );
    assert.ok(
      nodes.filter((n) => !n.members || n.collapsed).every((n) => !overlap(n, label.bounds)),
      'label clears hardware',
    );
    assert.ok(
      edge.sections.some((s) =>
        s.points.slice(1).some((b, i) => {
          const a = s.points[i],
            p = label.position;
          return (
            (near(a.y, b.y) && near(p.y, a.y) && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)) ||
            (near(a.x, b.x) && near(p.x, a.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y))
          );
        }),
      ),
      'name lies on its own signal',
    );
  }
  assert.ok(!renderSvg(layout).includes('data-role="label-leader"'));
}

for (const direction of ['right', 'down'])
  for (const grid of [false, true])
    test(`Receiving Concat labels reserve ordered slots ${direction} Grid=${grid}`, async () => {
      const raw = sample(direction);
      if (grid)
        Object.assign(raw.layout, {
          type: 'grid',
          cells:
            direction === 'right'
              ? [
                  ['A', 'Join', 'Sink'],
                  ['B', null, null],
                  ['C', null, null],
                ]
              : [
                  ['A', 'B', 'C'],
                  ['Join', null, null],
                  ['Sink', null, null],
                ],
        });
      const model = createDiagramModel(raw),
        before = structuredClone(model),
        layout = await layoutDiagram(model);
      assert.deepEqual(model, before);
      verify(layout);
      const labels = layout.connections.filter((e) => e.label).map((e) => e.labelInstances[1]),
        axis = direction === 'down' ? 'x' : 'y';
      assert.ok(
        labels.every((l, i) => !i || l.position[axis] > labels[i - 1].position[axis]),
        'Port order is retained',
      );
      assert.ok(
        labels.every((l, i) => labels.slice(i + 1).every((other) => !overlap(l.bounds, other.bounds))),
      );
    });

for (const side of ['left', 'right', 'top', 'bottom'])
  test('Receiver name follows explicit Port side ' + side, async () => {
    const raw = sample();
    raw.modules = raw.modules.filter((n) => ['A', 'Sink'].includes(n.id));
    raw.modules[1].ports[0].side = side;
    raw.connections = [
      {
        from: 'A.out',
        to: ['Sink.in'],
        label: 'Control\n32 bits',
        style: { label: { repeatAtEnd: 'always' } },
      },
    ];
    const layout = await layoutDiagram(createDiagramModel(raw));
    verify(layout);
    const n = layout.modules[1],
      b = layout.connections[0].labelInstances[1].bounds;
    assert.ok(
      side === 'left'
        ? b.x + b.width < n.x
        : side === 'right'
          ? b.x > n.x + n.width
          : side === 'top'
            ? b.y + b.height < n.y
            : b.y > n.y + n.height,
    );
  });

test('Auto freezes the first-pass long-branch selection and Never omits receiver space', async () => {
  const raw = sample();
  for (const e of raw.connections.filter((e) => e.label)) e.style.label.repeatAtEnd = 'never';
  const first = await layoutDiagram(createDiagramModel(raw));
  const threshold = routeLength(first.connections[1]) - 1;
  for (const e of raw.connections.filter((e) => e.label))
    Object.assign(e.style.label, { repeatAtEnd: 'auto', longThreshold: threshold });
  const auto = await layoutDiagram(createDiagramModel(raw));
  verify(auto);
  for (const e of auto.connections.filter((e) => e.label))
    assert.equal(
      e.labelInstances.length,
      routeLength(first.connections.find((f) => f.id === e.id)) > threshold ? 2 : 1,
    );
  assert.deepEqual(auto, await layoutDiagram(createDiagramModel(raw)), 'two passes are deterministic');
});

test('Receiver footprints survive nested boundary faces and group views', async () => {
  const raw = JSON.parse(
    await readFile(new URL('../fixtures/boundary-minimal.json', import.meta.url), 'utf8'),
  );
  for (const [i, e] of raw.connections.entries()) {
    e.label = 'Signal ' + i;
    e.style = { label: { repeatAtEnd: 'always' } };
  }
  const model = createDiagramModel(raw);
  verify(await layoutDiagram(model));
  verify(await layoutDiagram(model, { rootGroupId: 'Inner' }));
});

for (const grid of [false, true])
  test('Output Terminal keeps its receiver name adjacent Grid=' + grid, async () => {
    const raw = sample();
    raw.modules = raw.modules.filter((n) => n.id === 'A');
    raw.terminals = [{ id: 'Result', direction: 'output' }];
    raw.connections = [
      {
        from: 'A.out',
        to: [{ terminal: 'Result' }],
        label: 'Result bus',
        style: { label: { repeatAtEnd: 'always' } },
      },
    ];
    if (grid) Object.assign(raw.layout, { type: 'grid', cells: [['A']] });
    const model = createDiagramModel(raw);
    verify(await layoutDiagram(model));
  });

test('Collapsed Collection shares a receiver footprint while retaining semantic branch IDs', async () => {
  const raw = JSON.parse(
    await readFile(new URL('../../examples/collection-instances.json', import.meta.url), 'utf8'),
  );
  raw.connections[0].label = 'Parallel data';
  raw.connections[0].style = { label: { repeatAtEnd: 'always' } };
  const model = createDiagramModel(raw),
    layout = await layoutDiagram(model);
  copyLayout(layout);
  assert.equal(layout.warnings, undefined);
  const branches = layout.connections.filter((e) => e.netId === model.connections[0].netId);
  assert.equal(branches.length, 16);
  assert.ok(branches.every((e) => e.labelInstances[1].sharedKey === branches[0].labelInstances[1].sharedKey));
  assert.ok(
    branches.every(
      (e) => JSON.stringify(e.target) === JSON.stringify(model.connections.find((m) => m.id === e.id).target),
    ),
  );
  assert.equal((renderSvg(layout).match(/data-label-position="end"/g) ?? []).length, 1);
});

test('Repeated names retain bidirectional arrows and local non-constraining branch settings', async () => {
  const raw = {
    version: 1,
    diagram: { name: 'Abstract bus' },
    modules: ['Main', 'A', 'B'].map((id) => ({
      id,
      ports: [{ id: 'bus', direction: 'inout', side: id === 'Main' ? 'right' : 'left' }],
    })),
    connections: [
      {
        id: 'bus',
        from: 'Main.bus',
        to: ['A.bus', { endpoint: 'B.bus', constraint: false }],
        direction: 'both',
        label: 'Shared commands',
        style: { label: { repeatAtEnd: 'always' } },
      },
    ],
    layout: {
      type: 'grid',
      cells: [
        ['Main', 'A'],
        [null, 'B'],
      ],
    },
  };
  const model = createDiagramModel(raw),
    layout = await layoutDiagram(model);
  verify(layout);
  assert.ok(layout.connections.every((e) => e.startArrow && e.arrow));
  assert.equal(layout.connections[1].constraint, false);
  assert.deepEqual(
    layout.connections.map((e) => e.target),
    model.connections.map((e) => e.target),
  );
});

for (const direction of ['right', 'down'])
  test('Terminal adjustment moves its reserved receiver name ' + direction, async () => {
    const raw = JSON.parse(await readFile(new URL('../../examples/terminals.json', import.meta.url), 'utf8'));
    for (const e of raw.connections)
      if (e.to.some((t) => t.terminal)) {
        e.label = 'Receiver data';
        e.style = { label: { repeatAtEnd: 'always' } };
      }
    raw.layout = { ...raw.layout, direction, portAdjustment: 'fixed', maxPortShift: 120 };
    const fixed = await layoutDiagram(createDiagramModel(raw));
    raw.layout.portAdjustment = 'reduce-bends';
    const adjusted = await layoutDiagram(createDiagramModel(raw));
    verify(adjusted);
    const axis = direction === 'right' ? 'y' : 'x',
      origin = (l) => l.modules[0][axis];
    let moved = 0;
    for (const edge of adjusted.connections.filter((e) => e.label)) {
      const before = fixed.connections.find((e) => e.id === edge.id),
        terminal = adjusted.terminals.find((t) => t.id === edge.target.terminal),
        oldTerminal = fixed.terminals.find((t) => t.id === edge.target.terminal);
      const delta = terminal.anchor[axis] - origin(adjusted) - (oldTerminal.anchor[axis] - origin(fixed));
      const labelDelta =
        edge.labelInstances[1].position[axis] -
        origin(adjusted) -
        (before.labelInstances[1].position[axis] - origin(fixed));
      assert.ok(near(delta, labelDelta), 'receiver name moves with its Terminal');
      assert.ok(Math.abs(delta) <= 120 + 1e-6);
      if (Math.abs(delta) > 1e-6) moved++;
    }
    assert.ok(moved > 0, 'receiving Terminals remain eligible for bend reduction');
  });
