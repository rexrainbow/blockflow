import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';
import { fixture } from './helpers.js';
import sharp from 'sharp';

for (const direction of ['right', 'down'])
  test('Source labels reserve layout space without changing real block geometry ' + direction, async () => {
    const raw = fixture();
    raw.layout = { direction };
    const base = await layoutDiagram(createDiagramModel(raw));
    raw.connections[0].label = 'A long signal name\nwith multiple lines';
    raw.connections[0].style = { label: { fontSize: 30, padding: 6 } };
    const result = await layoutDiagram(createDiagramModel(raw));
    copyLayout(result);
    assert.deepEqual(
      result.modules.map((n) => [n.id, n.width, n.height]),
      base.modules.map((n) => [n.id, n.width, n.height]),
    );
    assert.ok(result.width > base.width || result.height > base.height);
    assert.ok([...result.modules, ...(result.groups ?? [])].every((n) => !n.id.startsWith('_signal_')));
    const label = result.connections[0].labelInstances[0];
    assert.equal(label.role, 'start');
    assert.equal(label.placement, 'inline');
    assert.ok(
      label.bounds.x >= 0 &&
        label.bounds.y >= 0 &&
        label.bounds.x + label.bounds.width <= result.width &&
        label.bounds.y + label.bounds.height <= result.height,
    );
  });

test('Receiver repetition reserves layout space and attaches inline beside the target Port', async () => {
  const raw = fixture();
  raw.connections[0].label = 'Data';
  raw.connections[0].style = { label: { repeatAtEnd: 'never' } };
  const never = await layoutDiagram(createDiagramModel(raw));
  raw.connections[0].style.label.repeatAtEnd = 'always';
  const always = await layoutDiagram(createDiagramModel(raw));
  const relative = (l) => {
    const origin = l.modules[0];
    return l.modules.map((n) => [n.id, n.x - origin.x, n.y - origin.y, n.width, n.height]);
  };
  assert.notDeepEqual(relative(always), relative(never));
  assert.equal(never.connections[0].labelInstances.length, 1);
  assert.equal(always.connections[0].labelInstances.length, 2);
  assert.equal(always.connections[0].labelInstances[1].placement, 'inline');
  assert.equal(always.connections[0].labelInstances[1].leader, undefined);
  copyLayout(always);
  const png = await sharp(Buffer.from(renderSvg(always)))
    .png()
    .toBuffer();
  assert.equal((await sharp(png).metadata()).format, 'png');
});

test('Old label placement and position fields are rejected instead of silently translated', () => {
  for (const label of [{ placement: 'inline' }, { position: 'both' }, { placement: 'callout' }]) {
    const raw = fixture();
    raw.connections[0].label = 'Data';
    raw.connections[0].style = { label };
    assert.throws(() => createDiagramModel(raw), /Unsupported style property/);
  }
});

test('Hidden source names omit the virtual footprint and every repeated label', async () => {
  const raw = fixture(),
    baseline = await layoutDiagram(createDiagramModel(raw));
  raw.connections[0].label = 'Hidden signal';
  raw.connections[0].style = { label: { hidden: true, repeatAtEnd: 'always' } };
  const layout = await layoutDiagram(createDiagramModel(raw));
  assert.deepEqual(layout.modules, baseline.modules);
  assert.deepEqual(layout.connections[0].labelInstances, []);
  assert.ok(!renderSvg(layout).includes('data-role="connection-label"'));
  copyLayout(layout);
});
