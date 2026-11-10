import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { copyLayout } from '../../src/lib/view/layout.js';
import { freeze } from './helpers.js';
const sample = JSON.parse(
  await readFile(new URL('../../examples/port-adjustment.json', import.meta.url), 'utf8'),
);
const validate = new Ajv({ strict: true, allErrors: true }).compile(
  JSON.parse(await readFile(new URL('../../schema/blockflow.schema.json', import.meta.url), 'utf8')),
);
const bends = (l) =>
  l.connections.reduce((sum, e) => {
    let previous;
    for (const s of e.sections)
      for (let i = 1; i < s.points.length; i++) {
        const a = s.points[i - 1],
          b = s.points[i];
        if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 1e-6) continue;
        const next = Math.abs(a.y - b.y) < 1e-6 ? 'h' : 'v';
        if (previous && previous !== next) sum++;
        previous = next;
      }
    return sum;
  }, 0);
const anchor = (l) => l.modules.find((n) => n.id === 'Processor') ?? l.modules[0];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
function sameBlocks(a, b) {
  const x = anchor(a),
    y = anchor(b);
  for (const n of [...a.modules, ...(a.groups ?? [])]) {
    const q = [...b.modules, ...(b.groups ?? [])].find((m) => m.id === n.id);
    near(n.x - x.x, q.x - y.x);
    near(n.y - x.y, q.y - y.y);
    near(n.width, q.width);
    near(n.height, q.height);
  }
}

test('Reference interface: six staircases become six straight lines without moving or resizing any block', async () => {
  const raw = structuredClone(sample);
  raw.layout.portAdjustment = 'fixed';
  const fixed = await layoutDiagram(createDiagramModel(raw));
  assert.equal(bends(fixed), 12);
  raw.layout.portAdjustment = 'reduce-bends';
  const before = structuredClone(raw),
    m = createDiagramModel(freeze(raw)),
    snapshot = structuredClone(m);
  const adjusted = await layoutDiagram(freeze(m));
  copyLayout(adjusted);
  assert.equal(bends(adjusted), 0);
  sameBlocks(fixed, adjusted);
  assert.deepEqual(raw, before);
  assert.deepEqual(m, snapshot);
  assert.deepEqual(await layoutDiagram(m), adjusted);
  for (const node of adjusted.modules)
    for (const p of node.ports) {
      const old = fixed.modules.find((n) => n.id === node.id).ports.find((q) => q.id === p.id);
      assert.ok(
        Math.abs(p.y - node.y - (old.y - fixed.modules.find((n) => n.id === node.id).y)) <= 120 + 1e-6,
      );
      if (node.id !== 'Processor') near(p.y - node.y, old.y - fixed.modules.find((n) => n.id === node.id).y);
    }
  assert.equal(adjusted.warnings, undefined);
  assert.ok(!renderSvg(adjusted).includes('_signal_'));
});

test('Reduce bends is the default; explicit Fixed and zero shift preserve fixed ports; small shifts remain bounded', async () => {
  const d = structuredClone(sample);
  delete d.layout.portAdjustment;
  delete d.layout.maxPortShift;
  const defaults = await layoutDiagram(createDiagramModel(d));
  d.layout.portAdjustment = 'reduce-bends';
  d.layout.maxPortShift = 40;
  assert.deepEqual(await layoutDiagram(createDiagramModel(d)), defaults);
  d.layout.portAdjustment = 'fixed';
  d.layout.maxPortShift = 120;
  const baseline = await layoutDiagram(createDiagramModel(d));
  assert.ok(bends(defaults) < bends(baseline));
  d.layout.portAdjustment = 'reduce-bends';
  d.layout.maxPortShift = 0;
  assert.deepEqual(await layoutDiagram(createDiagramModel(d)), baseline);
  d.layout.maxPortShift = 4;
  const l = await layoutDiagram(createDiagramModel(d));
  sameBlocks(baseline, l);
  assert.ok(bends(l) <= bends(baseline));
  for (const n of l.modules)
    for (const p of n.ports) {
      const old = baseline.modules.find((m) => m.id === n.id),
        q = old.ports.find((q) => q.id === p.id);
      assert.ok(Math.abs(p.y - n.y - (q.y - old.y)) <= 4 + 1e-6);
      near(p.x - n.x, q.x - old.x);
    }
});

