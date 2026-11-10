import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { groupCornerRadius } from '../../src/lib/blockchart/styles.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';

const sample = (type = 'container', collapsed = false, radius = 12) => ({
  version: 1,
  diagram: { name: 'Rounded groups' },
  modules: [{ id: 'A' }],
  groups: [
    {
      id: 'G',
      type,
      collapsed,
      members: ['A'],
      style: { borderRadius: radius },
      ...(type === 'boundary'
        ? {
            ports: [
              { id: 'i', direction: 'input' },
              { id: 'o', direction: 'output' },
            ],
          }
        : {}),
    },
  ],
});

test('rounded frames and collapsed faces/cards share validated radius and retain geometry', async () => {
  for (const [type, collapsed] of [
    ['container', false],
    ['boundary', false],
    ['boundary', true],
    ['collection', true],
  ]) {
    const raw = sample(type, collapsed);
    if (type === 'collection') {
      raw.modules.push({ id: 'B' });
      raw.groups[0].members.push('B');
    }
    const before = structuredClone(raw),
      layout = await layoutDiagram(createDiagramModel(raw));
    assert.deepEqual(copyLayout(layout), layout);
    assert.deepEqual(raw, before);
    const svg = renderSvg(layout);
    assert.match(svg, /<rect data-role="group"[^>]*rx="12" ry="12"/);
    if (type === 'collection') assert.match(svg, /data-role="collection-layer"[^>]*rx="12"/);
    raw.groups[0].style.borderRadius = 0;
    const square = await layoutDiagram(createDiagramModel(raw));
    assert.equal(square.width, layout.width);
    assert.equal(square.height, layout.height);
    assert.deepEqual(square.modules, layout.modules);
    assert.deepEqual(square.groups[0].ports, layout.groups[0].ports);
    assert.ok(!renderSvg(square).includes('rx="'));
    assert.ok((await sharp(Buffer.from(svg)).png().toBuffer()).length > 100);
  }
});

test('group-only radius rejects unsafe values and clamps huge radii to the inset rectangle', async () => {
  for (const borderRadius of [-1, null, '12', true, Infinity, NaN]) {
    const raw = sample();
    raw.groups[0].style.borderRadius = borderRadius;
    assert.throws(() => createDiagramModel(raw));
  }
  const raw = sample('container', false, 100000),
    layout = await layoutDiagram(createDiagramModel(raw)),
    g = layout.groups[0];
  assert.equal(
    groupCornerRadius(g),
    Math.min((g.width - g.style.borderWidth) / 2, (g.height - g.style.borderWidth) / 2),
  );
  const bad = structuredClone(layout);
  bad.groups[0].style.borderRadius = '12" onload="bad';
  assert.throws(() => copyLayout(bad));
  const module = sample();
  module.modules[0].style = { borderRadius: 12 };
  assert.throws(() => createDiagramModel(module), /Unsupported style/);
});

test('components migration replaces signal ovals with labels/abstract concat and preserves auto groups', async () => {
  const raw = JSON.parse(
    await readFile(new URL('../../examples/processor-components.json', import.meta.url), 'utf8'),
  );
  assert.equal(raw.modules.length, 16);
  assert.equal(raw.groups.length, 9);
  assert.equal(raw.connections.length, 20);
  assert.equal(raw.connections.reduce((n,c)=>n+c.to.length,0),34);
  assert.equal(raw.modules.filter((n) => n.type === 'concat').length, 3);
  assert.ok(
    !raw.modules.some((n) =>
      ['FilterOvlIn', 'CombOvlIn', 'TriggerInputs', 'UnitOut', 'GlueLogicOutput', 'WatchDogBite'].includes(
        n.id,
      ),
    ),
  );
  assert.ok(raw.modules.every((n) => n.ports.every((p) => p.width === undefined)));
  assert.equal(raw.layout.direction, 'down');
  assert.equal(raw.layout.cells, undefined);
  assert.ok(raw.groups.every((g) => g.style.borderRadius === 12 && g.layout === undefined));
  const model = createDiagramModel(raw),
    layout = await layoutDiagram(model);
  assert.deepEqual(copyLayout(layout), layout);
  assert.equal(layout.warnings, undefined);
  const svg = renderSvg(layout);
  assert.equal((svg.match(/data-role="group"/g) ?? []).length, 9);
  assert.equal((svg.match(/rx="12"/g) ?? []).length, 9);
  assert.ok(raw.connections.some((e) => e.label?.replace(/\s+/g, ' ').includes('Filtered data inputs')));
  assert.ok(svg.includes('x(8+1)x2 cores + 1'));
  assert.equal((svg.match(/connection-arrow/g) ?? []).length, 34);
  for (const rootGroupId of ['InputSubsystem', 'Processor', 'DecodeStage', 'WritebackStage']) {
    const scoped = await layoutDiagram(model, { rootGroupId });
    assert.deepEqual(copyLayout(scoped), scoped);
    if (rootGroupId === 'Processor') {
      assert.ok(!scoped.modules.some((n) => n.id === 'ResultBus'));
      assert.ok(
        !scoped.connections.some(
          (e) => e.source.moduleId === 'ResultBus' || e.target.moduleId === 'ResultBus',
        ),
      );
    }
  }
  assert.ok((await sharp(Buffer.from(svg)).png().toBuffer()).length > 1000);
});