test('Vertical flow and stacked front faces slide along their side; other appearances and Concat remain fixed', async () => {
  const d = structuredClone(sample);
  d.layout.direction = 'down';
  d.layout.maxPortShift = 240;
  d.layout.cells = d.layout.cells[0].map((id) => [id]);
  for (const g of d.groups) g.layout.cells = [g.layout.cells.map((r) => r[0])];
  for (const n of d.modules) {
    n.width = n.id === 'Processor' ? 12 : 1.4;
    n.height = 1;
    for (const p of n.ports) p.side = p.side === 'left' ? 'top' : 'bottom';
  }
  d.modules.find((n) => n.id === 'Processor').appearance = { type: 'stacked', layers: 2 };
  d.layout.portAdjustment = 'fixed';
  const base = await layoutDiagram(createDiagramModel(d));
  d.layout.portAdjustment = 'reduce-bends';
  const l = await layoutDiagram(createDiagramModel(d));
  copyLayout(l);
  sameBlocks(base, l);
  assert.ok(bends(l) < bends(base));
  for (const n of l.modules)
    for (const p of n.ports) {
      const a = base.modules.find((m) => m.id === n.id),
        q = a.ports.find((q) => q.id === p.id);
      near(p.y - n.y, q.y - a.y);
      assert.ok(Math.abs(p.x - n.x - (q.x - a.x)) <= 240 + 1e-6);
    }
  for (const name of ['concat', 'block-appearances']) {
    const raw = JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));
    const before = await layoutDiagram(createDiagramModel(raw));
    raw.layout ??= {};
    raw.layout.portAdjustment = 'reduce-bends';
    const after = await layoutDiagram(createDiagramModel(raw));
    copyLayout(after);
    sameBlocks(before, after);
    for (const node of after.modules)
      if (node.type === 'concat' || node.body?.type === 'trapezoid') {
        const old = before.modules.find((n) => n.id === node.id);
        for (const p of node.ports) {
          const q = old.ports.find((q) => q.id === p.id);
          near(p.x - node.x, q.x - old.x);
          near(p.y - node.y, q.y - old.y);
        }
      }
  }
});

test('Shared source labels, feedback, boundary and Collection scopes retain routing identities', async () => {
  for (const name of [
    'net-fanout',
    'net-bidirectional',
    'boundary-groups',
    'collection-instances',
    'signal-schematic',
  ]) {
    const raw = JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8')),
      before = await layoutDiagram(createDiagramModel(raw));
    raw.layout ??= {};
    raw.layout.portAdjustment = 'reduce-bends';
    raw.layout.maxPortShift = 80;
    const model = createDiagramModel(raw),
      after = await layoutDiagram(model);
    copyLayout(after);
    sameBlocks(before, after);
    assert.deepEqual(
      after.connections.map((e) => [e.id, e.source, e.target]),
      before.connections.map((e) => [e.id, e.source, e.target]),
    );
    assert.ok(!after.modules.some((n) => n.id.startsWith('_signal_')));
    const starts = (l) =>
      new Set(
        l.connections.flatMap((e) =>
          (e.labelInstances ?? []).filter((t) => t.role === 'start').map((t) => t.sharedKey),
        ),
      ).size;
    assert.equal(starts(after), starts(before));
    for (const g of model.groups)
      if (g.id === 'Inner') {
        const scoped = await layoutDiagram(model, { rootGroupId: g.id });
        copyLayout(scoped);
      }
  }
});

test('Port adjustment schema and model reject invalid modes and limits consistently', () => {
  for (const config of [
    { portAdjustment: 'floating' },
    { portAdjustment: null },
    { maxPortShift: -1 },
    { maxPortShift: '40' },
    { maxPortShift: null },
  ]) {
    const d = structuredClone(sample);
    Object.assign(d.layout, config);
    assert.equal(validate(d), false);
    assert.throws(() => createDiagramModel(d));
  }
  for (const config of [
    { portAdjustment: 'fixed' },
    { portAdjustment: 'reduce-bends', maxPortShift: 0 },
    { maxPortShift: 12.5 },
  ]) {
    const d = structuredClone(sample);
    Object.assign(d.layout, config);
    assert.equal(validate(d), true, JSON.stringify(validate.errors));
    createDiagramModel(d);
  }
  const d = structuredClone(sample);
  d.layout.maxPortShift = Infinity;
  assert.throws(() => createDiagramModel(d), /finite non-negative/);
});

test('An intervening block keeps necessary bends; visible ports never swap or overlap names', async () => {
  const raw = structuredClone(sample);
  raw.modules.push({ id: 'Wall', height: 7 });
  raw.layout.cells = [['Inputs', 'Processor', 'Wall', 'Outputs']];
  const result = await layoutDiagram(createDiagramModel(raw)),
    wall = result.modules.find((n) => n.id === 'Wall');
  copyLayout(result);
  for (const edge of result.connections.filter((e) => e.source.moduleId === 'Processor')) {
    assert.ok(bends({ connections: [edge] }) >= 2);
    for (const s of edge.sections)
      for (let i = 1; i < s.points.length; i++) {
        const a = s.points[i - 1],
          b = s.points[i];
        if (Math.abs(a.y - b.y) < 1e-6)
          assert.ok(
            a.y <= wall.y ||
              a.y >= wall.y + wall.height ||
              Math.max(a.x, b.x) <= wall.x ||
              Math.min(a.x, b.x) >= wall.x + wall.width,
          );
        else
          assert.ok(
            a.x <= wall.x ||
              a.x >= wall.x + wall.width ||
              Math.max(a.y, b.y) <= wall.y ||
              Math.min(a.y, b.y) >= wall.y + wall.height,
          );
      }
  }
  const named = structuredClone(sample);
  named.diagram.style.module.portLabel.hidden = false;
  named.groups.find((g) => g.id === 'Outputs').layout.cells.reverse();
  const l = await layoutDiagram(createDiagramModel(named));
  copyLayout(l);
  const middle = l.modules.find((n) => n.id === 'Processor');
  for (const side of ['left', 'right']) {
    const ports = middle.ports.filter((p) => p.side === side);
    for (let i = 1; i < ports.length; i++) {
      assert.ok(ports[i].y - ports[i - 1].y >= 24 - 1e-6);
      assert.ok(ports[i].labelBounds.y >= ports[i - 1].labelBounds.y + ports[i - 1].labelBounds.height + 3);
    }
  }
});

const terminalSample = JSON.parse(
  await readFile(new URL('../../examples/terminals.json', import.meta.url), 'utf8'),
);
function terminalEndpoints(layout) {
  for (const edge of layout.connections)
    for (const [ref, point] of [
      [edge.source, edge.sections[0].points[0]],
      [edge.target, edge.sections.at(-1).points.at(-1)],
    ])
      if (ref.terminal !== undefined)
        assert.deepEqual(point, layout.terminals.find((t) => t.id === ref.terminal).anchor);
}
for (const direction of ['right', 'down'])
  test(`Terminals slide with their names and reroute endpoints in ${direction} flow`, async () => {
    const raw = structuredClone(terminalSample);
    raw.layout = { ...raw.layout, direction, portAdjustment: 'fixed', maxPortShift: 120 };
    const fixed = await layoutDiagram(createDiagramModel(raw));
    raw.layout.portAdjustment = 'reduce-bends';
    const snapshot = structuredClone(raw),
      model = createDiagramModel(freeze(structuredClone(raw)));
    const after = await layoutDiagram(freeze(model));
    assert.deepEqual(raw, snapshot);
    assert.deepEqual(await layoutDiagram(model), after);
    sameBlocks(fixed, after);
    assert.ok(bends(fixed) > 0);
    assert.equal(bends(after), 0);
    terminalEndpoints(after);
    copyLayout(after);
    const axis = direction === 'down' ? 'x' : 'y',
      normal = axis === 'x' ? 'y' : 'x';
    let moved = 0;
    for (const terminal of after.terminals) {
      const old = fixed.terminals.find((t) => t.id === terminal.id);
      const delta = terminal[axis] - anchor(after)[axis] - (old[axis] - anchor(fixed)[axis]);
      if (Math.abs(delta) > 1e-6) moved++;
      assert.ok(Math.abs(delta) <= 120 + 1e-6);
      near(terminal[normal] - anchor(after)[normal], old[normal] - anchor(fixed)[normal]);
      for (const field of ['anchor', 'labelPosition', 'labelBounds']) {
        near(terminal[field][axis] - terminal[axis], old[field][axis] - old[axis]);
        near(terminal[field][normal] - terminal[normal], old[field][normal] - old[normal]);
      }
      for (const node of after.modules)
        assert.ok(
          terminal.x + terminal.width <= node.x ||
            node.x + node.width <= terminal.x ||
            terminal.y + terminal.height <= node.y ||
            node.y + node.height <= terminal.y,
        );
    }
    assert.ok(moved > 0, 'Terminal movement must contribute to bend reduction');
    for (const side of ['input', 'output']) {
      const ordered = after.terminals.filter((t) => t.direction === side);
      const extent = axis === 'x' ? 'width' : 'height';
      for (let i = 1; i < ordered.length; i++)
        assert.ok(ordered[i][axis] >= ordered[i - 1][axis] + ordered[i - 1][extent] + 6 - 1e-6);
    }
    raw.layout.maxPortShift = 0;
    assert.deepEqual(await layoutDiagram(createDiagramModel(raw)), fixed);
    raw.layout.maxPortShift = 4;
    const small = await layoutDiagram(createDiagramModel(raw));
    terminalEndpoints(small);
    for (const terminal of small.terminals) {
      const old = fixed.terminals.find((t) => t.id === terminal.id);
      assert.ok(
        Math.abs(terminal[axis] - anchor(small)[axis] - (old[axis] - anchor(fixed)[axis])) <= 4 + 1e-6,
      );
    }
  });

test('Terminal fan-out, shared signal labels and feedback keep every branch attached', async () => {
  const raw = structuredClone(terminalSample);
  raw.modules.push({ id: 'Monitor', ports: [{ id: 'in', direction: 'input' }] });
  raw.connections[0].to.push('Monitor.in');
  raw.connections[0].label = 'Shared data';
  raw.layout = { ...raw.layout, maxPortShift: 120, portAdjustment: 'fixed' };
  const baseline = await layoutDiagram(createDiagramModel(raw));
  raw.layout.portAdjustment = 'reduce-bends';
  const after = await layoutDiagram(createDiagramModel(raw));
  terminalEndpoints(after);
  assert.deepEqual(
    after.connections.map((e) => [e.id, e.source, e.target]),
    baseline.connections.map((e) => [e.id, e.source, e.target]),
  );
  assert.equal(after.connections.filter((e) => e.source.terminal === 'DataIn').length, 2);
  assert.ok(!after.modules.some((n) => n.id.startsWith('_signal_')));
  copyLayout(after);
  raw.connections[1].feedback = true;
  raw.layout.portAdjustment = 'fixed';
  const fixed = await layoutDiagram(createDiagramModel(raw));
  raw.layout.portAdjustment = 'reduce-bends';
  const locked = await layoutDiagram(createDiagramModel(raw));
  const position = (l) => l.terminals.find((t) => t.id === 'CommandIn').anchor;
  near(position(locked).y - anchor(locked).y, position(fixed).y - anchor(fixed).y);
  terminalEndpoints(locked);
});
